import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function verifyUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await getSupabaseAdmin().auth.getUser(token);
  if (!user) return null;

  const { data: profile } = await getSupabaseAdmin()
    .from('profiles')
    .select('id, role, client_id, hierarchy_level')
    .eq('id', user.id)
    .single();

  return profile;
}

// GET: 업무를 지시할 수 있는 대상 목록 조회
export async function GET(req: NextRequest) {
  const profile = await verifyUser(req);
  if (!profile) {
    return withCors(NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 }));
  }

  console.log('[AssignableUsers] request from', profile.id, 'role:', profile.role, 'hierarchy_level:', profile.hierarchy_level);

  const supabase = getSupabaseAdmin();

  // bbg_admin: 모든 staff + worker 조회
  if (profile.role === 'bbg_admin') {
    const { data: users, error } = await supabase
      .from('profiles')
      .select('id, display_name, email, role, hierarchy_level, team')
      .in('role', ['staff', 'worker'])
      .order('hierarchy_level', { ascending: false });

    if (error) {
      console.error('[AssignableUsers] bbg_admin query error:', error.message);
      return withCors(NextResponse.json({ error: error.message }, { status: 400 }));
    }

    const usersWithRelationship = (users || []).map(u => ({
      ...u,
      relationship: 'subordinate' as const,
    }));

    console.log('[AssignableUsers] bbg_admin returning', usersWithRelationship.length, 'users');
    return withCors(NextResponse.json({ users: usersWithRelationship }));
  }

  // client / hospital role (hierarchy_level is null): 자기 client_id의 worker만
  if (profile.hierarchy_level === null || profile.hierarchy_level === undefined) {
    if (!profile.client_id) {
      return withCors(NextResponse.json({ users: [] }));
    }

    const { data: workers, error } = await supabase
      .from('profiles')
      .select('id, display_name, email, role, hierarchy_level, team')
      .eq('role', 'worker')
      .eq('client_id', profile.client_id);

    if (error) {
      console.error('[AssignableUsers] client query error:', error.message);
      return withCors(NextResponse.json({ error: error.message }, { status: 400 }));
    }

    const usersWithRelationship = (workers || []).map(u => ({
      ...u,
      relationship: 'subordinate' as const,
    }));

    console.log('[AssignableUsers] client returning', usersWithRelationship.length, 'workers');
    return withCors(NextResponse.json({ users: usersWithRelationship }));
  }

  // staff role (hierarchy_level is set): 하위자 + 동급자
  const myLevel: number = profile.hierarchy_level;

  // 하위자: hierarchy_level > 내 레벨 (숫자가 클수록 하위)
  const { data: subordinates, error: subError } = await supabase
    .from('profiles')
    .select('id, display_name, email, role, hierarchy_level, team')
    .in('role', ['staff', 'worker'])
    .gt('hierarchy_level', myLevel);

  if (subError) {
    console.error('[AssignableUsers] subordinates query error:', subError.message);
    return withCors(NextResponse.json({ error: subError.message }, { status: 400 }));
  }

  // 동급자: hierarchy_level == 내 레벨, 본인 제외
  const { data: peers, error: peerError } = await supabase
    .from('profiles')
    .select('id, display_name, email, role, hierarchy_level, team')
    .eq('role', 'staff')
    .eq('hierarchy_level', myLevel)
    .neq('id', profile.id);

  if (peerError) {
    console.error('[AssignableUsers] peers query error:', peerError.message);
    return withCors(NextResponse.json({ error: peerError.message }, { status: 400 }));
  }

  const usersWithRelationship = [
    ...(subordinates || []).map(u => ({ ...u, relationship: 'subordinate' as const })),
    ...(peers || []).map(u => ({ ...u, relationship: 'peer' as const })),
  ];

  console.log('[AssignableUsers] staff returning', usersWithRelationship.length, 'users (subordinates:', (subordinates || []).length, ', peers:', (peers || []).length, ')');
  return withCors(NextResponse.json({ users: usersWithRelationship }));
}
