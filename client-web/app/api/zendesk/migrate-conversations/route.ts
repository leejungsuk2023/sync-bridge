import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ZendeskClient } from '@/lib/zendesk';

export const maxDuration = 300; // 5 min for large migration

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

/**
 * POST /api/zendesk/migrate-conversations
 *
 * Migrates existing zendesk_tickets.comments JSONB data into
 * the new zendesk_conversations table. Safe to run multiple times
 * (skips existing comment_ids via ON CONFLICT).
 *
 * Auth: CRON_SECRET or bbg_admin Bearer token
 */
export async function POST(req: NextRequest) {
  // Auth check
  const authHeader = req.headers.get('authorization');
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isCron) {
    if (!authHeader?.startsWith('Bearer ')) {
      return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    if (!user) {
      return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    }
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    if (!profile || profile.role !== 'bbg_admin') {
      return withCors(NextResponse.json({ error: 'Admin only' }, { status: 403 }));
    }
  }

  console.log('[MigrateConversations] Starting migration...');

  // Fetch all zendesk_tickets with comments
  // Batch params
  const url = new URL(req.url);
  const batchSize = parseInt(url.searchParams.get('batch') || '50');
  const offsetParam = parseInt(url.searchParams.get('offset') || '0');

  const { data: tickets, error: ticketsError } = await supabaseAdmin
    .from('zendesk_tickets')
    .select('ticket_id, comments, requester_email, requester_name, assignee_email, status, channel')
    .not('comments', 'is', null)
    .range(offsetParam, offsetParam + batchSize - 1);

  if (ticketsError) {
    console.error('[MigrateConversations] Error fetching tickets:', ticketsError);
    return withCors(NextResponse.json({ error: ticketsError.message }, { status: 500 }));
  }

  if (!tickets || tickets.length === 0) {
    return withCors(NextResponse.json({ message: 'No more tickets to migrate', migrated: 0, done: true }));
  }

  // Collect all unique author_ids to resolve names
  const authorIds = new Set<number>();
  for (const ticket of tickets) {
    const comments = Array.isArray(ticket.comments) ? ticket.comments : [];
    for (const c of comments) {
      if (c.author_id) authorIds.add(c.author_id);
    }
  }

  // Fetch author info from Zendesk API
  console.log(`[MigrateConversations] Batch offset=${offsetParam}, tickets=${tickets.length}, authors=${authorIds.size}`);
  const zendesk = new ZendeskClient();
  const usersMap = await zendesk.fetchUsers([...authorIds]);

  let migrated = 0;
  let skipped = 0;
  let errors: string[] = [];

  for (const ticket of tickets) {
    const comments = Array.isArray(ticket.comments) ? ticket.comments : [];
    if (comments.length === 0) continue;

    const rows = comments.map((c: any) => {
      const author = c.author_id ? usersMap.get(c.author_id) : null;
      const isRequester = author?.email === ticket.requester_email;
      const authorType = isRequester ? 'customer' : 'agent';

      return {
        ticket_id: ticket.ticket_id,
        comment_id: c.id,
        author_type: authorType,
        author_name: author?.name || null,
        author_email: author?.email || null,
        author_zendesk_id: c.author_id || null,
        body: c.body || '',
        body_html: c.html_body || null,
        is_public: c.public !== false,
        channel: ticket.channel || null,
        attachments: c.attachments?.length > 0
          ? c.attachments.map((a: any) => ({
              url: a.content_url,
              filename: a.file_name,
              content_type: a.content_type,
              size: a.size,
            }))
          : null,
        created_at_zd: c.created_at,
        synced_at: new Date().toISOString(),
      };
    });

    // Upsert batch per ticket (ON CONFLICT skip)
    const { error: insertError, count } = await supabaseAdmin
      .from('zendesk_conversations')
      .upsert(rows, { onConflict: 'comment_id', ignoreDuplicates: true })
      .select('id');

    if (insertError) {
      errors.push(`Ticket ${ticket.ticket_id}: ${insertError.message}`);
      console.error(`[MigrateConversations] Ticket ${ticket.ticket_id} error:`, insertError.message);
    } else {
      migrated += rows.length;
    }

    // Also update zendesk_tickets tracking columns
    const customerComments = comments
      .filter((c: any) => {
        const author = c.author_id ? usersMap.get(c.author_id) : null;
        return author?.email === ticket.requester_email;
      })
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const agentComments = comments
      .filter((c: any) => {
        const author = c.author_id ? usersMap.get(c.author_id) : null;
        return author && author.email !== ticket.requester_email;
      })
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    await supabaseAdmin
      .from('zendesk_tickets')
      .update({
        last_customer_comment_at: customerComments[0]?.created_at || null,
        last_agent_comment_at: agentComments[0]?.created_at || null,
        channel: ticket.channel || null,
      })
      .eq('ticket_id', ticket.ticket_id);
  }

  console.log(`[MigrateConversations] Done: ${migrated} comments migrated, ${errors.length} errors`);

  const hasMore = tickets.length === batchSize;
  return withCors(NextResponse.json({
    migrated,
    tickets_processed: tickets.length,
    authors_resolved: usersMap.size,
    next_offset: hasMore ? offsetParam + batchSize : null,
    done: !hasMore,
    errors: errors.length > 0 ? errors : undefined,
  }));
}
