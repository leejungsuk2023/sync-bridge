import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI, SchemaType, Schema } from '@google/generative-ai';

export const maxDuration = 300; // Vercel Pro allows 300s for cron

// CORS headers
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

// Verify cron secret (Vercel sends this header automatically)
function verifyCron(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

// Response schema for Gemini structured output (same as main RAG indexer)
const ragIndexSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    search_summary: { type: SchemaType.STRING },
    key_turns: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          role: { type: SchemaType.STRING },
          message: { type: SchemaType.STRING },
          turn: { type: SchemaType.NUMBER },
        },
        required: ['role', 'message'],
      },
    },
    customer_concern: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    procedure_category: { type: SchemaType.STRING },
  },
  required: ['search_summary', 'key_turns', 'customer_concern', 'procedure_category'],
};

// Korean Diet specific prompt
function buildKoreanDietPrompt(commentsText: string): string {
  return `아래 Korean Diet(한방 다이어트 약) 판매 상담 대화를 분석하여 다음 JSON을 생성하세요.

{
  "search_summary": "태국어로 작성. 형식:
    สินค้า: โคเรียนไดเอท {ระดับ/สี}
    ลูกค้า: {고객 특성}
    สถานการณ์: {상담 흐름 요약, 화살표(→) 연결}
    จุดเปลี่ยน: {구매 결정 포인트}
    ข้อกังวล: {고객 우려사항 키워드 3-5개}",
  "key_turns": [
    {"role": "customer"|"agent", "message": "100자 이내 핵심만", "turn": 번호}
  ],
  "customer_concern": ["ราคา", "วิธีทาน", ...],
  "procedure_category": "다이어트"
}

key_turns는 판매 전환에 결정적이었던 3-5턴만 (가격 안내, 주문 확인, 결제 안내, 복용법 등).
단순 인사/확인 제외. 각 message는 100자 이내로 핵심만 추출.

대화:
${commentsText}`;
}

// Generate embedding via Gemini gemini-embedding-001
async function generateEmbedding(text: string): Promise<number[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text }] },
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: 768,
      }),
    }
  );
  const data = await res.json();
  if (!data.embedding?.values) {
    throw new Error(`Embedding API error: ${JSON.stringify(data)}`);
  }
  return data.embedding.values as number[];
}

const MAX_TICKETS_PER_RUN = 10;
const MIN_TOTAL_CHARS = 200;
const MIN_COMMENT_COUNT = 5;

export async function GET(req: NextRequest) {
  if (!verifyCron(req)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  if (!process.env.GEMINI_API_KEY) {
    return withCors(NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 }));
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: ragIndexSchema,
      maxOutputTokens: 8192,
    },
  });

  let indexed = 0;
  let failed = 0;
  let skipped = 0;

  try {
    // 1. Get Korean Diet LINE channel IDs
    const { data: channels } = await supabaseAdmin
      .from('messaging_channels')
      .select('id')
      .eq('channel_type', 'line')
      .eq('hospital_prefix', 'koreandiet');

    const channelIds = (channels || []).map(c => c.id);
    if (channelIds.length === 0) {
      return withCors(NextResponse.json({ message: 'No Korean Diet LINE channels found', indexed: 0 }));
    }

    // 2. Fetch already-indexed conversation IDs
    const { data: existingIndex } = await supabaseAdmin
      .from('case_index')
      .select('ticket_id')
      .eq('hospital_name', 'Korean Diet')
      .neq('status', 'failed');

    const existingIds = new Set<number>((existingIndex || []).map((r: any) => r.ticket_id));
    console.log(`[KoreanDiet RAG] Already indexed: ${existingIds.size} conversations`);

    // 3. Fetch Korean Diet LINE conversations
    const { data: conversations } = await supabaseAdmin
      .from('channel_conversations')
      .select('id, customer_id, last_message_at')
      .in('channel_id', channelIds)
      .eq('channel_type', 'line')
      .order('last_message_at', { ascending: false })
      .limit(100);

    // Helper: convert UUID to integer for ticket_id compatibility (max 2,147,483,647)
    function uuidToInt(uuid: string): number {
      return parseInt(uuid.replace(/-/g, '').substring(0, 8), 16) % 2147483647;
    }

    // 4. Filter and process conversations
    const toProcess: Array<{ convId: string; ticketId: number }> = [];
    for (const conv of conversations || []) {
      const ticketId = uuidToInt(conv.id);
      if (existingIds.has(ticketId)) continue;
      toProcess.push({ convId: conv.id, ticketId });
    }

    console.log(`[KoreanDiet RAG] Conversations to process: ${Math.min(toProcess.length, MAX_TICKETS_PER_RUN)} (of ${toProcess.length} eligible)`);

    const batch = toProcess.slice(0, MAX_TICKETS_PER_RUN);

    for (const { convId, ticketId } of batch) {
      // Fetch messages for this conversation
      const { data: messages } = await supabaseAdmin
        .from('channel_messages')
        .select('sender_type, body, message_type, created_at')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true });

      const msgs = messages || [];

      // Filter: minimum message count and character count
      if (msgs.length < MIN_COMMENT_COUNT) {
        skipped++;
        continue;
      }
      const totalChars = msgs.reduce((sum, m) => sum + (m.body?.length || 0), 0);
      if (totalChars < MIN_TOTAL_CHARS) {
        skipped++;
        continue;
      }

      // Build conversation text
      const commentsText = msgs
        .map(m => {
          const role = m.sender_type === 'customer' ? 'customer' : 'agent';
          if (m.message_type === 'image') return `[${role}]: [ส่งรูปภาพ]`;
          return `[${role}]: ${m.body || ''}`;
        })
        .join('\n\n');

      if (!commentsText.trim()) {
        skipped++;
        continue;
      }

      console.log(`[KoreanDiet RAG] Processing conversation ${convId} (${msgs.length} messages)...`);

      // Check for existing failed entry
      const { data: existingFailed } = await supabaseAdmin
        .from('case_index')
        .select('id')
        .eq('ticket_id', ticketId)
        .eq('status', 'failed')
        .limit(1);

      try {
        // Gemini structured analysis
        const prompt = buildKoreanDietPrompt(commentsText);
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const parsed = JSON.parse(text);

        const { search_summary, key_turns, customer_concern, procedure_category } = parsed;

        if (!search_summary || !Array.isArray(key_turns) || key_turns.length === 0) {
          throw new Error('Gemini returned invalid structure');
        }

        // Generate embedding
        const embedding = await generateEmbedding(search_summary);

        // Store full conversation
        const conversationFull = msgs.map(m => ({
          sender_type: m.sender_type,
          body: m.body,
          message_type: m.message_type,
          created_at: m.created_at,
        }));

        const { error: convError } = await supabaseAdmin
          .from('case_conversations')
          .upsert(
            { ticket_id: ticketId, conversation_full: conversationFull },
            { onConflict: 'ticket_id' }
          );

        if (convError) throw new Error(`case_conversations insert failed: ${convError.message}`);

        // Remove previous failed entry
        if (existingFailed && existingFailed.length > 0) {
          await supabaseAdmin.from('case_index').delete().eq('ticket_id', ticketId).eq('status', 'failed');
        }

        // Upsert case_index
        const { error: indexError } = await supabaseAdmin
          .from('case_index')
          .upsert(
            {
              ticket_id: ticketId,
              search_summary,
              embedding: `[${embedding.join(',')}]`,
              key_turns,
              hospital_name: 'Korean Diet',
              procedure_category: procedure_category || '다이어트',
              customer_concern: customer_concern || [],
              status: 'indexed',
              embedding_model: 'gemini-embedding-001',
            },
            { onConflict: 'ticket_id' }
          );

        if (indexError) throw new Error(`case_index insert failed: ${indexError.message}`);

        indexed++;
        console.log(`[KoreanDiet RAG] Indexed conversation ${convId} → ticketId ${ticketId}`);
      } catch (err: any) {
        failed++;
        console.error(`[KoreanDiet RAG] Failed conversation ${convId}:`, err.message);

        await supabaseAdmin.from('case_index').upsert(
          {
            ticket_id: ticketId,
            search_summary: '',
            key_turns: [],
            hospital_name: 'Korean Diet',
            status: 'failed',
            embedding_model: 'gemini-embedding-001',
          },
          { onConflict: 'ticket_id' }
        );
      }
    }

    const remaining = toProcess.length - batch.length;
    console.log(
      `[KoreanDiet RAG] Done — indexed: ${indexed}, failed: ${failed}, skipped: ${skipped}` +
        (remaining > 0 ? `, remaining: ${remaining}` : ', all eligible processed')
    );
  } catch (err: any) {
    console.error('[KoreanDiet RAG] Fatal error:', err.message);
    return withCors(NextResponse.json({ error: err.message, indexed, failed, skipped }, { status: 500 }));
  }

  return withCors(NextResponse.json({ indexed, failed, skipped }));
}
