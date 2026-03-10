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
  if (!profile || !['bbg_admin', 'worker', 'client'].includes(profile.role)) return null;
  return { role: profile.role, userId: user.id };
}

export async function GET(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  try {
    const { searchParams } = new URL(req.url);
    const filter = searchParams.get('filter') || 'all';
    const hospital = searchParams.get('hospital') || '';
    const channel = searchParams.get('channel') || 'all';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const perPage = Math.min(50, Math.max(1, parseInt(searchParams.get('per_page') || '20', 10)));
    const offset = (page - 1) * perPage;

    if (!['mine', 'all', 'waiting'].includes(filter)) {
      return withCors(NextResponse.json({ error: 'filter must be one of: mine, all, waiting' }, { status: 400 }));
    }

    // Build query joining conversations with customers and messaging_channels
    let query = supabaseAdmin
      .from('conversations')
      .select(
        `id, channel_type, channel_id, customer_id, status, is_read,
         last_message_at, last_customer_message_at, last_agent_message_at,
         assigned_agent_id, hospital_prefix, created_at,
         customers!inner(display_name, avatar_url, line_user_id, facebook_user_id),
         messaging_channels(channel_name)`,
        { count: 'exact' }
      )
      .neq('status', 'closed');

    // Filter: mine — assigned to current user
    if (filter === 'mine') {
      query = query.eq('assigned_agent_id', authUser.userId);
    }

    // Filter: channel type
    if (channel && channel !== 'all') {
      query = query.eq('channel_type', channel);
    }

    // Filter: hospital prefix
    if (hospital) {
      query = query.eq('hospital_prefix', hospital);
    }

    // Order by most recent message
    query = query.order('last_message_at', { ascending: false, nullsFirst: false });

    // For 'waiting' filter, column-to-column comparison requires JS filtering
    const needsJsFilter = filter === 'waiting';
    if (!needsJsFilter) {
      query = query.range(offset, offset + perPage - 1);
    }

    const { data: conversations, error, count } = await query;

    if (error) {
      console.error('[Messaging] Error querying conversations:', error);
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }

    // Apply waiting filter in JS (needs column-to-column comparison)
    let filtered = conversations || [];
    if (filter === 'waiting') {
      filtered = filtered.filter(c => {
        if (!c.last_customer_message_at) return false;
        if (!c.last_agent_message_at) return true; // agent never replied
        return new Date(c.last_customer_message_at) > new Date(c.last_agent_message_at);
      });
    }

    const total = needsJsFilter ? filtered.length : (count || 0);

    // Paginate JS-filtered results
    if (needsJsFilter) {
      filtered = filtered.slice(offset, offset + perPage);
    }

    console.log(`[Messaging] Returned ${filtered.length} conversations (filter: ${filter}, channel: ${channel}, hospital: ${hospital || 'all'}, page: ${page})`);

    return withCors(NextResponse.json({
      conversations: filtered,
      total,
      page,
    }));
  } catch (err: any) {
    console.error('[Messaging] Conversations error:', err);
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}
