import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

export async function POST(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  const body = await req.json().catch(() => ({}));
  const { suggestion_id, selected_index, was_edited, final_text } = body;

  if (!suggestion_id) {
    return withCors(NextResponse.json({ error: 'suggestion_id required' }, { status: 400 }));
  }

  if (selected_index === undefined || selected_index === null) {
    return withCors(NextResponse.json({ error: 'selected_index required' }, { status: 400 }));
  }

  if (was_edited === undefined || was_edited === null) {
    return withCors(NextResponse.json({ error: 'was_edited required' }, { status: 400 }));
  }

  if (!final_text) {
    return withCors(NextResponse.json({ error: 'final_text required' }, { status: 400 }));
  }

  try {
    console.log(`[MessagingSuggestFeedback] Recording feedback for suggestion ${suggestion_id}, selected_index=${selected_index}, was_edited=${was_edited}`);

    const { error } = await supabaseAdmin
      .from('ai_suggestions')
      .update({
        selected_index,
        was_edited,
        final_text,
        feedback_by: authUser.userId,
        feedback_at: new Date().toISOString(),
      })
      .eq('id', suggestion_id);

    if (error) {
      console.error('[MessagingSuggestFeedback] DB error:', error.message);
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }

    console.log(`[MessagingSuggestFeedback] Feedback recorded for suggestion ${suggestion_id}`);
    return withCors(NextResponse.json({ ok: true }));
  } catch (err: any) {
    console.error('[MessagingSuggestFeedback] Error:', err?.message || err);
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}
