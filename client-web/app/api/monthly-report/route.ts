import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;

// CORS
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

async function verifyUser(req: NextRequest): Promise<{
  role: string;
  userId: string;
  hospitalPrefix?: string;
  clientId?: string;
} | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, hospital_prefix, client_id')
    .eq('id', user.id)
    .single();
  if (!profile) return null;
  if (!['bbg_admin', 'client', 'hospital'].includes(profile.role)) return null;
  return {
    role: profile.role,
    userId: user.id,
    hospitalPrefix: profile.hospital_prefix || undefined,
    clientId: profile.client_id || undefined,
  };
}

function getCurrentMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export async function GET(req: NextRequest) {
  const userInfo = await verifyUser(req);
  if (!userInfo) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  const { searchParams } = new URL(req.url);
  const hospitalTag = searchParams.get('hospital_tag');
  const month = searchParams.get('month') || getCurrentMonth();
  const isList = searchParams.get('list') === 'true';

  if (!hospitalTag) {
    return withCors(NextResponse.json({ error: 'hospital_tag is required' }, { status: 400 }));
  }

  // Permission check: client/hospital can only see their own hospital
  if (userInfo.role === 'hospital') {
    if (userInfo.hospitalPrefix !== hospitalTag) {
      return withCors(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    }
  }

  try {
    if (isList) {
      // List mode: recent 12 months of reports for this hospital
      let query = supabaseAdmin
        .from('monthly_reports')
        .select('id, report_month, status, updated_at')
        .eq('hospital_tag', hospitalTag)
        .order('report_month', { ascending: false })
        .limit(12);

      // Non-admin users can only see published reports
      if (userInfo.role !== 'bbg_admin') {
        query = query.eq('status', 'published');
      }

      const { data: reports, error } = await query;
      if (error) {
        console.error('[MonthlyReport] List error:', error.message);
        return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
      }

      console.log(`[MonthlyReport] Listed ${reports?.length || 0} reports for ${hospitalTag}`);
      return withCors(NextResponse.json({ reports: reports || [] }));
    }

    // Single report mode
    let query = supabaseAdmin
      .from('monthly_reports')
      .select('*')
      .eq('hospital_tag', hospitalTag)
      .eq('report_month', month)
      .single();

    const { data: report, error } = await query;
    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows found
      console.error('[MonthlyReport] Get error:', error.message);
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }

    if (!report) {
      return withCors(NextResponse.json({ report: null }));
    }

    // Non-admin users can only see published reports
    if (userInfo.role !== 'bbg_admin' && report.status !== 'published') {
      return withCors(NextResponse.json({ report: null }));
    }

    console.log(`[MonthlyReport] Fetched report for ${hospitalTag} ${month} (status: ${report.status})`);
    return withCors(NextResponse.json({ report }));
  } catch (err: any) {
    console.error('[MonthlyReport] GET error:', err?.message || err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }));
  }
}

export async function POST(req: NextRequest) {
  const userInfo = await verifyUser(req);
  if (!userInfo) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  // Only bbg_admin can create/update/publish
  if (userInfo.role !== 'bbg_admin') {
    return withCors(NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 }));
  }

  const body = await req.json().catch(() => ({}));
  const { hospital_tag, month, action } = body;

  if (!hospital_tag || !month || !action) {
    return withCors(NextResponse.json(
      { error: 'hospital_tag, month, and action are required' },
      { status: 400 },
    ));
  }

  if (!['create', 'update_content', 'publish'].includes(action)) {
    return withCors(NextResponse.json(
      { error: 'action must be create, update_content, or publish' },
      { status: 400 },
    ));
  }

  try {
    if (action === 'create') {
      // Upsert a draft report
      // Load default content_plan from hospital_content_config if exists
      const { data: config } = await supabaseAdmin
        .from('hospital_content_config')
        .select('photo_promised, reels_promised, reviewer_promised')
        .eq('hospital_tag', hospital_tag)
        .single();

      const contentPlan = {
        photo: { promised: config?.photo_promised ?? 12, actual: null, next_month: null },
        reels: { promised: config?.reels_promised ?? 3, actual: null, next_month: null },
        reviewer: { promised: config?.reviewer_promised ?? 2, actual: null, next_month: null },
      };

      const { data: report, error } = await supabaseAdmin
        .from('monthly_reports')
        .upsert(
          {
            hospital_tag,
            report_month: month,
            status: 'draft',
            content_plan: contentPlan,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'hospital_tag,report_month', ignoreDuplicates: false },
        )
        .select()
        .single();

      if (error) {
        console.error('[MonthlyReport] Create error:', error.message);
        return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
      }

      console.log(`[MonthlyReport] Created/upserted report for ${hospital_tag} ${month}`);
      return withCors(NextResponse.json({ report }));
    }

    if (action === 'update_content') {
      const updateData: Record<string, any> = { updated_at: new Date().toISOString() };

      if (body.content_plan) updateData.content_plan = body.content_plan;
      if (body.strategy_current !== undefined) updateData.strategy_current = body.strategy_current;
      if (body.strategy_next !== undefined) updateData.strategy_next = body.strategy_next;
      if (body.hospital_requests !== undefined) updateData.hospital_requests = body.hospital_requests;
      if (body.sales_focus !== undefined) updateData.sales_focus = body.sales_focus;

      const { data: report, error } = await supabaseAdmin
        .from('monthly_reports')
        .update(updateData)
        .eq('hospital_tag', hospital_tag)
        .eq('report_month', month)
        .select()
        .single();

      if (error) {
        console.error('[MonthlyReport] Update error:', error.message);
        return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
      }

      console.log(`[MonthlyReport] Updated content for ${hospital_tag} ${month}`);
      return withCors(NextResponse.json({ report }));
    }

    if (action === 'publish') {
      const { data: report, error } = await supabaseAdmin
        .from('monthly_reports')
        .update({
          status: 'published',
          published_at: new Date().toISOString(),
          published_by: userInfo.userId,
          updated_at: new Date().toISOString(),
        })
        .eq('hospital_tag', hospital_tag)
        .eq('report_month', month)
        .select()
        .single();

      if (error) {
        console.error('[MonthlyReport] Publish error:', error.message);
        return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
      }

      console.log(`[MonthlyReport] Published report for ${hospital_tag} ${month}`);
      return withCors(NextResponse.json({ report }));
    }

    return withCors(NextResponse.json({ error: 'Unknown action' }, { status: 400 }));
  } catch (err: any) {
    console.error('[MonthlyReport] POST error:', err?.message || err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }));
  }
}
