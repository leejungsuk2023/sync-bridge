import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const maxDuration = 60;

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
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!profile || !['bbg_admin', 'worker', 'client', 'staff'].includes(profile.role)) return null;
  return { role: profile.role, userId: user.id };
}

export async function POST(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  const body = await req.json().catch(() => ({}));
  const { conversation_id, message_id } = body;

  if (!conversation_id) {
    return withCors(NextResponse.json({ error: 'conversation_id required' }, { status: 400 }));
  }

  try {
    console.log(`[MessagingSuggestReply] Generating suggestions for conversation ${conversation_id}${message_id ? `, trigger message ${message_id}` : ''}`);

    // 1. Fetch recent messages for context (last 10, chronological)
    const { data: messages } = await supabaseAdmin
      .from('channel_messages')
      .select('sender_type, body, created_at')
      .eq('conversation_id', conversation_id)
      .order('created_at', { ascending: false })
      .limit(10);

    const recentMessages = (messages || []).reverse();

    // 2. Fetch conversation and linked customer info
    const { data: conversation } = await supabaseAdmin
      .from('channel_conversations')
      .select('*, customers(*)')
      .eq('id', conversation_id)
      .single();

    const customer = conversation?.customers || null;

    // 3. Fetch conversation analysis if exists
    const { data: analysis } = await supabaseAdmin
      .from('conversation_analyses')
      .select('*')
      .eq('conversation_id', conversation_id)
      .maybeSingle();

    // 4. Fetch quick replies for context
    const { data: quickReplies } = await supabaseAdmin
      .from('quick_replies')
      .select('*')
      .order('usage_count', { ascending: false })
      .limit(5);

    // 5. Fetch medical glossary
    const { data: glossary } = await supabaseAdmin
      .from('glossary')
      .select('*')
      .limit(20);

    // 6. Agent's polite particle
    let politeParticle = 'ค่ะ';
    const { data: agentProfile } = await supabaseAdmin
      .from('profiles')
      .select('polite_particle')
      .eq('id', authUser.userId)
      .single();
    if (agentProfile?.polite_particle) {
      politeParticle = agentProfile.polite_particle;
    }

    // 7. RAG: search for similar successful cases from case_index
    let ragSection = '';
    try {
      const customerMessages = recentMessages
        .filter((m: any) => m.sender_type === 'customer')
        .slice(-5);
      const ragQuery = customerMessages.map((m: any) => (m.body || '').slice(0, 300)).join(' ');

      if (ragQuery.trim()) {
        console.log(`[MessagingSuggestReply] RAG: building query embedding from ${customerMessages.length} customer messages`);

        const GEMINI_KEY = process.env.GEMINI_API_KEY!;
        const embeddingRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'models/gemini-embedding-001',
              content: { parts: [{ text: ragQuery }] },
              taskType: 'RETRIEVAL_QUERY',
              outputDimensionality: 768,
            }),
          },
        );

        if (embeddingRes.ok) {
          const embeddingJson = await embeddingRes.json();
          const queryEmbedding: number[] = embeddingJson?.embedding?.values || [];
          console.log(`[MessagingSuggestReply] RAG: got query embedding (dim=${queryEmbedding.length})`);

          if (queryEmbedding.length > 0) {
            const { data: cases } = await supabaseAdmin
              .from('case_index')
              .select('id, procedure_category, hospital_name, key_turns, embedding')
              .eq('status', 'indexed');

            const indexedCases = cases || [];
            console.log(`[MessagingSuggestReply] RAG: comparing against ${indexedCases.length} indexed cases`);

            function cosineSimilarity(a: number[], b: number[]): number {
              if (a.length !== b.length || a.length === 0) return 0;
              let dot = 0, normA = 0, normB = 0;
              for (let i = 0; i < a.length; i++) {
                dot += a[i] * b[i];
                normA += a[i] * a[i];
                normB += b[i] * b[i];
              }
              const denom = Math.sqrt(normA) * Math.sqrt(normB);
              return denom === 0 ? 0 : dot / denom;
            }

            const scored = indexedCases
              .map((c: any) => {
                let caseEmbedding: number[] = [];
                try {
                  caseEmbedding = JSON.parse(c.embedding || '[]');
                } catch {
                  // skip unparseable
                }
                const similarity = cosineSimilarity(queryEmbedding, caseEmbedding);
                return { ...c, similarity };
              })
              .filter((c: any) => c.similarity > 0.4)
              .sort((a: any, b: any) => b.similarity - a.similarity)
              .slice(0, 2);

            console.log(`[MessagingSuggestReply] RAG: found ${scored.length} similar cases (threshold 0.4)`);

            if (scored.length > 0) {
              const caseSections = scored.map((c: any) => {
                const similarityPct = Math.round(c.similarity * 100);
                const turns: string = Array.isArray(c.key_turns)
                  ? c.key_turns.map((t: any) => `${t.role || 'unknown'}: ${t.message || ''}`).join('\n')
                  : String(c.key_turns || '');
                return `### Case: ${c.procedure_category || 'General'} (${c.hospital_name || 'N/A'}) — Similarity: ${similarityPct}%\n${turns}`;
              });

              ragSection = `\n## 참고: 유사 성공 상담 사례\nBelow are key conversation turns from similar past consultations that resulted in successful bookings. Use these as reference for tone, approach, and handling customer concerns.\n\n${caseSections.join('\n\n')}\n`;
            }
          }
        } else {
          console.warn(`[MessagingSuggestReply] RAG: embedding API returned ${embeddingRes.status}`);
        }
      } else {
        console.log('[MessagingSuggestReply] RAG: no customer messages to build query from, skipping');
      }
    } catch (ragErr: any) {
      console.error('[MessagingSuggestReply] RAG: failed, proceeding without RAG context:', ragErr?.message || ragErr);
    }

    // Build prompt
    const conversationText = recentMessages
      .map((m: any) => {
        const bodySnippet = (m.body || '').slice(0, 500);
        return `[${m.sender_type === 'customer' ? 'Customer' : 'Agent'}] ${bodySnippet}`;
      })
      .join('\n');

    const customerInfo = customer || analysis
      ? `Customer: ${(customer as any)?.display_name || 'Unknown'}
Phone: ${(customer as any)?.phone || 'N/A'}
Interested procedure: ${analysis?.interested_procedure || 'N/A'}
Followup reason: ${analysis?.followup_reason || 'N/A'}
Summary: ${analysis?.summary || 'N/A'}`
      : 'No customer information available.';

    const quickReplyText = (quickReplies || []).length > 0
      ? (quickReplies || []).map((qr: any) => `- ${qr.text}`).join('\n')
      : 'No quick replies available.';

    const glossaryText = (glossary || []).length > 0
      ? (glossary || []).map((g: any) => `${g.korean} → ${g.thai}`).join('\n')
      : 'No glossary entries.';

    const prompt = `You are a Thai customer support specialist for BBG (Blue Bridge Global), a medical tourism company connecting Korean hospitals with international patients.

## Your Role
- Respond in Thai language
- Use polite particle: "${politeParticle}" at the end of sentences
- Be professional, warm, and helpful
- Focus on medical tourism context (cosmetic surgery, health checkups, dental, etc.)

## Customer Information
${customerInfo}

## Conversation History
${conversationText}

## Available Quick Replies (for reference)
${quickReplyText}

## Medical Glossary (Korean → Thai)
${glossaryText}
${ragSection}
## Task
Generate 2-3 suggested replies for the agent to send to the customer.
Each suggestion should be appropriate for the conversation context.
Vary the suggestions: one direct answer, one with follow-up question, one empathetic response.
If similar successful cases are provided above, adapt their proven approaches to the current conversation context.

## Output Format
Respond ONLY with valid JSON (no markdown, no code fences):
{
  "suggestions": [
    {
      "text": "The Thai reply text",
      "confidence": 0.0 to 1.0,
      "reasoning": "Brief explanation in Korean (한국어) of why this reply is appropriate"
    }
  ]
}`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const startTime = Date.now();
    console.log(`[MessagingSuggestReply] Calling Gemini for conversation ${conversation_id}`);
    const result = await model.generateContent(prompt);
    const responseTimeMs = Date.now() - startTime;

    const responseText = result.response.text();
    console.log(`[MessagingSuggestReply] Gemini responded in ${responseTimeMs}ms`);

    // Parse JSON response — strip markdown code fences if present
    let suggestions: Array<{ text: string; confidence: number; reasoning: string }> = [];
    try {
      const cleaned = responseText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      suggestions = (parsed.suggestions || []).map((s: any) => ({
        text: s.text || '',
        confidence: typeof s.confidence === 'number' ? s.confidence : 0.5,
        reasoning: s.reasoning || '',
      }));
    } catch (parseErr) {
      console.error('[MessagingSuggestReply] Failed to parse Gemini response:', parseErr, responseText);
      return withCors(NextResponse.json({ error: 'Failed to parse AI suggestion response' }, { status: 500 }));
    }

    // Save to ai_suggestions table
    const { data: saved, error: saveErr } = await supabaseAdmin
      .from('ai_suggestions')
      .insert({
        conversation_id,
        trigger_message_id: message_id || null,
        suggestions,
        model_version: 'gemini-2.5-flash',
        response_time_ms: responseTimeMs,
        created_by: authUser.userId,
      })
      .select('id')
      .single();

    if (saveErr) {
      console.error('[MessagingSuggestReply] Failed to save suggestions:', saveErr.message);
    }

    const suggestion_id = saved?.id || '';
    console.log(`[MessagingSuggestReply] Saved ${suggestions.length} suggestions for conversation ${conversation_id} (id: ${suggestion_id})`);

    return withCors(NextResponse.json({ suggestions, suggestion_id }));
  } catch (error: any) {
    console.error('[MessagingSuggestReply] Error:', error?.message || error);
    return withCors(NextResponse.json({ error: 'Failed to generate suggestions' }, { status: 500 }));
  }
}
