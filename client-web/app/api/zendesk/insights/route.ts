import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// CORS: Desktop App (Electron) and Extension cross-origin requests
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
  if (profile.role === 'bbg_admin' || profile.role === 'staff') return { role: profile.role, userId: user.id };
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

// Reverse mapping: display name -> tag prefix
const NAME_TO_PREFIX: Record<string, string> = {};
for (const [prefix, name] of Object.entries(HOSPITAL_NAMES)) {
  NAME_TO_PREFIX[name] = prefix;
}

// Check if a ticket's tags match a specific hospital prefix
function ticketMatchesHospital(tags: any, hospitalPrefix: string): boolean {
  if (!Array.isArray(tags)) return false;
  return tags.some((tag: string) => tag === hospitalPrefix || tag.startsWith(hospitalPrefix + '_'));
}

export async function POST(req: NextRequest) {
  const userInfo = await verifyUser(req);
  if (!userInfo) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  if (!process.env.GEMINI_API_KEY) {
    return withCors(NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 }));
  }

  const body = await req.json().catch(() => ({}));
  // Hospital role users can only generate insights for their own hospital
  let hospitalDisplayName = body.hospital;
  if (userInfo.role === 'hospital') {
    hospitalDisplayName = HOSPITAL_NAMES[userInfo.hospitalPrefix!] || userInfo.hospitalPrefix;
  }

  if (!hospitalDisplayName) {
    return withCors(NextResponse.json({ error: 'hospital is required' }, { status: 400 }));
  }

  // Find tag prefix from display name
  const tagPrefix = NAME_TO_PREFIX[hospitalDisplayName];
  if (!tagPrefix) {
    return withCors(NextResponse.json({ error: `Unknown hospital: ${hospitalDisplayName}` }, { status: 400 }));
  }

  try {
    // Fetch all tickets for this hospital
    const { data: allTickets, error: ticketsErr } = await supabaseAdmin
      .from('zendesk_tickets')
      .select('ticket_id, tags')
      .order('updated_at_zd', { ascending: false });

    if (ticketsErr) {
      return withCors(NextResponse.json({ error: ticketsErr.message }, { status: 500 }));
    }

    // Filter tickets matching this hospital
    const hospitalTickets = (allTickets || []).filter(t => ticketMatchesHospital(t.tags, tagPrefix));

    if (hospitalTickets.length === 0) {
      return withCors(NextResponse.json({ error: 'No tickets found for this hospital' }, { status: 404 }));
    }

    const ticketIds = hospitalTickets.map(t => t.ticket_id);

    // Fetch analyses with non-null summaries for these tickets
    // Supabase .in() has a practical limit, so batch if needed
    const batchSize = 200;
    let allAnalyses: any[] = [];
    for (let i = 0; i < ticketIds.length; i += batchSize) {
      const batch = ticketIds.slice(i, i + batchSize);
      const { data: analyses } = await supabaseAdmin
        .from('zendesk_analyses')
        .select('ticket_id, summary, analyzed_at')
        .in('ticket_id', batch)
        .not('summary', 'is', null)
        .order('analyzed_at', { ascending: false });
      if (analyses) allAnalyses = allAnalyses.concat(analyses);
    }

    if (allAnalyses.length === 0) {
      return withCors(NextResponse.json({ error: 'No analyzed tickets found for this hospital' }, { status: 404 }));
    }

    // Sort by analyzed_at descending and take max 50
    allAnalyses.sort((a, b) => (b.analyzed_at || '').localeCompare(a.analyzed_at || ''));
    const recentAnalyses = allAnalyses.slice(0, 50);
    const summaries = recentAnalyses.map(a => a.summary);

    // Generate insights with Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 4096,
      },
    });

    const prompt = `You are an analyst for BBG, a medical tourism agency connecting Thai customers with Korean hospitals.
Below are ${summaries.length} recent ticket conversation summaries for the hospital "${hospitalDisplayName}".

Analyze these summaries and return a JSON object with exactly 3 fields:
- hospital_strategy (string): 병원 전략 제안 — 가격 정책, 인기 시술 패키지, 고객 대화에서 파악된 집중 영역에 대한 제안. 2-3문장, 한국어로 작성.
- sales_improvement (string): Sales팀 개선 방향 — 응답 품질, 놓친 기회, 커뮤니케이션 이슈 등. 2-3문장, 한국어로 작성.
- hq_management (string): 본사 관리 방향 — 전반적인 트렌드, 리소스 배분, 파트너십 관리에 대한 제안. 2-3문장, 한국어로 작성.

IMPORTANT: All 3 fields must be written in Korean (한국어). Each field should be 2-3 sentences providing actionable insights.

Ticket summaries:
${summaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Respond ONLY with valid JSON, no markdown.`;

    // Try up to 2 times (Gemini may truncate on first attempt)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        let text = result.response.text();
        // Strip markdown fences if present
        text = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        const insights = JSON.parse(text);

        return withCors(NextResponse.json({
          insights: {
            hospital_strategy: insights.hospital_strategy,
            sales_improvement: insights.sales_improvement,
            hq_management: insights.hq_management,
          },
        }));
      } catch (parseErr: any) {
        if (attempt === 1) {
          return withCors(NextResponse.json({ error: `AI response parse failed: ${parseErr.message}` }, { status: 500 }));
        }
        // Retry on first failure
      }
    }

    return withCors(NextResponse.json({ error: 'Unexpected error' }, { status: 500 }));
  } catch (err: any) {
    return withCors(NextResponse.json({ error: err.message }, { status: 500 }));
  }
}
