import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { FacebookAdapter } from '@/lib/channels/facebook';
import { getFacebookAdapterByPageId } from '@/lib/channels/registry';

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
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── Signature verification ────────────────────────────────────────────────────

function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;

  const appSecret = process.env.FB_APP_SECRET;
  if (!appSecret) {
    console.error('[FB Webhook] FB_APP_SECRET is not configured');
    return false;
  }

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    // Buffers of different length throw — signatures differ
    return false;
  }
}

// ── GET — Facebook webhook verification challenge ─────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const mode = searchParams.get('hub.mode');
  const verifyToken = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && verifyToken === process.env.FB_VERIFY_TOKEN) {
    console.log('[FB Webhook] Webhook verification successful');
    return new NextResponse(challenge ?? '', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  console.warn('[FB Webhook] Webhook verification failed — invalid mode or verify token');
  return new NextResponse('Forbidden', { status: 403 });
}

// ── POST — Incoming message events ───────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Read raw body first — required for HMAC verification
  const rawBody = await req.text();

  const signature = req.headers.get('x-hub-signature-256');

  if (!verifySignature(rawBody, signature)) {
    console.error('[FB Webhook] Invalid HMAC signature, rejecting request');
    return withCors(new NextResponse('Unauthorized', { status: 401 }));
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    console.error('[FB Webhook] Failed to parse JSON body');
    return withCors(NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }));
  }

  if (body.object !== 'page') {
    console.warn('[FB Webhook] Unexpected webhook object type:', body.object);
    // Return 200 to avoid Facebook retries for unknown object types
    return withCors(NextResponse.json({ ok: true }));
  }

  // Process entries asynchronously but return 200 quickly
  // Fire-and-forget the processing so Facebook gets a fast 200 response
  processEntries(body, req).catch((err) => {
    console.error('[FB Webhook] Unhandled error in processEntries:', err);
  });

  return withCors(NextResponse.json({ ok: true }));
}

// ── Core processing ───────────────────────────────────────────────────────────

async function processEntries(body: any, req: NextRequest) {
  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      try {
        await processMessagingEvent(event, req);
      } catch (err) {
        console.error('[FB Webhook] Error processing messaging event:', err);
        // Continue to next event rather than stopping all processing
      }
    }

    // Handle postback events (button taps) — log for future use
    for (const event of entry.messaging ?? []) {
      if (event.postback) {
        await logWebhookEvent(entry.id, event, 'postback').catch((err) => {
          console.error('[FB Webhook] Error logging postback event:', err);
        });
      }
    }
  }
}

async function processMessagingEvent(event: any, req: NextRequest) {
  const pageId: string = event.recipient?.id ?? '';
  const senderId: string = event.sender?.id ?? '';
  const timestamp: number = event.timestamp ?? Date.now();

  if (!event.message) {
    // Delivery receipts, read receipts, etc. — skip silently
    return;
  }

  if (!pageId || !senderId) {
    console.warn('[FB Webhook] Missing pageId or senderId in event, skipping');
    return;
  }

  // Route to the correct hospital channel by page ID
  let channelId: string;
  let hospitalPrefix: string | null;
  let adapter: FacebookAdapter;

  try {
    ({ adapter, channelId, hospitalPrefix } = await getFacebookAdapterByPageId(pageId));
  } catch (err) {
    console.error(`[FB Webhook] No channel found for page ID ${pageId}:`, err);
    return;
  }

  // ── Find or create customer ───────────────────────────────────────────────

  const { data: existingCustomer } = await supabaseAdmin
    .from('customers')
    .select('id, display_name')
    .eq('facebook_user_id', senderId)
    .single();

  let customerId: string;

  if (existingCustomer) {
    customerId = existingCustomer.id;

    // Update last contact timestamp
    await supabaseAdmin
      .from('customers')
      .update({ last_contact_at: new Date(timestamp).toISOString() })
      .eq('id', customerId);
  } else {
    // Fetch Facebook profile for new customers
    let displayName = senderId;
    let avatarUrl: string | undefined;

    try {
      const profile = await adapter.getUserProfile(senderId);
      displayName = profile.displayName;
      avatarUrl = profile.avatarUrl;
    } catch (err) {
      console.warn(`[FB Webhook] Could not fetch profile for PSID ${senderId}:`, err);
    }

    const { data: newCustomer, error: insertError } = await supabaseAdmin
      .from('customers')
      .insert({
        facebook_user_id: senderId,
        display_name: displayName,
        avatar_url: avatarUrl ?? null,
        channel_type: 'facebook',
        hospital_prefix: hospitalPrefix,
        last_contact_at: new Date(timestamp).toISOString(),
      })
      .select('id')
      .single();

    if (insertError || !newCustomer) {
      console.error('[FB Webhook] Failed to insert customer:', insertError);
      return;
    }

    customerId = newCustomer.id;
    console.log(`[FB Webhook] Created new customer ${customerId} for PSID ${senderId}`);
  }

  // ── Find or create conversation ───────────────────────────────────────────

  const { data: existingConversation } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('customer_id', customerId)
    .eq('channel_type', 'facebook')
    .eq('channel_id', channelId)
    .in('status', ['new', 'open', 'pending'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  let conversationId: string;

  if (existingConversation) {
    conversationId = existingConversation.id;
  } else {
    const { data: newConversation, error: convError } = await supabaseAdmin
      .from('conversations')
      .insert({
        customer_id: customerId,
        channel_type: 'facebook',
        channel_id: channelId,
        hospital_prefix: hospitalPrefix,
        status: 'new',
      })
      .select('id')
      .single();

    if (convError || !newConversation) {
      console.error('[FB Webhook] Failed to create conversation:', convError);
      return;
    }

    conversationId = newConversation.id;
    console.log(`[FB Webhook] Created new conversation ${conversationId} for customer ${customerId}`);
  }

  // ── Build message payload ─────────────────────────────────────────────────

  const fbMessage = event.message;
  const externalMessageId: string = fbMessage.mid ?? '';

  // Idempotency check — skip if already stored
  if (externalMessageId) {
    const { data: existing } = await supabaseAdmin
      .from('messages')
      .select('id')
      .eq('external_message_id', externalMessageId)
      .single();

    if (existing) {
      console.log(`[FB Webhook] Message ${externalMessageId} already exists, skipping`);
      return;
    }
  }

  // Determine message type and content
  let messageType = 'text';
  let messageBody: string | null = null;
  let mediaUrl: string | null = null;
  let mediaMetadata: Record<string, any> | null = null;

  if (fbMessage.sticker_id) {
    messageType = 'sticker';
    mediaMetadata = { sticker_id: fbMessage.sticker_id };
  } else if (Array.isArray(fbMessage.attachments) && fbMessage.attachments.length > 0) {
    const attachment = fbMessage.attachments[0]; // Primary attachment
    const payloadUrl: string = attachment?.payload?.url ?? '';

    switch (attachment.type) {
      case 'image':
        messageType = 'image';
        break;
      case 'video':
        messageType = 'video';
        break;
      case 'audio':
        messageType = 'audio';
        break;
      case 'file':
      default:
        messageType = 'file';
    }

    mediaUrl = payloadUrl || null;
    mediaMetadata = { attachment_type: attachment.type };
  } else if (typeof fbMessage.text === 'string') {
    messageType = 'text';
    messageBody = fbMessage.text;
  }

  // ── Insert message ────────────────────────────────────────────────────────

  const { data: insertedMessage, error: msgError } = await supabaseAdmin
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'customer',
      body: messageBody,
      message_type: messageType,
      media_url: mediaUrl,
      media_metadata: mediaMetadata,
      external_message_id: externalMessageId || null,
      created_at: new Date(timestamp).toISOString(),
    })
    .select('id')
    .single();

  if (msgError) {
    // Handle unique constraint violation (duplicate) gracefully
    if (msgError.code === '23505') {
      console.log(`[FB Webhook] Duplicate external_message_id ${externalMessageId}, skipping`);
      return;
    }
    console.error('[FB Webhook] Failed to insert message:', msgError);
    return;
  }

  console.log(`[FB Webhook] Inserted message ${insertedMessage?.id} for conversation ${conversationId}`);

  // ── Update conversation metadata ──────────────────────────────────────────

  await supabaseAdmin
    .from('conversations')
    .update({
      last_message_at: new Date(timestamp).toISOString(),
      is_read: false,
    })
    .eq('id', conversationId);

  // ── Log webhook event ─────────────────────────────────────────────────────

  await logWebhookEvent(event.recipient?.id, event, 'message').catch((err) => {
    console.error('[FB Webhook] Error logging webhook event:', err);
  });

  // ── Fire-and-forget: trigger AI suggestion ────────────────────────────────

  if (messageType === 'text' && messageBody) {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

      fetch(`${baseUrl}/api/channels/facebook/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversationId,
          message_id: insertedMessage?.id,
          customer_id: customerId,
          hospital_prefix: hospitalPrefix,
        }),
      }).catch((err) => {
        console.error('[FB Webhook] Fire-and-forget suggest error:', err);
      });
    } catch (err) {
      console.error('[FB Webhook] Error triggering AI suggestion:', err);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function logWebhookEvent(
  pageId: string,
  event: any,
  eventType: string
) {
  await supabaseAdmin.from('webhook_log').insert({
    channel_type: 'facebook',
    page_id: pageId,
    event_type: eventType,
    payload: event,
    created_at: new Date().toISOString(),
  });
}
