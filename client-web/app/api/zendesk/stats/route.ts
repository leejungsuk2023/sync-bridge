import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// CORS: Desktop App (Electron) and Extension cross-origin requests
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

async function verifyAdmin(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return false;
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  return profile?.role === 'bbg_admin';
}

// Hospital tag prefix -> display name mapping
const HOSPITAL_NAMES: Record<string, string> = {
  thebb: 'TheBB', delphic: 'Delphic Clinic', will: 'Will Plastic Surgery',
  mikclinicthai: 'MikClinic', jyclinicthai: 'JY Clinic', du: 'DU Plastic Surgery',
  koreandiet: 'Korean Diet', ourpthai: 'OURP', everbreastthai: 'EverBreast',
  clyveps_th: 'Clyveps', mycell: 'Mycell Clinic', nbclinici: 'NB Clinic',
  'dr.song': 'Dr. Song', lacela: 'Lacela', artline: 'Artline', kleam: 'Kleam',
};
const KNOWN_PREFIXES = Object.keys(HOSPITAL_NAMES).sort((a, b) => b.length - a.length);

function getHospitalName(tags: any): string | null {
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) {
    for (const prefix of KNOWN_PREFIXES) {
      if (tag === prefix || tag.startsWith(prefix + '_')) {
        return HOSPITAL_NAMES[prefix];
      }
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  if (!await verifyAdmin(req)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') || 'month';
  const limitParam = parseInt(searchParams.get('limit') || '20', 10);
  const limit = Math.min(Math.max(limitParam, 1), 200);

  // Calculate date range
  const now = new Date();
  const since = new Date();
  if (period === 'week') {
    since.setDate(now.getDate() - 7);
  } else {
    since.setDate(now.getDate() - 30);
  }
  const sinceISO = since.toISOString();

  // Fetch tickets in period
  const { data: tickets, error: ticketsErr } = await supabaseAdmin
    .from('zendesk_tickets')
    .select('ticket_id, subject, assignee_email, assignee_name, created_at_zd, comments, status, tags')
    .gte('created_at_zd', sinceISO)
    .order('created_at_zd', { ascending: false });

  if (ticketsErr) {
    return withCors(NextResponse.json({ error: ticketsErr.message }, { status: 500 }));
  }

  const ticketIds = (tickets || []).map(t => t.ticket_id);

  // Fetch analyses for those tickets
  let analyses: any[] = [];
  if (ticketIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('zendesk_analyses')
      .select('ticket_id, quality_score, reservation_converted, needs_followup, summary')
      .in('ticket_id', ticketIds);
    analyses = data || [];
  }

  const analysisMap = new Map<number, any>();
  for (const a of analyses) {
    analysisMap.set(a.ticket_id, a);
  }

  // Overview stats
  const totalTickets = ticketIds.length;
  const analyzedTickets = analyses.length;
  const qualityScores = analyses.filter(a => a.quality_score != null).map(a => a.quality_score);
  const avgQualityScore = qualityScores.length > 0
    ? Math.round((qualityScores.reduce((s, v) => s + v, 0) / qualityScores.length) * 10) / 10
    : 0;
  const converted = analyses.filter(a => a.reservation_converted).length;
  const conversionRate = analyzedTickets > 0
    ? Math.round((converted / analyzedTickets) * 1000) / 10
    : 0;
  const followupNeeded = analyses.filter(a => a.needs_followup).length;
  const unassigned = (tickets || []).filter(t => !t.assignee_email).length;

  const overview = {
    totalTickets,
    analyzedTickets,
    avgQualityScore,
    conversionRate,
    followupNeeded,
    unassigned,
  };

  // By assignee
  const assigneeStats = new Map<string, {
    name: string;
    email: string;
    ticketCount: number;
    totalQuality: number;
    qualityCount: number;
    conversions: number;
  }>();

  for (const t of (tickets || [])) {
    const key = t.assignee_email || '__unassigned__';
    if (!assigneeStats.has(key)) {
      assigneeStats.set(key, {
        name: t.assignee_name || 'Unassigned',
        email: t.assignee_email || '',
        ticketCount: 0,
        totalQuality: 0,
        qualityCount: 0,
        conversions: 0,
      });
    }
    const stat = assigneeStats.get(key)!;
    stat.ticketCount++;

    const analysis = analysisMap.get(t.ticket_id);
    if (analysis) {
      if (analysis.quality_score != null) {
        stat.totalQuality += analysis.quality_score;
        stat.qualityCount++;
      }
      if (analysis.reservation_converted) {
        stat.conversions++;
      }
    }
  }

  const byAssignee = [...assigneeStats.values()]
    .map(s => ({
      name: s.name,
      email: s.email,
      ticketCount: s.ticketCount,
      avgQuality: s.qualityCount > 0
        ? Math.round((s.totalQuality / s.qualityCount) * 10) / 10
        : 0,
      conversions: s.conversions,
    }))
    .sort((a, b) => b.ticketCount - a.ticketCount);

  // Recent tickets (with analysis joined)
  const totalCount = (tickets || []).length;
  const recentTickets = (tickets || []).slice(0, limit).map(t => {
    const analysis = analysisMap.get(t.ticket_id);
    return {
      ticket_id: t.ticket_id,
      subject: t.subject,
      assignee_name: t.assignee_name,
      quality_score: analysis?.quality_score ?? null,
      reservation_converted: analysis?.reservation_converted ?? null,
      needs_followup: analysis?.needs_followup ?? null,
      summary: analysis?.summary ?? null,
      created_at_zd: t.created_at_zd,
      comment_count: Array.isArray(t.comments) ? t.comments.length : 0,
      status: t.status,
      hospital_name: getHospitalName(t.tags),
    };
  });

  return withCors(NextResponse.json({ overview, byAssignee, recentTickets, totalCount }));
}
