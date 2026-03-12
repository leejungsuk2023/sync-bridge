import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
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

async function clientOwnsHospital(clientId: string | null | undefined, hospitalId: string): Promise<boolean> {
  if (!clientId) return false;
  const { data } = await supabaseAdmin
    .from('hospital_info')
    .select('id')
    .eq('id', hospitalId)
    .eq('client_id', clientId)
    .single();
  return !!data;
}

// GET /api/hospital-kb/cases?hospital_id=xxx[&verified_only=true][&category=눈]
export async function GET(req: NextRequest) {
  const userInfo = await verifyUser(req);
  if (!userInfo) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  const { searchParams } = new URL(req.url);
  const hospital_id = searchParams.get('hospital_id');
  const verified_only = searchParams.get('verified_only') === 'true';
  const category = searchParams.get('category');

  if (!hospital_id) {
    return withCors(NextResponse.json({ error: 'hospital_id required' }, { status: 400 }));
  }

  let query = supabaseAdmin
    .from('successful_cases')
    .select('id, hospital_id, procedure_category, procedure_name_ko, procedure_name_th, customer_concern, customer_concern_th, outcome, contextual_summary, tags, quality_score, is_verified, is_masked, created_at, updated_at')
    .eq('hospital_id', hospital_id)
    .order('quality_score', { ascending: false });

  // Workers and non-admin roles only see verified cases
  if (verified_only || userInfo.role === 'worker') {
    query = query.eq('is_verified', true);
  }

  if (category) {
    query = query.eq('procedure_category', category);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[HospitalKB] Error fetching cases:', error.message);
    return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
  }

  return withCors(NextResponse.json({ cases: data }));
}

// POST /api/hospital-kb/cases — create case (bbg_admin only)
export async function POST(req: NextRequest) {
  const userInfo = await verifyUser(req);
  if (!userInfo) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }
  if (userInfo.role !== 'bbg_admin') {
    return withCors(NextResponse.json({ error: 'Forbidden: bbg_admin required' }, { status: 403 }));
  }

  const body = await req.json().catch(() => null);
  if (!body || !body.hospital_id || !body.full_conversation) {
    return withCors(NextResponse.json({ error: 'hospital_id and full_conversation required' }, { status: 400 }));
  }

  const { data, error } = await supabaseAdmin
    .from('successful_cases')
    .insert(body)
    .select()
    .single();

  if (error) {
    console.error('[HospitalKB] Error creating case:', error.message);
    return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
  }

  return withCors(NextResponse.json({ case: data }, { status: 201 }));
}

// PUT /api/hospital-kb/cases?id=xxx — update case metadata (bbg_admin only)
export async function PUT(req: NextRequest) {
  const userInfo = await verifyUser(req);
  if (!userInfo) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }
  if (userInfo.role !== 'bbg_admin') {
    return withCors(NextResponse.json({ error: 'Forbidden: bbg_admin required' }, { status: 403 }));
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return withCors(NextResponse.json({ error: 'id required' }, { status: 400 }));
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return withCors(NextResponse.json({ error: 'Request body required' }, { status: 400 }));
  }

  delete body.id;
  delete body.hospital_id;

  const { data, error } = await supabaseAdmin
    .from('successful_cases')
    .update(body)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[HospitalKB] Error updating case:', error.message);
    return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
  }

  return withCors(NextResponse.json({ case: data }));
}

// DELETE /api/hospital-kb/cases?id=xxx — delete case (bbg_admin only)
export async function DELETE(req: NextRequest) {
  const userInfo = await verifyUser(req);
  if (!userInfo) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }
  if (userInfo.role !== 'bbg_admin') {
    return withCors(NextResponse.json({ error: 'Forbidden: bbg_admin required' }, { status: 403 }));
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return withCors(NextResponse.json({ error: 'id required' }, { status: 400 }));
  }

  const { error } = await supabaseAdmin
    .from('successful_cases')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[HospitalKB] Error deleting case:', error.message);
    return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
  }

  return withCors(NextResponse.json({ success: true }));
}

// PATCH /api/hospital-kb/cases?id=xxx — toggle is_verified (bbg_admin only)
export async function PATCH(req: NextRequest) {
  const userInfo = await verifyUser(req);
  if (!userInfo) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }
  if (userInfo.role !== 'bbg_admin') {
    return withCors(NextResponse.json({ error: 'Forbidden: bbg_admin required' }, { status: 403 }));
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return withCors(NextResponse.json({ error: 'id required' }, { status: 400 }));
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.is_verified !== 'boolean') {
    return withCors(NextResponse.json({ error: 'is_verified (boolean) required' }, { status: 400 }));
  }

  const { data, error } = await supabaseAdmin
    .from('successful_cases')
    .update({ is_verified: body.is_verified })
    .eq('id', id)
    .select('id, is_verified, quality_score')
    .single();

  if (error) {
    console.error('[HospitalKB] Error verifying case:', error.message);
    return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
  }

  return withCors(NextResponse.json({ case: data }));
}
