import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;

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

export async function GET(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  try {
    const { searchParams } = new URL(req.url);
    const filter = searchParams.get('filter') || 'all';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const perPage = Math.min(50, Math.max(1, parseInt(searchParams.get('per_page') || '20', 10)));
    const offset = (page - 1) * perPage;

    if (!['mine', 'all', 'waiting'].includes(filter)) {
      return withCors(NextResponse.json({ error: 'filter must be one of: mine, all, waiting' }, { status: 400 }));
    }

    // Build query for active tickets (non-closed)
    let query = supabaseAdmin
      .from('zendesk_tickets')
      .select('ticket_id, subject, status, priority, tags, requester_name, requester_email, assignee_name, assignee_email, is_read, last_customer_comment_at, last_agent_comment_at, last_webhook_at, created_at_zd, updated_at_zd, assigned_agent_user_id', { count: 'exact' })
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

    // For 'waiting' filter, we need to fetch all and filter in JS
    // because PostgREST doesn't support column-to-column comparison
    if (filter !== 'waiting') {
      query = query.range(offset, offset + perPage - 1);
    }

    const { data: tickets, error, count } = await query;

    if (error) {
      console.error('[TicketsLive] Error querying tickets:', error);
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }

    // Apply waiting filter in JS (column-to-column comparison)
    let filteredTickets = tickets || [];
    if (filter === 'waiting') {
      filteredTickets = filteredTickets.filter(t => {
        if (!t.last_customer_comment_at) return false;
        if (!t.last_agent_comment_at) return true; // agent never replied
        return new Date(t.last_customer_comment_at) > new Date(t.last_agent_comment_at);
      });
    }

    const totalFiltered = filter === 'waiting' ? filteredTickets.length : (count || 0);

    // Paginate waiting results in JS
    if (filter === 'waiting') {
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

    console.log(`[TicketsLive] Returned ${enrichedTickets.length} tickets (filter: ${filter}, page: ${page})`);

    return withCors(NextResponse.json({
      tickets: enrichedTickets,
      total: totalFiltered,
      page,
    }));
  } catch (err: any) {
    console.error('[TicketsLive] Error:', err);
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}
