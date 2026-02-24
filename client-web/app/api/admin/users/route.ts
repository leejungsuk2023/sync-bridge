import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// 요청자가 bbg_admin인지 확인
async function verifyAdmin(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;

  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await getSupabaseAdmin().auth.getUser(token);
  if (!user) return false;

  const { data: profile } = await getSupabaseAdmin()
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  return profile?.role === 'bbg_admin';
}

// GET: 사용자 목록 조회
export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const { data: profiles } = await getSupabaseAdmin()
    .from('profiles')
    .select('id, email, display_name, role, client_id, created_at')
    .order('created_at', { ascending: false });

  return NextResponse.json({ users: profiles || [] });
}

// POST: 사용자 생성
export async function POST(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const body = await req.json();
  const { email, password, displayName, role, clientId } = body;

  if (!email || !password || !role) {
    return NextResponse.json({ error: '이메일, 비밀번호, 역할은 필수입니다.' }, { status: 400 });
  }

  if (!['client', 'worker'].includes(role)) {
    return NextResponse.json({ error: '역할은 client 또는 worker만 가능합니다.' }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json({ error: '비밀번호는 6자 이상이어야 합니다.' }, { status: 400 });
  }

  // 1. auth.users 생성
  const { data: authData, error: authError } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  const userId = authData.user.id;

  // 2. profiles 생성
  const { error: profileError } = await getSupabaseAdmin().from('profiles').insert({
    id: userId,
    email,
    display_name: displayName || email.split('@')[0],
    role,
    client_id: clientId || null,
  });

  if (profileError) {
    // 롤백: auth user 삭제
    await getSupabaseAdmin().auth.admin.deleteUser(userId);
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  return NextResponse.json({ id: userId, email, role });
}

// DELETE: 사용자 삭제
export async function DELETE(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('id');
  if (!userId) {
    return NextResponse.json({ error: '사용자 ID가 필요합니다.' }, { status: 400 });
  }

  // bbg_admin 삭제 방지
  const { data: profile } = await getSupabaseAdmin()
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();

  if (profile?.role === 'bbg_admin') {
    return NextResponse.json({ error: '관리자 계정은 삭제할 수 없습니다.' }, { status: 400 });
  }

  await getSupabaseAdmin().from('profiles').delete().eq('id', userId);
  await getSupabaseAdmin().auth.admin.deleteUser(userId);

  return NextResponse.json({ success: true });
}
