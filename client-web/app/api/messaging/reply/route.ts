import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getChannelAdapter } from '@/lib/channels/registry';

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
  if (!profile || !['bbg_admin', 'worker', 'client'].includes(profile.role)) return null;
  return { role: profile.role, userId: user.id };
}

export async function POST(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  try {
    const body = await req.json();
    const { conversation_id, body: replyBody, is_public, status, suggestion_id, suggestion_index, was_edited } = body;

    if (!conversation_id) {
      return withCors(NextResponse.json({ error: 'conversation_id is required' }, { status: 400 }));
    }

    // Status-only update: no message sent, just update conversation status
    const isStatusOnly = status && !replyBody;
    if (!isStatusOnly) {
      if (!replyBody || typeof replyBody !== 'string' || replyBody.trim().length === 0) {
        return withCors(NextResponse.json({ error: 'body is required and must be non-empty' }, { status: 400 }));
      }
    }

    // Look up conversation (channel_type, channel_id, customer_id)
    const { data: conversation, error: convError } = await supabaseAdmin
      .from('channel_conversations')
      .select('id, channel_type, channel_id, customer_id, status')
      .eq('id', conversation_id)
      .single();

    if (convError || !conversation) {
      console.error('[Messaging] Conversation not found:', conversation_id, convError);
      return withCors(NextResponse.json({ error: 'Conversation not found' }, { status: 404 }));
    }

    if (isStatusOnly) {
      // Status-only: update conversation status and return
      console.log(`[Messaging] Status-only update for conversation ${conversation_id} to "${status}" (user: ${authUser.userId})`);

      const { error: updateError } = await supabaseAdmin
        .from('channel_conversations')
        .update({ status })
        .eq('id', conversation_id);

      if (updateError) {
        console.error('[Messaging] Error updating conversation status:', updateError);
        return withCors(NextResponse.json({ error: updateError.message }, { status: 500 }));
      }

      console.log(`[Messaging] Status updated successfully for conversation ${conversation_id}`);
      return withCors(NextResponse.json({ ok: true }));
    }

    // Look up customer to get channel-specific recipient ID
    const { data: customer, error: customerError } = await supabaseAdmin
      .from('customers')
      .select('id, line_user_id, facebook_user_id')
      .eq('id', conversation.customer_id)
      .single();

    if (customerError || !customer) {
      console.error('[Messaging] Customer not found:', conversation.customer_id, customerError);
      return withCors(NextResponse.json({ error: 'Customer not found' }, { status: 404 }));
    }

    // Determine recipient ID based on channel type
    const recipientId =
      conversation.channel_type === 'line'
        ? customer.line_user_id
        : conversation.channel_type === 'facebook'
        ? customer.facebook_user_id
        : null;

    if (!recipientId) {
      console.error(`[Messaging] No recipient ID for channel ${conversation.channel_type} on customer ${customer.id}`);
      return withCors(NextResponse.json({ error: `No recipient ID for channel type: ${conversation.channel_type}` }, { status: 400 }));
    }

    // Get channel adapter and send message
    console.log(`[Messaging] Sending reply via ${conversation.channel_type} to ${recipientId} (user: ${authUser.userId})`);
    const adapter = await getChannelAdapter(conversation.channel_type, conversation.channel_id);
    const sendResult = await adapter.sendTextMessage(recipientId, replyBody.trim());

    const now = new Date().toISOString();

    // INSERT into messages table
    const { data: insertedMsg, error: msgInsertError } = await supabaseAdmin
      .from('channel_messages')
      .insert({
        conversation_id,
        sender_type: 'agent',
        sender_agent_id: authUser.userId,
        sender_name: null, // resolved from profile on read if needed
        message_type: 'text',
        body: replyBody.trim(),
        is_public: is_public ?? true,
        external_message_id: sendResult.messageId || null,
        created_at: now,
      })
      .select('id')
      .single();

    if (msgInsertError) {
      console.error('[Messaging] Error inserting message:', msgInsertError);
      // Don't fail — message was already sent to the channel
    }

    // UPDATE conversation timestamps and optional status
    const conversationUpdate: Record<string, any> = {
      last_message_at: now,
      last_agent_message_at: now,
    };
    if (status) {
      conversationUpdate.status = status;
    }

    const { error: convUpdateError } = await supabaseAdmin
      .from('channel_conversations')
      .update(conversationUpdate)
      .eq('id', conversation_id);

    if (convUpdateError) {
      console.error('[Messaging] Error updating conversation timestamps:', convUpdateError);
    }

    // If suggestion was used, update ai_suggestions table
    if (suggestion_id) {
      const suggestionUpdate: Record<string, any> = {
        selected_index: suggestion_index ?? null,
        was_edited: was_edited ?? false,
        final_text: replyBody.trim(),
        used_at: now,
      };

      const { error: sugError } = await supabaseAdmin
        .from('ai_suggestions')
        .update(suggestionUpdate)
        .eq('id', suggestion_id);

      if (sugError) {
        console.error('[Messaging] Error updating suggestion:', sugError);
      }
    }

    console.log(`[Messaging] Reply sent for conversation ${conversation_id}, external_message_id: ${sendResult.messageId}`);

    return withCors(NextResponse.json({
      ok: true,
      message_id: insertedMsg?.id || null,
      conversation_id,
    }));
  } catch (err: any) {
    console.error('[Messaging] Reply error:', err);
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}
