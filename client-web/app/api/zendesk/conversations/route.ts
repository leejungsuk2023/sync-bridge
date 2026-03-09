import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ZendeskClient } from '@/lib/zendesk';

export const maxDuration = 30;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function withCors(response: NextResponse) {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function translateToKorean(texts: { id: string; body: string }[]): Promise<Map<string, string>> {
  if (texts.length === 0) return new Map();

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = `You are a translator for a Korean medical tourism company. Translate these Thai customer service messages to Korean. Keep emojis. Return ONLY a JSON array of translated strings in the same order.

Messages:
${texts.map((t, i) => `${i + 1}. ${t.body}`).join('\n')}

Return JSON array like: ["translation1", "translation2", ...]`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  const jsonMatch = responseText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return new Map();

  try {
    const translations: string[] = JSON.parse(jsonMatch[0]);
    const map = new Map<string, string>();
    texts.forEach((t, i) => {
      if (translations[i]) map.set(t.id, translations[i]);
    });
    return map;
  } catch {
    return new Map();
  }
}

async function verifyUser(req: NextRequest): Promise<{ role: string; userId: string } | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!profile || !['bbg_admin', 'worker', 'client'].includes(profile.role)) return null;
  return { role: profile.role, userId: user.id };
}

// Live-sync: pull fresh comments from Zendesk API and insert missing ones into DB.
// Throttled per ticket to avoid hammering Zendesk on every frontend poll.
const syncTimestamps = new Map<number, number>();
const SYNC_COOLDOWN_MS = 10_000; // 10 seconds cooldown per ticket

async function liveSyncTicketComments(ticketIdNum: number): Promise<number> {
  const lastSync = syncTimestamps.get(ticketIdNum) || 0;
  if (Date.now() - lastSync < SYNC_COOLDOWN_MS) return 0;
  syncTimestamps.set(ticketIdNum, Date.now());

  try {
    const zendesk = new ZendeskClient();
    const comments = await zendesk.fetchTicketComments(ticketIdNum);
    if (!comments || comments.length === 0) return 0;

    // Get existing comment_ids
    const { data: existing } = await supabaseAdmin
      .from('zendesk_conversations')
      .select('comment_id')
      .eq('ticket_id', ticketIdNum);

    const existingIds = new Set((existing || []).map((c: any) => c.comment_id).filter(Boolean));
    const missing = comments.filter((c: any) => !existingIds.has(c.id));
    if (missing.length === 0) return 0;

    // Fetch requester_id for author type detection
    let requesterId: number | null = null;
    try {
      const zdAuth = 'Basic ' + Buffer.from(
        `${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`
      ).toString('base64');
      const ticketRes = await fetch(
        `https://${process.env.ZENDESK_SUBDOMAIN || 'bluebridge-globalhelp'}.zendesk.com/api/v2/tickets/${ticketIdNum}.json`,
        { headers: { Authorization: zdAuth, 'Content-Type': 'application/json' } }
      );
      if (ticketRes.ok) {
        const td = await ticketRes.json();
        requesterId = td.ticket?.requester_id || null;
      }
    } catch (err) {
      console.error(`[Conversations] Error fetching ticket #${ticketIdNum} detail:`, err);
    }

    let inserted = 0;
    for (const comment of missing) {
      const isCustomer = requesterId && comment.author_id === requesterId;
      const authorType = isCustomer ? 'customer' : 'agent';
      const plainBody = (comment.body || '')
        .replace(/<[^>]*>/g, '')
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

      const { error: insertError } = await supabaseAdmin
        .from('zendesk_conversations')
        .insert({
          ticket_id: ticketIdNum,
          comment_id: comment.id,
          author_zendesk_id: comment.author_id,
          author_type: authorType,
          body: plainBody,
          body_html: comment.body || null,
          is_public: comment.public !== false,
          created_at_zd: comment.created_at,
        });

      if (!insertError) {
        inserted++;
      } else if (insertError.code !== '23505') {
        console.error(`[Conversations] Live-sync insert error for comment ${comment.id}:`, insertError);
      }
    }

    if (inserted > 0) {
      console.log(`[Conversations] Live-synced ${inserted} new comments for ticket #${ticketIdNum}`);

      // Update ticket metadata
      const allSorted = [...missing].sort(
        (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      const ticketUpdate: Record<string, any> = {
        last_message_at: allSorted[0]?.created_at || new Date().toISOString(),
      };
      const latestCustomer = missing.find((c: any) => requesterId && c.author_id === requesterId);
      if (latestCustomer) {
        ticketUpdate.last_customer_comment_at = latestCustomer.created_at;
        ticketUpdate.is_read = false;
      }
      await supabaseAdmin
        .from('zendesk_tickets')
        .update(ticketUpdate)
        .eq('ticket_id', ticketIdNum);
    }

    return inserted;
  } catch (err) {
    console.error(`[Conversations] Live-sync error for ticket #${ticketIdNum}:`, err);
    return 0;
  }
}

export async function GET(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  try {
    const { searchParams } = new URL(req.url);
    const ticketId = searchParams.get('ticket_id');

    if (!ticketId) {
      return withCors(NextResponse.json({ error: 'ticket_id is required' }, { status: 400 }));
    }

    const ticketIdNum = parseInt(ticketId, 10);
    if (isNaN(ticketIdNum)) {
      return withCors(NextResponse.json({ error: 'ticket_id must be a number' }, { status: 400 }));
    }

    // Live-sync: pull fresh comments from Zendesk before serving (throttled)
    await liveSyncTicketComments(ticketIdNum);

    // Fetch conversations ordered by creation time
    const { data: conversations, error: convError } = await supabaseAdmin
      .from('zendesk_conversations')
      .select('*')
      .eq('ticket_id', ticketIdNum)
      .order('created_at_zd', { ascending: true });

    if (convError) {
      console.error('[Conversations] Error fetching conversations:', convError);
      return withCors(NextResponse.json({ error: convError.message }, { status: 500 }));
    }

    // Fetch ticket metadata
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from('zendesk_tickets')
      .select('ticket_id, subject, status, tags, requester_name, requester_email, assignee_name, assignee_email, priority, created_at_zd, updated_at_zd')
      .eq('ticket_id', ticketIdNum)
      .single();

    if (ticketError && ticketError.code !== 'PGRST116') {
      console.error('[Conversations] Error fetching ticket:', ticketError);
    }

    const locale = searchParams.get('locale');

    // If locale=ko, translate Thai messages to Korean and cache
    if (locale === 'ko' && conversations && conversations.length > 0) {
      // Find conversations needing translation: all non-system messages
      const needTranslation = conversations.filter(
        (c: any) =>
          c.body_ko === null &&
          c.body &&
          c.author_type !== 'system'
      );

      if (needTranslation.length > 0) {
        // Batch translate up to 20 at a time
        const BATCH_SIZE = 20;
        for (let i = 0; i < needTranslation.length; i += BATCH_SIZE) {
          const batch = needTranslation.slice(i, i + BATCH_SIZE).map((c: any) => ({
            id: c.id,
            body: c.body,
          }));

          try {
            const translations = await translateToKorean(batch);

            // Cache translations back to DB
            for (const [id, translation] of translations) {
              const { error: updateErr } = await supabaseAdmin
                .from('zendesk_conversations')
                .update({ body_ko: translation })
                .eq('id', id);

              if (updateErr) {
                console.error(`[Conversations] Failed to cache body_ko for ${id}:`, updateErr);
              } else {
                // Update in-memory data too
                const conv = conversations.find((c: any) => c.id === id);
                if (conv) (conv as any).body_ko = translation;
              }
            }

            console.log(`[Conversations] Translated ${translations.size}/${batch.length} messages to Korean for ticket #${ticketIdNum}`);
          } catch (translateErr) {
            console.error('[Conversations] Translation error:', translateErr);
            // Continue without translation — original Thai text will be shown
          }
        }
      }
    }

    console.log(`[Conversations] Returned ${(conversations || []).length} messages for ticket #${ticketIdNum}${locale === 'ko' ? ' (locale=ko)' : ''}`);

    return withCors(NextResponse.json({
      conversations: conversations || [],
      ticket: ticket || null,
    }));
  } catch (err: any) {
    console.error('[Conversations] Error:', err);
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}
