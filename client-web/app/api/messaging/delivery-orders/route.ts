import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { google } from 'googleapis';

export const maxDuration = 120;

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

function verifyCron(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron')) return true;
  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

function getGoogleAuth() {
  const base64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  if (!base64) throw new Error('GOOGLE_SERVICE_ACCOUNT_BASE64 not set');
  const credentials = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

export async function GET(req: NextRequest) {
  if (!verifyCron(req)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const SHEET_ID = process.env.DELIVERY_SHEET_ID;
  if (!SHEET_ID) {
    return withCors(NextResponse.json({ error: 'DELIVERY_SHEET_ID not set' }, { status: 500 }));
  }

  let processed = 0;
  let written = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  try {
    // 1. Get Korean Diet LINE channel IDs
    const { data: channels } = await supabaseAdmin
      .from('messaging_channels')
      .select('id')
      .eq('channel_type', 'line')
      .eq('hospital_prefix', 'koreandiet');

    const channelIds = (channels || []).map((c: { id: string }) => c.id);
    if (channelIds.length === 0) {
      return withCors(NextResponse.json({ message: 'No Korean Diet LINE channels', written: 0 }));
    }

    // 2. Get conversations with recent activity (last 7 days)
    // 48h was too short — payment slips may be sent days before cron runs
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: conversations } = await supabaseAdmin
      .from('channel_conversations')
      .select('id, customer_id')
      .in('channel_id', channelIds)
      .gte('last_message_at', since)
      .order('last_message_at', { ascending: false })
      .limit(50);

    // 3. Filter out already processed (written or manually skipped)
    const { data: existingExtractions } = await supabaseAdmin
      .from('delivery_order_extractions')
      .select('conversation_id');
    const processedConvIds = new Set((existingExtractions || []).map((e: { conversation_id: string }) => e.conversation_id));

    // 4. Setup Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // 5. Setup Google Sheets
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    for (const conv of conversations || []) {
      if (processedConvIds.has(conv.id)) {
        skippedCount++;
        continue;
      }

      try {
        // Fetch messages (last 20)
        const { data: messages } = await supabaseAdmin
          .from('channel_messages')
          .select('sender_type, body, message_type, media_url, created_at')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: false })
          .limit(20);

        const msgs = (messages || []).reverse();

        // Check if customer sent any images (potential payment slips)
        const customerImages = msgs.filter(
          (m: any) => m.message_type === 'image' && m.media_url && m.sender_type === 'customer'
        );

        // Use the timestamp of the first customer image (payment slip) as the payment date.
        // This is the ground truth — when the customer actually sent the slip in our system.
        const firstImageDate = customerImages[0]?.created_at
          ? new Date(customerImages[0].created_at).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0];

        if (customerImages.length === 0) {
          skippedCount++;
          continue;
        }

        // Check for payment-stage indicators in conversation
        const hasPaymentContext = msgs.some(
          (m: any) => m.body && (
            m.body.includes('เลขที่บัญชี') ||
            m.body.includes('สลิป') ||
            m.body.includes('โอน') ||
            m.body.includes('หลังโอนแล้ว') ||
            m.body.includes('ได้รับ') ||
            m.body.includes('149,000') ||
            m.body.includes('99,000') ||
            m.body.includes('199,000') ||
            m.body.includes('249,000')
          )
        );
        if (!hasPaymentContext) {
          skippedCount++;
          continue;
        }

        processed++;

        // Get customer info
        const { data: customer } = await supabaseAdmin
          .from('customers')
          .select('survey_name, display_name')
          .eq('id', conv.customer_id)
          .single();

        // Build conversation text
        const conversationText = msgs
          .map((m: any) => {
            const role = m.sender_type === 'customer' ? 'Customer' : 'Agent';
            if (m.message_type === 'image') return `[${role}] [ส่งรูปภาพ]`;
            return `[${role}] ${(m.body || '').slice(0, 500)}`;
          })
          .join('\n');

        // Download images (max 3)
        const parts: any[] = [];
        const recentImages = customerImages.slice(-3);
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
              parts.push({ inlineData: { mimeType: contentType, data: base64 } });
            }
          } catch (imgErr: any) {
            console.error(`[DeliveryOrders] Image fetch error: ${imgErr.message}`);
          }
        }

        // Gemini extraction prompt
        const prompt = `You are an order extraction assistant for Korean Diet (โคเรียนไดเอท).

Analyze this LINE conversation and customer images to extract delivery order details.

## What to look for:
- Payment slip image (bank transfer confirmation showing amount)
- Product: ระดับ1 สีฟ้า (blue/level1) or ระดับ2 สีชมพู (pink/level2)
- Quantity (number of boxes ordered)
- Recipient info: name, phone number, shipping address
- Payment amount (from slip image or conversation text)

## Customer info from DB:
- Display name: ${customer?.display_name || 'Unknown'}
- Survey name: ${customer?.survey_name || 'Unknown'}

## Conversation:
${conversationText}

## Task:
If the customer has sent a payment slip AND provided shipping details (name + phone + address), extract the order as JSON.
If this is NOT a completed order (no payment slip, or missing shipping info), return {"is_order": false}.

Return JSON:
{
  "is_order": true/false,
  "product_level": 1 or 2,
  "quantity": number of boxes,
  "recipient_name": "recipient name for delivery",
  "phone": "phone number",
  "address": "full shipping address",
  "survey_name": "name from health assessment",
  "payment_date": "YYYY-MM-DD",
  "payment_amount_krw": number (Korean Won amount),
  "confidence": "high" or "medium" or "low"
}`;

        // Call Gemini with images
        const allParts = [{ text: prompt }, ...parts];
        const result = await model.generateContent(allParts);
        const rawText = result.response.text().trim();

        // Parse response
        let parsed: any;
        try {
          const cleaned = rawText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
          parsed = JSON.parse(cleaned);
        } catch {
          console.log(`[DeliveryOrders] Failed to parse Gemini response for conv ${conv.id}`);
          continue;
        }

        if (!parsed.is_order) {
          console.log(`[DeliveryOrders] Conv ${conv.id}: not a completed order`);
          skippedCount++;
          continue;
        }

        if (parsed.confidence === 'low') {
          console.log(`[DeliveryOrders] Conv ${conv.id}: low confidence, skipping`);
          continue;
        }

        // Validate required fields
        if (!parsed.recipient_name || !parsed.phone || !parsed.address) {
          console.log(`[DeliveryOrders] Conv ${conv.id}: missing required fields (name/phone/address)`);
          continue;
        }

        // Map to sheet columns
        const productCode = parsed.product_level === 2 ? '06917' : '06916';
        const productName = parsed.product_level === 2 ? '다이어트환-핑크' : '다이어트환-블루';
        const optionName = parsed.product_level === 2 ? `핑크${parsed.quantity || 1}` : `블루${parsed.quantity || 1}`;
        // ALWAYS use the actual image send timestamp (channel_messages.created_at), never trust
        // Gemini's date extraction — Gemini hallucinated the date in the 제니 incident (2026-03-11
        // slip was recorded as 2026-03-15 because Gemini used the current date instead).
        const paymentDate = firstImageDate;
        const surveyName = parsed.survey_name || customer?.survey_name || '';

        // Append to Google Sheet
        // Columns: A=date, B=code, C=name, D=option, E=qty, F=recipient, G=phone, H=address, I=survey_name, J=country, K=shipping, L=tracking, M=status, N=payment_date, O=amount(krw)
        const row = [
          paymentDate,           // A: 주문번호/결제일
          productCode,           // B: 상품코드
          productName,           // C: 상품명
          optionName,            // D: 옵션
          parsed.quantity || 1,  // E: 수량
          parsed.recipient_name, // F: 수취인
          parsed.phone,          // G: 연락처
          parsed.address,        // H: 주소
          surveyName,            // I: 환자이름
          '',                    // J: 국가
          '',                    // K: 운임
          '',                    // L: 운송장
          '',                    // M: 배송상태
          paymentDate,           // N: 결제일
          parsed.payment_amount_krw ? parsed.payment_amount_krw.toLocaleString() : '',  // O: 결제금액(원)
        ];

        await sheets.spreadsheets.values.append({
          spreadsheetId: SHEET_ID,
          range: '태국_한약배송!A:O',
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [row] },
        });

        // Store extraction in DB
        await supabaseAdmin.from('delivery_order_extractions').upsert({
          conversation_id: conv.id,
          customer_id: conv.customer_id,
          product_level: parsed.product_level,
          quantity: parsed.quantity || 1,
          recipient_name: parsed.recipient_name,
          phone: parsed.phone,
          address: parsed.address,
          survey_name: surveyName,
          payment_date: paymentDate,
          payment_amount_krw: parsed.payment_amount_krw,
          confidence: parsed.confidence,
          status: 'written',
          raw_extraction: parsed,
        }, { onConflict: 'conversation_id' });

        // Mark conversation as payment confirmed
        await supabaseAdmin
          .from('channel_conversations')
          .update({ status: 'payment_confirmed' })
          .eq('id', conv.id);

        written++;
        console.log(`[DeliveryOrders] Written order for conv ${conv.id}: ${parsed.recipient_name} — ${productName} x${parsed.quantity}`);

      } catch (convErr: unknown) {
        const errMsg = convErr instanceof Error ? convErr.message : String(convErr);
        errors.push(`Conv ${conv.id}: ${errMsg}`);
        console.error(`[DeliveryOrders] Error processing conv ${conv.id}:`, errMsg);
      }
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[DeliveryOrders] Fatal error:', errMsg);
    return withCors(NextResponse.json({ error: errMsg }, { status: 500 }));
  }

  console.log(`[DeliveryOrders] Done — processed: ${processed}, written: ${written}, skipped: ${skippedCount}`);
  return withCors(NextResponse.json({
    processed,
    written,
    skipped: skippedCount,
    errors: errors.length > 0 ? errors : undefined,
  }));
}

export async function POST(req: NextRequest) {
  return GET(req);
}
