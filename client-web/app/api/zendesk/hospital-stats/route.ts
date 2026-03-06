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

async function verifyUser(req: NextRequest): Promise<{ role: string; userId: string; hospitalPrefix?: string } | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, hospital_prefix')
    .eq('id', user.id)
    .single();
  if (!profile) return null;
  if (profile.role === 'bbg_admin') return { role: profile.role, userId: user.id };
  if (profile.role === 'hospital' && profile.hospital_prefix) return { role: profile.role, userId: user.id, hospitalPrefix: profile.hospital_prefix };
  return null;
}

// Hospital tag prefix -> display name mapping
const HOSPITAL_NAMES: Record<string, string> = {
  thebb: 'TheBB',
  delphic: 'Delphic Clinic',
  will: 'Will Plastic Surgery',
  mikclinicthai: 'MikClinic',
  jyclinicthai: 'JY Clinic',
  du: 'DU Plastic Surgery',
  koreandiet: 'Korean Diet',
  ourpthai: 'OURP',
  everbreastthai: 'EverBreast',
  clyveps_th: 'Clyveps',
  mycell: 'Mycell Clinic',
  nbclinici: 'NB Clinic',
  'dr.song': 'Dr. Song',
  lacela: 'Lacela',
  artline: 'Artline',
  kleam: 'Kleam',
};

// Known prefixes sorted by length descending so longer prefixes match first
const KNOWN_PREFIXES = Object.keys(HOSPITAL_NAMES).sort((a, b) => b.length - a.length);

// Extract hospital prefix from a tag like "thebb_fb" -> "thebb"
function getHospitalPrefix(tag: string): string | null {
  for (const prefix of KNOWN_PREFIXES) {
    if (tag === prefix || tag.startsWith(prefix + '_')) {
      return prefix;
    }
  }
  return null;
}

// Check if a ticket's tags match a specific hospital prefix
function ticketMatchesHospital(tags: any, hospitalPrefix: string): boolean {
  if (!Array.isArray(tags)) return false;
  return tags.some((tag: string) => tag === hospitalPrefix || tag.startsWith(hospitalPrefix + '_'));
}

// Get all hospital prefixes from a ticket's tags
function getTicketHospitals(tags: any): Set<string> {
  const hospitals = new Set<string>();
  if (!Array.isArray(tags)) return hospitals;
  for (const tag of tags) {
    const prefix = getHospitalPrefix(tag);
    if (prefix) hospitals.add(prefix);
  }
  return hospitals;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function calcGrowth(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export async function GET(req: NextRequest) {
  const userInfo = await verifyUser(req);
  if (!userInfo) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  const { searchParams } = new URL(req.url);
  // Hospital role users can only see their own hospital
  let hospital = searchParams.get('hospital'); // tag prefix, optional
  if (userInfo.role === 'hospital') {
    hospital = userInfo.hospitalPrefix!;
  }
  const period = searchParams.get('period') || 'month';
  const days = period === 'week' ? 7 : 30;

  const now = new Date();
  const currentStart = new Date(now);
  currentStart.setDate(now.getDate() - days);
  const previousStart = new Date(currentStart);
  previousStart.setDate(currentStart.getDate() - days);

  // Fetch all tickets from previous period start onward (covers both periods)
  const { data: allTickets, error: ticketsErr } = await supabaseAdmin
    .from('zendesk_tickets')
    .select('ticket_id, tags, created_at_zd, comments, status')
    .gte('created_at_zd', previousStart.toISOString())
    .order('created_at_zd', { ascending: false });

  if (ticketsErr) {
    return withCors(NextResponse.json({ error: ticketsErr.message }, { status: 500 }));
  }

  const tickets = allTickets || [];

  // Split into current and previous period
  const currentISO = currentStart.toISOString();
  const currentTickets = tickets.filter(t => t.created_at_zd >= currentISO);
  const previousTickets = tickets.filter(t => t.created_at_zd < currentISO);

  // Build hospitals list from current period tickets
  const hospitalCounts = new Map<string, number>();
  for (const t of currentTickets) {
    const prefixes = getTicketHospitals(t.tags);
    for (const p of prefixes) {
      hospitalCounts.set(p, (hospitalCounts.get(p) || 0) + 1);
    }
  }

  const hospitals = [...hospitalCounts.entries()]
    .map(([tag_prefix, ticket_count]) => ({
      tag_prefix,
      display_name: HOSPITAL_NAMES[tag_prefix] || tag_prefix,
      ticket_count,
    }))
    .sort((a, b) => b.ticket_count - a.ticket_count);

  // If no specific hospital requested, return just the list
  // Hospital role users only see their own hospital in the list
  if (!hospital) {
    if (userInfo.role === 'hospital') {
      const filtered = hospitals.filter(h => h.tag_prefix === userInfo.hospitalPrefix);
      return withCors(NextResponse.json({ hospitals: filtered }));
    }
    return withCors(NextResponse.json({ hospitals }));
  }

  // Filter tickets for the requested hospital
  const currentHospital = currentTickets.filter(t => ticketMatchesHospital(t.tags, hospital));
  const previousHospital = previousTickets.filter(t => ticketMatchesHospital(t.tags, hospital));

  const currentTicketIds = currentHospital.map(t => t.ticket_id);

  // Fetch analyses for current period hospital tickets
  let analyses: any[] = [];
  if (currentTicketIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('zendesk_analyses')
      .select('ticket_id, reservation_converted')
      .in('ticket_id', currentTicketIds);
    analyses = data || [];
  }
  const analysisMap = new Map<number, any>();
  for (const a of analyses) {
    analysisMap.set(a.ticket_id, a);
  }

  // Fetch analyses for previous period hospital tickets (for growth calc)
  const previousTicketIds = previousHospital.map(t => t.ticket_id);
  let prevAnalyses: any[] = [];
  if (previousTicketIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('zendesk_analyses')
      .select('ticket_id, reservation_converted')
      .in('ticket_id', previousTicketIds);
    prevAnalyses = data || [];
  }

  // Count meaningful inquiries (4+ comments)
  const isMeaningful = (t: any) => Array.isArray(t.comments) && t.comments.length >= 4;

  const totalInquiries = currentHospital.length;
  const meaningfulInquiries = currentHospital.filter(isMeaningful).length;
  const conversions = analyses.filter(a => a.reservation_converted).length;

  const prevTotal = previousHospital.length;
  const prevMeaningful = previousHospital.filter(isMeaningful).length;
  const prevConversions = prevAnalyses.filter(a => a.reservation_converted).length;

  const growth = {
    totalInquiries: calcGrowth(totalInquiries, prevTotal),
    meaningfulInquiries: calcGrowth(meaningfulInquiries, prevMeaningful),
    conversions: calcGrowth(conversions, prevConversions),
  };

  // Daily trend: last 7 days
  const dailyTrend: { date: string; total: number; meaningful: number; conversions: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const dateStr = formatDate(d);
    const dayTickets = currentHospital.filter(t => t.created_at_zd?.slice(0, 10) === dateStr);
    const dayTicketIds = dayTickets.map(t => t.ticket_id);
    dailyTrend.push({
      date: dateStr,
      total: dayTickets.length,
      meaningful: dayTickets.filter(isMeaningful).length,
      conversions: analyses.filter(a => dayTicketIds.includes(a.ticket_id) && a.reservation_converted).length,
    });
  }

  const stats = {
    totalInquiries,
    meaningfulInquiries,
    conversions,
    growth,
    dailyTrend,
  };

  return withCors(NextResponse.json({
    hospitals,
    stats,
    hospital: {
      tag_prefix: hospital,
      display_name: HOSPITAL_NAMES[hospital] || hospital,
    },
  }));
}
