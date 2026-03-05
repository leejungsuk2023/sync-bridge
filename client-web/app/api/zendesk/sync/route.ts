import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ZendeskClient } from '@/lib/zendesk';

// CORS: Desktop App (Electron) and Extension cross-origin requests
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

async function verifyAdmin(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return false;
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  return profile?.role === 'bbg_admin';
}

export async function POST(req: NextRequest) {
  if (!await verifyAdmin(req)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  const body = await req.json().catch(() => ({}));
  const since = body.since as string | undefined;

  const zendesk = new ZendeskClient();
  const errors: string[] = [];
  let synced = 0;

  try {
    // 1. Fetch tickets from Zendesk
    const tickets = await zendesk.fetchTickets(since);

    // 2. Collect all unique user IDs for bulk lookup
    const userIds = new Set<number>();
    tickets.forEach(t => {
      if (t.assignee_id) userIds.add(t.assignee_id);
      if (t.requester_id) userIds.add(t.requester_id);
    });
    const usersMap = await zendesk.fetchUsers([...userIds]);

    // 3. For each ticket, fetch comments and upsert
    for (const ticket of tickets) {
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
          comments: comments, // stored as JSONB
          synced_at: new Date().toISOString(),
        }, { onConflict: 'ticket_id' });

        synced++;
      } catch (err: any) {
        errors.push(`Ticket ${ticket.id}: ${err.message}`);
      }
    }
  } catch (err: any) {
    return withCors(NextResponse.json({ error: err.message, synced, errors }, { status: 500 }));
  }

  return withCors(NextResponse.json({ synced, errors }));
}
