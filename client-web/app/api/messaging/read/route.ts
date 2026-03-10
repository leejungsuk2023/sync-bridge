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

export async function PATCH(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  try {
    const body = await req.json();
    const { conversation_id } = body;

    if (!conversation_id) {
      return withCors(NextResponse.json({ error: 'conversation_id is required' }, { status: 400 }));
    }

    const { error } = await supabaseAdmin
      .from('conversations')
      .update({ is_read: true })
      .eq('id', conversation_id);

    if (error) {
      console.error('[Messaging] Error marking conversation as read:', error);
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }

    console.log(`[Messaging] Conversation ${conversation_id} marked as read (user: ${authUser.userId})`);

    return withCors(NextResponse.json({ ok: true }));
  } catch (err: any) {
    console.error('[Messaging] Read update error:', err);
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}
