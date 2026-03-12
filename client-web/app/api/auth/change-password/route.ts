import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

export async function POST(req: NextRequest) {
  // Verify caller is authenticated
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return withCors(NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 }));
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !user) {
    return withCors(NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 }));
  }

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return withCors(NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 }));
  }

  const { currentPassword, newPassword } = body;

  if (!currentPassword || !newPassword) {
    return withCors(NextResponse.json({ error: '현재 비밀번호와 새 비밀번호를 입력해주세요.' }, { status: 400 }));
  }

  if (newPassword.length < 6) {
    return withCors(NextResponse.json({ error: '새 비밀번호는 최소 6자 이상이어야 합니다.' }, { status: 400 }));
  }

  // Verify current password by attempting sign-in
  const email = user.email;
  if (!email) {
    return withCors(NextResponse.json({ error: '사용자 이메일을 확인할 수 없습니다.' }, { status: 400 }));
  }

  console.log('[ChangePassword] Verifying current password for user:', user.id);

  const { error: signInError } = await supabaseAdmin.auth.signInWithPassword({
    email,
    password: currentPassword,
  });

  if (signInError) {
    console.log('[ChangePassword] Current password verification failed:', signInError.message);
    return withCors(NextResponse.json({ error: '현재 비밀번호가 올바르지 않습니다.' }, { status: 400 }));
  }

  // Update password using admin API
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
    password: newPassword,
  });

  if (updateError) {
    console.error('[ChangePassword] Failed to update password:', updateError.message);
    return withCors(NextResponse.json({ error: '비밀번호 변경에 실패했습니다.' }, { status: 500 }));
  }

  console.log('[ChangePassword] Password updated successfully for user:', user.id);
  return withCors(NextResponse.json({ success: true }));
}
