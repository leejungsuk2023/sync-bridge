import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// CORS: Desktop App (Electron) and Extension cross-origin requests
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
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
    const statusFilter = searchParams.get('status');

    let query = supabaseAdmin
      .from('zendesk_analyses')
      .select('ticket_id, customer_name, customer_phone, interested_procedure, customer_age, hospital_name, followup_reason, needs_followup, followup_status, followup_note, followup_updated_by, followup_updated_at')
      .eq('needs_followup', true)
      .order('analyzed_at', { ascending: false });

    if (statusFilter) {
      query = query.eq('followup_status', statusFilter);
    }

    const { data: analyses, error } = await query;

    if (error) {
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }

    // Enrich with ticket subject
    const ticketIds = (analyses || []).map(a => a.ticket_id);
    const { data: tickets } = ticketIds.length > 0
      ? await supabaseAdmin
          .from('zendesk_tickets')
          .select('ticket_id, subject')
          .in('ticket_id', ticketIds)
      : { data: [] };

    const ticketMap = new Map((tickets || []).map(t => [t.ticket_id, t.subject]));

    const customers = (analyses || []).map(a => ({
      ...a,
      subject: ticketMap.get(a.ticket_id) || null,
    }));

    return withCors(NextResponse.json({ customers }));
  } catch (err: any) {
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}

const VALID_STATUSES = ['pending', 'contacted', 'scheduled', 'converted', 'lost'];

export async function PATCH(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  try {
    const body = await req.json();
    const { ticket_id, status, note } = body;

    if (!ticket_id || !status) {
      return withCors(NextResponse.json({ error: 'ticket_id and status are required' }, { status: 400 }));
    }

    if (!VALID_STATUSES.includes(status)) {
      return withCors(NextResponse.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 }));
    }

    const updateData: Record<string, any> = {
      followup_status: status,
      followup_updated_by: authUser.userId,
      followup_updated_at: new Date().toISOString(),
    };

    if (note !== undefined) {
      updateData.followup_note = note;
    }

    const { data, error } = await supabaseAdmin
      .from('zendesk_analyses')
      .update(updateData)
      .eq('ticket_id', ticket_id)
      .select()
      .single();

    if (error) {
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }

    return withCors(NextResponse.json({ updated: data }));
  } catch (err: any) {
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}
