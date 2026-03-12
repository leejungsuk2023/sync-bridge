import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

// GET /api/hospital-kb/promotions?hospital_id=xxx[&active_only=true]
export async function GET(req: NextRequest) {
  const userInfo = await verifyUser(req);
  if (!userInfo) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  const { searchParams } = new URL(req.url);
  const hospital_id = searchParams.get('hospital_id');
  const active_only = searchParams.get('active_only') === 'true';

  if (!hospital_id) {
    return withCors(NextResponse.json({ error: 'hospital_id required' }, { status: 400 }));
  }

  let query = supabaseAdmin
    .from('hospital_promotions')
    .select('*')
    .eq('hospital_id', hospital_id)
    .order('starts_at', { ascending: false });

  if (active_only) {
    const today = new Date().toISOString().slice(0, 10);
    query = query
      .eq('is_active', true)
      .or(`ends_at.is.null,ends_at.gte.${today}`);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[HospitalKB] Error fetching promotions:', error.message);
    return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
  }

  return withCors(NextResponse.json({ promotions: data }));
}

// POST /api/hospital-kb/promotions — create promotion (bbg_admin or client for own hospital)
export async function POST(req: NextRequest) {
  const userInfo = await verifyUser(req);
  if (!userInfo) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 403 }));
  }

  const body = await req.json().catch(() => null);
  if (!body || !body.hospital_id || !body.title_ko) {
    return withCors(NextResponse.json({ error: 'hospital_id and title_ko required' }, { status: 400 }));
  }

  if (userInfo.role === 'client') {
    const owns = await clientOwnsHospital(userInfo.clientId, body.hospital_id);
    if (!owns) {
      return withCors(NextResponse.json({ error: 'Forbidden: not your hospital' }, { status: 403 }));
    }
  } else if (userInfo.role !== 'bbg_admin') {
    return withCors(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
  }

  const { data, error } = await supabaseAdmin
    .from('hospital_promotions')
    .insert(body)
    .select()
    .single();

  if (error) {
    console.error('[HospitalKB] Error creating promotion:', error.message);
    return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
  }

  return withCors(NextResponse.json({ promotion: data }, { status: 201 }));
}

// PUT /api/hospital-kb/promotions?id=xxx — update promotion (bbg_admin or client for own hospital)
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

  if (userInfo.role === 'client') {
    const { data: existing } = await supabaseAdmin
      .from('hospital_promotions')
      .select('hospital_id')
      .eq('id', id)
      .single();
    if (!existing) {
      return withCors(NextResponse.json({ error: 'Promotion not found' }, { status: 404 }));
    }
    const owns = await clientOwnsHospital(userInfo.clientId, existing.hospital_id);
    if (!owns) {
      return withCors(NextResponse.json({ error: 'Forbidden: not your hospital' }, { status: 403 }));
    }
  } else if (userInfo.role !== 'bbg_admin') {
    return withCors(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return withCors(NextResponse.json({ error: 'Request body required' }, { status: 400 }));
  }

  delete body.id;
  delete body.hospital_id;

  const { data, error } = await supabaseAdmin
    .from('hospital_promotions')
    .update(body)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[HospitalKB] Error updating promotion:', error.message);
    return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
  }

  return withCors(NextResponse.json({ promotion: data }));
}

// DELETE /api/hospital-kb/promotions?id=xxx — delete promotion (bbg_admin only)
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
    .from('hospital_promotions')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[HospitalKB] Error deleting promotion:', error.message);
    return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
  }

  return withCors(NextResponse.json({ success: true }));
}
