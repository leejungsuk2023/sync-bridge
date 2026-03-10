import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const maxDuration = 60;

// CORS
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

// Hospital tag prefix -> display name mapping
const HOSPITAL_NAMES: Record<string, string> = {
  thebb: 'TheBB', delphic: 'Delphic Clinic', will: 'Will Plastic Surgery',
  mikclinicthai: 'MikClinic', jyclinicthai: 'JY Clinic', du: 'DU Plastic Surgery',
  koreandiet: 'Korean Diet', ourpthai: 'OURP', everbreastthai: 'EverBreast',
  clyveps_th: 'Clyveps', mycell: 'Mycell Clinic', nbclinici: 'NB Clinic',
  'dr.song': 'Dr. Song', lacela: 'Lacela', artline: 'Artline', kleam: 'Kleam',
};

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
  if (!profile || profile.role !== 'bbg_admin') return null;
  return { role: profile.role, userId: user.id };
}

function ticketMatchesHospital(tags: any, hospitalTag: string): boolean {
  if (!Array.isArray(tags)) return false;
  return tags.some((tag: string) => tag === hospitalTag || tag.startsWith(hospitalTag + '_'));
}

async function collectConsultationData(hospitalTag: string, month: string) {
  // month is now YYYY-MM-DD (end date of 30-day window)
  const endDate = new Date(`${month}T23:59:59Z`);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 30);
  const startDateISO = startDate.toISOString();
  const endDateISO = endDate.toISOString();

  // Fetch tickets for this month
  const { data: allTickets, error: ticketsErr } = await supabaseAdmin
    .from('zendesk_tickets')
    .select('ticket_id, tags, comments, status, created_at_zd')
    .gte('created_at_zd', startDateISO)
    .lt('created_at_zd', endDateISO);

  if (ticketsErr) {
    console.error('[MonthlyReport] Tickets query error:', ticketsErr.message);
    return null;
  }

  // Filter by hospital tag
  const hospitalTickets = (allTickets || []).filter(t => ticketMatchesHospital(t.tags, hospitalTag));
  const ticketIds = hospitalTickets.map(t => t.ticket_id);

  // Fetch analyses for these tickets (batch if needed)
  let allAnalyses: any[] = [];
  const batchSize = 200;
  for (let i = 0; i < ticketIds.length; i += batchSize) {
    const batch = ticketIds.slice(i, i + batchSize);
    const { data: analyses } = await supabaseAdmin
      .from('zendesk_analyses')
      .select('ticket_id, summary, interested_procedure, reservation_converted, quality_score')
      .in('ticket_id', batch);
    if (analyses) allAnalyses = allAnalyses.concat(analyses);
  }

  const totalInquiries = hospitalTickets.length;
  const meaningfulInquiries = hospitalTickets.filter(
    t => Array.isArray(t.comments) && t.comments.length >= 4,
  ).length;
  const conversions = allAnalyses.filter(a => a.reservation_converted).length;
  const conversionRate = meaningfulInquiries > 0
    ? Math.round((conversions / meaningfulInquiries) * 1000) / 10
    : 0;

  // Top 5 procedures
  const procedureCounts: Record<string, number> = {};
  allAnalyses.forEach(a => {
    if (a.interested_procedure) {
      procedureCounts[a.interested_procedure] = (procedureCounts[a.interested_procedure] || 0) + 1;
    }
  });
  const topProcedures = Object.entries(procedureCounts)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 5);

  // Previous 30-day period for growth calculation
  const prevEnd = new Date(startDate);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - 30);

  const { data: prevTickets } = await supabaseAdmin
    .from('zendesk_tickets')
    .select('ticket_id, tags, comments')
    .gte('created_at_zd', prevStart.toISOString())
    .lt('created_at_zd', prevEnd.toISOString());

  const prevHospitalTickets = (prevTickets || []).filter(t => ticketMatchesHospital(t.tags, hospitalTag));
  const prevTicketIds = prevHospitalTickets.map(t => t.ticket_id);

  let prevConversions = 0;
  if (prevTicketIds.length > 0) {
    for (let i = 0; i < prevTicketIds.length; i += batchSize) {
      const batch = prevTicketIds.slice(i, i + batchSize);
      const { data: prevAnalyses } = await supabaseAdmin
        .from('zendesk_analyses')
        .select('reservation_converted')
        .in('ticket_id', batch);
      if (prevAnalyses) {
        prevConversions += prevAnalyses.filter(a => a.reservation_converted).length;
      }
    }
  }

  const prevTotal = prevHospitalTickets.length;
  const growthInquiries = prevTotal > 0
    ? Math.round(((totalInquiries - prevTotal) / prevTotal) * 1000) / 10
    : 0;
  const growthConversions = prevConversions > 0
    ? Math.round(((conversions - prevConversions) / prevConversions) * 1000) / 10
    : 0;

  // Recent summaries (max 30)
  const summaries = allAnalyses
    .map(a => a.summary)
    .filter(Boolean)
    .slice(0, 30);

  return {
    totalInquiries,
    meaningfulInquiries,
    conversions,
    conversionRate,
    topProcedures,
    growth: {
      totalInquiries: growthInquiries,
      conversions: growthConversions,
    },
    summaries,
  };
}

async function collectLeadData(hospitalTag: string, month: string) {
  // month is now YYYY-MM-DD (end date of 30-day window)
  const endDate = new Date(`${month}T23:59:59Z`);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 30);

  const { data: leads } = await supabaseAdmin
    .from('sales_leads')
    .select('status, procedures, collected_at')
    .eq('hospital_tag', hospitalTag)
    .gte('collected_at', startDate.toISOString())
    .lt('collected_at', endDate.toISOString());

  const statusCounts: Record<string, number> = {};
  (leads || []).forEach(l => {
    statusCounts[l.status] = (statusCounts[l.status] || 0) + 1;
  });

  return {
    total: (leads || []).length,
    byStatus: statusCounts,
  };
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
  const { hospital_tag, month } = body;

  if (!hospital_tag || !month) {
    return withCors(NextResponse.json(
      { error: 'hospital_tag and month are required' },
      { status: 400 },
    ));
  }

  const hospitalName = HOSPITAL_NAMES[hospital_tag] || hospital_tag;

  try {
    // Set status to generating
    await supabaseAdmin
      .from('monthly_reports')
      .upsert(
        {
          hospital_tag,
          report_month: month,
          status: 'generating',
          generated_by: userInfo.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'hospital_tag,report_month', ignoreDuplicates: false },
      );

    // Fetch existing report data (ad_parsed_data, content_plan)
    const { data: existingReport } = await supabaseAdmin
      .from('monthly_reports')
      .select('ad_parsed_data, content_plan')
      .eq('hospital_tag', hospital_tag)
      .eq('report_month', month)
      .single();

    const adData = existingReport?.ad_parsed_data;
    const contentPlan = existingReport?.content_plan || {
      photo: { promised: 12, actual: null, next_month: null },
      reels: { promised: 3, actual: null, next_month: null },
      reviewer: { promised: 2, actual: null, next_month: null },
    };

    // Collect consultation data
    console.log(`[MonthlyReport] Collecting consultation data for ${hospital_tag} ${month}`);
    const consultationData = await collectConsultationData(hospital_tag, month);

    // Collect lead data
    console.log(`[MonthlyReport] Collecting lead data for ${hospital_tag} ${month}`);
    const leadData = await collectLeadData(hospital_tag, month);

    // Build prompt
    const adSection = adData
      ? JSON.stringify(adData, null, 2)
      : '광고 데이터 없음';

    const consultationSection = consultationData
      ? `- 이번달 총 상담 건수: ${consultationData.totalInquiries}건
- 의미 있는 상담 (4건 이상 대화): ${consultationData.meaningfulInquiries}건
- 예약 전환: ${consultationData.conversions}건 (전환율 ${consultationData.conversionRate}%)
- 주요 문의 시술 TOP 5: ${consultationData.topProcedures.map(([proc, count]) => `${proc}(${count}건)`).join(', ') || '없음'}
- 전월 대비: 문의 ${consultationData.growth.totalInquiries}%, 전환 ${consultationData.growth.conversions}%
- 최근 상담 요약 (최대 30건): ${consultationData.summaries.join(' | ') || '없음'}`
      : '상담 데이터 없음';

    const contentSection = `- 사진: 약속 ${contentPlan.photo?.promised ?? 12}개 / 실제 ${contentPlan.photo?.actual ?? '미입력'}개 / 다음달 계획 ${contentPlan.photo?.next_month ?? '미입력'}개
- 릴스: 약속 ${contentPlan.reels?.promised ?? 3}개 / 실제 ${contentPlan.reels?.actual ?? '미입력'}개 / 다음달 계획 ${contentPlan.reels?.next_month ?? '미입력'}개
- 체험단: 약속 ${contentPlan.reviewer?.promised ?? 2}명 / 실제 ${contentPlan.reviewer?.actual ?? '미입력'}명 / 다음달 계획 ${contentPlan.reviewer?.next_month ?? '미입력'}명`;

    const leadSection = leadData.total > 0
      ? `- 수집된 리드: ${leadData.total}건
- 상태별: ${Object.entries(leadData.byStatus).map(([status, count]) => `${status} ${count}`).join(', ')}`
      : '리드 데이터 없음';

    const prompt = `You are a marketing analyst for BBG, a medical tourism agency.
Generate a monthly performance report for hospital "${hospitalName}" for 최근 30일 (ending ${month}).

All output MUST be in Korean (한국어).

=== INPUT DATA ===

[1] 광고 성과 데이터:
${adSection}

[2] 상담 데이터:
${consultationSection}

[3] 콘텐츠 현황:
${contentSection}

[4] 리드 데이터 (있는 경우):
${leadSection}

=== OUTPUT FORMAT (JSON) ===

{
  "ad_summary": "광고 성과를 3-5문장으로 요약. 총 노출, 클릭, 비용, 전환, CPC, ROAS 등 핵심 지표 언급. 전월 대비 변화 포함.",
  "consultation_summary": "상담 성과를 3-5문장으로 요약. 총 건수, 주요 시술, 전환율, 특이사항 언급.",
  "strategy_current": "이번달 광고 전략 요약. 3-5문장. 현재 진행 중인 캠페인 방향, 타겟팅, 예산 배분 등.",
  "strategy_next": "다음달 광고 전략 제안. 3-5문장. 데이터 기반 개선 방향, 신규 캠페인 아이디어, 시즈널 트렌드 반영.",
  "hospital_requests": "병원에 요청할 사항 목록. 번호 매기기. 예: 1. 의사 프로필 사진 업데이트 2. 신규 시술 가격표 제공 등.",
  "sales_focus": "세일즈팀 집중 포인트 목록. 번호 매기기. 예: 1. 리프팅 시술 문의 고객 적극 팔로업 2. 재방문 고객 프로모션 안내 등."
}

IMPORTANT:
- 모든 내용은 반드시 한국어로 작성
- 구체적인 숫자와 비율을 포함하여 설득력 있게 작성
- 병원 관계자가 읽는 공식 보고서이므로 전문적이고 정중한 어조 사용
- 광고 데이터가 없는 경우 상담 데이터만으로 요약 작성 (광고 미집행 언급)
- Respond ONLY with valid JSON, no markdown`;

    // Call Gemini
    console.log(`[MonthlyReport] Calling Gemini for ${hospital_tag} ${month}`);
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
        temperature: 0.7,
      },
    });

    // Try up to 2 times
    let aiResult: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        let text = result.response.text();
        text = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        aiResult = JSON.parse(text);
        break;
      } catch (parseErr: any) {
        console.error(`[MonthlyReport] Gemini parse attempt ${attempt + 1} failed:`, parseErr.message);
        if (attempt === 1) {
          // Revert status to draft on failure
          await supabaseAdmin
            .from('monthly_reports')
            .update({ status: 'draft', updated_at: new Date().toISOString() })
            .eq('hospital_tag', hospital_tag)
            .eq('report_month', month);
          return withCors(NextResponse.json(
            { error: `AI response parse failed: ${parseErr.message}` },
            { status: 500 },
          ));
        }
      }
    }

    if (!aiResult) {
      await supabaseAdmin
        .from('monthly_reports')
        .update({ status: 'draft', updated_at: new Date().toISOString() })
        .eq('hospital_tag', hospital_tag)
        .eq('report_month', month);
      return withCors(NextResponse.json({ error: 'AI generation failed' }, { status: 500 }));
    }

    // Save results
    const { data: updatedReport, error: updateErr } = await supabaseAdmin
      .from('monthly_reports')
      .update({
        ad_summary: aiResult.ad_summary || null,
        consultation_summary: aiResult.consultation_summary || null,
        consultation_data: consultationData,
        strategy_current: aiResult.strategy_current || null,
        strategy_next: aiResult.strategy_next || null,
        hospital_requests: aiResult.hospital_requests || null,
        sales_focus: aiResult.sales_focus || null,
        status: 'review',
        updated_at: new Date().toISOString(),
      })
      .eq('hospital_tag', hospital_tag)
      .eq('report_month', month)
      .select()
      .single();

    if (updateErr) {
      console.error('[MonthlyReport] Save generated report error:', updateErr.message);
      return withCors(NextResponse.json({ error: updateErr.message }, { status: 500 }));
    }

    console.log(`[MonthlyReport] Generated report for ${hospital_tag} ${month}, status set to review`);
    return withCors(NextResponse.json({ report: updatedReport }));
  } catch (err: any) {
    console.error('[MonthlyReport] Generate error:', err?.message || err);
    // Revert status on unexpected error
    await supabaseAdmin
      .from('monthly_reports')
      .update({ status: 'draft', updated_at: new Date().toISOString() })
      .eq('hospital_tag', hospital_tag)
      .eq('report_month', month);
    return withCors(NextResponse.json({ error: 'Failed to generate report' }, { status: 500 }));
  }
}
