import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
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

// Google Sheets auth
function getGoogleAuth() {
  const base64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  if (!base64) throw new Error('GOOGLE_SERVICE_ACCOUNT_BASE64 not set');
  const credentials = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

interface SheetRow {
  rowIndex: number; // 0-based row in sheet (data starts at row 2, so index 2 = row 3)
  submissionDate: string;
  name: string;
  lineId: string;
  phone: string;
  diagnosis: string; // "1 단계" or "2 단계"
  consent: string;
  status: string; // 상담현황
  channel: string; // "Line" or "FB"
  metaId: string;
}

// Parse diagnosis to level info
function parseDiagnosis(diagnosis: string): { level: number; nameKo: string; nameTh: string; emoji: string } | null {
  if (diagnosis.includes('1 단계') || diagnosis.includes('1단계')) {
    return { level: 1, nameKo: '1단계 (블루)', nameTh: 'ระดับ1 สีฟ้า🩵', emoji: '🩵' };
  }
  if (diagnosis.includes('2 단계') || diagnosis.includes('2단계')) {
    return { level: 2, nameKo: '2단계 (핑크)', nameTh: 'ระดับ2 สีชมพู🩷', emoji: '🩷' };
  }
  return null;
}

// Sanitize a string for use in PostgREST filter values to prevent injection
function sanitizeForFilter(value: string): string {
  return value.replace(/[%_'"\\]/g, '');
}

// Fuzzy match patient to LINE conversation using survey_name
async function findConversation(
  lineId: string,
  name: string,
  phone: string,
): Promise<{ conversationId: string; customerId: string; channelId: string; lineUserId: string } | null> {
  // Step 1: Exact survey_name match (most reliable — collected from chatbot)
  if (name) {
    const safeName = sanitizeForFilter(name);
    if (safeName) {
      const { data: exact } = await supabaseAdmin
        .from('customers')
        .select('id, line_user_id, display_name, survey_name')
        .eq('survey_name', safeName)
        .limit(5);

      if (exact && exact.length > 0) {
        const match = await findLatestConversation(exact);
        if (match) return match;
      }

      // Step 1b: Partial survey_name match (first name only)
      const firstName = safeName.split(/\s+/)[0];
      if (firstName && firstName.length >= 2) {
        const { data: partial } = await supabaseAdmin
          .from('customers')
          .select('id, line_user_id, display_name, survey_name')
          .not('survey_name', 'is', null)
          .ilike('survey_name', `%${firstName}%`)
          .limit(10);

        if (partial && partial.length > 0) {
          const match = await findLatestConversation(partial);
          if (match) return match;
        }
      }
    }
  }

  // Step 2: LINE display name match (fallback)
  if (lineId && lineId !== '-' && lineId !== '.') {
    const safeLineId = sanitizeForFilter(lineId);
    if (safeLineId) {
      const { data: exact } = await supabaseAdmin
        .from('customers')
        .select('id, line_user_id, display_name, survey_name')
        .eq('display_name', safeLineId)
        .limit(5);

      if (exact && exact.length > 0) {
        const match = await findLatestConversation(exact);
        if (match) return match;
      }

      // Partial LINE display name match
      const { data: partial } = await supabaseAdmin
        .from('customers')
        .select('id, line_user_id, display_name, survey_name')
        .ilike('display_name', `%${safeLineId}%`)
        .limit(10);

      if (partial && partial.length > 0) {
        const match = await findLatestConversation(partial);
        if (match) return match;
      }
    }
  }

  // Step 3 removed — display_name partial matching caused false positives
  // (e.g., "Ta" matching "litar@cartoon"). Only survey_name and exact
  // LINE display name matches are reliable.

  return null;
}

// From a list of customer candidates, find the one with the most recent LINE conversation
async function findLatestConversation(
  customers: Array<{ id: string; line_user_id: string; display_name: string; survey_name?: string }>,
): Promise<{ conversationId: string; customerId: string; channelId: string; lineUserId: string } | null> {
  const customerIds = customers.map(c => c.id);

  const { data: conversations } = await supabaseAdmin
    .from('channel_conversations')
    .select('id, customer_id, channel_id, channel_type')
    .in('customer_id', customerIds)
    .eq('channel_type', 'line')
    .order('last_message_at', { ascending: false })
    .limit(1);

  if (conversations && conversations.length > 0) {
    const conv = conversations[0];
    const customer = customers.find(c => c.id === conv.customer_id);
    return {
      conversationId: conv.id,
      customerId: conv.customer_id,
      channelId: conv.channel_id,
      lineUserId: customer?.line_user_id || '',
    };
  }
  return null;
}

// Build the notification message using payment info from DB
function buildNotificationMessage(
  diagnosisInfo: { level: number; nameTh: string; emoji: string },
  patientName: string,
  paymentKorea?: { bank: string; account_number: string; account_name: string },
  paymentThailand?: { bank: string; account_number: string; account_name: string },
): string {
  const levelDesc =
    diagnosisInfo.level === 1
      ? 'Korean Diet ระดับ1 สีฟ้า🩵 (อ่อนโยน เหมาะสำหรับผู้ที่ไวต่อคาเฟอีน หรือมีโรคประจำตัว)'
      : 'Korean Diet ระดับ2 สีชมพู🩷 (สูตรเข้มข้น เหมาะสำหรับผู้ที่ต้องการผลลัพธ์ที่ชัดเจน)';

  let paymentSection = '';
  if (paymentKorea) {
    paymentSection += `\n🇰🇷 โอนวอน:\nธนาคาร ${paymentKorea.bank}\nเลขที่บัญชี ${paymentKorea.account_number}\nชื่อบัญชี ${paymentKorea.account_name}`;
  }
  if (paymentThailand) {
    paymentSection += `\n\n🇹🇭 โอนบาท:\nธนาคาร ${paymentThailand.bank}\nเลขที่บัญชี ${paymentThailand.account_number}\nชื่อบัญชี ${paymentThailand.account_name}`;
  }

  return `สวัสดีค่ะ คุณ${patientName} 🙏🏻

คุณหมอตรวจแบบประเมินสุขภาพเรียบร้อยแล้วค่ะ 💊

ผลการวินิจฉัย: ${levelDesc}

📦 ราคาสินค้า:
• 1 กล่อง — 99,000 วอน (~2,587 บาท)
• 2 กล่อง — 149,000 วอน (~3,565 บาท)
• 4 กล่อง — 249,000 วอน (~5,739 บาท)
✨ ทุกออเดอร์แถม Lirio Plus 2 กล่องฟรี!

หากต้องการสั่งซื้อ กรุณาแจ้งจำนวนกล่องที่ต้องการ แล้วโอนเงินมาที่:
${paymentSection}

หลังโอนแล้วส่งสลิป + ชื่อ + เบอร์ + ที่อยู่จัดส่งมาได้เลยนะคะ 😊`;
}

export async function GET(req: NextRequest) {
  if (!verifyCron(req)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const SHEET_ID = process.env.GOOGLE_SHEET_ID;
  if (!SHEET_ID) {
    return withCors(NextResponse.json({ error: 'GOOGLE_SHEET_ID not set' }, { status: 500 }));
  }

  let notified = 0;
  let skipped = 0;
  let matchFailed = 0;
  let surveyPushSent = 0;
  const errors: string[] = [];

  // ── Phase 1: Push survey name request to customers who haven't provided it ──
  try {
    const SURVEY_PROMPT_MARKER = 'กรุณาแจ้งชื่อ-นามสกุลที่ใช้กรอกในแบบประเมิน';
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // Find LINE conversations where customer has no survey_name, last message > 1 hour ago
    const { data: candidates } = await supabaseAdmin
      .from('channel_conversations')
      .select('id, customer_id, channel_id')
      .eq('channel_type', 'line')
      .lt('last_message_at', oneHourAgo)
      .limit(20);

    for (const conv of candidates || []) {
      try {
        // Check if customer already has survey_name
        const { data: cust } = await supabaseAdmin
          .from('customers')
          .select('id, survey_name, line_user_id')
          .eq('id', conv.customer_id)
          .single();

        if (!cust || cust.survey_name || !cust.line_user_id) continue;

        // Check if we already sent the survey prompt in this conversation
        const { data: existingPrompt } = await supabaseAdmin
          .from('channel_messages')
          .select('id')
          .eq('conversation_id', conv.id)
          .eq('sender_type', 'bot')
          .ilike('body', `%${SURVEY_PROMPT_MARKER}%`)
          .limit(1);

        if (existingPrompt && existingPrompt.length > 0) continue;

        // Send push message
        const { getChannelAdapter } = await import('@/lib/channels/registry');
        const adapter = await getChannelAdapter('line', conv.channel_id);

        const pushMessage = 'สวัสดีค่ะ 🙏🏻 หากกรอกแบบประเมินสุขภาพเรียบร้อยแล้ว กรุณาแจ้งชื่อ-นามสกุลที่ใช้กรอกในแบบประเมินด้วยนะคะ เพื่อจะได้ตรวจสอบผลจากคุณหมอได้ถูกต้องค่ะ 😊';

        await adapter.sendTextMessage(cust.line_user_id, pushMessage);

        // Store in channel_messages
        const now = new Date().toISOString();
        await supabaseAdmin.from('channel_messages').insert({
          conversation_id: conv.id,
          sender_type: 'bot',
          body: pushMessage,
          message_type: 'text',
          created_at: now,
        });

        await supabaseAdmin
          .from('channel_conversations')
          .update({ last_message_at: now, last_agent_message_at: now })
          .eq('id', conv.id);

        surveyPushSent++;
        console.log(`[PrescriptionNotify] Survey push sent to customer ${conv.customer_id}`);
      } catch (pushErr: unknown) {
        const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
        console.error(`[PrescriptionNotify] Survey push error for conv ${conv.id}:`, msg);
      }
    }

    if (surveyPushSent > 0) {
      console.log(`[PrescriptionNotify] Phase 1 done — survey pushes sent: ${surveyPushSent}`);
    }
  } catch (phase1Err: unknown) {
    const msg = phase1Err instanceof Error ? phase1Err.message : String(phase1Err);
    console.error('[PrescriptionNotify] Phase 1 error:', msg);
  }

  // ── Phase 2: Google Sheet prescription notification ──
  try {
    // Pre-fetch all known survey_names for efficient retry filtering
    const { data: surveyCustomers } = await supabaseAdmin
      .from('customers')
      .select('survey_name')
      .not('survey_name', 'is', null);
    const surveyNames = (surveyCustomers || []).map(c => c.survey_name).filter(Boolean) as string[];
    console.log(`[PrescriptionNotify] Known survey_names: ${surveyNames.length}`);

    // Fetch payment info from hospital_info (Korean Diet)
    const { data: hospitalInfo } = await supabaseAdmin
      .from('hospital_info')
      .select('operating_hours')
      .eq('hospital_prefix', 'koreandiet')
      .maybeSingle();
    const paymentKorea = (hospitalInfo?.operating_hours as any)?.payment_korea;
    const paymentThailand = (hospitalInfo?.operating_hours as any)?.payment_thailand;

    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // Read all data from sheet
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A1:R5000',
    });

    const rows = res.data.values || [];
    if (rows.length < 3) {
      return withCors(NextResponse.json({ message: 'No data rows in sheet', notified: 0 }));
    }

    // Parse rows (skip header rows 0 and 1)
    const candidates: SheetRow[] = [];
    for (let i = 2; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 15) continue;

      const diagnosis = (row[12] || '').trim();
      const consent = (row[13] || '').trim().toLowerCase();
      const status = (row[14] || '').trim();
      const channel = (row[16] || '').trim();

      // Filter: has diagnosis + consent=yes + status is NOT already 구매완료 or contains "자동안내"
      if (!diagnosis || consent !== 'yes') continue;
      if (!parseDiagnosis(diagnosis)) continue;

      // Skip if already notified (구매완료, 자동안내완료, or 상담완료)
      if (status.includes('구매완료') || status.includes('자동안내완료')) continue;

      // Process: empty or 상담중 (new rows), or retry failed rows only if name matches a known survey_name
      const isNew = !status || status.includes('상담중');
      const isRetry = status.includes('매칭불가') || status.includes('메시지 보냈음');
      if (!isNew && !isRetry) continue;

      // For retry rows, skip if no survey_names exist that could match
      if (isRetry) {
        if (!surveyNames || surveyNames.length === 0) continue;
        const rowName = (row[1] || '').trim().toLowerCase();
        const hasMatch = surveyNames.some(sn => {
          const snLower = sn.toLowerCase();
          return snLower.includes(rowName) || rowName.includes(snLower) ||
            snLower.includes(rowName.split(/\s+/)[0]) || rowName.split(/\s+/)[0].length >= 2 && snLower.includes(rowName.split(/\s+/)[0]);
        });
        if (!hasMatch) continue;
      }

      candidates.push({
        rowIndex: i,
        submissionDate: (row[0] || '').trim(),
        name: (row[1] || '').trim(),
        lineId: (row[2] || '').trim(),
        phone: (row[3] || '').trim(),
        diagnosis,
        consent,
        status,
        channel,
        metaId: (row[17] || '').trim(),
      });
    }

    console.log(`[PrescriptionNotify] Found ${candidates.length} candidates to process`);

    // Process each candidate
    for (const candidate of candidates) {
      try {
        const diagnosisInfo = parseDiagnosis(candidate.diagnosis);
        if (!diagnosisInfo) {
          skipped++;
          continue;
        }

        // Only process LINE channel patients (FB handled separately)
        // Also try matching for rows without explicit channel
        if (candidate.channel && candidate.channel.toLowerCase() === 'fb') {
          // Skip Facebook patients for now — they use Messenger, not LINE
          skipped++;
          console.log(
            `[PrescriptionNotify] Skipping FB patient: ${candidate.name} (row ${candidate.rowIndex + 1})`,
          );
          continue;
        }

        // Fuzzy match to LINE conversation
        const match = await findConversation(candidate.lineId, candidate.name, candidate.phone);

        if (!match) {
          matchFailed++;
          console.log(
            `[PrescriptionNotify] No match for: ${candidate.name} (lineId=${candidate.lineId}, phone=${candidate.phone}) — row ${candidate.rowIndex + 1}`,
          );

          // Update sheet status — use '매칭불가' so it won't be retried
          await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `Sheet1!O${candidate.rowIndex + 1}`,
            valueInputOption: 'RAW',
            requestBody: {
              values: [['매칭불가 (라인 id 못찾기) จับคู่ไม่ได้ (ไม่พบไลน์ไอดี)']],
            },
          });
          continue;
        }

        // Build and send the notification message
        const message = buildNotificationMessage(diagnosisInfo, candidate.name, paymentKorea, paymentThailand);

        // Get LINE adapter and send
        const { getChannelAdapter } = await import('@/lib/channels/registry');
        const adapter = await getChannelAdapter('line', match.channelId);

        // Get customer's LINE user ID
        const { data: customerData } = await supabaseAdmin
          .from('customers')
          .select('line_user_id')
          .eq('id', match.customerId)
          .single();

        if (!customerData?.line_user_id) {
          console.error(
            `[PrescriptionNotify] No line_user_id for customer ${match.customerId}`,
          );
          matchFailed++;
          continue;
        }

        await adapter.sendTextMessage(customerData.line_user_id, message);

        // Store the bot message in channel_messages
        const now = new Date().toISOString();
        await supabaseAdmin.from('channel_messages').insert({
          conversation_id: match.conversationId,
          sender_type: 'bot',
          body: message,
          message_type: 'text',
          created_at: now,
        });

        // Update conversation timestamps
        await supabaseAdmin
          .from('channel_conversations')
          .update({
            last_message_at: now,
            last_agent_message_at: now,
          })
          .eq('id', match.conversationId);

        // Update Google Sheet status
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `Sheet1!O${candidate.rowIndex + 1}`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [[`자동안내완료 แจ้งผลอัตโนมัติ (${diagnosisInfo.nameTh})`]],
          },
        });

        notified++;
        console.log(
          `[PrescriptionNotify] Notified ${candidate.name} — ${diagnosisInfo.nameTh} (row ${candidate.rowIndex + 1})`,
        );
      } catch (rowErr: unknown) {
        const errMsg = rowErr instanceof Error ? rowErr.message : String(rowErr);
        errors.push(`Row ${candidate.rowIndex + 1} (${candidate.name}): ${errMsg}`);
        console.error(
          `[PrescriptionNotify] Error processing row ${candidate.rowIndex + 1}:`,
          errMsg,
        );
      }
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[PrescriptionNotify] Fatal error:', errMsg);
    return withCors(NextResponse.json({ error: errMsg }, { status: 500 }));
  }

  console.log(
    `[PrescriptionNotify] Done — notified: ${notified}, skipped: ${skipped}, matchFailed: ${matchFailed}, surveyPush: ${surveyPushSent}`,
  );
  return withCors(
    NextResponse.json({
      notified,
      skipped,
      match_failed: matchFailed,
      survey_push_sent: surveyPushSent,
      errors: errors.length > 0 ? errors : undefined,
    }),
  );
}

// POST handler aliases to GET for manual trigger
export async function POST(req: NextRequest) {
  return GET(req);
}
