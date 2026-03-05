'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ── 타입 ──
interface TaskWithMeta {
  id: string;
  client_id: string;
  assignee_id: string;
  content: string;
  content_th: string | null;
  status: 'pending' | 'done';
  source: string;
  created_at: string;
  updated_at: string;
  rating: number | null;
  due_date: string | null;
  profiles: { email: string; display_name: string } | null;
  clients: { name: string } | null;
  latest_message_at: string | null;
}

interface WorkerInfo {
  id: string;
  email: string;
  display_name: string;
  client_id: string | null;
  clientName: string | null;
}

// ── SLA 설정 ──
type SlaLevel = 'green' | 'yellow' | 'red';

const SLA_CONFIG: Record<SlaLevel, { emoji: string; label: string; classes: string }> = {
  green:  { emoji: '\uD83D\uDFE2', label: '정상', classes: 'bg-emerald-100 text-emerald-700' },
  yellow: { emoji: '\uD83D\uDFE1', label: '주의', classes: 'bg-amber-100 text-amber-700' },
  red:    { emoji: '\uD83D\uDD34', label: '지연', classes: 'bg-red-100 text-red-700' },
};

const SLA_ORDER: Record<SlaLevel, number> = { red: 0, yellow: 1, green: 2 };

const WORKER_STATUS_BADGE: Record<string, { icon: string; label: string; classes: string }> = {
  online:  { icon: '\uD83D\uDFE2', label: '온라인', classes: 'bg-emerald-100 text-emerald-700' },
  away:    { icon: '\uD83D\uDFE1', label: '자리비움', classes: 'bg-amber-100 text-amber-700' },
  offline: { icon: '\u26AA', label: '오프라인', classes: 'bg-slate-100 text-slate-500' },
};

// ── 헬퍼 ──
function getMessageSla(task: TaskWithMeta, now: number): SlaLevel {
  if (task.status === 'done') return 'green';
  const latest = new Date(task.latest_message_at || task.created_at).getTime();
  const diffMin = (now - latest) / 1000 / 60;
  if (diffMin < 5) return 'green';
  if (diffMin < 15) return 'yellow';
  return 'red';
}

function getTaskAgeSla(task: TaskWithMeta, now: number): SlaLevel {
  if (task.status === 'done') return 'green';
  const created = new Date(task.created_at).getTime();
  const diffHours = (now - created) / 1000 / 60 / 60;
  if (diffHours < 1) return 'green';
  if (diffHours < 3) return 'yellow';
  return 'red';
}

function formatRelativeTime(iso: string, now: number): string {
  const diff = (now - new Date(iso).getTime()) / 1000 / 60;
  if (diff < 1) return '방금 전';
  if (diff < 60) return `${Math.floor(diff)}분 전`;
  if (diff < 1440) return `${Math.floor(diff / 60)}시간 전`;
  return `${Math.floor(diff / 1440)}일 전`;
}

function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 1000 / 60);
  if (totalMin < 60) return `${totalMin}분`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
}

// ── 메인 컴포넌트 ──
export default function MonitoringPage() {
  const router = useRouter();

  // 인증
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // 업무 리스트
  const [tasks, setTasks] = useState<TaskWithMeta[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // 채팅
  const [messages, setMessages] = useState<any[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [input, setInput] = useState('');
  const [isWhisper, setIsWhisper] = useState(false);
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // SLA 타이머
  const [now, setNow] = useState(Date.now());

  // 필터
  const [filterClient, setFilterClient] = useState<string>('all');
  const [filterWorker, setFilterWorker] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPeriod, setFilterPeriod] = useState<string>('all');

  // Worker / Client 데이터
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [workerStatuses, setWorkerStatuses] = useState<Record<string, string>>({});
  const [clientList, setClientList] = useState<{ id: string; name: string }[]>([]);

  // ── 인증 + 권한 체크 ──
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setAuthLoading(false);
        return;
      }
      setUser(session.user);
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();
      if (profileData?.role !== 'bbg_admin') {
        router.push('/');
        return;
      }
      setProfile(profileData);
      setAuthLoading(false);
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) router.push('/');
    });
    return () => subscription.unsubscribe();
  }, [router]);

  // ── SLA 30초 갱신 ──
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // ── Workers + Clients 페칭 ──
  const fetchWorkersAndClients = useCallback(async () => {
    const [{ data: profilesData }, { data: clientsData }] = await Promise.all([
      supabase.from('profiles').select('id, email, display_name, client_id').eq('role', 'worker'),
      supabase.from('clients').select('id, name'),
    ]);

    const cMap: Record<string, string> = {};
    (clientsData || []).forEach((c: any) => { cMap[c.id] = c.name; });
    setClientList(clientsData || []);

    const w: WorkerInfo[] = (profilesData || []).map((p: any) => ({
      id: p.id,
      email: p.email,
      display_name: p.display_name,
      client_id: p.client_id,
      clientName: p.client_id ? cMap[p.client_id] || null : null,
    }));
    setWorkers(w);
  }, []);

  // ── Worker 상태 페칭 (time_logs) ──
  const fetchWorkerStatuses = useCallback(async (workerIds: string[]) => {
    if (workerIds.length === 0) return;
    const { data } = await supabase
      .from('time_logs')
      .select('worker_id, status, created_at')
      .in('worker_id', workerIds)
      .order('created_at', { ascending: false });

    const latest: Record<string, string> = {};
    (data || []).forEach((log: any) => {
      if (!latest[log.worker_id]) latest[log.worker_id] = log.status;
    });
    setWorkerStatuses(latest);
  }, []);

  // ── 업무 목록 페칭 ──
  const fetchTasks = useCallback(async () => {
    const { data } = await supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    const rawTasks = data || [];

    const assigneeIds = [...new Set(rawTasks.map((t: any) => t.assignee_id))];
    let profileMap: Record<string, { email: string; display_name: string }> = {};
    if (assigneeIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email, display_name')
        .in('id', assigneeIds);
      (profiles || []).forEach((p: any) => { profileMap[p.id] = p; });
    }

    const clientIds = [...new Set(rawTasks.map((t: any) => t.client_id))];
    let clientMap: Record<string, { name: string }> = {};
    if (clientIds.length > 0) {
      const { data: clients } = await supabase
        .from('clients')
        .select('id, name')
        .in('id', clientIds);
      (clients || []).forEach((c: any) => { clientMap[c.id] = c; });
    }

    const taskIds = rawTasks.map((t: any) => t.id);
    let latestMessages: Record<string, string> = {};
    if (taskIds.length > 0) {
      const { data: msgData } = await supabase
        .from('messages')
        .select('task_id, created_at')
        .in('task_id', taskIds)
        .order('created_at', { ascending: false });
      (msgData || []).forEach((m: any) => {
        if (!latestMessages[m.task_id]) latestMessages[m.task_id] = m.created_at;
      });
    }

    const enriched: TaskWithMeta[] = rawTasks.map((t: any) => ({
      ...t,
      profiles: profileMap[t.assignee_id] || null,
      clients: clientMap[t.client_id] || null,
      latest_message_at: latestMessages[t.id] || null,
    }));

    setTasks(enriched);
    setTasksLoading(false);
  }, []);

  // ── 메시지 페칭 ──
  const fetchMessages = useCallback(async (taskId: string) => {
    setMessagesLoading(true);
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });
    setMessages(data || []);
    setMessagesLoading(false);
  }, []);

  // ── 초기 로드 + Realtime 구독 ──
  const selectedTaskIdRef = useRef<string | null>(null);
  selectedTaskIdRef.current = selectedTaskId;

  useEffect(() => {
    if (!profile) return;
    fetchTasks();
    fetchWorkersAndClients();

    const tasksChannel = supabase
      .channel('admin_tasks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        fetchTasks();
      })
      .subscribe();

    const messagesChannel = supabase
      .channel('admin_messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        fetchTasks();
        const currentTaskId = selectedTaskIdRef.current;
        if (currentTaskId && payload.new && (payload.new as any).task_id === currentTaskId) {
          fetchMessages(currentTaskId);
        }
      })
      .subscribe();

    const timeLogsChannel = supabase
      .channel('admin_time_logs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_logs' }, () => {
        if (workers.length > 0) fetchWorkerStatuses(workers.map(w => w.id));
      })
      .subscribe();

    return () => {
      tasksChannel.unsubscribe();
      messagesChannel.unsubscribe();
      timeLogsChannel.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, fetchTasks, fetchMessages, fetchWorkersAndClients]);

  // Workers 로드 후 상태 페칭
  useEffect(() => {
    if (workers.length > 0) fetchWorkerStatuses(workers.map(w => w.id));
  }, [workers, fetchWorkerStatuses]);

  // 선택 업무 변경 시 메시지 로드
  useEffect(() => {
    if (selectedTaskId) fetchMessages(selectedTaskId);
    else setMessages([]);
  }, [selectedTaskId, fetchMessages]);

  // 채팅 자동 스크롤
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── 메시지 전송 ──
  const sendMessage = async () => {
    if (!input.trim() || !selectedTaskId || !user) return;
    setSending(true);
    const original = input.trim();
    setInput('');

    let contentTh = '';
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: original, targetLang: 'th' }),
      });
      if (res.ok) {
        const d = await res.json();
        contentTh = d.translated || '';
      }
    } catch { /* 번역 실패해도 전송 */ }

    await supabase.from('messages').insert({
      task_id: selectedTaskId,
      sender_id: user.id,
      content: original,
      content_ko: original,
      content_th: contentTh || original,
      sender_lang: 'ko',
      is_whisper: isWhisper,
    });
    setSending(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  // ── 필터된 업무 리스트 ──
  const filteredTasks = useMemo(() => {
    let result = [...tasks];

    if (filterClient !== 'all')
      result = result.filter(t => t.client_id === filterClient);
    if (filterWorker !== 'all')
      result = result.filter(t => t.assignee_id === filterWorker);
    if (filterStatus !== 'all')
      result = result.filter(t => t.status === filterStatus);
    if (filterPeriod === 'today') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      result = result.filter(t => new Date(t.created_at) >= todayStart);
    } else if (filterPeriod === 'week') {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - 7);
      weekStart.setHours(0, 0, 0, 0);
      result = result.filter(t => new Date(t.created_at) >= weekStart);
    }

    return result;
  }, [tasks, filterClient, filterWorker, filterStatus, filterPeriod]);

  // ── 정렬된 업무 리스트 ──
  const sortedTasks = useMemo(() => {
    return [...filteredTasks].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
      const ageA = SLA_ORDER[getTaskAgeSla(a, now)];
      const ageB = SLA_ORDER[getTaskAgeSla(b, now)];
      if (ageA !== ageB) return ageA - ageB;
      const msgA = SLA_ORDER[getMessageSla(a, now)];
      const msgB = SLA_ORDER[getMessageSla(b, now)];
      if (msgA !== msgB) return msgA - msgB;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }, [filteredTasks, now]);

  // ── 통계 계산 ──
  const stats = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayTasks = filteredTasks.filter(t => new Date(t.created_at) >= todayStart);
    const doneTasks = filteredTasks.filter(t => t.status === 'done');
    const pendingTasks = filteredTasks.filter(t => t.status === 'pending');

    // 평균 완료 시간 (updated_at - created_at)
    let avgCompletionMs = 0;
    const doneWithTime = doneTasks.filter(t => t.updated_at && t.created_at);
    if (doneWithTime.length > 0) {
      const totalMs = doneWithTime.reduce((sum, t) => {
        return sum + (new Date(t.updated_at).getTime() - new Date(t.created_at).getTime());
      }, 0);
      avgCompletionMs = totalMs / doneWithTime.length;
    }

    // 평균 평점
    const ratedTasks = filteredTasks.filter(t => t.rating != null);
    const avgRating = ratedTasks.length > 0
      ? Math.round(ratedTasks.reduce((s, t) => s + (t.rating || 0), 0) / ratedTasks.length * 10) / 10
      : 0;

    const redMsgCount = pendingTasks.filter(t => getMessageSla(t, now) === 'red').length;
    const yellowMsgCount = pendingTasks.filter(t => getMessageSla(t, now) === 'yellow').length;
    const redAgeCount = pendingTasks.filter(t => getTaskAgeSla(t, now) === 'red').length;
    const yellowAgeCount = pendingTasks.filter(t => getTaskAgeSla(t, now) === 'yellow').length;

    return {
      total: filteredTasks.length,
      todayCreated: todayTasks.length,
      todayDone: todayTasks.filter(t => t.status === 'done').length,
      totalPending: pendingTasks.length,
      totalDone: doneTasks.length,
      avgCompletionMs,
      avgRating,
      ratedCount: ratedTasks.length,
      redMsgCount,
      yellowMsgCount,
      redAgeCount,
      yellowAgeCount,
    };
  }, [filteredTasks, now]);

  // ── Worker별 통계 ──
  const workerStats = useMemo(() => {
    const map: Record<string, { pending: number; done: number; ratingSum: number; ratingCount: number }> = {};
    filteredTasks.forEach(t => {
      if (!map[t.assignee_id]) map[t.assignee_id] = { pending: 0, done: 0, ratingSum: 0, ratingCount: 0 };
      if (t.status === 'pending') map[t.assignee_id].pending++;
      else map[t.assignee_id].done++;
      if (t.rating != null) {
        map[t.assignee_id].ratingSum += t.rating;
        map[t.assignee_id].ratingCount++;
      }
    });
    return map;
  }, [filteredTasks]);

  const selectedTask = tasks.find(t => t.id === selectedTaskId);

  // ── 로딩 ──
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-slate-500">로딩 중...</p>
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-slate-500 mb-2">접근 권한이 없습니다.</p>
          <a href="/" className="text-sm text-emerald-600 hover:underline">대시보드로 이동</a>
        </div>
      </div>
    );
  }

  // ── 메인 UI ──
  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* ── 헤더 ── */}
      <header className="shrink-0 bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-slate-800">SyncBridge 모니터링</h1>
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">God Mode</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-600">{profile.email}</span>
          <span className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-700">bbg_admin</span>
          <a href="/app" className="text-sm text-slate-500 hover:text-slate-700">대시보드</a>
          <button type="button" onClick={handleLogout} className="text-sm text-slate-500 hover:text-slate-700">
            로그아웃
          </button>
        </div>
      </header>

      {/* ── 통계바 ── */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-6 py-3">
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">전체</span>
            <span className="font-semibold text-slate-800">{stats.total}</span>
          </div>
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">오늘 생성</span>
            <span className="font-semibold text-blue-600">{stats.todayCreated}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">오늘 완료</span>
            <span className="font-semibold text-emerald-600">{stats.todayDone}</span>
          </div>
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">대기</span>
            <span className="font-semibold text-amber-600">{stats.totalPending}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">완료</span>
            <span className="font-semibold text-emerald-600">{stats.totalDone}</span>
          </div>
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">평균 완료</span>
            <span className="font-semibold text-slate-700">
              {stats.avgCompletionMs > 0 ? formatDuration(stats.avgCompletionMs) : '-'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">평점</span>
            <span className="font-semibold text-amber-600">
              {stats.avgRating > 0 ? `★ ${stats.avgRating} (${stats.ratedCount})` : '-'}
            </span>
          </div>
          {(stats.redAgeCount > 0 || stats.yellowAgeCount > 0) && (
            <>
              <div className="h-4 w-px bg-slate-200" />
              {stats.redAgeCount > 0 && (
                <span className="text-xs font-medium px-2 py-0.5 rounded bg-red-100 text-red-700">
                  체류지연 {stats.redAgeCount}
                </span>
              )}
              {stats.yellowAgeCount > 0 && (
                <span className="text-xs font-medium px-2 py-0.5 rounded bg-amber-100 text-amber-700">
                  체류주의 {stats.yellowAgeCount}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── 필터바 ── */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-6 py-2">
        <div className="flex items-center gap-3">
          <select
            value={filterClient}
            onChange={e => setFilterClient(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:ring-2 focus:ring-emerald-400 outline-none"
          >
            <option value="all">전체 병원</option>
            {clientList.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            value={filterWorker}
            onChange={e => setFilterWorker(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:ring-2 focus:ring-emerald-400 outline-none"
          >
            <option value="all">전체 Worker</option>
            {workers.map(w => (
              <option key={w.id} value={w.id}>{w.display_name || w.email}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:ring-2 focus:ring-emerald-400 outline-none"
          >
            <option value="all">전체 상태</option>
            <option value="pending">대기</option>
            <option value="done">완료</option>
          </select>
          <select
            value={filterPeriod}
            onChange={e => setFilterPeriod(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:ring-2 focus:ring-emerald-400 outline-none"
          >
            <option value="all">전체 기간</option>
            <option value="today">오늘</option>
            <option value="week">이번 주</option>
          </select>
          {(filterClient !== 'all' || filterWorker !== 'all' || filterStatus !== 'all' || filterPeriod !== 'all') && (
            <button
              type="button"
              onClick={() => { setFilterClient('all'); setFilterWorker('all'); setFilterStatus('all'); setFilterPeriod('all'); }}
              className="text-xs text-slate-500 hover:text-slate-700 underline"
            >
              필터 초기화
            </button>
          )}
        </div>
      </div>

      {/* ── 2-패널 본문 ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── 좌측: 업무 리스트 ── */}
        <div className="w-[420px] shrink-0 border-r border-slate-200 flex flex-col bg-white">
          {/* SLA 요약 */}
          <div className="shrink-0 px-4 py-3 border-b border-slate-200 bg-slate-50">
            <div className="flex items-center gap-3 text-xs">
              <span className="text-slate-500">표시 {filteredTasks.length}건</span>
              {stats.redMsgCount > 0 && (
                <span className="text-red-600 font-medium">{SLA_CONFIG.red.emoji} 응답지연 {stats.redMsgCount}</span>
              )}
              {stats.yellowMsgCount > 0 && (
                <span className="text-amber-600 font-medium">{SLA_CONFIG.yellow.emoji} 응답주의 {stats.yellowMsgCount}</span>
              )}
            </div>
          </div>

          {/* 리스트 */}
          <div className="flex-1 overflow-y-auto">
            {tasksLoading ? (
              <p className="text-sm text-slate-500 p-4">업무 불러오는 중...</p>
            ) : sortedTasks.length === 0 ? (
              <p className="text-sm text-slate-500 p-4 text-center">조건에 맞는 업무가 없습니다.</p>
            ) : (
              sortedTasks.map(task => {
                const msgSla = getMessageSla(task, now);
                const ageSla = getTaskAgeSla(task, now);
                const isSelected = task.id === selectedTaskId;
                const wStatus = workerStatuses[task.assignee_id] || 'offline';
                const wBadge = WORKER_STATUS_BADGE[wStatus] || WORKER_STATUS_BADGE.offline;

                return (
                  <div
                    key={task.id}
                    onClick={() => setSelectedTaskId(task.id)}
                    className={`px-4 py-3 border-b border-slate-100 cursor-pointer transition-colors hover:bg-slate-50 ${
                      isSelected ? 'bg-emerald-50 border-l-2 border-l-emerald-500' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-slate-800 line-clamp-1 flex-1">{task.content}</p>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${SLA_CONFIG[msgSla].classes}`} title="응답 SLA">
                          응답{SLA_CONFIG[msgSla].emoji}
                        </span>
                        {task.status === 'pending' && ageSla !== 'green' && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${SLA_CONFIG[ageSla].classes}`} title="체류 SLA">
                            체류{SLA_CONFIG[ageSla].emoji}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                      <span>{task.clients?.name || '-'}</span>
                      <span className="text-slate-300">|</span>
                      <span className={`inline-flex items-center gap-0.5 ${wBadge.classes} px-1 rounded text-[10px]`}>
                        {wBadge.icon}
                      </span>
                      <span>{task.profiles?.display_name || task.profiles?.email || '-'}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      {task.status === 'done' ? (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">완료</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">대기</span>
                      )}
                      {task.source === 'worker_proposed' && (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700">자체 제안</span>
                      )}
                      {task.rating != null && (
                        <span className="text-xs text-amber-600">★ {task.rating}</span>
                      )}
                      {task.status === 'pending' && (
                        <span className="text-[10px] text-slate-400">
                          {formatDuration(now - new Date(task.created_at).getTime())} 경과
                        </span>
                      )}
                      {task.due_date && (() => {
                        const due = new Date(task.due_date);
                        const isOverdue = task.status === 'pending' && due.getTime() < now;
                        return (
                          <span className={`text-[10px] font-medium ${isOverdue ? 'text-red-600' : 'text-slate-500'}`}>
                            {isOverdue ? '⚠ 기한초과' : '📅'} {due.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} {due.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        );
                      })()}
                      <span className="text-xs text-slate-400 ml-auto">
                        {formatRelativeTime(task.latest_message_at || task.created_at, now)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── 우측: 상세 + 채팅 OR Worker 현황 ── */}
        <div className="flex-1 flex flex-col bg-slate-50">
          {!selectedTask ? (
            /* ── Worker 현황 그리드 ── */
            <div className="flex-1 overflow-y-auto p-6">
              <h2 className="text-base font-semibold text-slate-800 mb-4">Worker 현황</h2>
              {workers.length === 0 ? (
                <p className="text-sm text-slate-500">등록된 Worker가 없습니다.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {workers.map(w => {
                    const wStatus = workerStatuses[w.id] || 'offline';
                    const badge = WORKER_STATUS_BADGE[wStatus] || WORKER_STATUS_BADGE.offline;
                    const ws = workerStats[w.id] || { pending: 0, done: 0, ratingSum: 0, ratingCount: 0 };
                    const avgR = ws.ratingCount > 0 ? Math.round(ws.ratingSum / ws.ratingCount * 10) / 10 : null;

                    return (
                      <div
                        key={w.id}
                        onClick={() => { setFilterWorker(w.id); setSelectedTaskId(null); }}
                        className="p-4 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-emerald-300 hover:shadow-sm transition-all"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-medium text-sm text-slate-800 truncate">{w.display_name || w.email}</p>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${badge.classes}`}>
                            {badge.icon} {badge.label}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mb-3">{w.clientName || '-'}</p>
                        <div className="flex items-center gap-3 text-xs">
                          <div className="flex items-center gap-1">
                            <span className="text-amber-600 font-medium">대기</span>
                            <span className="font-semibold text-slate-700">{ws.pending}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-emerald-600 font-medium">완료</span>
                            <span className="font-semibold text-slate-700">{ws.done}</span>
                          </div>
                          {avgR != null && (
                            <div className="flex items-center gap-1 ml-auto">
                              <span className="text-amber-500">★</span>
                              <span className="font-semibold text-slate-700">{avgR}</span>
                              <span className="text-slate-400">({ws.ratingCount})</span>
                            </div>
                          )}
                        </div>
                        {ws.pending > 3 && (
                          <div className="mt-2">
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-red-50 text-red-600">과부하 주의</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* 업무 상세 헤더 */}
              <div className="shrink-0 px-6 py-4 bg-white border-b border-slate-200">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedTaskId(null)}
                        className="text-slate-400 hover:text-slate-600 text-sm"
                        title="업무 목록으로"
                      >
                        ←
                      </button>
                      <h2 className="text-base font-semibold text-slate-800">{selectedTask.content}</h2>
                    </div>
                    {selectedTask.content_th && (
                      <p className="text-xs text-slate-500 mt-1 ml-6">🇹🇭 {selectedTask.content_th}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(() => {
                      const msgSla = getMessageSla(selectedTask, now);
                      const ageSla = getTaskAgeSla(selectedTask, now);
                      return (
                        <>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${SLA_CONFIG[msgSla].classes}`}>
                            응답 {SLA_CONFIG[msgSla].emoji}
                          </span>
                          {selectedTask.status === 'pending' && ageSla !== 'green' && (
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${SLA_CONFIG[ageSla].classes}`}>
                              체류 {SLA_CONFIG[ageSla].emoji}
                            </span>
                          )}
                        </>
                      );
                    })()}
                    {selectedTask.status === 'done' ? (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">완료</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">대기</span>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs text-slate-500 ml-6">
                  <span>고객사: {selectedTask.clients?.name || '-'}</span>
                  <span className="text-slate-300">|</span>
                  <span className="inline-flex items-center gap-1">
                    담당:
                    {(() => {
                      const ws = workerStatuses[selectedTask.assignee_id] || 'offline';
                      const b = WORKER_STATUS_BADGE[ws] || WORKER_STATUS_BADGE.offline;
                      return <span className={`${b.classes} px-1 rounded text-[10px] ml-0.5`}>{b.icon} {b.label}</span>;
                    })()}
                    <span className="ml-0.5">{selectedTask.profiles?.display_name || selectedTask.profiles?.email || '-'}</span>
                  </span>
                  <span className="text-slate-300">|</span>
                  <span>{new Date(selectedTask.created_at).toLocaleString('ko-KR')}</span>
                  {selectedTask.status === 'pending' && (
                    <>
                      <span className="text-slate-300">|</span>
                      <span className="text-amber-600">{formatDuration(now - new Date(selectedTask.created_at).getTime())} 경과</span>
                    </>
                  )}
                  {selectedTask.rating != null && (
                    <>
                      <span className="text-slate-300">|</span>
                      <span className="text-amber-600">★ {selectedTask.rating}</span>
                    </>
                  )}
                </div>
              </div>

              {/* 채팅 메시지 영역 */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
                {messagesLoading && <p className="text-xs text-slate-400 text-center mt-8">메시지 로딩 중...</p>}
                {!messagesLoading && messages.length === 0 && (
                  <p className="text-xs text-slate-400 text-center mt-8">메시지가 없습니다</p>
                )}
                {messages.map(m => {
                  const isMine = m.sender_id === user.id;
                  const isWhisperMsg = m.is_whisper === true;

                  return (
                    <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[75%] rounded-lg px-3 py-2 ${
                          isWhisperMsg
                            ? 'bg-purple-700 text-white'
                            : isMine
                              ? 'bg-emerald-500 text-white'
                              : 'bg-white border border-slate-200 text-slate-800'
                        }`}
                      >
                        {isWhisperMsg && (
                          <div className="flex items-center gap-1 mb-1">
                            <span className="text-[10px] font-medium text-purple-200 bg-purple-800 px-1.5 py-0.5 rounded">
                              🔒 본사 지시
                            </span>
                          </div>
                        )}
                        <p className="text-sm">{m.content_ko || m.content}</p>
                        {m.content_th && m.content_th !== m.content_ko && (
                          <p className={`text-[10px] mt-0.5 ${
                            isWhisperMsg ? 'text-purple-300' : isMine ? 'text-emerald-200' : 'text-slate-400'
                          }`}>
                            🇹🇭 {m.content_th}
                          </p>
                        )}
                        <p
                          className={`text-[10px] mt-1 ${
                            isWhisperMsg
                              ? 'text-purple-300'
                              : isMine
                                ? 'text-emerald-200'
                                : 'text-slate-300'
                          }`}
                        >
                          {new Date(m.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>

              {/* 메시지 입력 */}
              <div className="shrink-0 px-6 py-4 bg-white border-t border-slate-200">
                <div className="flex items-center gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setIsWhisper(!isWhisper)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                      isWhisper
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {isWhisper ? '🔒 본사 지시 모드' : '💬 일반 메시지'}
                  </button>
                  {isWhisper && (
                    <span className="text-xs text-purple-600">이 메시지는 담당 직원에게만 보입니다</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendMessage())}
                    placeholder={isWhisper ? '본사 지시 입력...' : '한국어로 메시지 입력...'}
                    className={`flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 outline-none ${
                      isWhisper
                        ? 'border-purple-300 focus:ring-purple-400 bg-purple-50'
                        : 'border-slate-200 focus:ring-emerald-400'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={sendMessage}
                    disabled={sending || !input.trim()}
                    className={`px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 ${
                      isWhisper
                        ? 'bg-purple-600 text-white hover:bg-purple-700'
                        : 'bg-emerald-500 text-white hover:bg-emerald-600'
                    }`}
                  >
                    {sending ? '...' : '전송'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
