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

    // 1b. Check channel-level chatbot toggle — channel ON overrides individual conversation setting
    const { data: channel } = await supabaseAdmin
      .from('messaging_channels')
      .select('chatbot_enabled')
      .eq('id', conversation.channel_id)
      .maybeSingle();

    const channelChatbotEnabled = channel?.chatbot_enabled || false;
    const conversationChatbotEnabled = conversation.chatbot_enabled || false;

    // Channel toggle overrides: if channel is ON, always proceed
    // If channel is OFF, check individual conversation toggle
    if (!channelChatbotEnabled && !conversationChatbotEnabled) {
      console.log(`[AutoReply] Chatbot disabled for conversation ${conversation_id} (channel: ${channelChatbotEnabled}, conversation: ${conversationChatbotEnabled})`);
      return withCors(NextResponse.json({ skipped: true, reason: 'chatbot_disabled' }));
    }

    console.log(`[AutoReply] Chatbot enabled, generating reply for conversation ${conversation_id} (channel: ${channelChatbotEnabled}, conversation: ${conversationChatbotEnabled})`);

    // 2. Fetch recent messages (last 10)
    const { data: messages } = await supabaseAdmin
      .from('channel_messages')
      .select('sender_type, body, message_type, media_url, created_at')
      .eq('conversation_id', conversation_id)
      .order('created_at', { ascending: false })
      .limit(10);

    const recentMessages = (messages || []).reverse();

    if (recentMessages.length === 0) {
      return withCors(NextResponse.json({ skipped: true, reason: 'no_messages' }));
    }

    // Skip messages starting with "#" — these trigger LINE Business auto-replies
    const latestMsg = recentMessages[recentMessages.length - 1];
    if (latestMsg?.sender_type === 'customer' && latestMsg?.body?.trim().startsWith('#')) {
      console.log(`[AutoReply] Skipping LINE keyword message: "${latestMsg.body.trim().substring(0, 30)}"`);
      return withCors(NextResponse.json({ skipped: true, reason: 'line_keyword' }));
    }

    // 3. Fetch customer info
    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('display_name, phone, tags, survey_name')
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
    let hospitalInfo: any = null;
    // Fall back to channel's hospital_prefix if conversation doesn't have one
    let hospitalPrefix = conversation.hospital_prefix;
    if (!hospitalPrefix && conversation.channel_id) {
      const { data: ch } = await supabaseAdmin
        .from('messaging_channels')
        .select('hospital_prefix')
        .eq('id', conversation.channel_id)
        .maybeSingle();
      hospitalPrefix = ch?.hospital_prefix || null;
    }
    if (hospitalPrefix) {
      const { data: fetchedHospitalInfo } = await supabaseAdmin
        .from('hospital_info')
        .select('id, operating_hours, display_name_th, website')
        .eq('hospital_prefix', hospitalPrefix)
        .maybeSingle();
      hospitalInfo = fetchedHospitalInfo;

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
            .eq('status', 'indexed')
            .eq('hospital_name', 'Korean Diet');

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
      .map((m: any) => {
        const role = m.sender_type === 'customer' ? 'Customer' : 'Agent';
        if (m.message_type === 'image') {
          return `[${role}] [ส่งรูปภาพ — ดูรูปด้านล่าง] ${m.body || ''}`;
        }
        return `[${role}] ${(m.body || '').slice(0, 500)}`;
      })
      .join('\n');

    const customerInfo = customer
      ? `Customer: ${customer.display_name || 'Unknown'}\nPhone: ${customer.phone || 'N/A'}${customer.survey_name ? `\nSurvey Name: ${customer.survey_name}` : ''}`
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

    const paymentText = (() => {
      const hours = hospitalInfo?.operating_hours as any;
      if (!hours) return '';
      const parts: string[] = ['## ข้อมูลการชำระเงิน'];
      if (hours.payment_korea) {
        const pk = hours.payment_korea;
        parts.push(`🇰🇷 จัดส่งสินค้าที่เกาหลี ชำระโดยเงินวอน`);
        parts.push(`ชื่อบัญชี: ${pk.account_name}`);
        parts.push(`ธนาคาร: ${pk.bank}`);
        parts.push(`เลขที่บัญชี: ${pk.account_number}`);
      }
      if (hours.payment_thailand) {
        const pt = hours.payment_thailand;
        parts.push(`🇹🇭 จัดส่งสินค้าที่ไทย ชำระโดยเงินบาท`);
        parts.push(`ชื่อบัญชี: ${pt.account_name}`);
        parts.push(`ธนาคาร: ${pt.bank}`);
        parts.push(`เลขที่บัญชี: ${pt.account_number}`);
      }
      if (hours.stamp_program) {
        parts.push(`\n## สะสมแสตมป์: ${hours.stamp_program}`);
      }
      return parts.join('\n');
    })();

    const agentStyleRef = agentMessages.length > 0
      ? `\n## 기존 상담원 답변 스타일 참고\n${agentMessages.map((m: string) => `Agent: ${m.slice(0, 200)}`).join('\n')}`
      : '';

    const assessmentUrl = (hospitalInfo?.operating_hours as any)?.health_assessment_url || 'https://koreandiet.store';

    const prompt = `You are an experienced Thai sales agent for Korean Diet (โคเรียนไดเอท) — a LINE-based Korean herbal diet medicine sales channel operated by BBG (Blue Bridge Global).

## Your Identity
- You ARE the sales agent — not an AI, not a chatbot, not a customer service bot
- Respond in Thai language ONLY
- Use polite particle "ค่ะ" at the end of sentences
- Be warm, friendly, and proactive — like a trusted friend recommending health products
- Match the casual, warm tone of LINE chat (use emoji sparingly: 🙏🏻😊❤️🩵🩷)

## Sales Flow (follow this order)
1. GREET warmly, ask what they're interested in
2. EXPLAIN products — Korean Diet has 2 levels: ระดับ1 สีฟ้า🩵 (mild) and ระดับ2 สีชมพู🩷 (strong). Doctor decides which level based on health assessment.
3. DIRECT to health assessment: "หากสนใจสั่งซื้อหรือต้องการให้คุณหมอออกใบสั่งยาให้เข้าไปทำแบบประเมินสุขภาพที่ลิ้งค์นี้ได้เลยนะคะ 👉🏻${assessmentUrl}"
3.5. After customer fills the form, ASK for their full name used in the assessment: "กรอกแบบประเมินเรียบร้อยแล้วใช่ไหมคะ? กรุณาแจ้งชื่อ-นามสกุลที่ใช้กรอกในแบบประเมินด้วยนะคะ เพื่อจะได้ตรวจสอบผลได้ถูกต้องค่ะ 🙏🏻"
4. After assessment, CONFIRM doctor's prescription (which level)
5. CONFIRM order quantity and CALCULATE price
6. SHARE payment info (bank accounts below) and ask customer to send payment slip + name + phone + address
7. After payment confirmed, arrange DELIVERY and share tracking number
8. Share DOSAGE instructions

## What You MUST Do
- Share bank account info when customer is ready to pay — this is essential for sales!
- Quote exact prices from the product data below
- Price tiers: 1กล่อง 99,000 วอน / 2กล่อง 149,000 วอน / 4กล่อง 249,000 วอน — ONLY quote these exact tier prices, do NOT calculate or extrapolate prices for other quantities
- Thailand prices: 1กล่อง 2,587 บาท / 2กล่อง 3,565 บาท / 4กล่อง 5,739 บาท
- Every order includes Lirio Plus 2 boxes free
- If customer asks for a quantity not in the price tiers (e.g., 3 boxes, 5 boxes), say "ขอเช็คราคาให้สักครู่นะคะ" — do NOT invent a price
- Guide customers to fill the health assessment form
- When customer sends a photo/image, ALWAYS analyze it carefully before responding. Describe what you see (e.g., payment slip, health assessment screenshot, product photo, before/after photo) and respond appropriately. NEVER ignore an image.
- Confirm orders with exact price calculations
- Be proactive about closing the sale
- Answer dosage, ingredient, and usage questions directly from product data below

## What You Should AVOID
- Never guarantee specific weight loss numbers (kg) — results vary per person
- Never make medical diagnoses — defer drug interaction questions to their doctor
- If you truly don't know something specific about the product, say "ขอเช็คข้อมูลให้สักครู่นะคะ"

## Customer Information
${customerInfo}
${analysisInfo}

## Conversation History
${conversationText}
${agentStyleRef}

## Product & Pricing Information
${kbText || 'No specific product data available.'}

${paymentText}

## Medical Glossary (Korean → Thai)
${glossaryText}
${ragSection}
## Task
Generate ONE natural reply as the sales agent on LINE.
Keep it concise (1-4 sentences). Be helpful, answer directly, and actively guide toward purchase.
When customer asks about price, ALWAYS quote the exact price.
When customer wants to order, provide payment info immediately.
${ragSection ? 'Adapt proven sales approaches from the successful cases above.' : ''}

Respond in JSON format: {"reply": "your Thai text reply here", "survey_name": "full name if customer just provided their assessment form name, otherwise null"}
Only extract survey_name when the customer clearly states their full name in response to you asking about the health assessment form. Do not extract names from casual greetings.`;

    // 8. Generate reply with Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // Check if there are any image messages from the customer
    const imageMessages = recentMessages.filter(
      (m: any) => m.message_type === 'image' && m.media_url && m.sender_type === 'customer'
    );

    const startTime = Date.now();
    let result;
    if (imageMessages.length > 0) {
      // Build multimodal content parts
      const parts: any[] = [{ text: prompt }];

      // Download and add each image (max 3 most recent to avoid token bloat)
      const recentImages = imageMessages.slice(-3);
      for (const img of recentImages) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);
          const imgResponse = await fetch(img.media_url, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (imgResponse.ok) {
            const buffer = await imgResponse.arrayBuffer();
            const base64 = Buffer.from(buffer).toString('base64');
            const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
            parts.push({
              inlineData: {
                mimeType: contentType,
                data: base64,
              },
            });
            console.log(`[AutoReply] Added image to prompt: ${img.media_url.substring(0, 80)}...`);
          }
        } catch (imgErr: any) {
          console.error(`[AutoReply] Failed to fetch image: ${imgErr.message}`);
        }
      }

      result = await model.generateContent(parts);
    } else {
      result = await model.generateContent(prompt);
    }
    const rawText = result.response.text().trim();
    const responseTimeMs = Date.now() - startTime;

    // Parse JSON response — fall back to plain text if parsing fails
    let replyText = rawText;
    let extractedSurveyName: string | null = null;

    try {
      // Strip markdown code fences if present
      const cleaned = rawText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (parsed.reply) {
        replyText = parsed.reply;
        extractedSurveyName = parsed.survey_name || null;
      }
    } catch {
      // Gemini returned plain text — use as-is
      console.log('[AutoReply] Response was plain text, not JSON');
    }

    console.log(`[AutoReply] Generated reply in ${responseTimeMs}ms: "${replyText.substring(0, 100)}..."${extractedSurveyName ? ` | survey_name: ${extractedSurveyName}` : ''}`);

    if (!replyText) {
      return withCors(NextResponse.json({ skipped: true, reason: 'empty_reply' }));
    }

    // Save survey_name to customers table if detected and not already set
    if (extractedSurveyName && conversation.customer_id) {
      const existingSurveyName = customer?.survey_name;
      if (!existingSurveyName) {
        await supabaseAdmin
          .from('customers')
          .update({ survey_name: extractedSurveyName })
          .eq('id', conversation.customer_id);
        console.log(`[AutoReply] Saved survey_name "${extractedSurveyName}" for customer ${conversation.customer_id}`);
      }
    }

    // 8b. One-time survey name prompt — append if survey_name not yet collected
    const SURVEY_PROMPT_MARKER = 'กรุณาแจ้งชื่อ-นามสกุลที่ใช้กรอกในแบบประเมิน';
    if (!customer?.survey_name && !extractedSurveyName) {
      // Check if we already asked (search conversation history for the marker)
      const alreadyAsked = recentMessages.some(
        (m: any) => m.sender_type === 'bot' && m.body?.includes(SURVEY_PROMPT_MARKER)
      );
      if (!alreadyAsked) {
        replyText += '\n\nกรอกแบบประเมินเรียบร้อยแล้วใช่ไหมคะ? กรุณาแจ้งชื่อ-นามสกุลที่ใช้กรอกในแบบประเมินด้วยนะคะ เพื่อจะได้ตรวจสอบผลได้ถูกต้องค่ะ 🙏🏻';
        console.log(`[AutoReply] Appended one-time survey name prompt for customer ${conversation.customer_id}`);
      }
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
