import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// CORS: Desktop App (Electron) and Extension cross-origin requests
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
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
    const unreadCount = searchParams.get('unread_count');

    // Return unread action count for badge
    if (unreadCount === 'true') {
      const { count, error } = await supabaseAdmin
        .from('followup_actions')
        .select('*', { count: 'exact', head: true })
        .is('read_at', null)
        .in('action_type', ['worker_action', 'ai_instruction']);

      if (error) {
        return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
      }
      return withCors(NextResponse.json({ unread_count: count || 0 }));
    }

    if (!ticketId) {
      return withCors(NextResponse.json({ error: 'ticket_id is required' }, { status: 400 }));
    }

    const { data: actions, error } = await supabaseAdmin
      .from('followup_actions')
      .select('*')
      .eq('ticket_id', Number(ticketId))
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }

    // Mark these actions as read for admin
    if (authUser.role === 'bbg_admin' && actions && actions.length > 0) {
      const unreadIds = actions.filter((a: any) => !a.read_at).map((a: any) => a.id);
      if (unreadIds.length > 0) {
        await supabaseAdmin
          .from('followup_actions')
          .update({ read_at: new Date().toISOString() })
          .in('id', unreadIds);
      }
    }

    return withCors(NextResponse.json({ actions: actions || [] }));
  } catch (err: any) {
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}

export async function POST(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser || authUser.role !== 'bbg_admin') {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  try {
    const { ticket_id, content } = await req.json();
    if (!ticket_id || !content) {
      return withCors(NextResponse.json({ error: 'ticket_id and content are required' }, { status: 400 }));
    }

    // Insert followup_action as system_note (admin push instruction)
    const { data: action, error } = await supabaseAdmin
      .from('followup_actions')
      .insert({
        ticket_id,
        action_type: 'ai_instruction',
        content,
        content_th: content, // Admin writes in the target language or we keep as-is
        created_by: authUser.userId,
      })
      .select()
      .single();

    if (error) {
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }

    // Create notification for workers
    const { data: workers } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('role', 'worker');

    if (workers && workers.length > 0) {
      const notifications = workers.map((w: any) => ({
        action_id: action.id,
        ticket_id,
        worker_id: w.id,
        title: `Push: Ticket #${ticket_id}`,
        body: content,
      }));

      await supabaseAdmin.from('followup_notifications').insert(notifications);
    }

    // Update the ticket's next_check_at to refresh the followup loop
    await supabaseAdmin
      .from('zendesk_analyses')
      .update({
        next_check_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        followup_updated_at: new Date().toISOString(),
      })
      .eq('ticket_id', ticket_id);

    return withCors(NextResponse.json({ action }));
  } catch (err: any) {
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}

export async function PATCH(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  try {
    const { action_id } = await req.json();
    if (!action_id) {
      return withCors(NextResponse.json({ error: 'action_id is required' }, { status: 400 }));
    }

    const { error } = await supabaseAdmin
      .from('followup_actions')
      .update({ read_at: new Date().toISOString() })
      .eq('id', action_id);

    if (error) {
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }

    return withCors(NextResponse.json({ success: true }));
  } catch (err: any) {
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}
