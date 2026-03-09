import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60;

// CORS: Desktop App (Electron) and Extension cross-origin requests
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

const ALL_STATUSES = ['collecting', 'cs_requested', 'quote_sent', 'reserved', 'completed', 'cancelled', 'no_show'];
const PAGE_SIZE = 20;

// Timestamp field for each status
const STATUS_TIMESTAMP_MAP: Record<string, string> = {
  cs_requested: 'cs_requested_at',
  quote_sent: 'quote_sent_at',
  reserved: 'reserved_at',
  completed: 'completed_at',
  cancelled: 'cancelled_at',
};

// GET: List leads with filters and stats
export async function GET(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  try {
    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get('status');
    const hospitalFilter = searchParams.get('hospital');
    const workerIdFilter = searchParams.get('worker_id');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const offset = (page - 1) * PAGE_SIZE;

    // Build query for leads
    let query = supabaseAdmin
      .from('sales_leads')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    // Apply filters
    if (statusFilter) {
      const statuses = statusFilter.split(',').filter(s => ALL_STATUSES.includes(s));
      if (statuses.length > 0) {
        query = query.in('status', statuses);
      }
    }
    if (hospitalFilter) {
      query = query.eq('hospital_tag', hospitalFilter);
    }
    if (workerIdFilter) {
      query = query.eq('collected_by', workerIdFilter);
    }

    const { data: leads, count, error: leadsErr } = await query;

    if (leadsErr) {
      console.error('[SalesLeads] Error fetching leads:', leadsErr);
      throw new Error('Failed to fetch leads');
    }

    // Build stats (all leads, ignoring pagination filters but respecting hospital/worker filters)
    let statsQuery = supabaseAdmin
      .from('sales_leads')
      .select('status');

    if (hospitalFilter) {
      statsQuery = statsQuery.eq('hospital_tag', hospitalFilter);
    }
    if (workerIdFilter) {
      statsQuery = statsQuery.eq('collected_by', workerIdFilter);
    }

    const { data: allLeads } = await statsQuery;

    const byStatus: Record<string, number> = {};
    for (const s of ALL_STATUSES) {
      byStatus[s] = 0;
    }
    let total = 0;
    if (allLeads) {
      for (const l of allLeads) {
        total++;
        if (byStatus[l.status] !== undefined) {
          byStatus[l.status]++;
        }
      }
    }

    return withCors(NextResponse.json({
      leads: leads || [],
      stats: {
        total,
        by_status: byStatus,
      },
      total_count: count || 0,
    }));
  } catch (error: any) {
    console.error('[SalesLeads] GET error:', error?.message || error);
    return withCors(NextResponse.json({ error: error?.message || 'Failed to fetch leads' }, { status: 500 }));
  }
}

// PATCH: Update lead status
export async function PATCH(req: NextRequest) {
  const authUser = await verifyUser(req);
  if (!authUser) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  const body = await req.json().catch(() => ({}));
  const { lead_id, status, note } = body;

  if (!lead_id) {
    return withCors(NextResponse.json({ error: 'lead_id required' }, { status: 400 }));
  }
  if (!status || !ALL_STATUSES.includes(status)) {
    return withCors(NextResponse.json({ error: `status must be one of: ${ALL_STATUSES.join(', ')}` }, { status: 400 }));
  }

  try {
    // Get current lead
    const { data: currentLead, error: fetchErr } = await supabaseAdmin
      .from('sales_leads')
      .select('id, status')
      .eq('id', lead_id)
      .single();

    if (fetchErr || !currentLead) {
      return withCors(NextResponse.json({ error: 'Lead not found' }, { status: 404 }));
    }

    // Build update object
    const now = new Date().toISOString();
    const update: Record<string, any> = {
      status,
      updated_at: now,
    };

    // Set corresponding timestamp field
    const tsField = STATUS_TIMESTAMP_MAP[status];
    if (tsField) {
      update[tsField] = now;
    }

    const { error: updateErr } = await supabaseAdmin
      .from('sales_leads')
      .update(update)
      .eq('id', lead_id);

    if (updateErr) {
      console.error('[SalesLeads] Error updating lead:', updateErr);
      throw new Error('Failed to update lead status');
    }

    // Record timeline event
    await supabaseAdmin.from('sales_lead_timeline').insert({
      lead_id,
      event_type: note ? 'note_added' : 'status_changed',
      event_data: note ? { note } : null,
      status_before: currentLead.status,
      status_after: status,
      created_by: authUser.userId,
    });

    console.log(`[SalesLeads] Lead ${lead_id} status changed: ${currentLead.status} -> ${status}`);

    return withCors(NextResponse.json({
      lead_id,
      status,
      previous_status: currentLead.status,
    }));
  } catch (error: any) {
    console.error('[SalesLeads] PATCH error:', error?.message || error);
    return withCors(NextResponse.json({ error: error?.message || 'Failed to update lead' }, { status: 500 }));
  }
}
