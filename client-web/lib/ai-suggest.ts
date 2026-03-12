// AI reply suggestion logic using Gemini for Zendesk chat integration

import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import { fetchHospitalKBContext, extractHospitalPrefix, HospitalKBContext } from '@/lib/hospital-utils';

export interface SuggestionContext {
  conversations: any[];
  analysis: any;
  quickReplies: any[];
  glossary: any[];
  politeParticle: string;
  // Hospital KB
  hospitalInfo: HospitalKBContext['hospitalInfo'];
  procedures: HospitalKBContext['procedures'];
  activePromotions: HospitalKBContext['activePromotions'];
  doctors: HospitalKBContext['doctors'];
  successfulCases: HospitalKBContext['successfulCases'];
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
    .select('author_type, body, created_at')
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

  // 6. Fetch ticket tags to extract hospital prefix → load Hospital KB
  const { data: ticket } = await supabaseAdmin
    .from('zendesk_tickets')
    .select('tags')
    .eq('ticket_id', ticketId)
    .single();

  const hospitalPrefix = extractHospitalPrefix(ticket?.tags || []);

  let hospitalKB: HospitalKBContext = {
    hospitalInfo: null,
    doctors: [],
    procedures: [],
    activePromotions: [],
    successfulCases: [],
  };

  if (hospitalPrefix) {
    hospitalKB = await fetchHospitalKBContext(supabaseAdmin, hospitalPrefix);
  }

  return {
    conversations: (conversations || []).reverse(), // chronological order
    analysis: analysis || null,
    quickReplies: quickReplies || [],
    glossary: glossary || [],
    politeParticle,
    hospitalInfo: hospitalKB.hospitalInfo,
    procedures: hospitalKB.procedures,
    activePromotions: hospitalKB.activePromotions,
    doctors: hospitalKB.doctors,
    successfulCases: hospitalKB.successfulCases,
  };
}

// KRW to THB approximate conversion rate
const KRW_TO_THB = 0.025;

function formatPrice(priceKrw: number): string {
  const thb = Math.round(priceKrw * KRW_TO_THB);
  return `${priceKrw.toLocaleString()} KRW (~${thb.toLocaleString()} THB)`;
}

function buildPrompt(context: SuggestionContext): string {
  const {
    conversations,
    analysis,
    quickReplies,
    glossary,
    politeParticle,
    hospitalInfo,
    procedures,
    activePromotions,
    doctors,
    successfulCases,
  } = context;

  const conversationText = conversations
    .map((c: any) => {
      const body = (c.body || '').slice(0, 500); // Truncate long messages to avoid token limits
      return `[${c.author_type === 'customer' ? 'Customer' : 'Agent'}] ${body}`;
    })
    .join('\n');

  const customerInfo = analysis
    ? `Customer: ${analysis.customer_name || 'Unknown'}
Phone: ${analysis.customer_phone || 'N/A'}
Interested procedure: ${analysis.interested_procedure || 'N/A'}
Followup reason: ${analysis.followup_reason || 'N/A'}
Summary: ${analysis.summary || 'N/A'}`
    : 'No customer analysis available.';

  const quickReplyText = quickReplies.length > 0
    ? quickReplies.map((qr: any) => `- ${qr.text}`).join('\n')
    : 'No quick replies available.';

  const glossaryText = glossary.length > 0
    ? glossary.map((g: any) => `${g.korean} → ${g.thai}`).join('\n')
    : 'No glossary entries.';

  // Hospital KB sections
  let hospitalSection = '';

  if (hospitalInfo) {
    const nameLine = [hospitalInfo.display_name_th, hospitalInfo.display_name_ko]
      .filter(Boolean).join(' / ');
    hospitalSection += `\n## Hospital Information
Name: ${nameLine || hospitalInfo.hospital_prefix}`;
    if (hospitalInfo.address_th || hospitalInfo.address_ko) {
      hospitalSection += `\nAddress: ${hospitalInfo.address_th || ''}${hospitalInfo.address_ko ? ` / ${hospitalInfo.address_ko}` : ''}`;
    }
    if (hospitalInfo.phone) hospitalSection += `\nPhone: ${hospitalInfo.phone}`;
    if (hospitalInfo.website) hospitalSection += `\nWebsite: ${hospitalInfo.website}`;

    if (doctors.length > 0) {
      hospitalSection += `\n\n## Doctors`;
      for (const doc of doctors) {
        const titlePart = doc.title_th ? ` (${doc.title_th})` : '';
        const specialties = (doc.specialties || []).join(', ');
        hospitalSection += `\n- ${doc.name_th || ''}${titlePart}${specialties ? ` — ${specialties}` : ''}`;
      }
    }

    if (procedures.length > 0) {
      hospitalSection += `\n\n## Available Procedures & Prices (KRW / ~THB)`;
      for (const proc of procedures) {
        const star = proc.is_popular ? '⭐ ' : '   ';
        const pricePart = proc.price_min != null
          ? proc.price_max != null && proc.price_max !== proc.price_min
            ? `${formatPrice(proc.price_min)}~${formatPrice(proc.price_max)}`
            : formatPrice(proc.price_min)
          : 'ราคาตามการปรึกษา';
        const notePart = proc.price_note ? ` (${proc.price_note})` : '';
        hospitalSection += `\n${star}${proc.name_th || ''} (${proc.category}) — ${pricePart}${notePart}`;
      }
    }

    if (activePromotions.length > 0) {
      hospitalSection += `\n\n## Current Promotions`;
      for (const promo of activePromotions) {
        const until = promo.ends_at ? ` (ถึง ${promo.ends_at})` : ' (ไม่มีกำหนดสิ้นสุด)';
        hospitalSection += `\n🎉 ${promo.title_th || ''}${until}`;
        if (promo.description_th) hospitalSection += `\n   ${promo.description_th}`;
      }
    }

    // Successful cases: only inject if interested procedure matches and verified cases exist
    const interestedProcedure = analysis?.interested_procedure || '';
    const relevantCases = successfulCases.filter(c => {
      if (!interestedProcedure) return false;
      const procName = (c.procedure_name_th || '').toLowerCase();
      const keyword = interestedProcedure.toLowerCase();
      return procName.includes(keyword) || keyword.includes(procName);
    });

    if (relevantCases.length > 0) {
      hospitalSection += `\n\n## Successful Consultation Reference
아래는 이 병원에서 실제로 수술 예약까지 이어진 상담 사례입니다.
참고하여 비슷한 패턴으로 응대하세요:`;
      relevantCases.forEach((c, i) => {
        hospitalSection += `\n\n[Case ${i + 1}: ${c.procedure_name_th || ''} → ${c.outcome || 'success'}]`;
        if (c.contextual_summary) hospitalSection += `\nContext: ${c.contextual_summary}`;
        hospitalSection += `\n--- 전체 대화 ---\n${c.full_conversation.slice(0, 3000)}\n--- 대화 끝 ---`;
      });
    }

    hospitalSection += `\n\n## IMPORTANT RULES
- 가격 질문 시 반드시 위 시술 목록에서 인용
- 활성 프로모션이 있으면 적극적으로 안내
- 목록에 없는 시술은 "확인 후 안내드리겠습니다"로 응대
- 성공 케이스의 응대 패턴(톤, 정보 제공 순서, 클로징 방식)을 참고`;
  }

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
${hospitalSection}

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
): Promise<{ suggestions: Suggestion[]; suggestion_id: string }> {
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

  // Parse JSON response — strip markdown code fences if present
  let suggestions: Suggestion[] = [];
  try {
    const cleaned = responseText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
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
      suggestions: suggestions,
      model_version: 'gemini-2.5-flash',
      response_time_ms: responseTimeMs,
    })
    .select('id')
    .single();

  if (saveErr) {
    console.error('[AISuggest] Failed to save suggestions:', saveErr);
  }

  const suggestion_id = saved?.id || '';
  console.log(`[AISuggest] Saved ${suggestions.length} suggestions for ticket #${ticketId} (id: ${suggestion_id})`);

  return { suggestions, suggestion_id };
}
