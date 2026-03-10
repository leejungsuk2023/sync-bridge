import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;

// CORS
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
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

const DEFAULT_CONFIG = {
  photo_promised: 12,
  reels_promised: 3,
  reviewer_promised: 2,
  custom_items: [],
};

export async function GET(req: NextRequest) {
  const userInfo = await verifyUser(req);
  if (!userInfo) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  const { searchParams } = new URL(req.url);
  const hospitalTag = searchParams.get('hospital_tag');

  if (!hospitalTag) {
    return withCors(NextResponse.json({ error: 'hospital_tag is required' }, { status: 400 }));
  }

  try {
    const { data: config, error } = await supabaseAdmin
      .from('hospital_content_config')
      .select('*')
      .eq('hospital_tag', hospitalTag)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('[MonthlyReport] Config get error:', error.message);
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }

    // Return config or defaults
    const result = config || { hospital_tag: hospitalTag, ...DEFAULT_CONFIG };
    console.log(`[MonthlyReport] Config fetched for ${hospitalTag}`);
    return withCors(NextResponse.json({ config: result }));
  } catch (err: any) {
    console.error('[MonthlyReport] Config GET error:', err?.message || err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }));
  }
}

export async function PUT(req: NextRequest) {
  const userInfo = await verifyUser(req);
  if (!userInfo) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  const body = await req.json().catch(() => ({}));
  const { hospital_tag, photo_promised, reels_promised, reviewer_promised, custom_items } = body;

  if (!hospital_tag) {
    return withCors(NextResponse.json({ error: 'hospital_tag is required' }, { status: 400 }));
  }

  try {
    const upsertData: Record<string, any> = {
      hospital_tag,
      updated_by: userInfo.userId,
      updated_at: new Date().toISOString(),
    };

    if (photo_promised !== undefined) upsertData.photo_promised = photo_promised;
    if (reels_promised !== undefined) upsertData.reels_promised = reels_promised;
    if (reviewer_promised !== undefined) upsertData.reviewer_promised = reviewer_promised;
    if (custom_items !== undefined) upsertData.custom_items = custom_items;

    const { data: config, error } = await supabaseAdmin
      .from('hospital_content_config')
      .upsert(upsertData, { onConflict: 'hospital_tag', ignoreDuplicates: false })
      .select()
      .single();

    if (error) {
      console.error('[MonthlyReport] Config upsert error:', error.message);
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }

    console.log(`[MonthlyReport] Config updated for ${hospital_tag}`);
    return withCors(NextResponse.json({ config }));
  } catch (err: any) {
    console.error('[MonthlyReport] Config PUT error:', err?.message || err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }));
  }
}
