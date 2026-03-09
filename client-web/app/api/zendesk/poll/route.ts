import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ZendeskClient } from '@/lib/zendesk';

export const maxDuration = 300; // Cron route, allow longer execution

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function verifyCron(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!verifyCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const zendesk = new ZendeskClient();
    let checked = 0;
    let newComments = 0;
    const errors: string[] = [];

    // Query active tickets that may have missed webhooks
    // Tickets where last_webhook_at is null or older than 2 minutes
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    const { data: tickets, error: queryError } = await supabaseAdmin
      .from('zendesk_tickets')
      .select('ticket_id, last_webhook_at')
      .in('status', ['new', 'open', 'pending'])
      .or(`last_webhook_at.is.null,last_webhook_at.lt.${twoMinutesAgo}`)
      .order('updated_at_zd', { ascending: false })
      .limit(50); // Process max 50 tickets per poll run

    if (queryError) {
      console.error('[Poll] Error querying tickets:', queryError);
      return NextResponse.json({ error: queryError.message }, { status: 500 });
    }

    if (!tickets || tickets.length === 0) {
      console.log('[Poll] No tickets to poll');
      return NextResponse.json({ ok: true, checked: 0, new_comments: 0 });
    }

    // Also discover new tickets from Zendesk that aren't in DB yet
    let newTicketsSynced = 0;
    try {
      const { tickets: zdTickets } = await zendesk.fetchTicketsPage(1, 30);
      if (zdTickets && zdTickets.length > 0) {
        const zdTicketIds = zdTickets.map((t: any) => t.id);
        const { data: existingInDb } = await supabaseAdmin
          .from('zendesk_tickets')
          .select('ticket_id')
          .in('ticket_id', zdTicketIds);

        const existingIds = new Set((existingInDb || []).map((t: any) => t.ticket_id));
        const newZdTickets = zdTickets.filter((t: any) => !existingIds.has(t.id));

        if (newZdTickets.length > 0) {
          // Fetch user info for new tickets
          const userIds = new Set<number>();
          newZdTickets.forEach((t: any) => {
            if (t.assignee_id) userIds.add(t.assignee_id);
            if (t.requester_id) userIds.add(t.requester_id);
          });
          const usersMap = await zendesk.fetchUsers([...userIds]);

          for (const zt of newZdTickets) {
            try {
              const comments = await zendesk.fetchTicketComments(zt.id);
              const assignee = zt.assignee_id ? usersMap.get(zt.assignee_id) : null;
              const requester = zt.requester_id ? usersMap.get(zt.requester_id) : null;

              let lastCustomerCommentAt: string | null = null;
              let lastAgentCommentAt: string | null = null;
              let lastMessageAt: string | null = null;

              if (comments && comments.length > 0) {
                const sorted = [...comments].sort(
                  (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                );
                lastMessageAt = sorted[0]?.created_at || null;
                for (const c of sorted) {
                  const isCust = zt.requester_id && c.author_id === zt.requester_id;
                  if (isCust && !lastCustomerCommentAt) lastCustomerCommentAt = c.created_at;
                  if (!isCust && !lastAgentCommentAt) lastAgentCommentAt = c.created_at;
                  if (lastCustomerCommentAt && lastAgentCommentAt) break;
                }
              }

              await supabaseAdmin.from('zendesk_tickets').upsert({
                ticket_id: zt.id,
                subject: zt.subject,
                description: zt.description,
                status: zt.status,
                priority: zt.priority,
                assignee_email: assignee?.email || null,
                assignee_name: assignee?.name || null,
                requester_email: requester?.email || null,
                requester_name: requester?.name || null,
                tags: zt.tags,
                created_at_zd: zt.created_at,
                updated_at_zd: zt.updated_at,
                comments: comments || [],
                synced_at: new Date().toISOString(),
                last_message_at: lastMessageAt || zt.updated_at,
                last_customer_comment_at: lastCustomerCommentAt,
                last_agent_comment_at: lastAgentCommentAt,
                is_read: false,
              }, { onConflict: 'ticket_id' });

              // Insert conversations
              for (const comment of (comments || [])) {
                const isCust = zt.requester_id && comment.author_id === zt.requester_id;
                const plainBody = (comment.body || '')
                  .replace(/<[^>]*>/g, '')
                  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

                const commentAuthor = usersMap.get(comment.author_id);
                const { error: insErr } = await supabaseAdmin
                  .from('zendesk_conversations')
                  .insert({
                    ticket_id: zt.id,
                    comment_id: comment.id,
                    author_zendesk_id: comment.author_id,
                    author_name: commentAuthor?.name || null,
                    author_email: commentAuthor?.email || null,
                    author_type: isCust ? 'customer' : 'agent',
                    body: plainBody,
                    body_html: comment.body || null,
                    is_public: comment.public !== false,
                    created_at_zd: comment.created_at,
                  });

                if (insErr && insErr.code !== '23505') {
                  console.error(`[Poll] Error inserting new ticket comment ${comment.id}:`, insErr);
                }
              }

              newTicketsSynced++;
            } catch (err: any) {
              console.error(`[Poll] Error syncing new ticket #${zt.id}:`, err.message);
            }
          }
          console.log(`[Poll] Discovered ${newTicketsSynced} new tickets from Zendesk`);
        }
      }
    } catch (err: any) {
      console.error('[Poll] Error discovering new tickets:', err.message);
    }

    console.log(`[Poll] Checking ${tickets.length} existing tickets for missed comments`);

    for (const ticket of tickets) {
      checked++;

      try {
        // Fetch latest comments from Zendesk
        const comments = await zendesk.fetchTicketComments(ticket.ticket_id);

        if (!comments || comments.length === 0) continue;

        // Get existing comment_ids from zendesk_conversations
        const { data: existingConvs } = await supabaseAdmin
          .from('zendesk_conversations')
          .select('comment_id')
          .eq('ticket_id', ticket.ticket_id);

        const existingCommentIds = new Set(
          (existingConvs || []).map((c: any) => c.comment_id).filter(Boolean)
        );

        // Find new comments not yet in zendesk_conversations
        const missingComments = comments.filter(
          (c: any) => !existingCommentIds.has(c.id)
        );

        if (missingComments.length === 0) continue;

        // Get ticket requester_id to determine author type
        let requesterId: number | null = null;
        try {
          const zdAuth = 'Basic ' + Buffer.from(
            `${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`
          ).toString('base64');

          const ticketRes = await fetch(
            `https://${process.env.ZENDESK_SUBDOMAIN || 'bluebridge-globalhelp'}.zendesk.com/api/v2/tickets/${ticket.ticket_id}.json`,
            { headers: { Authorization: zdAuth, 'Content-Type': 'application/json' } }
          );
          if (ticketRes.ok) {
            const ticketData = await ticketRes.json();
            requesterId = ticketData.ticket?.requester_id || null;
          }
        } catch (err) {
          console.error(`[Poll] Error fetching ticket #${ticket.ticket_id} detail:`, err);
        }

        // Insert missing comments
        for (const comment of missingComments) {
          const isCustomer = requesterId && comment.author_id === requesterId;
          const authorType = isCustomer ? 'customer' : 'agent';

          const plainBody = (comment.body || '')
            .replace(/<[^>]*>/g, '')
            .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

          const { error: insertError } = await supabaseAdmin
            .from('zendesk_conversations')
            .insert({
              ticket_id: ticket.ticket_id,
              comment_id: comment.id,
              author_zendesk_id: comment.author_id,
              author_type: authorType,
              body: plainBody,
              body_html: comment.body || null,
              is_public: comment.public !== false,
              created_at_zd: comment.created_at,
            });

          if (insertError) {
            // Skip duplicates silently
            if (insertError.code === '23505') continue;
            console.error(`[Poll] Error inserting comment ${comment.id}:`, insertError);
            continue;
          }

          newComments++;
        }

        // Update zendesk_tickets with latest info
        const latestCustomerComment = missingComments
          .filter((c: any) => requesterId && c.author_id === requesterId)
          .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

        const latestAgentComment = missingComments
          .filter((c: any) => !requesterId || c.author_id !== requesterId)
          .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

        // Determine latest message time for sorting
        const allSorted = [...missingComments].sort(
          (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        const ticketUpdate: Record<string, any> = {
          last_webhook_at: new Date().toISOString(),
          last_message_at: allSorted[0]?.created_at || new Date().toISOString(),
        };

        if (latestCustomerComment) {
          ticketUpdate.last_customer_comment_at = latestCustomerComment.created_at;
          ticketUpdate.is_read = false;
        }

        if (latestAgentComment) {
          ticketUpdate.last_agent_comment_at = latestAgentComment.created_at;
        }

        // Also append new comments to zendesk_tickets.comments JSONB
        const { data: currentTicket } = await supabaseAdmin
          .from('zendesk_tickets')
          .select('comments')
          .eq('ticket_id', ticket.ticket_id)
          .single();

        const existingJsonComments = Array.isArray(currentTicket?.comments) ? currentTicket.comments : [];
        const existingJsonIds = new Set(existingJsonComments.map((c: any) => c.id));

        const newJsonComments = missingComments
          .filter((c: any) => !existingJsonIds.has(c.id))
          .map((c: any) => ({
            id: c.id,
            body: c.body,
            author_id: c.author_id,
            created_at: c.created_at,
            public: c.public,
          }));

        if (newJsonComments.length > 0) {
          ticketUpdate.comments = [...existingJsonComments, ...newJsonComments];
        }

        await supabaseAdmin
          .from('zendesk_tickets')
          .update(ticketUpdate)
          .eq('ticket_id', ticket.ticket_id);

      } catch (err: any) {
        errors.push(`Ticket ${ticket.ticket_id}: ${err.message}`);
        console.error(`[Poll] Error processing ticket #${ticket.ticket_id}:`, err);
      }
    }

    console.log(`[Poll] Complete: checked ${checked} tickets, found ${newComments} new comments, discovered ${newTicketsSynced} new tickets`);

    return NextResponse.json({
      ok: true,
      checked,
      new_comments: newComments,
      new_tickets_discovered: newTicketsSynced,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    console.error('[Poll] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
