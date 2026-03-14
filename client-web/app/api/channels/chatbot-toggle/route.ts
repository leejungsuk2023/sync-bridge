import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
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

// Auth helper
async function verifyUser(req: NextRequest) {
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
  if (!profile || !['bbg_admin', 'staff'].includes(profile.role)) return null;
  return { role: profile.role, userId: user.id };
}

// GET: List channels with chatbot status
export async function GET(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));

  const { data: channels } = await supabaseAdmin
    .from('messaging_channels')
    .select('id, channel_name, channel_type, hospital_prefix, chatbot_enabled, is_active')
    .eq('is_active', true)
    .order('hospital_prefix');

  return withCors(NextResponse.json({ channels: channels || [] }));
}

// PUT: Toggle chatbot for a channel
export async function PUT(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));

  const body = await req.json().catch(() => ({}));
  const { channel_id, chatbot_enabled } = body;

  if (!channel_id || typeof chatbot_enabled !== 'boolean') {
    return withCors(NextResponse.json({ error: 'channel_id and chatbot_enabled required' }, { status: 400 }));
  }

  const { error } = await supabaseAdmin
    .from('messaging_channels')
    .update({ chatbot_enabled })
    .eq('id', channel_id);

  if (error) {
    return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
  }

  return withCors(NextResponse.json({ success: true, channel_id, chatbot_enabled }));
}
