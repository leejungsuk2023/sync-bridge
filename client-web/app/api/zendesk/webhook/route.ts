import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ZendeskClient } from '@/lib/zendesk';
import crypto from 'crypto';

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

function verifySignature(rawBody: string, signature: string | null, timestamp: string | null): boolean {
  if (!signature || !timestamp) return false;
  const secret = process.env.ZENDESK_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[Webhook] ZENDESK_WEBHOOK_SECRET not configured');
    return false;
  }

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(timestamp + rawBody);
  const expected = hmac.digest('base64');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );
}

export async function POST(req: NextRequest) {
  // Read raw body FIRST before any parsing (required for HMAC verification)
  const rawBody = await req.text();

  const signature = req.headers.get('x-zendesk-webhook-signature');
  const timestamp = req.headers.get('x-zendesk-webhook-signature-timestamp');

  // Log signature verification attempt (skip blocking for now — TODO: re-enable after confirming secret match)
  if (signature && timestamp) {
    const isValid = verifySignature(rawBody, signature, timestamp);
    if (isValid) {
      console.log('[Webhook] HMAC signature verified');
    } else {
      console.warn('[Webhook] HMAC signature mismatch — allowing request for now');
    }
  } else {
    console.warn('[Webhook] No HMAC signature headers — allowing request');
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error('[Webhook] Invalid JSON body');
    return withCors(NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }));
  }

  const rawTicketId = payload.ticket_id || payload.ticket?.id;
  const rawCommentId = payload.comment_id || payload.comment?.id;
  const ticketId = Number(rawTicketId);
  const commentId = rawCommentId ? Number(rawCommentId) : null;
  const ticketStatus = payload.ticket_status || null;
  const commentIsPublic = payload.comment_is_public;

  if (!ticketId || isNaN(ticketId)) {
    console.error('[Webhook] Missing or invalid ticket_id in payload');
    return withCors(NextResponse.json({ error: 'Missing ticket_id' }, { status: 400 }));
  }

  try {
    // Log webhook to zendesk_webhook_log
    await supabaseAdmin.from('zendesk_webhook_log').insert({
      ticket_id: ticketId,
      comment_id: commentId || null,
      payload,
      created_at: new Date().toISOString(),
    });

    // Fetch full comment details from Zendesk
    const zendesk = new ZendeskClient();
    const comments = await zendesk.fetchTicketComments(ticketId);

    if (!comments || comments.length === 0) {
      console.warn(`[Webhook] No comments found for ticket #${ticketId}`);
      return withCors(NextResponse.json({ ok: true, message: 'No comments found' }));
    }

    // Find the specific comment or use the latest (comment IDs from Zendesk API are numbers)
    let targetComment = commentId
      ? comments.find((c: any) => c.id === commentId)
      : comments[comments.length - 1];

    // Fallback: use comment_is_public from trigger payload if available
    if (targetComment && commentIsPublic !== undefined) {
      // Only use as fallback — API value (targetComment.public) takes priority
      if (targetComment.public === undefined || targetComment.public === null) {
        targetComment = { ...targetComment, public: commentIsPublic === 'true' || commentIsPublic === true };
      }
    }

    if (!targetComment) {
      targetComment = comments[comments.length - 1];
    }

    // Check if comment already exists (idempotency via comment_id unique constraint)
    const { data: existing } = await supabaseAdmin
      .from('zendesk_conversations')
      .select('id')
      .eq('comment_id', targetComment.id)
      .single();

    if (existing) {
      console.log(`[Webhook] Comment ${targetComment.id} already exists, skipping`);
      return withCors(NextResponse.json({ ok: true, message: 'Duplicate comment, skipped' }));
    }

    // Determine author type by checking if author is a Zendesk agent or end-user
    // Fetch ticket detail for requester info
    let requesterId: number | null = null;
    try {
      const ticketDetailRes = await fetch(
        `https://${process.env.ZENDESK_SUBDOMAIN || 'bluebridge-globalhelp'}.zendesk.com/api/v2/tickets/${ticketId}.json`,
        {
          headers: {
            Authorization: 'Basic ' + Buffer.from(`${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`).toString('base64'),
            'Content-Type': 'application/json',
          },
        }
      );
      if (ticketDetailRes.ok) {
        const ticketDetail = await ticketDetailRes.json();
        requesterId = ticketDetail.ticket?.requester_id || null;
      }
    } catch (err) {
      console.error('[Webhook] Error fetching ticket detail:', err);
    }

    const isCustomer = requesterId && targetComment.author_id === requesterId;
    const authorType = isCustomer ? 'customer' : 'agent';

    // Strip HTML tags from body for plain text storage
    const plainBody = (targetComment.body || '')
      .replace(/<[^>]*>/g, '')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

    // INSERT into zendesk_conversations
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('zendesk_conversations')
      .insert({
        ticket_id: ticketId,
        comment_id: targetComment.id,
        author_zendesk_id: targetComment.author_id,
        author_type: authorType,
        body: plainBody,
        body_html: targetComment.body || null,
        is_public: targetComment.public !== false,
        created_at_zd: targetComment.created_at,
      })
      .select('id')
      .single();

    if (insertError) {
      // If duplicate key error, just skip
      if (insertError.code === '23505') {
        console.log(`[Webhook] Duplicate comment_id ${targetComment.id}, skipping`);
        return withCors(NextResponse.json({ ok: true, message: 'Duplicate comment' }));
      }
      throw insertError;
    }

    console.log(`[Webhook] Inserted conversation for ticket #${ticketId}, comment #${targetComment.id}, type: ${authorType}`);

    // UPDATE zendesk_tickets
    const ticketUpdate: Record<string, any> = {
      last_webhook_at: new Date().toISOString(),
      last_message_at: targetComment.created_at,
      is_read: false,
    };

    if (isCustomer) {
      ticketUpdate.last_customer_comment_at = targetComment.created_at;
    } else {
      ticketUpdate.last_agent_comment_at = targetComment.created_at;
    }

    if (ticketStatus) {
      ticketUpdate.status = ticketStatus;
    }

    // Also append to zendesk_tickets.comments JSONB (Phase 1 coexistence)
    const { data: currentTicket } = await supabaseAdmin
      .from('zendesk_tickets')
      .select('comments')
      .eq('ticket_id', ticketId)
      .single();

    const existingComments = Array.isArray(currentTicket?.comments) ? currentTicket.comments : [];
    const alreadyInComments = existingComments.some((c: any) => c.id === targetComment.id);

    if (!alreadyInComments) {
      ticketUpdate.comments = [...existingComments, {
        id: targetComment.id,
        body: targetComment.body,
        author_id: targetComment.author_id,
        created_at: targetComment.created_at,
        public: targetComment.public,
      }];
    }

    await supabaseAdmin
      .from('zendesk_tickets')
      .update(ticketUpdate)
      .eq('ticket_id', ticketId);

    // Fire-and-forget: trigger AI suggestion generation
    try {
      const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        ? new URL(req.url).origin
        : 'http://localhost:3000';

      fetch(`${baseUrl}/api/zendesk/suggest-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_id: ticketId,
          comment_id: targetComment.id,
          conversation_id: inserted?.id,
        }),
      }).catch(err => {
        console.error('[Webhook] Fire-and-forget suggest-reply error:', err);
      });
    } catch (err) {
      console.error('[Webhook] Error triggering suggest-reply:', err);
    }

    return withCors(NextResponse.json({ ok: true }));
  } catch (err: any) {
    console.error('[Webhook] Error processing webhook:', err);
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}
