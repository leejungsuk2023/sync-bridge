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

// Fuzzy match patient to LINE conversation
async function findConversation(
  lineId: string,
  name: string,
  phone: string,
): Promise<{ conversationId: string; customerId: string; channelId: string; lineUserId: string } | null> {
  // Step 1: Exact LINE display name match
  if (lineId && lineId !== '-' && lineId !== '.') {
    const safeLineId = sanitizeForFilter(lineId);

    if (safeLineId) {
      const { data: exact } = await supabaseAdmin
        .from('customers')
        .select('id, line_user_id, display_name')
        .eq('display_name', safeLineId)
        .limit(5);

      if (exact && exact.length > 0) {
        const match = await findLatestConversation(exact);
        if (match) return match;
      }

      // Step 2: Partial LINE ID match (ILIKE)
      const { data: partial } = await supabaseAdmin
        .from('customers')
        .select('id, line_user_id, display_name')
        .ilike('display_name', `%${safeLineId}%`)
        .limit(10);

      if (partial && partial.length > 0) {
        const match = await findLatestConversation(partial);
        if (match) return match;
      }
    }
  }

  // Step 3: Name match
  if (name) {
    // Try first word of name (often first name)
    const firstName = name.split(/\s+/)[0];
    if (firstName && firstName.length >= 2) {
      const safeFirstName = sanitizeForFilter(firstName);
      if (safeFirstName) {
        const { data: nameMatch } = await supabaseAdmin
          .from('customers')
          .select('id, line_user_id, display_name')
          .ilike('display_name', `%${safeFirstName}%`)
          .limit(10);

        if (nameMatch && nameMatch.length > 0) {
          const match = await findLatestConversation(nameMatch);
          if (match) return match;
        }
      }
    }
  }

  // Step 4: Phone match
  if (phone && phone.length >= 8) {
    // Remove leading zeros/country code, match last 8+ digits
    const phoneClean = phone.replace(/\D/g, '').slice(-9);
    if (phoneClean) {
      const { data: phoneMatch } = await supabaseAdmin
        .from('customers')
        .select('id, line_user_id, display_name')
        .ilike('phone', `%${phoneClean}%`)
        .limit(5);

      if (phoneMatch && phoneMatch.length > 0) {
        const match = await findLatestConversation(phoneMatch);
        if (match) return match;
      }
    }
  }

  return null;
}

// From a list of customer candidates, find the one with the most recent LINE conversation
async function findLatestConversation(
  customers: Array<{ id: string; line_user_id: string; display_name: string }>,
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

// Build the notification message
function buildNotificationMessage(
  diagnosisInfo: { level: number; nameTh: string; emoji: string },
  patientName: string,
): string {
  const levelDesc =
    diagnosisInfo.level === 1
      ? 'Korean Diet ระดับ1 สีฟ้า🩵 (อ่อนโยน เหมาะสำหรับผู้ที่ไวต่อคาเฟอีน หรือมีโรคประจำตัว)'
      : 'Korean Diet ระดับ2 สีชมพู🩷 (สูตรเข้มข้น เหมาะสำหรับผู้ที่ต้องการผลลัพธ์ที่ชัดเจน)';

  return `สวัสดีค่ะ คุณ${patientName} 🙏🏻

คุณหมอตรวจแบบประเมินสุขภาพเรียบร้อยแล้วค่ะ 💊

ผลการวินิจฉัย: ${levelDesc}

📦 ราคาสินค้า:
• 1 กล่อง — 99,000 วอน (~2,587 บาท)
• 2 กล่อง — 149,000 วอน (~3,565 บาท)
• 4 กล่อง — 249,000 วอน (~5,739 บาท)
✨ ทุกออเดอร์แถม Lirio Plus 2 กล่องฟรี!

หากต้องการสั่งซื้อ กรุณาแจ้งจำนวนกล่องที่ต้องการ แล้วโอนเงินมาที่:

🇰🇷 โอนวอน:
ธนาคาร SC제일은행
เลขที่บัญชี 202-20-231828
ชื่อบัญชี 이정석

🇹🇭 โอนบาท:
ธนาคาร KBANK (กสิกรไทย)
เลขที่บัญชี 182-8-33668-8
ชื่อบัญชี SUWIPA CHUTASRIPANICH

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
  const errors: string[] = [];

  try {
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // Read all data from sheet
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A1:R1000',
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

      // Only process rows where status is 상담중 or empty — these haven't been handled yet
      const shouldProcess = !status || status.includes('상담중');
      if (!shouldProcess) continue;

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
        const message = buildNotificationMessage(diagnosisInfo, candidate.name);

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
    `[PrescriptionNotify] Done — notified: ${notified}, skipped: ${skipped}, matchFailed: ${matchFailed}`,
  );
  return withCors(
    NextResponse.json({
      notified,
      skipped,
      match_failed: matchFailed,
      errors: errors.length > 0 ? errors : undefined,
    }),
  );
}

// POST handler aliases to GET for manual trigger
export async function POST(req: NextRequest) {
  return GET(req);
}
