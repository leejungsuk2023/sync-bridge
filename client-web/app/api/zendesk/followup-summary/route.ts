import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

export const maxDuration = 300;

// Vercel cron calls GET
export async function GET(req: NextRequest) {
  return handleSummary(req);
}

export async function POST(req: NextRequest) {
  return handleSummary(req);
}

async function handleSummary(req: NextRequest) {
  if (!verifyCron(req)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  const results: { ticket_id: number; status: string }[] = [];
  const errors: string[] = [];
  let autoMissing = 0;

  try {
    // Get ALL active followup tickets (not just due ones)
    const { data: activeTickets, error: queryError } = await supabaseAdmin
      .from('zendesk_analyses')
      .select('*')
      .in('followup_status', ['contacted', 'scheduled'])
      .limit(50);

    if (queryError) {
      return withCors(NextResponse.json({ error: queryError.message }, { status: 500 }));
    }

    if (!activeTickets || activeTickets.length === 0) {
      return withCors(NextResponse.json({ processed: 0, message: 'No active followup tickets' }));
    }

    const ZENDESK_AUTH = process.env.ZENDESK_EMAIL && process.env.ZENDESK_API_TOKEN
      ? Buffer.from(`${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`).toString('base64')
      : null;

    // === AUTO-MISSING: Mark tickets with no activity for 4+ days as lost ===
    try {
      const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
      const { data: staleTickets, error: staleError } = await supabaseAdmin
        .from('zendesk_analyses')
        .select('ticket_id, customer_name, followup_status, followup_updated_at')
        .in('followup_status', ['contacted', 'scheduled', 'pending'])
        .lte('followup_updated_at', fourDaysAgo);

      if (!staleError && staleTickets && staleTickets.length > 0) {
        console.log(`[followup-summary] Auto-missing: found ${staleTickets.length} stale tickets (4+ days inactive)`);

        for (const ticket of staleTickets) {
          // Update status to lost
          await supabaseAdmin
            .from('zendesk_analyses')
            .update({
              followup_status: 'lost',
              lost_reason: 'no_response',
              next_check_at: null,
              followup_updated_at: new Date().toISOString(),
            })
            .eq('ticket_id', ticket.ticket_id);

          // Insert action record
          await supabaseAdmin
            .from('followup_actions')
            .insert({
              ticket_id: ticket.ticket_id,
              action_type: 'system_note',
              content: `4일간 활동 없음 — 자동으로 미싱(lost) 처리됨 (이전 상태: ${ticket.followup_status})`,
              content_th: `ไม่มีกิจกรรม 4 วัน — ระบบเปลี่ยนสถานะเป็น ไม่สำเร็จ อัตโนมัติ (สถานะเดิม: ${ticket.followup_status})`,
              status_before: ticket.followup_status,
              status_after: 'lost',
            });

          console.log(`[followup-summary] Auto-missing: ticket ${ticket.ticket_id} (${ticket.customer_name}) marked as lost`);
        }

        autoMissing = staleTickets.length;
      }
    } catch (missingErr: any) {
      console.error('[followup-summary] Auto-missing error:', missingErr.message);
    }

    for (const ticket of activeTickets) {
      try {
        // Fetch recent Zendesk comments
        let recentComments = '';
        if (ZENDESK_AUTH && process.env.ZENDESK_SUBDOMAIN) {
          try {
            const zdRes = await fetch(
              `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets/${ticket.ticket_id}/comments?sort_order=desc&per_page=10`,
              { headers: { Authorization: `Basic ${ZENDESK_AUTH}` } }
            );
            if (zdRes.ok) {
              const zdData = await zdRes.json();
              const comments = (zdData.comments || []).reverse();
              recentComments = comments
                .map((c: any) => {
                  const body = (c.body || '')
                    .replace(/<[^>]*>/g, '')
                    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
                    .substring(0, 300);
                  return `[${c.created_at}] ${body}`;
                })
                .join('\n');
            }
          } catch (zdErr: any) {
            errors.push(`Ticket ${ticket.ticket_id}: Zendesk fetch failed - ${zdErr.message}`);
          }
        }

        // Get ticket subject
        const { data: ticketInfo } = await supabaseAdmin
          .from('zendesk_tickets')
          .select('subject')
          .eq('ticket_id', ticket.ticket_id)
          .single();

        // Get recent followup_actions for context
        const { data: recentActions } = await supabaseAdmin
          .from('followup_actions')
          .select('action_type, content, created_at')
          .eq('ticket_id', ticket.ticket_id)
          .order('created_at', { ascending: false })
          .limit(5);

        const actionsContext = (recentActions || [])
          .reverse()
          .map(a => `[${a.created_at}] (${a.action_type}): ${a.content}`)
          .join('\n') || 'No previous actions';

        // AI summary
        const prompt = `You are an AI assistant monitoring customer followup progress.

## Context
- Customer: ${ticket.customer_name || 'Unknown'}
- Hospital: ${ticket.hospital_name || 'Unknown'}
- Interested procedure: ${ticket.interested_procedure || 'Unknown'}
- Followup reason: ${ticket.followup_reason || 'Unknown'}
- Ticket subject: ${ticketInfo?.subject || 'Unknown'}
- Current status: ${ticket.followup_status}
- Check count: ${(ticket.check_count || 0) + 1}

## Recent Zendesk conversation:
${recentComments || 'No recent comments available'}

## Previous followup actions:
${actionsContext}

## Task
Provide a periodic status update and next action recommendation for this customer.
1. Summarize any changes or new developments
2. Recommend the next specific action the worker should take
3. Assess if this might convert to a reservation (look for booking intent in conversation)

Return JSON:
{
  "summary_ko": "Korean: Status update + what changed (2-3 sentences for admin)",
  "instruction_th": "Thai: Specific next action for worker",
  "instruction_ko": "Korean: Same instruction (for admin reference)",
  "urgency": "high | medium | low",
  "suggested_status": "contacted | scheduled | converted | lost | null",
  "reservation_detected": false
}`;

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.2, maxOutputTokens: 1024, responseMimeType: 'application/json' },
            }),
          }
        );

        if (!geminiRes.ok) {
          errors.push(`Ticket ${ticket.ticket_id}: Gemini ${geminiRes.status}`);
          results.push({ ticket_id: ticket.ticket_id, status: 'gemini_failed' });
          continue;
        }

        const geminiData = await geminiRes.json();
        let text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (!text) {
          errors.push(`Ticket ${ticket.ticket_id}: Empty Gemini response`);
          results.push({ ticket_id: ticket.ticket_id, status: 'empty_response' });
          continue;
        }

        // Clean control characters that break JSON.parse
        text = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
        const result = JSON.parse(text);

        // Insert AI instruction action
        const { data: actionData } = await supabaseAdmin
          .from('followup_actions')
          .insert({
            ticket_id: ticket.ticket_id,
            action_type: 'ai_instruction',
            content: result.instruction_ko || result.summary_ko || '',
            content_th: result.instruction_th || '',
            zendesk_changes: {
              urgency: result.urgency,
              suggested_status: result.suggested_status,
              reservation_detected: result.reservation_detected,
              summary_ko: result.summary_ko,
            },
          })
          .select('id')
          .single();

        // Create notification for workers
        if (actionData) {
          const { data: workers } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('role', 'worker');

          if (workers && workers.length > 0) {
            const notifications = workers.map((w: any) => ({
              user_id: w.id,
              action_id: actionData.id,
              ticket_id: ticket.ticket_id,
              title: result.urgency === 'high'
                ? `[เร่งด่วน] ต้องติดตาม: ${ticket.customer_name || `#${ticket.ticket_id}`}`
                : `คำแนะนำติดตาม: ${ticket.customer_name || `#${ticket.ticket_id}`}`,
              body: result.instruction_th || result.instruction_ko || '',
            }));
            await supabaseAdmin.from('followup_notifications').insert(notifications);
          }
        }

        // Auto-detect reservation → update status to converted
        if (result.reservation_detected && result.suggested_status === 'converted') {
          await supabaseAdmin
            .from('zendesk_analyses')
            .update({
              followup_status: 'converted',
              followup_updated_at: new Date().toISOString(),
            })
            .eq('ticket_id', ticket.ticket_id);

          await supabaseAdmin.from('followup_actions').insert({
            ticket_id: ticket.ticket_id,
            action_type: 'system_note',
            content: `AI detected reservation - auto-converted (${result.summary_ko || ''})`,
            content_th: 'AI ตรวจพบการจอง - เปลี่ยนสถานะเป็นสำเร็จอัตโนมัติ',
            status_before: ticket.followup_status,
            status_after: 'converted',
          });
        }

        // Update check metadata
        await supabaseAdmin
          .from('zendesk_analyses')
          .update({
            last_checked_at: new Date().toISOString(),
            next_check_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(), // Next check in 3h
            check_count: (ticket.check_count || 0) + 1,
          })
          .eq('ticket_id', ticket.ticket_id);

        results.push({ ticket_id: ticket.ticket_id, status: 'ok' });
      } catch (ticketErr: any) {
        errors.push(`Ticket ${ticket.ticket_id}: ${ticketErr.message}`);
        results.push({ ticket_id: ticket.ticket_id, status: 'error' });
      }
    }
  } catch (err: any) {
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }

  return withCors(NextResponse.json({
    processed: results.length,
    auto_missing: autoMissing,
    results,
    errors: errors.length > 0 ? errors : undefined,
  }));
}
