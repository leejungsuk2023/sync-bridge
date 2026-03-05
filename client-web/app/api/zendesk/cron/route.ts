import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ZendeskClient } from '@/lib/zendesk';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const maxDuration = 300; // Vercel Pro allows 300s for cron

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Verify cron secret (Vercel sends this header automatically)
function verifyCron(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!verifyCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: any = { sync: null, analyze: null };

  // === STEP 1: Incremental Sync ===
  // Get the latest synced_at timestamp to only fetch recent changes
  try {
    const { data: latestTicket } = await supabaseAdmin
      .from('zendesk_tickets')
      .select('synced_at')
      .order('synced_at', { ascending: false })
      .limit(1)
      .single();

    const since = latestTicket?.synced_at || undefined;
    const zendesk = new ZendeskClient();
    let synced = 0;
    const errors: string[] = [];

    // Use fetchTicketsPage for incremental sync, max 10 pages
    let page = 1;
    const maxPages = 10;

    while (page <= maxPages) {
      const data = await zendesk.fetchTicketsPage(page, 50);
      const tickets = data.tickets;

      if (tickets.length === 0) break;

      // Check if we've reached tickets older than our last sync
      let hasRecentTickets = false;

      const userIds = new Set<number>();
      tickets.forEach((t: any) => {
        if (t.assignee_id) userIds.add(t.assignee_id);
        if (t.requester_id) userIds.add(t.requester_id);
        if (since && new Date(t.updated_at) > new Date(since)) {
          hasRecentTickets = true;
        }
      });

      // If no since, we're doing first full sync — always process
      if (since && !hasRecentTickets) break;

      const usersMap = await zendesk.fetchUsers([...userIds]);

      for (const ticket of tickets) {
        // Skip tickets not updated since last sync (if incremental)
        if (since && new Date(ticket.updated_at) <= new Date(since)) continue;

        try {
          const comments = await zendesk.fetchTicketComments(ticket.id);
          const assignee = ticket.assignee_id ? usersMap.get(ticket.assignee_id) : null;
          const requester = ticket.requester_id ? usersMap.get(ticket.requester_id) : null;

          await supabaseAdmin.from('zendesk_tickets').upsert({
            ticket_id: ticket.id,
            subject: ticket.subject,
            description: ticket.description,
            status: ticket.status,
            priority: ticket.priority,
            assignee_email: assignee?.email || null,
            assignee_name: assignee?.name || null,
            requester_email: requester?.email || null,
            requester_name: requester?.name || null,
            tags: ticket.tags,
            created_at_zd: ticket.created_at,
            updated_at_zd: ticket.updated_at,
            comments: comments,
            synced_at: new Date().toISOString(),
          }, { onConflict: 'ticket_id' });

          synced++;
        } catch (err: any) {
          errors.push(`Ticket ${ticket.id}: ${err.message}`);
        }
      }

      if (!data.next_page) break;
      page++;
    }

    console.log(`[ZendeskCron] Sync complete: ${synced} tickets synced across ${page} pages`);
    results.sync = { synced, pages: page, errors: errors.length > 0 ? errors : undefined };
  } catch (err: any) {
    console.error('[ZendeskCron] Sync error:', err.message);
    results.sync = { error: err.message };
  }

  // === STEP 2: Analyze unanalyzed active tickets ===
  try {
    if (!process.env.GEMINI_API_KEY) {
      results.analyze = { error: 'GEMINI_API_KEY not configured' };
    } else {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 2048,
        },
      });

      // Find active tickets with 10+ comments, not yet analyzed
      const { data: tickets } = await supabaseAdmin
        .from('zendesk_tickets')
        .select('*')
        .in('status', ['open', 'pending', 'new'])
        .order('updated_at_zd', { ascending: false });

      if (!tickets || tickets.length === 0) {
        results.analyze = { analyzed: 0, message: 'No active tickets' };
      } else {
        const ticketIds = tickets.map(t => t.ticket_id);
        const { data: existingAnalyses } = await supabaseAdmin
          .from('zendesk_analyses')
          .select('ticket_id')
          .in('ticket_id', ticketIds);

        const analyzedIds = new Set((existingAnalyses || []).map((a: any) => a.ticket_id));
        const unanalyzed = tickets.filter(t => {
          if (analyzedIds.has(t.ticket_id)) return false;
          const commentCount = Array.isArray(t.comments) ? t.comments.length : 0;
          return commentCount >= 10;
        });

        let analyzed = 0;
        const errors: string[] = [];
        const batch = unanalyzed.slice(0, 10); // Max 10 per cron run

        for (const ticket of batch) {
          try {
            const commentsText = (ticket.comments || [])
              .map((c: any) => `[${c.author_id}]: ${c.body}`)
              .join('\n\n');

            const prompt = `You are analyzing a customer support ticket from a medical tourism agency (BBG) that connects Thai customers with Korean hospitals.

Analyze the following support ticket conversation and return a JSON response with these fields:
- quality_score (1-5): How well the agent handled the inquiry. 5=excellent, 1=very poor
- reservation_converted (boolean): Did the conversation lead to a hospital reservation/booking?
- needs_followup (boolean): Does this customer need follow-up contact?
- followup_reason (string or null): If needs_followup is true, explain why in Korean
- summary (string): 2-3 sentence summary of the conversation IN KOREAN (한국어로 작성)
- issues (string[]): List of any problems found in Korean (e.g., 응답 지연, 잘못된 정보, 기회 놓침)
- hospital_name (string or null): Name of the hospital discussed, if any

IMPORTANT: summary, followup_reason, and issues MUST be written in Korean (한국어).

Ticket Subject: ${ticket.subject}
Ticket Status: ${ticket.status}
Conversation:
${commentsText}

Respond ONLY with valid JSON, no markdown.`;

            const result = await model.generateContent(prompt);
            const text = result.response.text();
            const analysis = JSON.parse(text);

            await supabaseAdmin.from('zendesk_analyses').insert({
              ticket_id: ticket.ticket_id,
              quality_score: analysis.quality_score,
              reservation_converted: analysis.reservation_converted,
              needs_followup: analysis.needs_followup,
              followup_reason: analysis.followup_reason || null,
              summary: analysis.summary,
              issues: analysis.issues || [],
              hospital_name: analysis.hospital_name || null,
              analyzed_at: new Date().toISOString(),
            });

            analyzed++;
          } catch (err: any) {
            errors.push(`Ticket ${ticket.ticket_id}: ${err.message}`);
          }
        }

        console.log(`[ZendeskCron] Analyze complete: ${analyzed}/${unanalyzed.length} tickets analyzed`);
        results.analyze = { analyzed, total_unanalyzed: unanalyzed.length, errors: errors.length > 0 ? errors : undefined };
      }
    }
  } catch (err: any) {
    console.error('[ZendeskCron] Analyze error:', err.message);
    results.analyze = { error: err.message };
  }

  return NextResponse.json(results);
}
