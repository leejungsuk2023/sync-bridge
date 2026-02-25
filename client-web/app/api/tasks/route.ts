import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// 요청자 인증 확인
async function verifyUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await getSupabaseAdmin().auth.getUser(token);
  if (!user) return null;

  const { data: profile } = await getSupabaseAdmin()
    .from('profiles')
    .select('id, role, client_id')
    .eq('id', user.id)
    .single();

  return profile;
}

// GET: 업무 목록 조회 (profiles join 포함)
export async function GET(req: NextRequest) {
  const profile = await verifyUser(req);
  if (!profile) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('client_id');

  let query = getSupabaseAdmin()
    .from('tasks')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  if (clientId) {
    query = query.eq('client_id', clientId);
  } else if (profile.role !== 'bbg_admin' && profile.client_id) {
    query = query.eq('client_id', profile.client_id);
  }

  const { data: tasks, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // profiles join 수동 처리
  const assigneeIds = [...new Set((tasks || []).map(t => t.assignee_id).filter(Boolean))];
  let profilesMap: Record<string, any> = {};

  if (assigneeIds.length > 0) {
    const { data: profiles } = await getSupabaseAdmin()
      .from('profiles')
      .select('id, email, display_name')
      .in('id', assigneeIds);

    (profiles || []).forEach(p => { profilesMap[p.id] = p; });
  }

  const tasksWithProfiles = (tasks || []).map(t => ({
    ...t,
    profiles: profilesMap[t.assignee_id] || null,
  }));

  return NextResponse.json({ tasks: tasksWithProfiles });
}

// POST: 업무 생성
export async function POST(req: NextRequest) {
  const profile = await verifyUser(req);
  if (!profile) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  if (!['client', 'bbg_admin'].includes(profile.role)) {
    return NextResponse.json({ error: '업무 할당 권한이 없습니다.' }, { status: 403 });
  }

  const body = await req.json();
  const { client_id, assignee_id, content, content_th, status, due_date } = body;

  if (!assignee_id || !content) {
    return NextResponse.json({ error: '담당자와 업무 내용은 필수입니다.' }, { status: 400 });
  }

  const insertData: any = {
    client_id: client_id || profile.client_id,
    assignee_id,
    content,
    content_th: content_th || '',
    status: status || 'pending',
  };
  if (due_date) insertData.due_date = due_date;

  const { data, error } = await getSupabaseAdmin()
    .from('tasks')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data);
}

// PATCH: 업무 수정 (평가 등)
export async function PATCH(req: NextRequest) {
  const profile = await verifyUser(req);
  if (!profile) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const body = await req.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: '업무 ID가 필요합니다.' }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from('tasks')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data);
}
