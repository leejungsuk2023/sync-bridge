import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, proposeTask } from './lib/supabase';
import { storage, sendMessage as platformSendMessage } from './lib/platform';

const WEB_URL = import.meta.env.VITE_WEB_URL || 'http://localhost:3000';

const STATUS_OPTIONS = [
  { value: 'online', label: 'เข้างาน (출근)', badge: 'bg-emerald-500', text: 'text-white' },
  { value: 'away', label: 'ไม่อยู่ (자리비움)', badge: 'bg-amber-400', text: 'text-slate-800' },
  { value: 'offline', label: 'เลิกงาน (퇴근)', badge: 'bg-slate-400', text: 'text-white' },
];

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoadingSubmit, setAuthLoadingSubmit] = useState(false);
  const [authMode, setAuthMode] = useState(null);

  const [status, setStatus] = useState('online');
  const [statusStartedAt, setStatusStartedAt] = useState(() => Date.now());
  const [statusRestored, setStatusRestored] = useState(false);
  const [displaySeconds, setDisplaySeconds] = useState(0);
  const [timeLogError, setTimeLogError] = useState('');
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [avgRating, setAvgRating] = useState(null);
  const [toast, setToast] = useState(null);
  const [expandedTaskId, setExpandedTaskId] = useState(null);

  // 채팅
  const [chatTaskId, setChatTaskId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [msgInput, setMsgInput] = useState('');
  const [msgSending, setMsgSending] = useState(false);
  const chatEndRef = useRef(null);

  // 업무 제안
  const [showProposeForm, setShowProposeForm] = useState(false);
  const [proposeContent, setProposeContent] = useState('');
  const [proposeSubmitting, setProposeSubmitting] = useState(false);
  const [proposeError, setProposeError] = useState('');

  // 번역 헬퍼 + AI Assist
  const [thaiInput, setThaiInput] = useState('');
  const [koreanResult, setKoreanResult] = useState('');
  const [translating, setTranslating] = useState(false);
  const [translateMode, setTranslateMode] = useState('translate'); // 'translate' | 'ai'
  const [aiResult, setAiResult] = useState(null); // { translation_ko, intent, replies }
  const [aiLoading, setAiLoading] = useState(false);

  // 현재 탭
  const [activeTab, setActiveTab] = useState('tasks'); // tasks | chat | translate | templates

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) {
        storage.remove([
          'syncbridge_userId', 'syncbridge_accessToken',
          'syncbridge_url', 'syncbridge_anonKey', 'syncbridge_lastStatus', 'syncbridge_statusStartedAt',
        ]);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSignIn = async (e) => {
    e.preventDefault();
    setAuthError('');
    const te = email.trim(), tp = password.trim();
    if (!te || !tp) { setAuthError('กรุณากรอกอีเมลและรหัสผ่าน (이메일과 비밀번호를 입력해 주세요)'); return; }
    setAuthLoadingSubmit(true);
    const { error } = await supabase.auth.signInWithPassword({ email: te, password: tp });
    setAuthLoadingSubmit(false);
    if (error) setAuthError(error.message);
  };

  const handleSignUp = async (e) => {
    e.preventDefault();
    setAuthError('');
    const te = email.trim(), tp = password.trim();
    if (!te || !tp) { setAuthError('กรุณากรอกอีเมลและรหัสผ่าน (이메일과 비밀번호를 입력해 주세요)'); return; }
    if (tp.length < 6) { setAuthError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร (비밀번호는 6자 이상)'); return; }
    setAuthLoadingSubmit(true);
    const { data, error } = await supabase.auth.signUp({ email: te, password: tp });
    setAuthLoadingSubmit(false);
    if (error) { setAuthError(error.message); return; }
    if (data?.user?.identities?.length === 0) { setAuthError('อีเมลนี้ลงทะเบียนแล้ว กรุณาเข้าสู่ระบบ (이미 가입된 이메일)'); return; }
    showToast('ลงทะเบียนสำเร็จ (가입 완료)');
  };

  useEffect(() => {
    if (!user) return;
    const ensureProfile = async () => {
      const { data: profile, error: selErr } = await supabase.from('profiles').select('id').eq('id', user.id).single();
      if (selErr && selErr.code !== 'PGRST116') return;
      if (!profile) {
        await supabase.from('profiles').insert({
          id: user.id, role: 'worker', email: user.email, display_name: user.email.split('@')[0],
        });
      }
    };
    ensureProfile();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token) return;
      storage.set({
        syncbridge_userId: user.id, syncbridge_accessToken: session.access_token,
        syncbridge_url: import.meta.env.VITE_SUPABASE_URL, syncbridge_anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        syncbridge_webUrl: import.meta.env.VITE_WEB_URL || 'http://localhost:3000',
      });
    });
  }, [user]);

  // 앱 열릴 때 저장된 상태/시작 시간 복원 (storage → DB fallback)
  useEffect(() => {
    if (!user) return;
    const restore = async () => {
      const data = await storage.get(['syncbridge_lastStatus', 'syncbridge_statusStartedAt']);
      let savedStatus = data?.syncbridge_lastStatus;
      let savedStartedAt = data?.syncbridge_statusStartedAt;

      // storage에 시작 시간 없으면 DB에서 마지막 time_log로 복원
      if (!savedStartedAt || typeof savedStartedAt !== 'number') {
        const { data: logs } = await supabase
          .from('time_logs')
          .select('status, created_at')
          .eq('worker_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1);
        if (logs?.[0]) {
          savedStatus = savedStatus || logs[0].status;
          savedStartedAt = new Date(logs[0].created_at).getTime();
          storage.set({ syncbridge_lastStatus: savedStatus, syncbridge_statusStartedAt: savedStartedAt });
        }
      }

      if (savedStatus) setStatus(savedStatus);
      if (savedStartedAt) setStatusStartedAt(savedStartedAt);
      setStatusRestored(true);
    };
    restore();
  }, [user]);

  // 상태 변경 시 storage에 저장
  useEffect(() => {
    if (!user || !statusRestored) return;
    storage.set({ syncbridge_lastStatus: status });
  }, [user, status, statusRestored]);

  useEffect(() => {
    const iv = setInterval(() => setDisplaySeconds(Math.floor((Date.now() - statusStartedAt) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [statusStartedAt]);

  const handleStatusChange = useCallback(async (newStatus) => {
    const now = Date.now();
    setStatus(newStatus);
    setStatusStartedAt(now);
    setTimeLogError('');
    if (!user) return;
    const { error } = await supabase.from('time_logs').insert({ worker_id: user.id, status: newStatus });
    if (error) setTimeLogError(error.message);
    storage.set({ syncbridge_lastStatus: newStatus, syncbridge_statusStartedAt: now });
  }, [user]);

  const fetchTasks = useCallback(async () => {
    if (!user) return;
    setTasksLoading(true);
    const { data, error } = await supabase
      .from('tasks').select('id, content, content_th, status, source, created_at, due_date')
      .eq('assignee_id', user.id).order('created_at', { ascending: false });
    setTasksLoading(false);
    if (!error) setTasks(data || []);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    fetchTasks();
    const channel = supabase
      .channel('tasks_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `assignee_id=eq.${user.id}` }, () => {
        fetchTasks();
        platformSendMessage({ type: 'task_updated' });
      })
      .subscribe();
    return () => channel.unsubscribe();
  }, [user, fetchTasks]);

  const fetchTemplates = useCallback(async () => {
    const { data } = await supabase
      .from('quick_replies')
      .select('id, title_th, title_ko, body_th, body_ko')
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });
    setTemplates((data || []).map((t) => ({ ...t, title: t.title_th || t.title_ko, body: t.body_th || t.body_ko })));
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchTemplates();
  }, [user, fetchTemplates]);

  const fetchAvgRating = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('tasks').select('rating').eq('assignee_id', user.id).not('rating', 'is', null);
    if (data?.length > 0) {
      const sum = data.reduce((a, t) => a + t.rating, 0);
      setAvgRating(Math.round((sum / data.length) * 10) / 10);
    } else setAvgRating(null);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    fetchAvgRating();
  }, [user, fetchAvgRating]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel('rating_changes').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `assignee_id=eq.${user.id}` }, fetchAvgRating).subscribe();
    return () => ch.unsubscribe();
  }, [user, fetchAvgRating]);

  const handleTaskDone = async (taskId) => {
    const { error } = await supabase.from('tasks').update({ status: 'done' }).eq('id', taskId);
    if (!error) { showToast('เสร็จแล้ว ✓ (완료)'); fetchTasks(); }
  };

  // ── 업무 제안 ──
  const hasPendingClientTasks = tasks.some((t) => t.status === 'pending' && t.source !== 'worker_proposed');

  const handlePropose = async () => {
    const text = proposeContent.trim();
    if (!text || !user) return;
    setProposeSubmitting(true);
    setProposeError('');

    let contentKo = '';
    try {
      const res = await fetch(`${WEB_URL}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, targetLang: 'ko' }),
      });
      if (res.ok) {
        const d = await res.json();
        contentKo = d.translated || '';
      }
    } catch { /* 번역 실패해도 등록은 진행 */ }

    const { error } = await proposeTask(user.id, text, contentKo);
    setProposeSubmitting(false);
    if (error) {
      setProposeError(error.message);
      return;
    }
    setProposeContent('');
    setShowProposeForm(false);
    showToast('เสนองานสำเร็จ (업무 제안 완료)');
    fetchTasks();
  };

  // ── 채팅 ──
  const fetchMessages = useCallback(async (taskId) => {
    const { data } = await supabase
      .from('messages').select('*')
      .eq('task_id', taskId).order('created_at', { ascending: true });
    setMessages(data || []);
  }, []);

  const openChat = (taskId) => {
    setChatTaskId(taskId);
    fetchMessages(taskId);
  };

  useEffect(() => {
    if (!chatTaskId) return;
    const ch = supabase
      .channel('msg_' + chatTaskId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `task_id=eq.${chatTaskId}` }, () => {
        fetchMessages(chatTaskId);
      })
      .subscribe();
    return () => ch.unsubscribe();
  }, [chatTaskId, fetchMessages]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const sendChatMessage = async () => {
    if (!msgInput.trim() || !chatTaskId || !user) return;
    setMsgSending(true);
    const original = msgInput.trim();
    setMsgInput('');

    let contentKo = '';
    try {
      const res = await fetch(`${WEB_URL}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: original, targetLang: 'ko' }),
      });
      if (res.ok) {
        const d = await res.json();
        contentKo = d.translated || '';
      }
    } catch { /* 번역 실패해도 메시지는 보냄 */ }

    await supabase.from('messages').insert({
      task_id: chatTaskId,
      sender_id: user.id,
      content: original,
      content_th: original,
      content_ko: contentKo || original,
      sender_lang: 'th',
    });
    setMsgSending(false);
  };

  // ── 번역 헬퍼 ──
  const handleTranslate = async () => {
    if (!thaiInput.trim()) return;
    setTranslating(true);
    setKoreanResult('');
    try {
      const res = await fetch(`${WEB_URL}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: thaiInput.trim(), targetLang: 'ko' }),
      });
      if (res.ok) {
        const d = await res.json();
        setKoreanResult(d.translated || '번역 결과 없음');
      } else {
        const d = await res.json();
        setKoreanResult('แปลไม่สำเร็จ (번역 실패): ' + (d.error || ''));
      }
    } catch (err) {
      setKoreanResult('แปลไม่สำเร็จ (번역 실패): ' + err.message);
    }
    setTranslating(false);
  };

  // ── AI Assist ──
  const handleAiAssist = async () => {
    if (!thaiInput.trim()) return;
    setAiLoading(true);
    setAiResult(null);
    try {
      const res = await fetch(`${WEB_URL}/api/ai-assist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: thaiInput.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiResult(data);
      } else {
        setAiResult({ translation_ko: '분석 실패', intent: '', replies: [] });
      }
    } catch (err) {
      setAiResult({ translation_ko: '분석 실패: ' + err.message, intent: '', replies: [] });
    }
    setAiLoading(false);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => showToast('คัดลอกแล้ว (복사됨)'));
  };

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const currentBadge = STATUS_OPTIONS.find((o) => o.value === status);

  // ── 로딩 ──
  if (authLoading) return <div className="flex items-center justify-center h-screen text-slate-500">กำลังโหลด... (로딩 중...)</div>;

  // ── 미로그인 ──
  if (!user) {
    if (!authMode) {
      return (
        <div className="flex flex-col items-center justify-center h-screen p-6 bg-slate-50">
          <div className="text-2xl font-bold text-slate-800 mb-2">SyncBridge</div>
          <p className="text-sm text-slate-500 mb-8">เครื่องมือเพิ่มประสิทธิภาพงาน CS (CS 업무 효율화 도구)</p>
          <div className="w-full max-w-xs space-y-3">
            <button type="button" onClick={() => { setAuthMode('login'); setAuthError(''); setEmail(''); setPassword(''); }}
              className="w-full py-3 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors">
              เข้าสู่ระบบ (로그인)
            </button>
            <button type="button" onClick={() => { setAuthMode('signup'); setAuthError(''); setEmail(''); setPassword(''); }}
              className="w-full py-3 rounded-lg bg-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-300 transition-colors">
              ลงทะเบียน (회원가입)
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col h-screen p-6 bg-slate-50">
        <button type="button" onClick={() => { setAuthMode(null); setAuthError(''); }} className="self-start text-sm text-slate-500 hover:text-slate-700 mb-4">← ย้อนกลับ (뒤로)</button>
        <h1 className="text-lg font-semibold text-slate-800 mb-6">{authMode === 'login' ? 'เข้าสู่ระบบ (로그인)' : 'ลงทะเบียน (회원가입)'}</h1>
        <form className="space-y-4" onSubmit={authMode === 'login' ? handleSignIn : handleSignUp}>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">อีเมล (이메일)</label>
            <input type="email" placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-400 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">รหัสผ่าน (비밀번호)</label>
            <input type="password" placeholder={authMode === 'signup' ? 'อย่างน้อย 6 ตัวอักษร (6자 이상)' : 'รหัสผ่าน (비밀번호)'}
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-400 outline-none" />
          </div>
          {authError && <p className="text-sm text-red-600">{authError}</p>}
          <button type="submit" disabled={authLoadingSubmit}
            className="w-full py-3 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors">
            {authLoadingSubmit ? 'กำลังดำเนินการ... (처리 중...)' : authMode === 'login' ? 'เข้าสู่ระบบ (로그인)' : 'ลงทะเบียน (회원가입)'}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-500">
          {authMode === 'login' ? 'ยังไม่มีบัญชี? (계정이 없나요?) ' : 'มีบัญชีแล้ว? (이미 계정이 있나요?) '}
          <button type="button" onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setAuthError(''); }}
            className="text-emerald-600 font-medium hover:underline">
            {authMode === 'login' ? 'ลงทะเบียน (회원가입)' : 'เข้าสู่ระบบ (로그인)'}
          </button>
        </p>
        {toast && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm toast-in">{toast}</div>}
      </div>
    );
  }

  // ── 채팅 전체 화면 ──
  if (chatTaskId) {
    const chatTask = tasks.find((t) => t.id === chatTaskId);
    return (
      <div className="flex flex-col h-screen bg-slate-50">
        <header className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-white">
          <button type="button" onClick={() => { setChatTaskId(null); setActiveTab('chat'); }} className="text-sm text-slate-500 hover:text-slate-700">← ย้อนกลับ</button>
          <span className="text-sm font-semibold text-slate-700 truncate flex-1">แชท (채팅)</span>
        </header>
        {chatTask && (
          <div className="shrink-0 px-4 py-2 bg-emerald-50 border-b border-emerald-100">
            <p className="text-xs text-emerald-700 font-medium">งาน: {chatTask.content_th || chatTask.content}</p>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {messages.length === 0 && <p className="text-xs text-slate-400 text-center mt-8">ยังไม่มีข้อความ</p>}
          {messages.map((m) => {
            const isMine = m.sender_id === user.id;
            return (
              <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-2 ${isMine ? 'bg-emerald-500 text-white' : 'bg-white border border-slate-200 text-slate-800'}`}>
                  <p className="text-sm">{m.content_th || m.content}</p>
                  <p className={`text-[10px] mt-1 ${isMine ? 'text-emerald-200' : 'text-slate-300'}`}>
                    {new Date(m.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={chatEndRef} />
        </div>
        <div className="shrink-0 px-4 py-3 border-t border-slate-200 bg-white flex gap-2">
          <input
            value={msgInput}
            onChange={(e) => setMsgInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendChatMessage())}
            placeholder="พิมพ์ข้อความภาษาไทย..."
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-400 outline-none"
          />
          <button type="button" onClick={sendChatMessage} disabled={msgSending || !msgInput.trim()}
            className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-50">
            {msgSending ? '...' : 'ส่ง'}
          </button>
        </div>
        {toast && <div className="fixed bottom-16 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium shadow-lg toast-in">{toast}</div>}
      </div>
    );
  }

  // ── 메인 UI ──
  return (
    <div className="flex flex-col h-screen bg-gradient-to-b from-white to-slate-50">
      <header className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white/80 backdrop-blur-sm">
        <span className="text-lg font-semibold text-slate-700 tracking-tight">SyncBridge</span>
        <div className="flex items-center gap-2">
          <select value={status} onChange={(e) => handleStatusChange(e.target.value)}
            className="text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded-lg px-2 py-1.5 cursor-pointer focus:ring-2 focus:ring-emerald-400 outline-none">
            {STATUS_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${currentBadge.badge} ${currentBadge.text}`}>
            {currentBadge.label.split(' ')[0]}
          </span>
        </div>
      </header>

      <section className="shrink-0 px-4 py-4 bg-white border-b border-slate-200">
        <p className="text-xs font-medium text-slate-500 mb-1">เวลาสถานะปัจจุบัน (현재 상태 지속 시간)</p>
        <p className="text-3xl font-mono font-semibold text-slate-800 tabular-nums">{formatDuration(displaySeconds)}</p>
        {avgRating != null && <p className="mt-1 text-sm text-amber-600">★ {avgRating} (품질 평균)</p>}
        {timeLogError && <p className="mt-1 text-xs text-red-600">{timeLogError}</p>}
      </section>

      {/* 탭 네비게이션 */}
      <div className="shrink-0 flex border-b border-slate-200 bg-white">
        {[
          { key: 'tasks', label: 'งาน' },
          { key: 'chat', label: 'แชท' },
          { key: 'translate', label: 'แปล / AI' },
          { key: 'templates', label: 'เทมเพลต' },
        ].map((tab) => (
          <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${activeTab === tab.key ? 'text-emerald-600 border-b-2 border-emerald-500' : 'text-slate-500 hover:text-slate-700'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'tasks' && (
          <section className="px-4 py-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-slate-700">งานของฉัน (내 업무)</p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => { setShowProposeForm(!showProposeForm); setProposeError(''); }}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                  {showProposeForm ? 'ยกเลิก (취소)' : '+ เสนองาน (제안)'}
                </button>
                <button type="button" onClick={fetchTasks} disabled={tasksLoading} className="text-xs text-slate-500 hover:text-slate-700">
                  รีเฟรช (새로고침)
                </button>
              </div>
            </div>

            {showProposeForm && (
              <div className="mb-3 p-3 rounded-lg border border-indigo-200 bg-indigo-50/50">
                {hasPendingClientTasks && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-2">
                    &#9888;&#65039; มีงานเร่งด่วนจากสำนักงานใหญ่ที่ยังไม่เสร็จ แนะนำให้ทำให้เสร็จก่อน
                    (한국 본사의 긴급 지시사항이 남아있습니다. 먼저 처리하시길 권장합니다.)
                  </p>
                )}
                <textarea
                  value={proposeContent}
                  onChange={(e) => setProposeContent(e.target.value)}
                  placeholder="เขียนงานที่ต้องการเสนอเป็นภาษาไทย... (제안할 업무를 태국어로 입력...)"
                  className="w-full h-16 px-3 py-2 text-sm border border-slate-200 rounded-lg resize-none focus:ring-2 focus:ring-indigo-400 outline-none bg-white"
                  rows={2}
                  autoFocus
                />
                {proposeError && <p className="text-xs text-red-600 mt-1">{proposeError}</p>}
                <button type="button" onClick={handlePropose} disabled={proposeSubmitting || !proposeContent.trim()}
                  className="mt-2 w-full py-2 rounded-lg bg-indigo-500 text-white text-xs font-medium hover:bg-indigo-600 disabled:opacity-50 transition-colors">
                  {proposeSubmitting ? 'กำลังส่ง... (전송 중...)' : 'ส่งข้อเสนอ (제안 등록)'}
                </button>
              </div>
            )}

            {tasksLoading ? (
              <p className="text-sm text-slate-500">กำลังโหลด... (불러오는 중...)</p>
            ) : tasks.length === 0 ? (
              <p className="text-sm text-slate-500">ยังไม่มีงาน (지시된 업무가 없습니다)</p>
            ) : (
              <ul className="space-y-2">
                {tasks.map((t) => (
                  <li key={t.id} className="p-3 rounded-lg border border-slate-200 bg-white">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {t.source === 'worker_proposed' && (
                          <span className="inline-block text-[10px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5 mb-1">
                            เสนอเอง (자체 제안)
                          </span>
                        )}
                        <p className="text-sm text-slate-800">{t.content_th || t.content}</p>
                        {t.content_th && (
                          <button type="button" onClick={() => setExpandedTaskId(expandedTaskId === t.id ? null : t.id)}
                            className="text-xs text-blue-500 hover:underline mt-0.5">
                            {expandedTaskId === t.id ? 'ซ่อนต้นฉบับ (원문 숨기기)' : '🇰🇷 ดูต้นฉบับ (원문 보기)'}
                          </button>
                        )}
                        {expandedTaskId === t.id && t.content_th && (
                          <p className="text-xs text-slate-500 mt-1 bg-slate-50 rounded px-2 py-1">{t.content}</p>
                        )}
                        {t.due_date && (() => {
                          const due = new Date(t.due_date);
                          const now = new Date();
                          const isOverdue = t.status === 'pending' && due < now;
                          const isSoon = t.status === 'pending' && !isOverdue && (due - now) < 3 * 60 * 60 * 1000;
                          return (
                            <p className={`text-xs mt-1 font-medium ${isOverdue ? 'text-red-600' : isSoon ? 'text-amber-600' : 'text-slate-500'}`}>
                              {isOverdue ? '⚠ เลยกำหนด (기한 초과)' : '📅 กำหนดส่ง (마감)'}:{' '}
                              {due.toLocaleDateString('th-TH', { month: 'short', day: 'numeric' })}{' '}
                              {due.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          );
                        })()}
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        {t.status === 'pending' ? (
                          <button type="button" onClick={() => handleTaskDone(t.id)}
                            className="py-1 px-2 rounded bg-emerald-500 text-white text-xs">เสร็จ</button>
                        ) : (
                          <span className="text-xs text-emerald-500">เสร็จแล้ว ✓</span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {activeTab === 'chat' && (
          <section className="px-4 py-4">
            <p className="text-sm font-medium text-slate-700 mb-3">เลือกงานเพื่อแชท (채팅할 업무 선택)</p>
            {tasks.length === 0 ? (
              <p className="text-sm text-slate-500">ยังไม่มีงาน</p>
            ) : (
              <ul className="space-y-2">
                {tasks.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => openChat(t.id)}
                      className="w-full text-left p-3 rounded-lg border border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50 transition-colors">
                      <p className="text-sm text-slate-800 line-clamp-2">{t.content_th || t.content}</p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className={`text-xs ${t.status === 'done' ? 'text-emerald-500' : 'text-amber-500'}`}>
                          {t.status === 'done' ? 'เสร็จแล้ว ✓' : 'รอดำเนินการ'}
                        </span>
                        <span className="text-xs text-blue-500 font-medium">เปิดแชท →</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {activeTab === 'translate' && (
          <section className="px-4 py-4 space-y-3">
            {/* Mode Toggle */}
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              <button type="button" onClick={() => { setTranslateMode('translate'); setAiResult(null); }}
                className={`flex-1 py-2 text-xs font-medium transition-colors ${translateMode === 'translate' ? 'bg-emerald-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                แปลภาษา (번역)
              </button>
              <button type="button" onClick={() => { setTranslateMode('ai'); setKoreanResult(''); }}
                className={`flex-1 py-2 text-xs font-medium transition-colors ${translateMode === 'ai' ? 'bg-indigo-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                AI วิเคราะห์ (AI 분석)
              </button>
            </div>

            <textarea
              placeholder={translateMode === 'translate'
                ? 'พิมพ์ภาษาไทยที่ต้องการแปล (번역할 태국어를 입력)'
                : 'วางข้อความลูกค้าที่นี่ (고객 메시지를 붙여넣기)'}
              value={thaiInput}
              onChange={(e) => setThaiInput(e.target.value)}
              className="w-full h-24 px-3 py-2 text-sm border border-slate-200 rounded-lg resize-none focus:ring-2 focus:ring-emerald-400 outline-none"
              rows={4}
            />

            {translateMode === 'translate' ? (
              <>
                <button type="button" onClick={handleTranslate} disabled={translating || !thaiInput.trim()}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-50">
                  {translating ? 'กำลังแปล... (번역 중...)' : 'แปลเป็นเกาหลี 🔄 (한국어로 번역)'}
                </button>
                <div className="relative">
                  <textarea placeholder="ผลการแปลจะแสดงที่นี่ (번역 결과)" value={koreanResult} readOnly
                    className="w-full h-20 px-3 py-2 pr-20 text-sm border border-slate-200 rounded-lg resize-none bg-slate-50" rows={3} />
                  <button type="button" onClick={() => koreanResult && copyToClipboard(koreanResult)} disabled={!koreanResult}
                    className="absolute right-2 bottom-2 py-1.5 px-2.5 rounded-md bg-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-300 disabled:opacity-50">
                    คัดลอก (복사)
                  </button>
                </div>
              </>
            ) : (
              <>
                <button type="button" onClick={handleAiAssist} disabled={aiLoading || !thaiInput.trim()}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 disabled:opacity-50">
                  {aiLoading ? 'กำลังวิเคราะห์... (분석 중...)' : '🤖 วิเคราะห์ข้อความ (메시지 분석)'}
                </button>

                {aiResult && (
                  <div className="space-y-3">
                    {/* Translation */}
                    <div className="p-3 rounded-lg border border-blue-200 bg-blue-50">
                      <p className="text-xs font-medium text-blue-600 mb-1">🇰🇷 คำแปลเกาหลี (한국어 번역)</p>
                      <p className="text-sm text-slate-800">{aiResult.translation_ko}</p>
                    </div>

                    {/* Intent */}
                    {aiResult.intent && (
                      <div className="p-3 rounded-lg border border-amber-200 bg-amber-50">
                        <p className="text-xs font-medium text-amber-600 mb-1">💡 จุดประสงค์ (의도 분석)</p>
                        <p className="text-sm text-slate-800">{aiResult.intent}</p>
                      </div>
                    )}

                    {/* Reply Suggestions */}
                    {aiResult.replies?.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-slate-600">💬 คำตอบแนะนำ (추천 답변)</p>
                        {aiResult.replies.map((reply, i) => (
                          <button key={i} type="button" onClick={() => copyToClipboard(reply.text)}
                            className="w-full text-left p-3 rounded-lg border border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50 transition-colors group">
                            <p className="text-xs font-medium text-indigo-600 mb-1">{reply.label}</p>
                            <p className="text-sm text-slate-700">{reply.text}</p>
                            <p className="text-[10px] text-slate-400 mt-1 group-hover:text-indigo-400">คลิกเพื่อคัดลอก (클릭하면 복사)</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {activeTab === 'templates' && (
          <section className="px-4 py-4">
            <p className="text-sm font-medium text-slate-700 mb-3">เทมเพลตตอบด่วน (퀵 리플라이 템플릿)</p>
            {templates.length === 0 ? <p className="text-sm text-slate-500">등록된 템플릿이 없습니다. 관리자에게 요청하세요.</p> : (
            <ul className="space-y-2">
              {templates.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-2 p-3 rounded-lg border border-slate-200 bg-white hover:border-slate-300">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">{item.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{item.body}</p>
                  </div>
                  <button type="button" onClick={() => copyToClipboard(item.body)}
                    className="shrink-0 py-1.5 px-2.5 rounded-md bg-slate-100 text-slate-600 text-xs font-medium hover:bg-slate-200">
                    คัดลอก (복사)
                  </button>
                </li>
              ))}
            </ul>
            )}
          </section>
        )}
      </div>

      <div className="shrink-0 px-4 py-2 border-t border-slate-200 flex justify-between items-center bg-white">
        <span className="text-xs text-slate-500">{user.email}</span>
        <button type="button" onClick={() => supabase.auth.signOut()} className="text-xs text-slate-500 hover:text-slate-700">
          ออกจากระบบ (로그아웃)
        </button>
      </div>

      {toast && <div className="fixed bottom-12 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium shadow-lg toast-in">{toast}</div>}
    </div>
  );
}
