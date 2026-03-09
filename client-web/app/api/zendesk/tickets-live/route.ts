import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ZendeskClient } from '@/lib/zendesk';

export const maxDuration = 30;

// In-memory throttle: skip Zendesk sync if last sync was < 60s ago
let lastSyncTime = 0;
const SYNC_INTERVAL_MS = 60 * 1000; // 60 seconds

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
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

async function verifyUser(req: NextRequest): Promise<{ role: string; userId: string; email: string } | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!profile || !['bbg_admin', 'worker', 'client'].includes(profile.role)) return null;
  return { role: profile.role, userId: user.id, email: user.email || '' };
}

/**
 * Two-phase auto-sync from Zendesk API:
 *
 * Phase 1 (fast, ~2s): Fetch recent ticket metadata from Zendesk and bulk-upsert
 *   into DB. No per-ticket comment fetching — just ticket list. This ensures new
 *   tickets appear in the list immediately.
 *
 * Phase 2 (bounded, up to ~12s): For NEW tickets only (not in DB before), fetch
 *   comments in parallel batches of 5, with a 15-second hard deadline.
 *   Updated tickets get their comments synced lazily via conversations API.
 *
 * Throttled to at most once per 60s per serverless instance.
 */
async function autoSyncRecentTickets(): Promise<{ synced: number; newTickets: number; commentsInserted: number }> {
  const now = Date.now();
  if (now - lastSyncTime < SYNC_INTERVAL_MS) {
    return { synced: 0, newTickets: 0, commentsInserted: 0 };
  }
  lastSyncTime = now;

  const DEADLINE_MS = 15_000; // Stop comment sync after 15s to stay within 30s maxDuration
  const startTime = Date.now();

  try {
    const zendesk = new ZendeskClient();

    // --- Phase 1: Fetch ticket list (1 API call) and bulk-upsert metadata ---
    const { tickets } = await zendesk.fetchTicketsPage(1, 30);

    if (!tickets || tickets.length === 0) {
      return { synced: 0, newTickets: 0, commentsInserted: 0 };
    }

    // Check which tickets already exist in DB
    const ticketIds = tickets.map((t: any) => t.id);
    const { data: existingTickets } = await supabaseAdmin
      .from('zendesk_tickets')
      .select('ticket_id, updated_at_zd')
      .in('ticket_id', ticketIds);

    const existingMap = new Map<number, string>();
    for (const t of existingTickets || []) {
      existingMap.set(t.ticket_id, t.updated_at_zd);
    }

    // Filter to tickets that are new or updated
    const ticketsToSync = tickets.filter((t: any) => {
      const dbUpdated = existingMap.get(t.id);
      if (!dbUpdated) return true; // New ticket
      return new Date(t.updated_at) > new Date(dbUpdated); // Updated
    });

    if (ticketsToSync.length === 0) {
      return { synced: 0, newTickets: 0, commentsInserted: 0 };
    }

    // Bulk fetch user info (1 API call for all users)
    const userIdSet = new Set<number>();
    ticketsToSync.forEach((t: any) => {
      if (t.assignee_id) userIdSet.add(t.assignee_id);
      if (t.requester_id) userIdSet.add(t.requester_id);
    });
    const usersMap = await zendesk.fetchUsers([...userIdSet]);

    let synced = 0;
    let newTicketCount = 0;
    const newTicketIds: number[] = [];

    // Phase 1 upsert: ticket metadata only (no comments fetch)
    for (const ticket of ticketsToSync) {
      try {
        const isNew = !existingMap.has(ticket.id);
        const assignee = ticket.assignee_id ? usersMap.get(ticket.assignee_id) : null;
        const requester = ticket.requester_id ? usersMap.get(ticket.requester_id) : null;

        const upsertData: Record<string, any> = {
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
          synced_at: new Date().toISOString(),
        };

        // For new tickets, set last_message_at from ticket.updated_at as placeholder
        if (isNew) {
          upsertData.last_message_at = ticket.updated_at;
          upsertData.is_read = false;
          newTicketIds.push(ticket.id);
          newTicketCount++;
        }

        await supabaseAdmin.from('zendesk_tickets').upsert(upsertData, { onConflict: 'ticket_id' });
        synced++;
      } catch (err: any) {
        console.error(`[AutoSync] Phase 1 error for ticket #${ticket.id}:`, err.message);
      }
    }

    if (synced > 0) {
      console.log(`[AutoSync] Phase 1: upserted ${synced} tickets (${newTicketCount} new) in ${Date.now() - startTime}ms`);
    }

    // --- Phase 2: Fetch comments for NEW tickets only (parallel, bounded) ---
    let commentsInserted = 0;
    if (newTicketIds.length > 0) {
      const BATCH_SIZE = 5;
      const newTicketsData = ticketsToSync.filter((t: any) => newTicketIds.includes(t.id));

      for (let i = 0; i < newTicketsData.length; i += BATCH_SIZE) {
        // Check deadline
        if (Date.now() - startTime > DEADLINE_MS) {
          console.log(`[AutoSync] Phase 2: deadline reached after ${i} tickets, ${newTicketsData.length - i} remaining`);
          break;
        }

        const batch = newTicketsData.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (ticket: any) => {
            const comments = await zendesk.fetchTicketComments(ticket.id);
            if (!comments || comments.length === 0) return 0;

            // Compute last_customer/agent comment times
            let lastCustomerCommentAt: string | null = null;
            let lastAgentCommentAt: string | null = null;
            let lastMessageAt: string | null = null;

            const sorted = [...comments].sort(
              (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );
            lastMessageAt = sorted[0]?.created_at || null;

            for (const c of sorted) {
              const isCust = ticket.requester_id && c.author_id === ticket.requester_id;
              if (isCust && !lastCustomerCommentAt) lastCustomerCommentAt = c.created_at;
              if (!isCust && !lastAgentCommentAt) lastAgentCommentAt = c.created_at;
              if (lastCustomerCommentAt && lastAgentCommentAt) break;
            }

            // Update ticket with comment metadata + JSONB comments
            await supabaseAdmin.from('zendesk_tickets').update({
              comments,
              last_message_at: lastMessageAt || ticket.updated_at,
              last_customer_comment_at: lastCustomerCommentAt,
              last_agent_comment_at: lastAgentCommentAt,
            }).eq('ticket_id', ticket.id);

            // Insert into zendesk_conversations
            let inserted = 0;
            for (const comment of comments) {
              const isCust = ticket.requester_id && comment.author_id === ticket.requester_id;
              const plainBody = (comment.body || '')
                .replace(/<[^>]*>/g, '')
                .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

              const authorUser = usersMap.get(comment.author_id);
              const { error } = await supabaseAdmin
                .from('zendesk_conversations')
                .insert({
                  ticket_id: ticket.id,
                  comment_id: comment.id,
                  author_zendesk_id: comment.author_id,
                  author_name: authorUser?.name || null,
                  author_email: authorUser?.email || null,
                  author_type: isCust ? 'customer' : 'agent',
                  body: plainBody,
                  body_html: comment.body || null,
                  is_public: comment.public !== false,
                  created_at_zd: comment.created_at,
                });

              if (!error) inserted++;
              else if (error.code !== '23505') {
                console.error(`[AutoSync] Error inserting comment ${comment.id}:`, error);
              }
            }
            return inserted;
          })
        );

        for (const r of results) {
          if (r.status === 'fulfilled') commentsInserted += r.value;
        }
      }

      if (commentsInserted > 0) {
        console.log(`[AutoSync] Phase 2: inserted ${commentsInserted} comments for ${newTicketIds.length} new tickets in ${Date.now() - startTime}ms`);
      }
    }

    return { synced, newTickets: newTicketCount, commentsInserted };
  } catch (err: any) {
    console.error('[AutoSync] Error:', err.message);
    return { synced: 0, newTickets: 0, commentsInserted: 0 };
  }
}

export async function GET(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  try {
    const { searchParams } = new URL(req.url);
    const filter = searchParams.get('filter') || 'all';

    // Auto-sync recent tickets from Zendesk before querying DB
    // This runs inline (not background) so the response includes fresh data
    const syncResult = await autoSyncRecentTickets();
    const hospital = searchParams.get('hospital') || '';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const perPage = Math.min(50, Math.max(1, parseInt(searchParams.get('per_page') || '20', 10)));
    const offset = (page - 1) * perPage;

    if (!['mine', 'all', 'waiting'].includes(filter)) {
      return withCors(NextResponse.json({ error: 'filter must be one of: mine, all, waiting' }, { status: 400 }));
    }

    // Build query for active tickets (non-closed)
    let query = supabaseAdmin
      .from('zendesk_tickets')
      .select('ticket_id, subject, status, priority, tags, requester_name, requester_email, assignee_name, assignee_email, is_read, last_customer_comment_at, last_agent_comment_at, last_message_at, last_webhook_at, created_at_zd, updated_at_zd, assigned_agent_user_id', { count: 'exact' })
      .neq('status', 'closed');

    if (filter === 'mine') {
      // Get agent's zendesk email for matching
      const { data: agentToken } = await supabaseAdmin
        .from('zendesk_agent_tokens')
        .select('zendesk_email')
        .eq('user_id', authUser.userId)
        .eq('is_active', true)
        .single();

      const agentEmail = agentToken?.zendesk_email || authUser.email;

      // Match by assigned_agent_user_id OR assignee_email
      query = query.or(`assigned_agent_user_id.eq.${authUser.userId},assignee_email.eq.${agentEmail}`);
    } else if (filter === 'waiting') {
      // Tickets where customer replied more recently than agent
      // PostgREST doesn't support column-to-column comparison in .or(),
      // so we use raw filter with a computed approach:
      // Fetch all active tickets and filter in JS after query
    }

    // Order and paginate
    query = query
      .order('last_message_at', { ascending: false, nullsFirst: false });

    // For 'waiting' or 'hospital' filter, we need to fetch all and filter in JS
    // because PostgREST doesn't support column-to-column comparison or tag prefix matching
    const needsJsFilter = filter === 'waiting' || !!hospital;
    if (!needsJsFilter) {
      query = query.range(offset, offset + perPage - 1);
    }

    const { data: tickets, error, count } = await query;

    if (error) {
      console.error('[TicketsLive] Error querying tickets:', error);
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }

    // Apply JS filters (waiting: column-to-column comparison, hospital: tag prefix matching)
    let filteredTickets = tickets || [];
    if (filter === 'waiting') {
      filteredTickets = filteredTickets.filter(t => {
        if (!t.last_customer_comment_at) return false;
        if (!t.last_agent_comment_at) return true; // agent never replied
        return new Date(t.last_customer_comment_at) > new Date(t.last_agent_comment_at);
      });
    }

    // Hospital filter: keep tickets where any tag starts with the hospital prefix
    if (hospital) {
      filteredTickets = filteredTickets.filter(t => {
        const tags: string[] = t.tags || [];
        return tags.some(tag => tag.startsWith(hospital));
      });
    }

    const totalFiltered = needsJsFilter ? filteredTickets.length : (count || 0);

    // Paginate JS-filtered results
    if (needsJsFilter) {
      filteredTickets = filteredTickets.slice(offset, offset + perPage);
    }

    // Get latest customer message preview for each ticket
    const ticketIds = filteredTickets.map(t => t.ticket_id);
    let previewMap = new Map<number, string>();

    if (ticketIds.length > 0) {
      const { data: latestComments } = await supabaseAdmin
        .from('zendesk_conversations')
        .select('ticket_id, body, created_at_zd')
        .in('ticket_id', ticketIds)
        .eq('author_type', 'customer')
        .order('created_at_zd', { ascending: false });

      if (latestComments) {
        for (const comment of latestComments) {
          if (!previewMap.has(comment.ticket_id)) {
            const preview = (comment.body || '').substring(0, 100);
            previewMap.set(comment.ticket_id, preview);
          }
        }
      }
    }

    // Enrich tickets with preview
    const enrichedTickets = filteredTickets.map(t => ({
      ...t,
      latest_customer_preview: previewMap.get(t.ticket_id) || null,
    }));

    console.log(`[TicketsLive] Returned ${enrichedTickets.length} tickets (filter: ${filter}, hospital: ${hospital || 'all'}, page: ${page}, synced: ${syncResult.synced})`);

    return withCors(NextResponse.json({
      tickets: enrichedTickets,
      total: totalFiltered,
      page,
      _sync: syncResult.synced > 0 ? syncResult : undefined,
    }));
  } catch (err: any) {
    console.error('[TicketsLive] Error:', err);
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}
