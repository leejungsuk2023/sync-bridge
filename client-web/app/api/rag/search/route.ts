import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;

// CORS: Desktop App (Electron) and Extension cross-origin requests
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
  const {
    data: { user },
  } = await supabaseAdmin.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!profile || !['bbg_admin', 'staff', 'worker', 'client'].includes(profile.role)) return null;
  return { role: profile.role, userId: user.id };
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dotProduct / denom;
}

export async function POST(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  const body = await req.json().catch(() => ({}));
  const { query, hospital_name, limit = 3 } = body as {
    query?: string;
    hospital_name?: string;
    limit?: number;
  };

  if (!query || typeof query !== 'string' || query.trim() === '') {
    return withCors(NextResponse.json({ error: 'query is required' }, { status: 400 }));
  }

  const threshold =
    parseFloat(process.env.RAG_SIMILARITY_THRESHOLD ?? '') || 0.5;

  try {
    // Step 1: Check indexed case count
    const { count: totalIndexed, error: countError } = await supabaseAdmin
      .from('case_index')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'indexed');

    if (countError) {
      console.error('[RAG Search] Failed to count indexed cases:', countError.message);
      return withCors(NextResponse.json({ results: [], total_indexed: 0, threshold }));
    }

    const indexedCount = totalIndexed ?? 0;
    console.log(`[RAG Search] Total indexed cases: ${indexedCount}`);

    if (indexedCount < 30) {
      console.log('[RAG Search] Fewer than 30 indexed cases, skipping RAG');
      return withCors(
        NextResponse.json({ results: [], total_indexed: indexedCount, threshold }),
      );
    }

    // Step 2: Embed the query with Gemini gemini-embedding-001
    console.log(`[RAG Search] Embedding query (length=${query.length})`);
    const embeddingRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text: query }] },
          taskType: 'RETRIEVAL_QUERY',
          outputDimensionality: 768,
        }),
      },
    );

    if (!embeddingRes.ok) {
      const errText = await embeddingRes.text();
      console.error('[RAG Search] Gemini embedding error:', embeddingRes.status, errText);
      return withCors(
        NextResponse.json({ results: [], total_indexed: indexedCount, threshold }),
      );
    }

    const embeddingData = await embeddingRes.json();
    const queryEmbedding: number[] = embeddingData?.embedding?.values;

    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
      console.error('[RAG Search] Invalid embedding response:', JSON.stringify(embeddingData));
      return withCors(
        NextResponse.json({ results: [], total_indexed: indexedCount, threshold }),
      );
    }

    // Step 3: Load all indexed cases and compute cosine similarity in JS
    // (suitable for < 1,000 cases; migrate to pgvector RPC when > 1,000)
    const { data: cases, error: fetchError } = await supabaseAdmin
      .from('case_index')
      .select('id, search_summary, hospital_name, procedure_category, key_turns, embedding')
      .eq('status', 'indexed');

    if (fetchError || !cases) {
      console.error('[RAG Search] Failed to fetch cases:', fetchError?.message);
      return withCors(
        NextResponse.json({ results: [], total_indexed: indexedCount, threshold }),
      );
    }

    // Helper: parse embedding column (may be returned as a string from Supabase)
    function parseEmbedding(raw: unknown): number[] | null {
      if (Array.isArray(raw)) return raw as number[];
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed as number[];
        } catch {
          // ignore
        }
      }
      return null;
    }

    interface ScoredCase {
      id: string;
      search_summary: string;
      hospital_name: string | null;
      procedure_category: string | null;
      key_turns: unknown;
      similarity: number;
    }

    type CaseRow = (typeof cases)[number];

    function scoreAndFilter(
      rows: CaseRow[],
      hospitalFilter: string | undefined,
    ): ScoredCase[] {
      const scored: ScoredCase[] = [];
      for (const c of rows) {
        if (hospitalFilter && c.hospital_name !== hospitalFilter) continue;
        const emb = parseEmbedding(c.embedding);
        if (!emb) continue;
        const sim = cosineSimilarity(queryEmbedding, emb);
        if (sim < threshold) continue;
        scored.push({
          id: c.id,
          search_summary: c.search_summary,
          hospital_name: c.hospital_name,
          procedure_category: c.procedure_category,
          key_turns: c.key_turns,
          similarity: sim,
        });
      }
      return scored.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
    }

    // Step 3a: Filter by hospital_name first
    let results = scoreAndFilter(cases, hospital_name);
    console.log(
      `[RAG Search] Hospital-filtered results: ${results.length} (hospital_name=${hospital_name ?? 'none'})`,
    );

    // Step 3b: Fall back to global search if fewer than 1 result
    if (results.length < 1) {
      console.log('[RAG Search] Falling back to global search (no hospital filter)');
      results = scoreAndFilter(cases, undefined);
      console.log(`[RAG Search] Global search results: ${results.length}`);
    }

    const response = {
      results: results.map(({ id, search_summary, hospital_name, procedure_category, key_turns, similarity }) => ({
        id,
        search_summary,
        hospital_name,
        procedure_category,
        key_turns,
        similarity: Math.round(similarity * 10000) / 10000,
      })),
      total_indexed: indexedCount,
      threshold,
    };

    console.log(
      `[RAG Search] Returning ${response.results.length} results (threshold=${threshold})`,
    );
    return withCors(NextResponse.json(response));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[RAG Search] Unexpected error:', message);
    // Return empty results so RAG failure does not block suggest-reply
    return withCors(NextResponse.json({ results: [], total_indexed: 0, threshold }));
  }
}
