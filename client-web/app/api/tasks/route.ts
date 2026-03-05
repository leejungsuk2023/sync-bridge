import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { CHAT_ROOMS, ALL_CHAT_SENTINELS } from '@/lib/chat-rooms';

// CORS: Desktop App (Electron) 및 Extension에서의 cross-origin 요청 허용
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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

function getSupabaseAdmin() {
  return supabaseAdmin;
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
    return withCors(NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 }));
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('client_id');
  const taskId = searchParams.get('id');
  const assigneeId = searchParams.get('assignee_id');
  const month = searchParams.get('month'); // format: 2026-03
  const generalChat = searchParams.get('general_chat');

  // Chat room: single room lookup/create
  const chatRoom = searchParams.get('chat_room');
  if (chatRoom) {
    const roomDef = CHAT_ROOMS.find(r => r.key === chatRoom);
    if (!roomDef) {
      return withCors(NextResponse.json({ error: 'Invalid chat_room key' }, { status: 400 }));
    }
    const roomClientId = clientId || profile.client_id;
    if (!roomClientId) {
      return withCors(NextResponse.json({ error: 'client_id is required' }, { status: 400 }));
    }

    // Check for existing
    const { data: existing } = await getSupabaseAdmin()
      .from('tasks')
      .select('*')
      .eq('client_id', roomClientId)
      .eq('content', roomDef.sentinel)
      .limit(1);

    if (existing && existing.length > 0) {
      return withCors(NextResponse.json({ task: existing[0] }));
    }

    // If this is WORK room, check for legacy __GENERAL_CHAT__ and migrate
    if (roomDef.key === 'WORK') {
      const { data: legacy } = await getSupabaseAdmin()
        .from('tasks')
        .select('*')
        .eq('client_id', roomClientId)
        .eq('content', '__GENERAL_CHAT__')
        .limit(1);
      if (legacy && legacy.length > 0) {
        const { data: migrated } = await getSupabaseAdmin()
          .from('tasks')
          .update({ content: '__CHAT_WORK__', content_th: '__CHAT_WORK__' })
          .eq('id', legacy[0].id)
          .select()
          .single();
        if (migrated) {
          return withCors(NextResponse.json({ task: migrated }));
        }
      }
    }

    // Create new
    const { data: created, error: createErr } = await getSupabaseAdmin()
      .from('tasks')
      .insert({
        client_id: roomClientId,
        assignee_id: profile.id,
        content: roomDef.sentinel,
        content_th: roomDef.sentinel,
        status: 'pending',
      })
      .select()
      .single();

    if (createErr) {
      return withCors(NextResponse.json({ error: createErr.message }, { status: 400 }));
    }
    return withCors(NextResponse.json({ task: created }));
  }

  // List all chat rooms for a client (find or create all 4)
  const listChatRooms = searchParams.get('list_chat_rooms');
  if (listChatRooms === 'true') {
    const roomClientId = clientId || profile.client_id;
    if (!roomClientId) {
      return withCors(NextResponse.json({ error: 'client_id is required' }, { status: 400 }));
    }

    // Migrate legacy __GENERAL_CHAT__ to __CHAT_WORK__ first
    const { data: legacy } = await getSupabaseAdmin()
      .from('tasks')
      .select('*')
      .eq('client_id', roomClientId)
      .eq('content', '__GENERAL_CHAT__')
      .limit(1);
    if (legacy && legacy.length > 0) {
      await getSupabaseAdmin()
        .from('tasks')
        .update({ content: '__CHAT_WORK__', content_th: '__CHAT_WORK__' })
        .eq('id', legacy[0].id);
    }

    const rooms: any[] = [];
    for (const room of CHAT_ROOMS) {
      const { data: existing } = await getSupabaseAdmin()
        .from('tasks')
        .select('*')
        .eq('client_id', roomClientId)
        .eq('content', room.sentinel)
        .limit(1);

      if (existing && existing.length > 0) {
        rooms.push({ ...room, taskId: existing[0].id });
      } else {
        const { data: created } = await getSupabaseAdmin()
          .from('tasks')
          .insert({
            client_id: roomClientId,
            assignee_id: profile.id,
            content: room.sentinel,
            content_th: room.sentinel,
            status: 'pending',
          })
          .select()
          .single();
        if (created) {
          rooms.push({ ...room, taskId: created.id });
        }
      }
    }

    return withCors(NextResponse.json({ rooms }));
  }

  // 전체 톡방 조회/생성 (backward compat — migrates __GENERAL_CHAT__ to __CHAT_WORK__)
  if (generalChat === 'true') {
    const gcClientId = clientId || profile.client_id;
    if (!gcClientId) {
      return withCors(NextResponse.json({ error: 'client_id가 필요합니다.' }, { status: 400 }));
    }

    // 기존 전체 채팅방 task 조회 (legacy sentinel)
    const { data: existing } = await getSupabaseAdmin()
      .from('tasks')
      .select('*')
      .eq('client_id', gcClientId)
      .eq('content', '__GENERAL_CHAT__')
      .limit(1);

    if (existing && existing.length > 0) {
      // Migrate to __CHAT_WORK__
      const { data: migrated } = await getSupabaseAdmin()
        .from('tasks')
        .update({ content: '__CHAT_WORK__', content_th: '__CHAT_WORK__' })
        .eq('id', existing[0].id)
        .select()
        .single();
      return withCors(NextResponse.json({ task: migrated || existing[0] }));
    }

    // 없으면 __CHAT_WORK__ sentinel로 생성
    const { data: created, error: createErr } = await getSupabaseAdmin()
      .from('tasks')
      .insert({
        client_id: gcClientId,
        assignee_id: profile.id,
        content: '__CHAT_WORK__',
        content_th: '__CHAT_WORK__',
        status: 'pending',
      })
      .select()
      .single();

    if (createErr) {
      return withCors(NextResponse.json({ error: createErr.message }, { status: 400 }));
    }
    return withCors(NextResponse.json({ task: created }));
  }

  let query = getSupabaseAdmin()
    .from('tasks')
    .select('*')
    .order('created_at', { ascending: false });

  for (const sentinel of ALL_CHAT_SENTINELS) {
    query = query.neq('content', sentinel);
  }

  // month 필터가 있으면 limit 제거 (캘린더용), 없으면 20개 제한
  if (!month) {
    query = query.limit(20);
  }

  if (taskId) {
    query = query.eq('id', taskId);
  } else if (clientId) {
    query = query.eq('client_id', clientId);
  } else if (profile.role !== 'bbg_admin' && profile.client_id) {
    query = query.eq('client_id', profile.client_id);
  }

  if (assigneeId) {
    query = query.eq('assignee_id', assigneeId);
  }

  if (month) {
    const start = `${month}-01T00:00:00.000Z`;
    const [y, m] = month.split('-').map(Number);
    const end = new Date(y, m, 1).toISOString(); // 다음달 1일
    query = query.gte('created_at', start).lt('created_at', end);
  }

  const { data: tasks, error } = await query;
  if (error) {
    return withCors(NextResponse.json({ error: error.message }, { status: 400 }));
  }

  // profiles join 수동 처리 (assignee + created_by)
  const profileIds = new Set<string>();
  (tasks || []).forEach(t => {
    if (t.assignee_id) profileIds.add(t.assignee_id);
    if (t.created_by) profileIds.add(t.created_by);
  });
  const allProfileIds = [...profileIds];
  let profilesMap: Record<string, any> = {};

  if (allProfileIds.length > 0) {
    const { data: profiles } = await getSupabaseAdmin()
      .from('profiles')
      .select('id, email, display_name')
      .in('id', allProfileIds);

    (profiles || []).forEach(p => { profilesMap[p.id] = p; });
  }

  const tasksWithProfiles = (tasks || []).map(t => ({
    ...t,
    profiles: profilesMap[t.assignee_id] || null,
    assigner: t.created_by ? profilesMap[t.created_by] || null : null,
  }));

  return withCors(NextResponse.json({ tasks: tasksWithProfiles }));
}

// POST: 업무 생성
export async function POST(req: NextRequest) {
  const profile = await verifyUser(req);
  if (!profile) {
    return withCors(NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 }));
  }

  const body = await req.json();
  const { client_id, assignee_id, content, content_th, status, due_date, source } = body;

  // Worker can only create proposals (source: 'worker_proposed')
  if (!['client', 'bbg_admin'].includes(profile.role) && source !== 'worker_proposed') {
    return withCors(NextResponse.json({ error: '업무 할당 권한이 없습니다.' }, { status: 403 }));
  }

  if (!assignee_id || !content) {
    return withCors(NextResponse.json({ error: '담당자와 업무 내용은 필수입니다.' }, { status: 400 }));
  }

  const insertData: any = {
    client_id: client_id || profile.client_id,
    assignee_id,
    content,
    content_th: content_th || '',
    status: status || 'pending',
    created_by: profile.id,
  };
  if (due_date) insertData.due_date = due_date;
  if (source) insertData.source = source;

  const { data, error } = await getSupabaseAdmin()
    .from('tasks')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    return withCors(NextResponse.json({ error: error.message }, { status: 400 }));
  }

  return withCors(NextResponse.json(data));
}

// DELETE: 업무 삭제 (client_id scope check)
export async function DELETE(req: NextRequest) {
  const profile = await verifyUser(req);
  if (!profile) {
    return withCors(NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 }));
  }

  if (!['client', 'bbg_admin'].includes(profile.role)) {
    return withCors(NextResponse.json({ error: '삭제 권한이 없습니다.' }, { status: 403 }));
  }

  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get('id');

  if (!taskId) {
    return withCors(NextResponse.json({ error: '업무 ID가 필요합니다.' }, { status: 400 }));
  }

  // Verify task belongs to the user's client scope
  const { data: task } = await getSupabaseAdmin()
    .from('tasks')
    .select('client_id')
    .eq('id', taskId)
    .single();

  if (!task) {
    return withCors(NextResponse.json({ error: '업무를 찾을 수 없습니다.' }, { status: 404 }));
  }

  if (profile.role !== 'bbg_admin' && task.client_id !== profile.client_id) {
    return withCors(NextResponse.json({ error: '해당 업무에 대한 삭제 권한이 없습니다.' }, { status: 403 }));
  }

  // 연결된 messages 먼저 삭제
  await getSupabaseAdmin().from('messages').delete().eq('task_id', taskId);

  const { error } = await getSupabaseAdmin().from('tasks').delete().eq('id', taskId);
  if (error) {
    return withCors(NextResponse.json({ error: error.message }, { status: 400 }));
  }

  return withCors(NextResponse.json({ success: true }));
}

// PATCH: 업무 수정 (field whitelist + scope check)
const ALLOWED_PATCH_FIELDS = ['status', 'rating', 'rated_by', 'rated_at', 'due_date', 'content', 'content_th', 'assignee_id'];

export async function PATCH(req: NextRequest) {
  const profile = await verifyUser(req);
  if (!profile) {
    return withCors(NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 }));
  }

  const body = await req.json();
  const { id, ...rawUpdates } = body;

  if (!id) {
    return withCors(NextResponse.json({ error: '업무 ID가 필요합니다.' }, { status: 400 }));
  }

  // Field whitelist — only allow known safe fields
  const updates: Record<string, any> = {};
  for (const key of Object.keys(rawUpdates)) {
    if (ALLOWED_PATCH_FIELDS.includes(key)) {
      updates[key] = rawUpdates[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    return withCors(NextResponse.json({ error: '수정할 항목이 없습니다.' }, { status: 400 }));
  }

  // Verify task belongs to the user's client scope
  const { data: task } = await getSupabaseAdmin()
    .from('tasks')
    .select('client_id, assignee_id')
    .eq('id', id)
    .single();

  if (!task) {
    return withCors(NextResponse.json({ error: '업무를 찾을 수 없습니다.' }, { status: 404 }));
  }

  // Workers can only update rating or status on their own tasks
  if (profile.role === 'worker') {
    const workerAllowed = ['rating', 'rated_by', 'rated_at'];
    const hasDisallowed = Object.keys(updates).some(k => !workerAllowed.includes(k));
    if (hasDisallowed || task.assignee_id !== profile.id) {
      return withCors(NextResponse.json({ error: '수정 권한이 없습니다.' }, { status: 403 }));
    }
  } else if (profile.role !== 'bbg_admin' && task.client_id !== profile.client_id) {
    return withCors(NextResponse.json({ error: '해당 업무에 대한 수정 권한이 없습니다.' }, { status: 403 }));
  }

  const { data, error } = await getSupabaseAdmin()
    .from('tasks')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return withCors(NextResponse.json({ error: error.message }, { status: 400 }));
  }

  return withCors(NextResponse.json(data));
}
