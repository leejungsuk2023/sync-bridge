// AI reply suggestion logic using Gemini for Zendesk chat integration

import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

export interface SuggestionContext {
  conversations: any[];
  analysis: any;
  quickReplies: any[];
  glossary: any[];
  politeParticle: string;
}

export interface Suggestion {
  text: string;
  confidence: number;
  reasoning: string;
}

// Build context for AI suggestion
export async function buildSuggestionContext(
  ticketId: number,
  agentUserId?: string
): Promise<SuggestionContext> {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Recent 10 conversations for this ticket
  const { data: conversations } = await supabaseAdmin
    .from('zendesk_conversations')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: false })
    .limit(10);

  // 2. Customer analysis from zendesk_analyses
  const { data: analysis } = await supabaseAdmin
    .from('zendesk_analyses')
    .select('*')
    .eq('ticket_id', ticketId)
    .single();

  // 3. Quick replies (limit 5)
  const { data: quickReplies } = await supabaseAdmin
    .from('quick_replies')
    .select('*')
    .order('usage_count', { ascending: false })
    .limit(5);

  // 4. Medical glossary (limit 20)
  const { data: glossary } = await supabaseAdmin
    .from('glossary')
    .select('*')
    .limit(20);

  // 5. Agent's polite_particle from profiles
  let politeParticle = 'ค่ะ'; // default
  if (agentUserId) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('polite_particle')
      .eq('id', agentUserId)
      .single();
    if (profile?.polite_particle) {
      politeParticle = profile.polite_particle;
    }
  }

  return {
    conversations: (conversations || []).reverse(), // chronological order
    analysis: analysis || null,
    quickReplies: quickReplies || [],
    glossary: glossary || [],
    politeParticle,
  };
}

function buildPrompt(context: SuggestionContext): string {
  const { conversations, analysis, quickReplies, glossary, politeParticle } = context;

  const conversationText = conversations
    .map((c: any) => `[${c.direction === 'inbound' ? 'Customer' : 'Agent'}] ${c.body}`)
    .join('\n');

  const customerInfo = analysis
    ? `Customer: ${analysis.customer_name || 'Unknown'}
Phone: ${analysis.customer_phone || 'N/A'}
Interested procedure: ${analysis.interested_procedure || 'N/A'}
Followup reason: ${analysis.followup_reason || 'N/A'}
Summary: ${analysis.ai_summary || 'N/A'}`
    : 'No customer analysis available.';

  const quickReplyText = quickReplies.length > 0
    ? quickReplies.map((qr: any) => `- ${qr.text}`).join('\n')
    : 'No quick replies available.';

  const glossaryText = glossary.length > 0
    ? glossary.map((g: any) => `${g.korean} → ${g.thai}`).join('\n')
    : 'No glossary entries.';

  return `You are a Thai customer support specialist for BBG (Blue Bridge Global), a medical tourism company connecting Korean hospitals with international patients.

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

## Task
Generate 2-3 suggested replies for the agent to send to the customer.
Each suggestion should be appropriate for the conversation context.
Vary the suggestions: one direct answer, one with follow-up question, one empathetic response.

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
}

// Generate AI suggestions
export async function generateSuggestions(
  ticketId: number,
  triggerCommentId?: number,
  agentUserId?: string
): Promise<{ suggestions: Suggestion[]; suggestionId: string }> {
  const context = await buildSuggestionContext(ticketId, agentUserId);

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = buildPrompt(context);
  const startTime = Date.now();

  console.log(`[AISuggest] Generating suggestions for ticket #${ticketId}`);
  const result = await model.generateContent(prompt);
  const responseTimeMs = Date.now() - startTime;

  const responseText = result.response.text();
  console.log(`[AISuggest] Gemini responded in ${responseTimeMs}ms for ticket #${ticketId}`);

  // Parse JSON response
  let suggestions: Suggestion[] = [];
  try {
    const parsed = JSON.parse(responseText);
    suggestions = (parsed.suggestions || []).map((s: any) => ({
      text: s.text || '',
      confidence: typeof s.confidence === 'number' ? s.confidence : 0.5,
      reasoning: s.reasoning || '',
    }));
  } catch (parseErr) {
    console.error('[AISuggest] Failed to parse Gemini response:', parseErr, responseText);
    throw new Error('Failed to parse AI suggestion response');
  }

  // Save to ai_reply_suggestions table
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: saved, error: saveErr } = await supabaseAdmin
    .from('ai_reply_suggestions')
    .insert({
      ticket_id: ticketId,
      trigger_comment_id: triggerCommentId || null,
      suggestions: JSON.stringify(suggestions),
      model_version: 'gemini-2.5-flash',
      response_time_ms: responseTimeMs,
    })
    .select('id')
    .single();

  if (saveErr) {
    console.error('[AISuggest] Failed to save suggestions:', saveErr);
  }

  const suggestionId = saved?.id || '';
  console.log(`[AISuggest] Saved ${suggestions.length} suggestions for ticket #${ticketId} (id: ${suggestionId})`);

  return { suggestions, suggestionId };
}
