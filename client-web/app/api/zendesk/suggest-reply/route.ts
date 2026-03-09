import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateSuggestions } from '@/lib/ai-suggest';

export const maxDuration = 60;

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
  // Auth: Bearer token (worker/bbg_admin) OR internal secret (from webhook/cron)
  const internalSecret = req.headers.get('x-internal-secret');
  const isInternal = internalSecret === process.env.CRON_SECRET;

  let agentUserId: string | undefined;
  if (!isInternal) {
    const authUser = await verifyUser(req);
    if (!authUser) {
      return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
    }
    agentUserId = authUser.userId;
  }

  const body = await req.json().catch(() => ({}));
  const { ticket_id, trigger_comment_id } = body;

  if (!ticket_id) {
    return withCors(NextResponse.json({ error: 'ticket_id required' }, { status: 400 }));
  }

  try {
    console.log(`[SuggestReply] Generating suggestions for ticket ${ticket_id}${trigger_comment_id ? `, trigger comment ${trigger_comment_id}` : ''}`);
    const result = await generateSuggestions(ticket_id, trigger_comment_id, agentUserId);
    console.log(`[SuggestReply] Generated ${result.suggestions?.length || 0} suggestions for ticket ${ticket_id}`);
    return withCors(NextResponse.json(result));
  } catch (error: any) {
    console.error('[SuggestReply] Error:', error?.message || error);
    return withCors(NextResponse.json({ error: 'Failed to generate suggestions' }, { status: 500 }));
  }
}
