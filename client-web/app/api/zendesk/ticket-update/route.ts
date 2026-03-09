import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAgentClient } from '@/lib/zendesk-agent';

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

export async function PATCH(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  try {
    const body = await req.json();
    const { ticket_id, status, tags, is_read } = body;

    if (!ticket_id) {
      return withCors(NextResponse.json({ error: 'ticket_id is required' }, { status: 400 }));
    }

    const ticketIdNum = parseInt(ticket_id, 10);
    if (isNaN(ticketIdNum)) {
      return withCors(NextResponse.json({ error: 'ticket_id must be a number' }, { status: 400 }));
    }

    // If status or tags changed, update on Zendesk side too
    if (status || tags) {
      const agentClient = await getAgentClient(authUser.userId);
      const zendeskUpdate: Record<string, any> = {};
      if (status) zendeskUpdate.status = status;
      if (tags) zendeskUpdate.tags = tags;

      console.log(`[TicketUpdate] Updating ticket #${ticketIdNum} on Zendesk:`, zendeskUpdate);
      await agentClient.updateTicket(ticketIdNum, zendeskUpdate);
    }

    // Update in Supabase
    const supabaseUpdate: Record<string, any> = {};
    if (status) supabaseUpdate.status = status;
    if (tags) supabaseUpdate.tags = tags;
    if (typeof is_read === 'boolean') supabaseUpdate.is_read = is_read;

    if (Object.keys(supabaseUpdate).length === 0) {
      return withCors(NextResponse.json({ error: 'No fields to update. Provide status, tags, or is_read.' }, { status: 400 }));
    }

    const { error: updateError } = await supabaseAdmin
      .from('zendesk_tickets')
      .update(supabaseUpdate)
      .eq('ticket_id', ticketIdNum);

    if (updateError) {
      console.error('[TicketUpdate] Error updating Supabase:', updateError);
      return withCors(NextResponse.json({ error: updateError.message }, { status: 500 }));
    }

    console.log(`[TicketUpdate] Ticket #${ticketIdNum} updated successfully:`, supabaseUpdate);

    return withCors(NextResponse.json({ ok: true }));
  } catch (err: any) {
    console.error('[TicketUpdate] Error:', err);
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}
