/**
 * index-koreandiet-rag.ts
 *
 * One-time script to index Korean Diet Zendesk conversations into the RAG case_index.
 * Targets tickets with tags 'koreandiet_line' or 'koreandiet_fb'.
 *
 * Run with: npx tsx scripts/index-koreandiet-rag.ts
 */

import fs from 'fs';
import path from 'path';

// ─── Parse .env.local manually (no dotenv — ESM compatibility) ───────────────
function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('[KoreanDiet RAG] .env.local not found at', envPath);
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY) {
  console.error('[KoreanDiet RAG] Missing required env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY');
  process.exit(1);
}

const MAX_TICKETS_PER_RUN = 10;
const MIN_TOTAL_CHARS = 200;
const MIN_COMMENT_COUNT = 5;

// ─── Supabase REST helpers ────────────────────────────────────────────────────
async function supabaseGet(path: string): Promise<any> {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase GET ${path} failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function supabaseUpsert(table: string, record: Record<string, unknown>, onConflict: string): Promise<void> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase upsert into ${table} failed (${res.status}): ${body}`);
  }
}

// ─── Gemini structured output ─────────────────────────────────────────────────

interface RAGIndexResult {
  search_summary: string;
  key_turns: Array<{ role: string; message: string; turn?: number }>;
  customer_concern: string[];
  procedure_category: string;
}

const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    search_summary: { type: 'STRING' },
    key_turns: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          role: { type: 'STRING' },
          message: { type: 'STRING' },
          turn: { type: 'NUMBER' },
        },
        required: ['role', 'message'],
      },
    },
    customer_concern: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    procedure_category: { type: 'STRING' },
  },
  required: ['search_summary', 'key_turns', 'customer_concern', 'procedure_category'],
};

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

async function callGemini(commentsText: string): Promise<RAGIndexResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{ parts: [{ text: buildKoreanDietPrompt(commentsText) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: GEMINI_SCHEMA,
      maxOutputTokens: 8192,
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Gemini API error (${res.status}): ${JSON.stringify(data)}`);
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error(`Gemini returned no text: ${JSON.stringify(data)}`);
  }
  return JSON.parse(text) as RAGIndexResult;
}

// ─── Embedding ────────────────────────────────────────────────────────────────
async function generateEmbedding(text: string): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text }] },
      taskType: 'RETRIEVAL_DOCUMENT',
      outputDimensionality: 768,
    }),
  });
  const data = await res.json();
  if (!data.embedding?.values) {
    throw new Error(`Embedding API error: ${JSON.stringify(data)}`);
  }
  return data.embedding.values as number[];
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('[KoreanDiet RAG] Starting indexer...');

  // 1. Fetch already-indexed Korean Diet ticket IDs (non-failed)
  const existingRaw = await supabaseGet(
    `case_index?select=ticket_id&status=neq.failed&hospital_name=eq.Korean%20Diet`
  );
  const existingIds = new Set<number>((existingRaw as Array<{ ticket_id: number }>).map((r) => r.ticket_id));
  console.log(`[KoreanDiet RAG] Already indexed: ${existingIds.size} tickets`);

  // 2. Fetch Korean Diet tickets from zendesk_tickets
  // Filter: tags contains 'koreandiet_line' OR 'koreandiet_fb'
  // Supabase REST: use cs.(array) for "contains" on array columns
  const [lineTickets, fbTickets] = await Promise.all([
    supabaseGet(
      `zendesk_tickets?select=ticket_id,subject,comments,tags&tags=cs.%7Bkoreandiet_line%7D&order=ticket_id.asc`
    ) as Promise<any[]>,
    supabaseGet(
      `zendesk_tickets?select=ticket_id,subject,comments,tags&tags=cs.%7Bkoreandiet_fb%7D&order=ticket_id.asc`
    ) as Promise<any[]>,
  ]);

  // Deduplicate by ticket_id
  const allTicketsMap = new Map<number, any>();
  for (const t of [...lineTickets, ...fbTickets]) {
    allTicketsMap.set(t.ticket_id, t);
  }
  const allTickets = Array.from(allTicketsMap.values());
  console.log(`[KoreanDiet RAG] Total Korean Diet tickets found: ${allTickets.length}`);

  // 3. Filter out already indexed and short conversations
  const toProcess = allTickets.filter((ticket) => {
    if (existingIds.has(ticket.ticket_id)) return false;

    const comments: any[] = ticket.comments || [];
    if (comments.length < MIN_COMMENT_COUNT) return false;

    const totalChars = comments.reduce((sum: number, c: any) => sum + (c.body?.length || 0), 0);
    if (totalChars < MIN_TOTAL_CHARS) return false;

    return true;
  });

  console.log(`[KoreanDiet RAG] Tickets to process this run: ${Math.min(toProcess.length, MAX_TICKETS_PER_RUN)} (of ${toProcess.length} eligible)`);

  const batch = toProcess.slice(0, MAX_TICKETS_PER_RUN);

  let indexed = 0;
  let failed = 0;
  let skipped = 0;

  for (const ticket of batch) {
    const ticketId: number = ticket.ticket_id;
    const comments: any[] = ticket.comments || [];

    const commentsText = comments
      .map((c: any) => `[${c.author_id ?? 'unknown'}]: ${c.body ?? ''}`)
      .join('\n\n');

    if (!commentsText.trim()) {
      console.log(`[KoreanDiet RAG] Ticket ${ticketId}: empty conversation, skipping`);
      skipped++;
      continue;
    }

    console.log(`[KoreanDiet RAG] Processing ticket ${ticketId} (${comments.length} comments)...`);

    try {
      // 3a. Gemini structured analysis
      const parsed = await callGemini(commentsText);
      const { search_summary, key_turns, customer_concern, procedure_category } = parsed;

      if (!search_summary || !Array.isArray(key_turns) || key_turns.length === 0) {
        throw new Error('Gemini returned invalid structure: missing search_summary or key_turns');
      }

      // 3b. Generate embedding from search_summary
      const embedding = await generateEmbedding(search_summary);
      const embeddingStr = `[${embedding.join(',')}]`;

      // 3c. Upsert conversation
      await supabaseUpsert(
        'case_conversations',
        {
          ticket_id: ticketId,
          conversation_full: comments,
        },
        'ticket_id'
      );

      // 3d. Upsert case_index
      await supabaseUpsert(
        'case_index',
        {
          ticket_id: ticketId,
          search_summary,
          embedding: embeddingStr,
          key_turns,
          hospital_name: 'Korean Diet',
          procedure_category: procedure_category || '다이어트',
          customer_concern: customer_concern || [],
          status: 'indexed',
          embedding_model: 'gemini-embedding-001',
        },
        'ticket_id'
      );

      indexed++;
      console.log(`[KoreanDiet RAG] ✓ Indexed ticket ${ticketId} — category: ${procedure_category}`);
    } catch (err: any) {
      failed++;
      console.error(`[KoreanDiet RAG] ✗ Failed ticket ${ticketId}:`, err.message);

      // Mark as failed for retry awareness
      try {
        await supabaseUpsert(
          'case_index',
          {
            ticket_id: ticketId,
            search_summary: '',
            key_turns: [],
            hospital_name: 'Korean Diet',
            status: 'failed',
            embedding_model: 'gemini-embedding-001',
          },
          'ticket_id'
        );
      } catch (markErr: any) {
        console.error(`[KoreanDiet RAG]   Could not mark ticket ${ticketId} as failed:`, markErr.message);
      }
    }
  }

  const remaining = toProcess.length - batch.length;
  console.log(
    `[KoreanDiet RAG] Done — indexed: ${indexed}, failed: ${failed}, skipped: ${skipped}` +
    (remaining > 0 ? `, remaining (run again): ${remaining}` : ', all eligible tickets processed')
  );
}

main().catch((err) => {
  console.error('[KoreanDiet RAG] Fatal error:', err);
  process.exit(1);
});
