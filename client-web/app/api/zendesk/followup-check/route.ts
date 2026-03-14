import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// CORS: Desktop App (Electron) and Extension cross-origin requests
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

const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN;
const ZENDESK_AUTH = Buffer.from(
  `${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`
).toString('base64');

function verifyCron(req: NextRequest): boolean {
  // Vercel Cron header
  if (req.headers.get('x-vercel-cron')) return true;
  // Manual trigger with CRON_SECRET
  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

interface ZendeskComment {
  id: number;
  body: string;
  author_id: number;
  created_at: string;
}

async function fetchZendeskComments(ticketId: number): Promise<ZendeskComment[]> {
  const res = await fetch(
    `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets/${ticketId}/comments`,
    { headers: { Authorization: `Basic ${ZENDESK_AUTH}` } }
  );
  if (!res.ok) {
    throw new Error(`Zendesk API error: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data.comments || [];
}

function buildFollowupPrompt(params: {
  hospitalName: string;
  customerName: string;
  customerPhone: string;
  interestedProcedure: string;
  ticketSubject: string;
  currentFollowupStatus: string;
  checkCount: number;
  ticketStatus: string;
  recentComments: string;
  newCommentsCount: number;
  newCommentsSummary: string;
  statusChanged: boolean;
  workerActions: string;
}): string {
  return `당신은 태국 CS/마케팅 직원의 업무 코치입니다.

## 상황
- 병원: ${params.hospitalName || 'N/A'}
- 고객: ${params.customerName || 'N/A'} (${params.customerPhone || 'N/A'})
- 관심 시술: ${params.interestedProcedure || 'N/A'}
- 원래 문의 내용: ${params.ticketSubject || 'N/A'}
- 현재 팔로우업 상태: ${params.currentFollowupStatus}
- 체크 횟수: ${params.checkCount}회차

## Zendesk 티켓 최신 상태
- 티켓 상태: ${params.ticketStatus || 'N/A'}
- 최근 댓글:
${params.recentComments}

## 지난 체크 이후 변화
- 새 댓글: ${params.newCommentsCount}건
- 새 댓글 내용 요약: ${params.newCommentsSummary || '없음'}
- 상태 변경: ${params.statusChanged ? '있음' : '없음'}

## 워커 이전 조치 이력
${params.workerActions}

## 지시사항
위 정보를 분석하여 워커가 지금 해야 할 구체적인 다음 행동 1가지를 태국어로 작성하세요.

규칙:
1. 구체적으로 (예: "LINE으로 시술 가격표를 보내고 3월 15일 예약 확인")
2. 고객 반응에 맞춰 대응, 무반응이면 다른 채널/접근법 제안
3. checkCount 10 이상이면 escalation/종료 고려 제안
4. 태국어 작성, 고유명사 원어 유지

응답 형식 (JSON):
{
  "instruction_th": "태국어 행동 지시",
  "instruction_ko": "한국어 번역 (어드민 확인용)",
  "urgency": "high | medium | low",
  "suggested_status": "contacted | scheduled | converted | lost | null"
}`;
}

export async function POST(req: NextRequest) {
  if (!verifyCron(req)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  const results: { ticket_id: number; status: string }[] = [];
  const errors: string[] = [];

  try {
    // Find tickets due for check
    const { data: dueTickets, error: queryError } = await supabaseAdmin
      .from('zendesk_analyses')
      .select('*')
      .in('followup_status', ['contacted', 'scheduled'])
      .not('next_check_at', 'is', null)
      .lte('next_check_at', new Date().toISOString())
      .lt('check_count', 20)
      .limit(10);

    if (queryError) {
      return withCors(NextResponse.json({ error: queryError.message }, { status: 500 }));
    }

    if (!dueTickets || dueTickets.length === 0) {
      return withCors(NextResponse.json({ processed: 0, message: 'No tickets due for check' }));
    }

    // Fetch ticket subjects for context
    const ticketIds = dueTickets.map(t => t.ticket_id);
    const { data: tickets } = await supabaseAdmin
      .from('zendesk_tickets')
      .select('ticket_id, subject, status')
      .in('ticket_id', ticketIds);
    const ticketMap = new Map((tickets || []).map(t => [t.ticket_id, t]));

    // Process each ticket
    for (const analysis of dueTickets) {
      try {
        const ticketInfo = ticketMap.get(analysis.ticket_id);

        // 1. Fetch Zendesk comments
        let comments: ZendeskComment[] = [];
        try {
          comments = await fetchZendeskComments(analysis.ticket_id);
        } catch (zErr: any) {
          errors.push(`Ticket ${analysis.ticket_id}: Zendesk fetch failed - ${zErr.message}`);
          // Still continue with empty comments
        }

        // 2. Filter new comments after last_zendesk_comment_id
        let newComments: ZendeskComment[] = [];
        if (analysis.last_zendesk_comment_id && comments.length > 0) {
          const lastIdx = comments.findIndex(
            c => String(c.id) === String(analysis.last_zendesk_comment_id)
          );
          if (lastIdx >= 0) {
            newComments = comments.slice(lastIdx + 1);
          } else {
            newComments = comments;
          }
        } else {
          newComments = comments;
        }

        // 3. Fetch recent followup_actions for context
        const { data: recentActions } = await supabaseAdmin
          .from('followup_actions')
          .select('*')
          .eq('ticket_id', analysis.ticket_id)
          .order('created_at', { ascending: false })
          .limit(5);

        const workerActionsText = (recentActions || [])
          .reverse()
          .map(a => `[${a.created_at}] (${a.action_type}): ${a.content}`)
          .join('\n') || 'No previous actions';

        const recentCommentsText = comments
          .slice(-10)
          .map(c => `[${c.created_at}] (author:${c.author_id}): ${c.body?.substring(0, 300)}`)
          .join('\n') || 'No comments';

        const newCommentsSummary = newComments
          .map(c => c.body?.substring(0, 200))
          .join('; ') || '';

        // 4. Call Gemini API for next action instruction
        const prompt = buildFollowupPrompt({
          hospitalName: analysis.hospital_name || '',
          customerName: analysis.customer_name || '',
          customerPhone: analysis.customer_phone || '',
          interestedProcedure: analysis.interested_procedure || '',
          ticketSubject: ticketInfo?.subject || '',
          currentFollowupStatus: analysis.followup_status,
          checkCount: (analysis.check_count || 0) + 1,
          ticketStatus: ticketInfo?.status || '',
          recentComments: recentCommentsText,
          newCommentsCount: newComments.length,
          newCommentsSummary,
          statusChanged: false,
          workerActions: workerActionsText,
        });

        let aiResult: any = null;
        let geminiSuccess = false;

        try {
          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: 'application/json' },
              }),
            }
          );

          if (!geminiRes.ok) {
            throw new Error(`Gemini API error: ${geminiRes.status}`);
          }

          const geminiData = await geminiRes.json();
          const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            aiResult = JSON.parse(text);
            geminiSuccess = true;
          } else {
            throw new Error('Empty Gemini response');
          }
        } catch (gemErr: any) {
          errors.push(`Ticket ${analysis.ticket_id}: Gemini failed - ${gemErr.message}`);
        }

        // 5. Insert action record
        if (geminiSuccess && aiResult) {
          const { data: actionData } = await supabaseAdmin
            .from('followup_actions')
            .insert({
              ticket_id: analysis.ticket_id,
              action_type: 'ai_instruction',
              content: aiResult.instruction_ko || aiResult.instruction_th || '',
              content_th: aiResult.instruction_th || '',
              zendesk_changes: {
                new_comments_count: newComments.length,
                urgency: aiResult.urgency,
                suggested_status: aiResult.suggested_status,
              },
            })
            .select('id')
            .single();

          // 6. Insert notification for the worker who last updated this ticket
          if (actionData && analysis.followup_updated_by) {
            await supabaseAdmin
              .from('followup_notifications')
              .insert({
                user_id: analysis.followup_updated_by,
                action_id: actionData.id,
                ticket_id: analysis.ticket_id,
                title: aiResult.urgency === 'high'
                  ? `[เร่งด่วน] ต้องติดตาม: ${analysis.customer_name || `#${analysis.ticket_id}`}`
                  : `คำแนะนำติดตาม: ${analysis.customer_name || `#${analysis.ticket_id}`}`,
                body: aiResult.instruction_th || aiResult.instruction_ko || '',
              });
          }

          // 7. Update zendesk_analyses
          const latestCommentId = comments.length > 0
            ? String(comments[comments.length - 1].id)
            : analysis.last_zendesk_comment_id;

          await supabaseAdmin
            .from('zendesk_analyses')
            .update({
              last_checked_at: new Date().toISOString(),
              last_zendesk_comment_id: latestCommentId,
              next_check_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
              check_count: (analysis.check_count || 0) + 1,
            })
            .eq('ticket_id', analysis.ticket_id);

          results.push({ ticket_id: analysis.ticket_id, status: 'ok' });
        } else {
          // Gemini failed: insert system_note and retry in 1h
          await supabaseAdmin
            .from('followup_actions')
            .insert({
              ticket_id: analysis.ticket_id,
              action_type: 'system_note',
              content: 'AI instruction generation failed',
              content_th: 'ไม่สามารถสร้างคำแนะนำจาก AI ได้',
            });

          await supabaseAdmin
            .from('zendesk_analyses')
            .update({
              last_checked_at: new Date().toISOString(),
              next_check_at: new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(),
              check_count: (analysis.check_count || 0) + 1,
            })
            .eq('ticket_id', analysis.ticket_id);

          results.push({ ticket_id: analysis.ticket_id, status: 'gemini_failed' });
        }
      } catch (ticketErr: any) {
        errors.push(`Ticket ${analysis.ticket_id}: ${ticketErr.message}`);
        results.push({ ticket_id: analysis.ticket_id, status: 'error' });
      }
    }
  } catch (err: any) {
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }

  return withCors(NextResponse.json({
    processed: results.length,
    results,
    errors: errors.length > 0 ? errors : undefined,
  }));
}

export async function GET(req: NextRequest) {
  return POST(req);
}
