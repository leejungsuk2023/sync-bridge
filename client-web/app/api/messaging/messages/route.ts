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

export async function GET(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  try {
    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get('conversation_id');
    const locale = searchParams.get('locale');

    if (!conversationId) {
      return withCors(NextResponse.json({ error: 'conversation_id is required' }, { status: 400 }));
    }

    // Fetch messages ordered by creation time ascending
    const { data: messages, error: msgsError } = await supabaseAdmin
      .from('channel_messages')
      .select('id, conversation_id, sender_type, sender_agent_id, sender_customer_id, sender_name, message_type, body, body_ko, media_url, media_metadata, is_public, external_message_id, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (msgsError) {
      console.error('[Messaging] Error fetching messages:', msgsError);
      return withCors(NextResponse.json({ error: msgsError.message }, { status: 500 }));
    }

    // Fetch agent display names for agent messages
    const agentIds = [...new Set(
      (messages || [])
        .filter(m => m.sender_type === 'agent' && m.sender_agent_id)
        .map(m => m.sender_agent_id!)
    )];

    const agentNameMap = new Map<string, string>();
    if (agentIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name')
        .in('id', agentIds);

      for (const p of profiles || []) {
        if (p.full_name) agentNameMap.set(p.id, p.full_name);
      }
    }

    // Enrich messages with resolved sender_name for agents
    const enrichedMessages = (messages || []).map(m => ({
      ...m,
      sender_name: m.sender_type === 'agent' && m.sender_agent_id
        ? (agentNameMap.get(m.sender_agent_id) || m.sender_name || 'Agent')
        : m.sender_name,
    }));

    // Fetch conversation metadata
    const { data: conversation, error: convError } = await supabaseAdmin
      .from('channel_conversations')
      .select(
        `id, channel_id, channel_type, status, is_read, last_message_at, last_customer_message_at, last_agent_message_at, assigned_agent_id, hospital_prefix, created_at,
         customers(display_name, avatar_url, line_user_id, facebook_user_id),
         messaging_channels(channel_name)`
      )
      .eq('id', conversationId)
      .single();

    if (convError && convError.code !== 'PGRST116') {
      console.error('[Messaging] Error fetching conversation:', convError);
    }

    // If locale=ko, translate Thai messages to Korean and cache
    if (locale === 'ko' && enrichedMessages.length > 0) {
      const needTranslation = enrichedMessages.filter(
        m => (m as any).body_ko === null && m.body && m.sender_type !== 'system'
      );

      if (needTranslation.length > 0) {
        const BATCH_SIZE = 20;
        for (let i = 0; i < needTranslation.length; i += BATCH_SIZE) {
          const batch = needTranslation.slice(i, i + BATCH_SIZE).map(m => ({
            id: m.id,
            body: m.body as string,
          }));

          try {
            const translations = await translateToKorean(batch);

            for (const [id, translation] of translations) {
              const { error: updateErr } = await supabaseAdmin
                .from('channel_messages')
                .update({ body_ko: translation })
                .eq('id', id);

              if (updateErr) {
                console.error(`[Messaging] Failed to cache body_ko for message ${id}:`, updateErr);
              } else {
                const msg = enrichedMessages.find(m => m.id === id);
                if (msg) (msg as any).body_ko = translation;
              }
            }

            console.log(`[Messaging] Translated ${translations.size}/${batch.length} messages to Korean for conversation ${conversationId}`);
          } catch (translateErr) {
            console.error('[Messaging] Translation error:', translateErr);
          }
        }
      }
    }

    console.log(`[Messaging] Returned ${enrichedMessages.length} messages for conversation ${conversationId}${locale === 'ko' ? ' (locale=ko)' : ''}`);

    return withCors(NextResponse.json({
      messages: enrichedMessages,
      conversation: conversation || null,
    }));
  } catch (err: any) {
    console.error('[Messaging] Messages error:', err);
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}
