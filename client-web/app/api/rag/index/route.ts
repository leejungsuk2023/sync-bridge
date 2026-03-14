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

// Response schema for Gemini structured output
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

// Build the indexing prompt
function buildIndexPrompt(commentsText: string): string {
  return `아래 의료관광 상담 대화를 분석하여 다음 JSON을 생성하세요.

{
  "search_summary": "태국어로 작성. 한국어 시술명 병기. 형식:
    หัตถการ: {시술명 태국어} ({한국어})
    ลูกค้า: {연령대, 성별, 거주지}
    สถานการณ์: {상담 흐름 한 줄, 화살표(→) 연결}
    จุดเปลี่ยน: {예약 결정에 결정적이었던 포인트}
    ข้อกังวล: {고객 우려사항 키워드 3-5개}",
  "key_turns": [
    {"role": "customer"|"agent", "message": "100자 이내 핵심만", "turn": 번호(optional)}
  ],
  "customer_concern": ["가격", "다운타임", ...],
  "procedure_category": "코성형"
}

key_turns는 전환에 결정적이었던 3-5턴만. 단순 인사/확인 제외.
각 message는 100자 이내로 핵심만 추출.

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
  let invalidated = 0;
  let failed = 0;

  // === STEP 1: Find unindexed success cases ===
  try {
    // Get ticket_ids already in case_index (non-failed)
    const { data: existingIndex } = await supabaseAdmin
      .from('case_index')
      .select('ticket_id')
      .neq('status', 'failed');

    const existingTicketIds = (existingIndex || []).map((r: any) => r.ticket_id);

    // Query success cases not yet indexed
    let query = supabaseAdmin
      .from('zendesk_analyses')
      .select('ticket_id, hospital_name')
      .eq('reservation_converted', true)
      .limit(5);

    if (existingTicketIds.length > 0) {
      query = query.not('ticket_id', 'in', `(${existingTicketIds.join(',')})`);
    }

    const { data: cases, error: casesError } = await query;

    if (casesError) {
      console.error('[RAG Index] Failed to fetch success cases:', casesError.message);
    } else if (cases && cases.length > 0) {
      console.log(`[RAG Index] Found ${cases.length} unindexed success cases`);

      for (const caseRow of cases) {
        const ticketId = caseRow.ticket_id;

        // Check consecutive failure count
        const { data: existingFailed } = await supabaseAdmin
          .from('case_index')
          .select('id')
          .eq('ticket_id', ticketId)
          .eq('status', 'failed')
          .limit(1);

        try {
          // Fetch full conversation from zendesk_tickets
          const { data: ticket, error: ticketError } = await supabaseAdmin
            .from('zendesk_tickets')
            .select('comments, subject')
            .eq('ticket_id', ticketId)
            .single();

          if (ticketError || !ticket) {
            throw new Error(`Ticket not found: ${ticketError?.message || 'no data'}`);
          }

          const commentsText = (ticket.comments || [])
            .map((c: any) => `[${c.author_id}]: ${c.body}`)
            .join('\n\n');

          if (!commentsText.trim()) {
            throw new Error('No conversation content');
          }

          // Step 2a: Gemini structured output — single prompt for all fields
          const prompt = buildIndexPrompt(commentsText);
          const result = await model.generateContent(prompt);
          const text = result.response.text();
          const parsed = JSON.parse(text);

          const { search_summary, key_turns, customer_concern, procedure_category } = parsed;

          if (!search_summary || !Array.isArray(key_turns) || key_turns.length === 0) {
            throw new Error('Gemini returned invalid structure: missing search_summary or key_turns');
          }

          // Step 2b: Generate embedding for search_summary
          const embedding = await generateEmbedding(search_summary);

          // Step 2c: Atomic insert — both tables must succeed
          const { error: convError } = await supabaseAdmin
            .from('case_conversations')
            .upsert(
              {
                ticket_id: ticketId,
                conversation_full: ticket.comments,
              },
              { onConflict: 'ticket_id' }
            );

          if (convError) {
            throw new Error(`case_conversations insert failed: ${convError.message}`);
          }

          // Remove any previous failed entry before inserting indexed
          if (existingFailed && existingFailed.length > 0) {
            await supabaseAdmin
              .from('case_index')
              .delete()
              .eq('ticket_id', ticketId)
              .eq('status', 'failed');
          }

          const { error: indexError } = await supabaseAdmin
            .from('case_index')
            .upsert(
              {
                ticket_id: ticketId,
                search_summary,
                embedding: `[${embedding.join(',')}]`,
                key_turns,
                hospital_name: caseRow.hospital_name || null,
                procedure_category: procedure_category || null,
                customer_concern: customer_concern || [],
                status: 'indexed',
                embedding_model: 'gemini-embedding-001',
              },
              { onConflict: 'ticket_id' }
            );

          if (indexError) {
            throw new Error(`case_index insert failed: ${indexError.message}`);
          }

          indexed++;
          console.log(`[RAG Index] Indexed ticket ${ticketId} (${procedure_category})`);
        } catch (err: any) {
          failed++;
          console.error(`[RAG Index] Failed to index ticket ${ticketId}:`, err.message);

          // Mark as failed after failure (3-strike rule: mark on any failure for retry awareness)
          await supabaseAdmin
            .from('case_index')
            .upsert(
              {
                ticket_id: ticketId,
                search_summary: '',
                key_turns: [],
                status: 'failed',
                embedding_model: 'gemini-embedding-001',
              },
              { onConflict: 'ticket_id' }
            );
        }
      }
    } else {
      console.log('[RAG Index] No new success cases to index');
    }
  } catch (err: any) {
    console.error('[RAG Index] Fatal error in indexing step:', err.message);
  }

  // === STEP 2: Invalidation check ===
  // Find case_index entries that are no longer 'converted' in zendesk_analyses
  try {
    const { data: indexedCases } = await supabaseAdmin
      .from('case_index')
      .select('ticket_id')
      .eq('status', 'indexed');

    if (indexedCases && indexedCases.length > 0) {
      const indexedTicketIds = indexedCases.map((r: any) => r.ticket_id);

      // Find which of these are no longer converted
      const { data: stillConverted } = await supabaseAdmin
        .from('zendesk_analyses')
        .select('ticket_id')
        .eq('reservation_converted', true)
        .in('ticket_id', indexedTicketIds);

      const convertedSet = new Set((stillConverted || []).map((r: any) => r.ticket_id));
      const toInvalidate = indexedTicketIds.filter((id: number) => !convertedSet.has(id));

      if (toInvalidate.length > 0) {
        const { error: invalidateError } = await supabaseAdmin
          .from('case_index')
          .update({ status: 'invalidated' })
          .in('ticket_id', toInvalidate);

        if (invalidateError) {
          console.error('[RAG Index] Invalidation update error:', invalidateError.message);
        } else {
          invalidated = toInvalidate.length;
          console.log(`[RAG Index] Invalidated ${invalidated} cases that are no longer converted`);
        }
      }
    }
  } catch (err: any) {
    console.error('[RAG Index] Fatal error in invalidation step:', err.message);
  }

  console.log(`[RAG Index] Done — indexed: ${indexed}, invalidated: ${invalidated}, failed: ${failed}`);
  return withCors(NextResponse.json({ indexed, invalidated, failed }));
}
