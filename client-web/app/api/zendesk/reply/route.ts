import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAgentClient } from '@/lib/zendesk-agent';

export const maxDuration = 60;

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

export async function POST(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  try {
    const body = await req.json();
    const { ticket_id, body: replyBody, is_public, status, suggestion_id, suggestion_index, was_edited } = body;

    if (!ticket_id) {
      return withCors(NextResponse.json({ error: 'ticket_id is required' }, { status: 400 }));
    }
    if (!replyBody || typeof replyBody !== 'string' || replyBody.trim().length === 0) {
      return withCors(NextResponse.json({ error: 'body is required and must be non-empty' }, { status: 400 }));
    }
    if (typeof is_public !== 'boolean') {
      return withCors(NextResponse.json({ error: 'is_public must be a boolean' }, { status: 400 }));
    }

    const ticketIdNum = parseInt(ticket_id, 10);
    if (isNaN(ticketIdNum)) {
      return withCors(NextResponse.json({ error: 'ticket_id must be a number' }, { status: 400 }));
    }

    // Get agent client (personal token or fallback to admin)
    const agentClient = await getAgentClient(authUser.userId);

    // Send reply to Zendesk
    console.log(`[Reply] Sending reply to ticket #${ticketIdNum} (public: ${is_public}, user: ${authUser.userId})`);
    const { comment_id } = await agentClient.addComment(ticketIdNum, replyBody.trim(), is_public, status);

    // INSERT into zendesk_conversations
    const { data: conversation, error: insertError } = await supabaseAdmin
      .from('zendesk_conversations')
      .insert({
        ticket_id: ticketIdNum,
        comment_id: comment_id || null,
        author_id: agentClient.getZendeskUserId() || null,
        author_type: 'agent',
        body: replyBody.trim(),
        is_public,
        created_at_zd: new Date().toISOString(),
        sent_by_user_id: authUser.userId,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[Reply] Error inserting conversation:', insertError);
      // Don't fail the request - the Zendesk reply was already sent
    }

    // UPDATE zendesk_tickets
    const ticketUpdate: Record<string, any> = {
      last_agent_comment_at: new Date().toISOString(),
    };
    if (status) {
      ticketUpdate.status = status;
    }

    await supabaseAdmin
      .from('zendesk_tickets')
      .update(ticketUpdate)
      .eq('ticket_id', ticketIdNum);

    // If suggestion was used, update ai_reply_suggestions
    if (suggestion_id) {
      const suggestionUpdate: Record<string, any> = {
        selected_index: suggestion_index ?? null,
        was_edited: was_edited ?? false,
        final_text: replyBody.trim(),
        used_at: new Date().toISOString(),
      };

      const { error: sugError } = await supabaseAdmin
        .from('ai_reply_suggestions')
        .update(suggestionUpdate)
        .eq('id', suggestion_id);

      if (sugError) {
        console.error('[Reply] Error updating suggestion:', sugError);
      }
    }

    console.log(`[Reply] Reply sent successfully to ticket #${ticketIdNum}, comment_id: ${comment_id}`);

    return withCors(NextResponse.json({
      ok: true,
      comment_id,
      conversation_id: conversation?.id || null,
    }));
  } catch (err: any) {
    console.error('[Reply] Error:', err);
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}
