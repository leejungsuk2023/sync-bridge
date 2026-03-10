import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;

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

// Column mapping: internal key -> possible CSV header names
const AD_COLUMN_MAP: Record<string, string[]> = {
  report_start:    ['보고 시작', 'Reporting starts'],
  report_end:      ['보고 종료', 'Reporting ends'],
  campaign_name:   ['캠페인 이름', 'Campaign name', 'Campaign Name'],
  campaign_status: ['캠페인 게재', 'Delivery', 'Campaign delivery'],
  results:         ['결과', 'Results'],
  result_type:     ['결과 표시 도구', 'Result indicator', 'Result Type'],
  cost_per_result: ['결과당 비용', 'Cost per result'],
  ad_set_budget:   ['광고 세트 예산', 'Ad set budget'],
  spend:           ['지출 금액 (KRW)', '지출 금액', 'Amount spent (KRW)', 'Amount spent'],
  impressions:     ['노출', 'Impressions'],
  reach:           ['도달', 'Reach'],
};

// Result type classification
function classifyResultType(resultType: string): string {
  if (!resultType) return '기타';
  if (resultType.includes('post_engagement')) return '참여';
  if (resultType.includes('messaging_conversation_started')) return '메시지';
  if (resultType.includes('link_click')) return '트래픽';
  return '기타';
}

// Simple CSV parser (handles quoted fields with commas and escaped quotes)
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;

  while (i < text.length) {
    const row: string[] = [];
    while (i < text.length) {
      let value = '';

      // Skip leading whitespace (but not newlines)
      while (i < text.length && text[i] === ' ') i++;

      if (i < text.length && text[i] === '"') {
        // Quoted field
        i++; // skip opening quote
        while (i < text.length) {
          if (text[i] === '"') {
            if (i + 1 < text.length && text[i + 1] === '"') {
              // Escaped quote
              value += '"';
              i += 2;
            } else {
              // End of quoted field
              i++; // skip closing quote
              break;
            }
          } else {
            value += text[i];
            i++;
          }
        }
      } else {
        // Unquoted field
        while (i < text.length && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
          value += text[i];
          i++;
        }
        value = value.trim();
      }

      row.push(value);

      // Check what follows the field
      if (i < text.length && text[i] === ',') {
        i++; // skip comma, continue to next field
      } else {
        // End of row (newline or EOF)
        if (i < text.length && text[i] === '\r') i++;
        if (i < text.length && text[i] === '\n') i++;
        break;
      }
    }

    // Skip empty rows
    if (row.length > 0 && !(row.length === 1 && row[0] === '')) {
      rows.push(row);
    }
  }

  return rows;
}

function parseNumber(val: string): number {
  if (!val) return 0;
  // Remove commas, currency symbols, spaces
  const cleaned = val.replace(/[,\s₩원KRW]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

export async function POST(req: NextRequest) {
  const userInfo = await verifyUser(req);
  if (!userInfo) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const hospitalTag = formData.get('hospital_tag') as string | null;
    const month = formData.get('month') as string | null;

    if (!file || !hospitalTag || !month) {
      return withCors(NextResponse.json(
        { error: 'file, hospital_tag, and month are required' },
        { status: 400 },
      ));
    }

    // Read CSV text
    const csvText = await file.text();
    console.log(`[MonthlyReport] Parsing CSV for ${hospitalTag} ${month}, size: ${csvText.length} bytes`);

    // Parse CSV
    const rows = parseCSV(csvText);
    if (rows.length < 2) {
      return withCors(NextResponse.json({ error: 'CSV has no data rows' }, { status: 400 }));
    }

    const headers = rows[0];
    const dataRows = rows.slice(1);

    // Map CSV headers to internal keys
    const headerMap: Record<string, number> = {}; // internal key -> column index
    const unmappedColumns: string[] = [];

    headers.forEach((header, idx) => {
      const trimmed = header.trim();
      let mapped = false;
      for (const [key, aliases] of Object.entries(AD_COLUMN_MAP)) {
        if (aliases.some(alias => alias === trimmed)) {
          headerMap[key] = idx;
          mapped = true;
          break;
        }
      }
      if (!mapped && trimmed) {
        unmappedColumns.push(trimmed);
      }
    });

    // Parse campaigns
    interface Campaign {
      name: string;
      status: string;
      result_type: string;
      result_type_label: string;
      results: number;
      cost_per_result: number;
      spend: number;
      impressions: number;
      reach: number;
      ad_set_budget: number;
      report_start: string;
      report_end: string;
    }

    const campaigns: Campaign[] = [];

    for (const row of dataRows) {
      const getVal = (key: string): string => {
        const idx = headerMap[key];
        return idx !== undefined && idx < row.length ? row[idx].trim() : '';
      };

      const resultType = getVal('result_type');
      const campaign: Campaign = {
        name: getVal('campaign_name'),
        status: getVal('campaign_status'),
        result_type: resultType,
        result_type_label: classifyResultType(resultType),
        results: parseNumber(getVal('results')),
        cost_per_result: parseNumber(getVal('cost_per_result')),
        spend: parseNumber(getVal('spend')),
        impressions: parseNumber(getVal('impressions')),
        reach: parseNumber(getVal('reach')),
        ad_set_budget: parseNumber(getVal('ad_set_budget')),
        report_start: getVal('report_start'),
        report_end: getVal('report_end'),
      };

      campaigns.push(campaign);
    }

    // Calculate totals
    const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
    const totalImpressions = campaigns.reduce((s, c) => s + c.impressions, 0);
    const totalReach = campaigns.reduce((s, c) => s + c.reach, 0);
    const totalResults = campaigns.reduce((s, c) => s + c.results, 0);
    const avgCostPerResult = totalResults > 0
      ? Math.round((totalSpend / totalResults) * 100) / 100
      : 0;

    // Group by objective (result_type_label)
    const byObjective: Record<string, {
      campaigns: number;
      results: number;
      spend: number;
      impressions: number;
      avg_cost_per_result: number;
    }> = {};

    for (const c of campaigns) {
      const label = c.result_type_label;
      if (!byObjective[label]) {
        byObjective[label] = { campaigns: 0, results: 0, spend: 0, impressions: 0, avg_cost_per_result: 0 };
      }
      byObjective[label].campaigns++;
      byObjective[label].results += c.results;
      byObjective[label].spend += c.spend;
      byObjective[label].impressions += c.impressions;
    }

    // Calculate avg_cost_per_result for each objective group
    for (const obj of Object.values(byObjective)) {
      obj.avg_cost_per_result = obj.results > 0
        ? Math.round((obj.spend / obj.results) * 100) / 100
        : 0;
    }

    const adParsedData = {
      campaigns,
      totals: {
        total_spend: totalSpend,
        total_impressions: totalImpressions,
        total_reach: totalReach,
        total_results: totalResults,
        avg_cost_per_result: avgCostPerResult,
      },
      by_objective: byObjective,
      csv_row_count: dataRows.length,
      parsed_at: new Date().toISOString(),
      currency: 'KRW',
    };

    // Save to monthly_reports (upsert)
    const { error: upsertError } = await supabaseAdmin
      .from('monthly_reports')
      .upsert(
        {
          hospital_tag: hospitalTag,
          report_month: month,
          ad_parsed_data: adParsedData,
          ad_csv_filename: file.name,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'hospital_tag,report_month', ignoreDuplicates: false },
      );

    if (upsertError) {
      console.error('[MonthlyReport] CSV save error:', upsertError.message);
      return withCors(NextResponse.json({ error: upsertError.message }, { status: 500 }));
    }

    console.log(`[MonthlyReport] Parsed ${campaigns.length} campaigns from CSV for ${hospitalTag} ${month}`);

    return withCors(NextResponse.json({
      ad_parsed_data: adParsedData,
      unmapped_columns: unmappedColumns,
    }));
  } catch (err: any) {
    console.error('[MonthlyReport] CSV upload error:', err?.message || err);
    return withCors(NextResponse.json({ error: 'Failed to parse CSV' }, { status: 500 }));
  }
}
