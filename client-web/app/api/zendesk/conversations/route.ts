import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
  if (!profile || (profile.role !== 'bbg_admin' && profile.role !== 'worker')) return null;
  return { role: profile.role, userId: user.id };
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
      // Find conversations needing translation: customer messages and short agent messages, excluding system
      const needTranslation = conversations.filter(
        (c: any) =>
          c.body_ko === null &&
          c.body &&
          c.author_type !== 'system' &&
          (c.author_type === 'customer' || c.body.length < 500)
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
