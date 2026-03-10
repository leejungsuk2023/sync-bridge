import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { LineAdapter } from '@/lib/channels/line';

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

export async function POST(req: NextRequest) {
  // Read raw body FIRST — required for HMAC signature verification
  const rawBody = await req.text();

  const signature = req.headers.get('x-line-signature') ?? '';

  // Verify LINE webhook signature
  let adapter: LineAdapter;
  try {
    adapter = new LineAdapter();
  } catch (err) {
    console.error('[LINE Webhook] Failed to initialize LineAdapter:', err);
    // Return 200 to prevent LINE from retrying with a misconfigured secret
    return withCors(NextResponse.json({ ok: false, error: 'Adapter init failed' }, { status: 200 }));
  }

  if (!signature) {
    console.warn('[LINE Webhook] Missing x-line-signature header — rejecting request');
    return withCors(NextResponse.json({ error: 'Missing signature' }, { status: 401 }));
  }

  const isValid = adapter.verifyWebhookSignature(rawBody, signature);
  if (!isValid) {
    console.warn('[LINE Webhook] Signature verification failed — rejecting request');
    return withCors(NextResponse.json({ error: 'Invalid signature' }, { status: 401 }));
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch (err) {
    console.error('[LINE Webhook] Invalid JSON body');
    // Return 200 so LINE does not retry malformed payloads
    return withCors(NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 200 }));
  }

  // Convert request headers to plain object for parseWebhookEvents
  const headersRecord: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headersRecord[key] = value;
  });

  let events;
  try {
    events = await adapter.parseWebhookEvents(body, headersRecord);
  } catch (err) {
    console.error('[LINE Webhook] Failed to parse webhook events:', err);
    return withCors(NextResponse.json({ ok: false, error: 'Parse failed' }, { status: 200 }));
  }

  // Fetch the LINE channel_id once for use across all events
  let lineChannelId: string | null = null;
  try {
    const { data: channelRow } = await supabaseAdmin
      .from('messaging_channels')
      .select('id')
      .eq('channel_type', 'line')
      .eq('is_active', true)
      .limit(1)
      .single();
    lineChannelId = channelRow?.id ?? null;
  } catch (err) {
    console.error('[LINE Webhook] Failed to fetch LINE messaging_channel:', err);
  }

  for (const event of events) {
    try {
      const channelUserId = event.channelUserId;

      if (event.type === 'message') {
        // ── Find or create customer ────────────────────────────────────────
        let customerId: string;
        let senderName: string = channelUserId;

        const { data: existingCustomer } = await supabaseAdmin
          .from('customers')
          .select('id, display_name')
          .eq('line_user_id', channelUserId)
          .single();

        if (existingCustomer) {
          customerId = existingCustomer.id;
          senderName = existingCustomer.display_name ?? channelUserId;

          // Update last_contact_at
          await supabaseAdmin
            .from('customers')
            .update({ last_contact_at: new Date().toISOString() })
            .eq('id', customerId);
        } else {
          // New customer — fetch LINE profile for display name and avatar
          let displayName = channelUserId;
          let avatarUrl: string | undefined;

          try {
            const profile = await adapter.getUserProfile(channelUserId);
            displayName = profile.displayName;
            avatarUrl = profile.avatarUrl;
          } catch (err) {
            console.warn(`[LINE Webhook] Could not fetch profile for ${channelUserId}:`, err);
          }

          senderName = displayName;
          const now = new Date().toISOString();

          const { data: newCustomer, error: insertCustomerError } = await supabaseAdmin
            .from('customers')
            .insert({
              line_user_id: channelUserId,
              display_name: displayName,
              avatar_url: avatarUrl ?? null,
              first_contact_at: now,
              last_contact_at: now,
            })
            .select('id')
            .single();

          if (insertCustomerError || !newCustomer) {
            console.error('[LINE Webhook] Failed to create customer:', insertCustomerError);
            continue;
          }
          customerId = newCustomer.id;
        }

        // ── Find or create open conversation ──────────────────────────────
        let conversationId: string;

        const { data: existingConv } = await supabaseAdmin
          .from('channel_conversations')
          .select('id')
          .eq('customer_id', customerId)
          .eq('channel_type', 'line')
          .in('status', ['new', 'open', 'pending'])
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (existingConv) {
          conversationId = existingConv.id;
        } else {
          if (!lineChannelId) {
            console.error('[LINE Webhook] No active LINE messaging_channel found — cannot create conversation');
            continue;
          }

          const { data: newConv, error: insertConvError } = await supabaseAdmin
            .from('channel_conversations')
            .insert({
              customer_id: customerId,
              channel_id: lineChannelId,
              channel_type: 'line',
              status: 'new',
            })
            .select('id')
            .single();

          if (insertConvError || !newConv) {
            console.error('[LINE Webhook] Failed to create conversation:', insertConvError);
            continue;
          }
          conversationId = newConv.id;
        }

        // ── Idempotency: skip duplicate external_message_id ───────────────
        const externalMsgId = event.message?.id ?? null;
        if (externalMsgId) {
          const { data: dupMsg } = await supabaseAdmin
            .from('channel_messages')
            .select('id')
            .eq('external_message_id', externalMsgId)
            .single();

          if (dupMsg) {
            console.log(`[LINE Webhook] Duplicate message ${externalMsgId}, skipping`);
            continue;
          }
        }

        // ── Build message insert payload ──────────────────────────────────
        const msgEvent = event.message!;
        const msgType = msgEvent.type;
        const now = new Date().toISOString();

        const messageInsert: Record<string, any> = {
          conversation_id: conversationId,
          sender_type: 'customer',
          sender_customer_id: customerId,
          sender_name: senderName,
          message_type: msgType,
          external_message_id: externalMsgId,
          created_at: new Date(event.timestamp).toISOString(),
        };

        switch (msgType) {
          case 'text':
            messageInsert.body = msgEvent.text ?? '';
            break;

          case 'image':
          case 'video':
          case 'audio':
          case 'file':
            messageInsert.media_url = msgEvent.mediaUrl ?? null;
            if (msgEvent.metadata) {
              messageInsert.media_metadata = msgEvent.metadata;
            }
            break;

          case 'sticker':
            messageInsert.media_metadata = {
              packageId: msgEvent.metadata?.packageId,
              stickerId: msgEvent.metadata?.stickerId,
            };
            break;

          case 'location':
            messageInsert.body = msgEvent.text ?? '';
            messageInsert.media_metadata = {
              title: msgEvent.metadata?.title,
              address: msgEvent.metadata?.address,
              latitude: msgEvent.metadata?.latitude,
              longitude: msgEvent.metadata?.longitude,
            };
            break;

          default:
            messageInsert.body = msgEvent.text ?? '';
            if (msgEvent.metadata) {
              messageInsert.media_metadata = msgEvent.metadata;
            }
        }

        const { data: insertedMsg, error: msgInsertError } = await supabaseAdmin
          .from('channel_messages')
          .insert(messageInsert)
          .select('id')
          .single();

        if (msgInsertError) {
          console.error('[LINE Webhook] Failed to insert message:', msgInsertError);
          continue;
        }

        // ── Update conversation timestamps ────────────────────────────────
        await supabaseAdmin
          .from('channel_conversations')
          .update({
            last_message_at: now,
            last_customer_message_at: now,
            is_read: false,
          })
          .eq('id', conversationId);

        // ── Log to webhook_log ────────────────────────────────────────────
        await supabaseAdmin.from('webhook_log').insert({
          channel_type: 'line',
          event_type: 'message',
          external_id: externalMsgId,
          payload: body,
          processed: true,
        });

        console.log(
          `[LINE Webhook] Message from ${channelUserId} (customer ${customerId}) saved as msg ${insertedMsg?.id} in conv ${conversationId}`
        );

        // ── Fire-and-forget: trigger AI suggestion ────────────────────────
        try {
          const baseUrl = new URL(req.url).origin;
          fetch(`${baseUrl}/api/messaging/suggest-reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              conversation_id: conversationId,
              message_id: insertedMsg?.id,
            }),
          }).catch((err) => {
            console.error('[LINE Webhook] Fire-and-forget suggest-reply error:', err);
          });
        } catch (err) {
          console.error('[LINE Webhook] Error triggering suggest-reply:', err);
        }

      } else if (event.type === 'follow') {
        // ── Follow event: create customer if not exists ───────────────────
        const { data: existingCustomer } = await supabaseAdmin
          .from('customers')
          .select('id')
          .eq('line_user_id', channelUserId)
          .single();

        if (!existingCustomer) {
          let displayName = channelUserId;
          let avatarUrl: string | undefined;

          try {
            const profile = await adapter.getUserProfile(channelUserId);
            displayName = profile.displayName;
            avatarUrl = profile.avatarUrl;
          } catch (err) {
            console.warn(`[LINE Webhook] Could not fetch profile for follow event ${channelUserId}:`, err);
          }

          const now = new Date().toISOString();
          await supabaseAdmin.from('customers').insert({
            line_user_id: channelUserId,
            display_name: displayName,
            avatar_url: avatarUrl ?? null,
            first_contact_at: now,
            last_contact_at: now,
          });
          console.log(`[LINE Webhook] Created customer for follow event: ${channelUserId}`);
        }

        await supabaseAdmin.from('webhook_log').insert({
          channel_type: 'line',
          event_type: 'follow',
          external_id: channelUserId,
          payload: body,
          processed: true,
        });

      } else if (event.type === 'unfollow') {
        // ── Unfollow event: log only, do not delete customer ──────────────
        await supabaseAdmin.from('webhook_log').insert({
          channel_type: 'line',
          event_type: 'unfollow',
          external_id: channelUserId,
          payload: body,
          processed: true,
        });

        console.log(`[LINE Webhook] Unfollow from ${channelUserId} — logged, customer retained`);
      }

    } catch (err) {
      console.error('[LINE Webhook] Error processing event:', err);
      // Continue processing remaining events even if one fails
    }
  }

  // LINE requires a 200 response; always return 200
  return withCors(NextResponse.json({ ok: true }));
}
