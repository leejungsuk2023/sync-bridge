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
    // Fetch unread notifications for current user, joined with action details
    const { data: notifications, error } = await supabaseAdmin
      .from('followup_notifications')
      .select('*, followup_actions(*)')
      .eq('user_id', authUser.userId)
      .is('read_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }

    return withCors(NextResponse.json({ notifications: notifications || [] }));
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
    const body = await req.json();
    const { notification_ids, mark_all_read } = body;

    if (!notification_ids && !mark_all_read) {
      return withCors(NextResponse.json(
        { error: 'notification_ids or mark_all_read is required' },
        { status: 400 }
      ));
    }

    const now = new Date().toISOString();

    if (mark_all_read) {
      // Mark all unread notifications as read for current user
      const { error } = await supabaseAdmin
        .from('followup_notifications')
        .update({ read_at: now })
        .eq('user_id', authUser.userId)
        .is('read_at', null);

      if (error) {
        return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
      }

      return withCors(NextResponse.json({ updated: true }));
    }

    // Mark specific notifications as read
    if (!Array.isArray(notification_ids) || notification_ids.length === 0) {
      return withCors(NextResponse.json(
        { error: 'notification_ids must be a non-empty array' },
        { status: 400 }
      ));
    }

    const { error } = await supabaseAdmin
      .from('followup_notifications')
      .update({ read_at: now })
      .eq('user_id', authUser.userId)
      .in('id', notification_ids);

    if (error) {
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }

    return withCors(NextResponse.json({ updated: true }));
  } catch (err: any) {
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}
