import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// CORS: cross-origin requests from web/desktop clients
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
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

interface UserInfo {
  role: string;
  userId: string;
  clientId?: string | null;
}

async function verifyUser(req: NextRequest): Promise<UserInfo | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, client_id')
    .eq('id', user.id)
    .single();
  if (!profile) return null;
  const allowedRoles = ['bbg_admin', 'client', 'worker', 'hospital'];
  if (!allowedRoles.includes(profile.role)) return null;
  return { role: profile.role, userId: user.id, clientId: profile.client_id };
}

// GET /api/hospital-kb?hospital_prefix=thebb
// Returns combined hospital info + doctors + procedures + active promotions
export async function GET(req: NextRequest) {
  const userInfo = await verifyUser(req);
  if (!userInfo) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  const { searchParams } = new URL(req.url);
  const hospital_prefix = searchParams.get('hospital_prefix');

  if (!hospital_prefix) {
    // List all hospitals (bbg_admin only)
    if (userInfo.role !== 'bbg_admin') {
      return withCors(NextResponse.json({ error: 'hospital_prefix required' }, { status: 400 }));
    }
    const { data, error } = await supabaseAdmin
      .from('hospital_info')
      .select('id, hospital_prefix, display_name_ko, display_name_th, logo_url, specialties, updated_at')
      .order('display_name_ko');
    if (error) {
      console.error('[HospitalKB] Error listing hospitals:', error.message);
      return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    }
    return withCors(NextResponse.json({ hospitals: data }));
  }

  // Fetch hospital_info
  const { data: hospitalInfo, error: infoError } = await supabaseAdmin
    .from('hospital_info')
    .select('*')
    .eq('hospital_prefix', hospital_prefix)
    .single();

  if (infoError || !hospitalInfo) {
    return withCors(NextResponse.json({ error: 'Hospital not found' }, { status: 404 }));
  }

  const today = new Date().toISOString().slice(0, 10);

  // Parallel fetch of sub-resources
  const [doctorsRes, proceduresRes, promotionsRes] = await Promise.all([
    supabaseAdmin
      .from('hospital_doctors')
      .select('*')
      .eq('hospital_id', hospitalInfo.id)
      .eq('is_active', true)
      .order('sort_order'),

    supabaseAdmin
      .from('hospital_procedures')
      .select('*')
      .eq('hospital_id', hospitalInfo.id)
      .eq('is_active', true)
      .order('is_popular', { ascending: false })
      .order('sort_order'),

    supabaseAdmin
      .from('hospital_promotions')
      .select('*')
      .eq('hospital_id', hospitalInfo.id)
      .eq('is_active', true)
      .or(`ends_at.is.null,ends_at.gte.${today}`),
  ]);

  if (doctorsRes.error) console.error('[HospitalKB] Error fetching doctors:', doctorsRes.error.message);
  if (proceduresRes.error) console.error('[HospitalKB] Error fetching procedures:', proceduresRes.error.message);
  if (promotionsRes.error) console.error('[HospitalKB] Error fetching promotions:', promotionsRes.error.message);

  return withCors(NextResponse.json({
    hospital_info: hospitalInfo,
    doctors: doctorsRes.data ?? [],
    procedures: proceduresRes.data ?? [],
    active_promotions: promotionsRes.data ?? [],
  }));
}

// POST /api/hospital-kb — create hospital_info (bbg_admin only)
export async function POST(req: NextRequest) {
  const userInfo = await verifyUser(req);
  if (!userInfo) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }
  if (userInfo.role !== 'bbg_admin') {
    return withCors(NextResponse.json({ error: 'Forbidden: bbg_admin required' }, { status: 403 }));
  }

  const body = await req.json().catch(() => null);
  if (!body || !body.hospital_prefix) {
    return withCors(NextResponse.json({ error: 'hospital_prefix required' }, { status: 400 }));
  }

  const { data, error } = await supabaseAdmin
    .from('hospital_info')
    .insert(body)
    .select()
    .single();

  if (error) {
    console.error('[HospitalKB] Error creating hospital_info:', error.message);
    return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
  }

  return withCors(NextResponse.json({ hospital_info: data }, { status: 201 }));
}

// PUT /api/hospital-kb?id=xxx — update hospital_info (bbg_admin or client for own hospital)
export async function PUT(req: NextRequest) {
  const userInfo = await verifyUser(req);
  if (!userInfo) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return withCors(NextResponse.json({ error: 'id required' }, { status: 400 }));
  }

  // client role: can only update their own hospital
  if (userInfo.role === 'client') {
    const { data: existing } = await supabaseAdmin
      .from('hospital_info')
      .select('client_id')
      .eq('id', id)
      .single();
    if (!existing || existing.client_id !== userInfo.clientId) {
      return withCors(NextResponse.json({ error: 'Forbidden: not your hospital' }, { status: 403 }));
    }
  } else if (userInfo.role !== 'bbg_admin') {
    return withCors(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return withCors(NextResponse.json({ error: 'Request body required' }, { status: 400 }));
  }

  // Prevent overwriting hospital_prefix or id via body
  delete body.id;
  delete body.hospital_prefix;

  const { data, error } = await supabaseAdmin
    .from('hospital_info')
    .update(body)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[HospitalKB] Error updating hospital_info:', error.message);
    return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
  }

  return withCors(NextResponse.json({ hospital_info: data }));
}
