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

async function verifyUser(req: NextRequest): Promise<{ role: string; userId: string } | null> {
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
  if (!profile || (profile.role !== 'bbg_admin' && profile.role !== 'worker')) return null;
  return { role: profile.role, userId: user.id };
}

export async function GET(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  try {
    const { searchParams } = new URL(req.url);
    const ticketId = searchParams.get('ticket_id');

    if (!ticketId) {
      return withCors(NextResponse.json({ error: 'ticket_id is required' }, { status: 400 }));
    }

    const ticketIdNum = parseInt(ticketId, 10);
    if (isNaN(ticketIdNum)) {
      return withCors(NextResponse.json({ error: 'ticket_id must be a number' }, { status: 400 }));
    }

    // Fetch conversations ordered by creation time
    const { data: conversations, error: convError } = await supabaseAdmin
      .from('zendesk_conversations')
      .select('*')
      .eq('ticket_id', ticketIdNum)
      .order('created_at_zd', { ascending: true });

    if (convError) {
      console.error('[Conversations] Error fetching conversations:', convError);
      return withCors(NextResponse.json({ error: convError.message }, { status: 500 }));
    }

    // Fetch ticket metadata
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from('zendesk_tickets')
      .select('ticket_id, subject, status, tags, requester_name, requester_email, assignee_name, assignee_email, priority, created_at_zd, updated_at_zd')
      .eq('ticket_id', ticketIdNum)
      .single();

    if (ticketError && ticketError.code !== 'PGRST116') {
      console.error('[Conversations] Error fetching ticket:', ticketError);
    }

    console.log(`[Conversations] Returned ${(conversations || []).length} messages for ticket #${ticketIdNum}`);

    return withCors(NextResponse.json({
      conversations: conversations || [],
      ticket: ticket || null,
    }));
  } catch (err: any) {
    console.error('[Conversations] Error:', err);
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}
