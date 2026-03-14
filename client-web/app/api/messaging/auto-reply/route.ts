import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const maxDuration = 60;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { conversation_id, message_id } = body;

  if (!conversation_id) {
    return withCors(NextResponse.json({ error: 'conversation_id required' }, { status: 400 }));
  }

  try {
    // 1. Check if chatbot is enabled for this conversation
    const { data: conversation, error: convError } = await supabaseAdmin
      .from('channel_conversations')
      .select('chatbot_enabled, channel_type, channel_id, customer_id, hospital_prefix')
      .eq('id', conversation_id)
      .single();

    if (convError || !conversation) {
      console.log(`[AutoReply] Conversation ${conversation_id} not found`);
      return withCors(NextResponse.json({ skipped: true, reason: 'conversation_not_found' }));
    }

    if (!conversation.chatbot_enabled) {
      console.log(`[AutoReply] Chatbot disabled for conversation ${conversation_id}`);
      return withCors(NextResponse.json({ skipped: true, reason: 'chatbot_disabled' }));
    }

    console.log(`[AutoReply] Chatbot enabled, generating reply for conversation ${conversation_id}`);

    // 2. Fetch recent messages (last 10)
    const { data: messages } = await supabaseAdmin
      .from('channel_messages')
      .select('sender_type, body, message_type, created_at')
      .eq('conversation_id', conversation_id)
      .order('created_at', { ascending: false })
      .limit(10);

    const recentMessages = (messages || []).reverse();

    if (recentMessages.length === 0) {
      return withCors(NextResponse.json({ skipped: true, reason: 'no_messages' }));
    }

    // 3. Fetch customer info
    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('display_name, phone, tags')
      .eq('id', conversation.customer_id)
      .single();

    // 4. Fetch conversation analysis if exists
    const { data: analysis } = await supabaseAdmin
      .from('conversation_analyses')
      .select('*')
      .eq('conversation_id', conversation_id)
      .maybeSingle();

    // 5. Fetch medical glossary
    const { data: glossary } = await supabaseAdmin
      .from('glossary')
      .select('korean, thai')
      .limit(20);

    // 5b. Fetch hospital procedures and promotions for product/service knowledge
    let hospitalProcedures: any[] = [];
    let hospitalPromotions: any[] = [];
    if (conversation.hospital_prefix) {
      const { data: hospitalInfo } = await supabaseAdmin
        .from('hospital_info')
        .select('id')
        .eq('hospital_prefix', conversation.hospital_prefix)
        .maybeSingle();

      if (hospitalInfo?.id) {
        const [{ data: procedures }, { data: promotions }] = await Promise.all([
          supabaseAdmin
            .from('hospital_procedures')
            .select('name_th, description_th, price_min, price_max, price_currency, price_note, category, is_popular')
            .eq('hospital_id', hospitalInfo.id)
            .eq('is_active', true)
            .order('sort_order'),
          supabaseAdmin
            .from('hospital_promotions')
            .select('title_th, description_th, discount_type, discount_value')
            .eq('hospital_id', hospitalInfo.id)
            .eq('is_active', true),
        ]);
        hospitalProcedures = procedures || [];
        hospitalPromotions = promotions || [];
      }
    }

    // 5c. Fetch recent agent messages from this conversation for tone/style reference
    const agentMessages = recentMessages
      .filter((m: any) => m.sender_type === 'agent' && m.body)
      .slice(-3)
      .map((m: any) => m.body);

    // 6. RAG: Find similar successful cases
    let ragSection = '';
    try {
      const customerMessages = recentMessages
        .filter((m: any) => m.sender_type === 'customer' && m.body)
        .slice(-3)
        .map((m: any) => m.body)
        .join('\n');

      if (customerMessages.trim()) {
        const embRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${process.env.GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'models/gemini-embedding-001',
              content: { parts: [{ text: customerMessages }] },
              taskType: 'RETRIEVAL_QUERY',
              outputDimensionality: 768,
            }),
          }
        );
        const embData = await embRes.json();
        const queryEmbedding = embData.embedding?.values;

        if (queryEmbedding) {
          const { data: cases } = await supabaseAdmin
            .from('case_index')
            .select('ticket_id, search_summary, embedding, key_turns, hospital_name, procedure_category')
            .eq('status', 'indexed');

          if (cases && cases.length > 0) {
            // Cosine similarity
            const dotProduct = (a: number[], b: number[]) => a.reduce((sum, val, i) => sum + val * b[i], 0);
            const magnitude = (a: number[]) => Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
            const cosineSim = (a: number[], b: number[]) => {
              const magA = magnitude(a);
              const magB = magnitude(b);
              return magA && magB ? dotProduct(a, b) / (magA * magB) : 0;
            };

            const scored = cases
              .map((c: any) => {
                try {
                  const emb = typeof c.embedding === 'string' ? JSON.parse(c.embedding) : c.embedding;
                  return { ...c, similarity: cosineSim(queryEmbedding, emb) };
                } catch { return null; }
              })
              .filter((c: any) => c && c.similarity > 0.4)
              .sort((a: any, b: any) => b.similarity - a.similarity)
              .slice(0, 2);

            if (scored.length > 0) {
              ragSection = '\n## 참고: 유사 성공 상담 사례\nBelow are key turns from similar past consultations that resulted in successful bookings.\n\n';
              for (const sc of scored) {
                ragSection += `### ${sc.procedure_category || 'Unknown'} (${sc.hospital_name || 'Unknown'}) — Similarity: ${Math.round(sc.similarity * 100)}%\n`;
                const turns = Array.isArray(sc.key_turns) ? sc.key_turns : [];
                for (const t of turns) {
                  ragSection += `[${t.role}]: ${t.message}\n`;
                }
                ragSection += '\n';
              }
            }
          }
        }
      }
    } catch (ragErr: any) {
      console.error('[AutoReply] RAG search failed (continuing without):', ragErr.message);
    }

    // 7. Build Gemini prompt
    const conversationText = recentMessages
      .map((m: any) => `[${m.sender_type === 'customer' ? 'Customer' : 'Agent'}] ${(m.body || '').slice(0, 500)}`)
      .join('\n');

    const customerInfo = customer
      ? `Customer: ${customer.display_name || 'Unknown'}\nPhone: ${customer.phone || 'N/A'}`
      : 'No customer information available.';

    const analysisInfo = analysis
      ? `Interested procedure: ${analysis.interested_procedure || 'N/A'}\nSummary: ${analysis.summary || 'N/A'}`
      : '';

    const glossaryText = (glossary || []).length > 0
      ? (glossary || []).map((g: any) => `${g.korean} → ${g.thai}`).join('\n')
      : '';

    const kbText = (() => {
      const parts: string[] = [];
      if (hospitalProcedures.length > 0) {
        parts.push('### สินค้า/บริการ');
        for (const p of hospitalProcedures) {
          const priceStr = p.price_min && p.price_max
            ? p.price_min === p.price_max
              ? `${p.price_min.toLocaleString()} ${p.price_currency || 'KRW'}`
              : `${p.price_min.toLocaleString()} – ${p.price_max.toLocaleString()} ${p.price_currency || 'KRW'}`
            : '';
          const popular = p.is_popular ? ' ⭐' : '';
          parts.push(`[${p.category || 'General'}]${popular} ${p.name_th}`);
          if (priceStr) parts.push(`  ราคา: ${priceStr}${p.price_note ? ` (${p.price_note})` : ''}`);
          if (p.description_th) parts.push(`  รายละเอียด: ${p.description_th.slice(0, 400)}`);
        }
      }
      if (hospitalPromotions.length > 0) {
        parts.push('\n### โปรโมชั่นปัจจุบัน');
        for (const promo of hospitalPromotions) {
          parts.push(`🎉 ${promo.title_th}`);
          if (promo.description_th) parts.push(`  ${promo.description_th}`);
          if (promo.discount_value) {
            const discountLabel = promo.discount_type === 'percent'
              ? `ลด ${promo.discount_value}%`
              : `ลด ${promo.discount_value.toLocaleString()} วอน`;
            parts.push(`  ส่วนลด: ${discountLabel}`);
          }
        }
      }
      return parts.join('\n');
    })();

    const agentStyleRef = agentMessages.length > 0
      ? `\n## 기존 상담원 답변 스타일 참고\n${agentMessages.map((m: string) => `Agent: ${m.slice(0, 200)}`).join('\n')}`
      : '';

    const prompt = `You are an experienced Thai customer support agent for Korean Diet (a LINE-based health/beauty product sales channel operated by BBG - Blue Bridge Global).

## Your Identity
- You ARE the sales agent — not an AI assistant, not a chatbot
- Respond in Thai language ONLY
- Use polite particle "ค่ะ" at the end of sentences
- Be warm, friendly, and proactive — like a trusted friend who sells health products
- Match the casual, warm tone of LINE chat (use emoji sparingly: 🙏🏻😊❤️)

## What You CAN Do (answer directly):
- Greet customers warmly
- Explain products, ingredients, dosage, and usage instructions
- Quote prices and offer package deals
- Suggest products based on customer needs
- Answer FAQ about shipping, payment, side effects
- Encourage purchases with gentle sales techniques
- Thank customers and confirm orders
- Follow up on previous purchases

## What You Should AVOID:
- Never share bank account numbers or payment details (say "ส่งเลขบัญชีให้ทางนี้เลยนะคะ" and let a human follow up)
- Never make specific medical diagnoses
- Never guarantee medical results
- If you truly don't know something specific, say "ขอเช็คข้อมูลให้สักครู่นะคะ" (let me check) — NOT "let me transfer you to an agent"

## Customer Information
${customerInfo}
${analysisInfo}

## Conversation History
${conversationText}
${agentStyleRef}

## Product & Service Knowledge
${kbText || 'No specific product data available — answer based on general health/beauty product knowledge.'}

## Medical Glossary (Korean → Thai)
${glossaryText}
${ragSection}
## Task
Generate ONE natural reply as if you are the actual sales agent chatting on LINE.
Keep it concise (1-3 sentences). Be helpful and answer the question directly.
${ragSection ? 'Adapt proven approaches from the successful cases above.' : ''}

Respond with ONLY the Thai text reply. No JSON, no explanation, just the message text.`;

    // 8. Generate reply with Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const startTime = Date.now();
    const result = await model.generateContent(prompt);
    const replyText = result.response.text().trim();
    const responseTimeMs = Date.now() - startTime;

    console.log(`[AutoReply] Generated reply in ${responseTimeMs}ms: "${replyText.substring(0, 100)}..."`);

    if (!replyText) {
      return withCors(NextResponse.json({ skipped: true, reason: 'empty_reply' }));
    }

    // 9. Send the reply via LINE (or other channel)
    const { getChannelAdapter } = await import('@/lib/channels/registry');

    // Get recipient ID
    const { data: customerData } = await supabaseAdmin
      .from('customers')
      .select('line_user_id, facebook_user_id')
      .eq('id', conversation.customer_id)
      .single();

    const recipientId = conversation.channel_type === 'line'
      ? customerData?.line_user_id
      : customerData?.facebook_user_id;

    if (!recipientId) {
      console.error(`[AutoReply] No recipient ID for customer ${conversation.customer_id}`);
      return withCors(NextResponse.json({ error: 'no_recipient_id' }, { status: 500 }));
    }

    const adapter = await getChannelAdapter(conversation.channel_type, conversation.channel_id);
    const sendResult = await adapter.sendTextMessage(recipientId, replyText);

    console.log(`[AutoReply] Sent reply to ${recipientId}, messageId: ${sendResult.messageId || 'N/A'}`);

    // 10. Store the bot reply in channel_messages
    const now = new Date().toISOString();
    const { error: msgError } = await supabaseAdmin
      .from('channel_messages')
      .insert({
        conversation_id,
        sender_type: 'bot',
        body: replyText,
        message_type: 'text',
        external_message_id: sendResult.messageId || null,
        created_at: now,
      });

    if (msgError) {
      console.error('[AutoReply] Failed to store bot message:', msgError.message);
    }

    // Update conversation timestamps
    await supabaseAdmin
      .from('channel_conversations')
      .update({
        last_message_at: now,
        last_agent_message_at: now,
        is_read: true,
      })
      .eq('id', conversation_id);

    return withCors(NextResponse.json({
      sent: true,
      reply: replyText,
      response_time_ms: responseTimeMs,
    }));

  } catch (error: any) {
    console.error('[AutoReply] Error:', error?.message || error);
    return withCors(NextResponse.json({ error: 'Auto-reply failed' }, { status: 500 }));
  }
}
