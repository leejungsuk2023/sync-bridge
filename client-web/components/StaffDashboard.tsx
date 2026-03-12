'use client';

import { useEffect, useState } from 'react';
import { Lock, Loader2, ChevronDown, CheckCircle, MessageCircle, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import dynamic from 'next/dynamic';
import TaskChat from './TaskChat';

const ChatLayout = dynamic(() => import('./ChatLayout'), { ssr: false });
const MessagingLayout = dynamic(() => import('./MessagingLayout'), { ssr: false });

type Tab = '내가 지시한 업무' | '나에게 온 업무' | '채팅' | '상담';

// ----------------------------------------------------------------
// StaffTaskAssign: staff 전용 업무 할당 폼
// ----------------------------------------------------------------
function StaffTaskAssign({ onCreated }: { onCreated: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<any[]>([]);
  const [assigneeId, setAssigneeId] = useState('');
  const [content, setContent] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [previewDesc, setPreviewDesc] = useState('');

  useEffect(() => {
    const fetchAssignable = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/assignable-users', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAssignableUsers(data.users || []);
      }
    };
    fetchAssignable();
  }, []);

  const selectedUser = assignableUsers.find((u) => u.id === assigneeId);
  const isWorker = selectedUser?.role === 'worker';

  const koreanStaff = assignableUsers.filter((u) => u.role === 'staff');
  const thaiWorkers = assignableUsers.filter((u) => u.role === 'worker');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigneeId || !content.trim()) {
      setError('담당자와 업무 내용을 입력해 주세요.');
      return;
    }
    setLoading(true);
    setError('');
    setPreview('');
    setPreviewDesc('');

    let contentTh = '';
    let descriptionTh = '';

    // Only translate to Thai when assigning to a Thai worker
    if (isWorker) {
      try {
        const res = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: content.trim(), targetLang: 'th' }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError('번역 실패: ' + (data.error || '알 수 없는 오류'));
          setLoading(false);
          return;
        }
        contentTh = data.translated || '';
        setPreview(contentTh);
      } catch (err: any) {
        setError('번역 요청 실패: ' + err.message);
        setLoading(false);
        return;
      }

      if (description.trim()) {
        try {
          const res = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: description.trim(), targetLang: 'th' }),
          });
          const data = await res.json();
          if (!res.ok) {
            setError('상세 가이드 번역 실패: ' + (data.error || '알 수 없는 오류'));
            setLoading(false);
            return;
          }
          descriptionTh = data.translated || '';
          setPreviewDesc(descriptionTh);
        } catch (err: any) {
          setError('상세 가이드 번역 요청 실패: ' + err.message);
          setLoading(false);
          return;
        }
      }
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const insertData: any = {
        assignee_id: assigneeId,
        content: content.trim(),
        content_th: contentTh,
        status: 'pending',
      };
      if (description.trim()) {
        insertData.description = description.trim();
        if (descriptionTh) insertData.description_th = descriptionTh;
      }
      if (dueDate) insertData.due_date = new Date(dueDate).toISOString();

      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify(insertData),
      });
      const result = await res.json();
      setLoading(false);
      if (!res.ok) {
        setError(result.error || '업무 할당 실패');
        return;
      }
    } catch (err: any) {
      setLoading(false);
      setError(err.message);
      return;
    }

    setContent('');
    setDescription('');
    setAssigneeId('');
    setPreview('');
    setPreviewDesc('');
    setDueDate('');
    onCreated();
    alert('업무가 할당되었습니다.');
  };

  return (
    <div className="bg-gradient-to-r from-emerald-50/70 to-white rounded-xl shadow-sm border border-emerald-100 border-l-4 border-l-emerald-400 p-4 sm:p-6">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between cursor-pointer"
      >
        <h2 className="text-lg font-semibold text-slate-900">업무 할당</h2>
        <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
      </button>
      {!collapsed && (
        <form onSubmit={handleSubmit} className="mt-4">
          {/* Row 1: 담당자 + 마감일 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">담당자</label>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow bg-white"
                required
              >
                <option value="">선택하세요</option>
                {koreanStaff.length > 0 && (
                  <optgroup label="한국 직원">
                    {koreanStaff.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.display_name || u.email}
                        {u.relationship === 'peer' ? ' (동급)' : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
                {thaiWorkers.length > 0 && (
                  <optgroup label="태국 직원">
                    {thaiWorkers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.display_name || u.email}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                마감일시 <span className="text-slate-400">(선택)</span>
              </label>
              <input
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow"
              />
            </div>
          </div>

          {/* Row 2: 업무 제목 + 버튼 */}
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end mb-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-600 mb-1">
                업무 제목
                {isWorker && <span className="text-slate-400 ml-1">(한국어 → 태국어 자동번역)</span>}
              </label>
              <input
                type="text"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="예: 페이스북 이벤트 게시글 업로드"
                className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading || assignableUsers.length === 0}
              className="w-full sm:w-auto shrink-0 h-10 px-6 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  할당 중...
                </>
              ) : (
                '업무 할당'
              )}
            </button>
          </div>

          {/* Row 3: 상세 가이드 */}
          <div className="mb-3">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              상세 가이드 <span className="text-slate-400">(선택사항{isWorker ? ', 태국어 자동번역' : ''})</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="예: 오후 2시까지 완료, 이미지 3장 포함"
              rows={3}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg resize-none text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow"
            />
          </div>

          {(preview || previewDesc) && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs font-medium text-amber-900 mb-1">태국어 번역 미리보기</p>
              {preview && <p className="text-sm text-amber-800 font-medium">{preview}</p>}
              {previewDesc && <p className="text-sm text-amber-800 mt-1">{previewDesc}</p>}
            </div>
          )}

          {error && (
            <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
              {error}
            </div>
          )}
          {assignableUsers.length === 0 && (
            <p className="mt-3 text-sm text-amber-600">할당 가능한 직원이 없습니다.</p>
          )}
        </form>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// StaffTaskList: view 파라미터 기반 업무 목록
// ----------------------------------------------------------------
function StaffTaskList({
  view,
  userId,
  title,
  showComplete = false,
  refreshKey,
}: {
  view: 'assigned_by_me' | 'assigned_to_me' | 'all';
  userId: string;
  title: string;
  showComplete?: boolean;
  refreshKey?: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [chatTaskId, setChatTaskId] = useState<string | null>(null);

  const fetchTasks = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/tasks?view=${view}`, {
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    const data = await res.json();
    setTasks(data.tasks || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchTasks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, refreshKey]);

  useEffect(() => {
    const channel = supabase
      .channel(`staff_tasks_${view}_${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, fetchTasks)
      .subscribe();
    return () => { channel.unsubscribe(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, userId]);

  const completeTask = async (taskId: string) => {
    if (!confirm('이 업무를 완료 처리하시겠습니까?')) return;
    const { data: { session } } = await supabase.auth.getSession();
    await fetch('/api/tasks', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ id: taskId, status: 'done' }),
    });
  };

  const pendingTasks = tasks.filter((t) => t.status !== 'done');
  const doneTasks = tasks.filter((t) => t.status === 'done');

  const getRequestTypeBadge = (task: any) => {
    if (task.request_type === 'cooperation') {
      return (
        <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
          협조요청
        </span>
      );
    }
    if (task.request_type === 'directive') {
      return (
        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
          업무지시
        </span>
      );
    }
    return null;
  };

  return (
    <div className="bg-gradient-to-r from-amber-50/70 to-white rounded-xl shadow-sm border border-amber-100 border-l-4 border-l-amber-400 p-4 sm:p-6">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between cursor-pointer"
      >
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <div className="flex items-center gap-3">
          {!collapsed && doneTasks.length > 0 && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); setShowDone(!showDone); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setShowDone(!showDone); } }}
              className="text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
            >
              {showDone ? `완료 ${doneTasks.length}건 숨기기` : `완료 ${doneTasks.length}건 보기`}
            </span>
          )}
          <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
        </div>
      </button>

      {!collapsed && (
        loading ? (
          <p className="text-center text-slate-500 py-12 mt-6">불러오는 중...</p>
        ) : pendingTasks.length === 0 && !showDone ? (
          <p className="text-center text-slate-500 py-12 mt-6">진행 중인 업무가 없습니다.</p>
        ) : (
          <div className="space-y-4 max-h-[800px] overflow-y-auto pr-2 mt-6">
            {[...pendingTasks, ...(showDone ? doneTasks : [])].map((task) => (
              <div key={task.id} className="border border-slate-200 rounded-lg p-3 sm:p-4 space-y-3">
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-slate-900">{task.content}</p>
                      {getRequestTypeBadge(task)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 flex-wrap">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      task.status === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {task.status === 'done' ? '완료' : '대기'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setChatTaskId(chatTaskId === task.id ? null : task.id)}
                      className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-medium transition-colors ${
                        chatTaskId === task.id
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'text-blue-600 border border-blue-300 hover:bg-blue-50'
                      }`}
                    >
                      <MessageCircle className="w-3 h-3" />
                      채팅
                    </button>
                    {task.status === 'pending' && showComplete && (
                      <button
                        type="button"
                        onClick={() => completeTask(task.id)}
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs text-emerald-600 border border-emerald-300 hover:bg-emerald-50 transition-colors"
                      >
                        <CheckCircle className="w-3 h-3" />
                        완료
                      </button>
                    )}
                  </div>
                </div>

                {/* Description */}
                {task.description && (
                  <div className="bg-blue-50 border border-blue-100 rounded p-3">
                    <p className="text-xs font-medium text-blue-900 mb-1">상세 가이드</p>
                    <p className="text-sm text-blue-800 whitespace-pre-wrap">{task.description}</p>
                  </div>
                )}

                {/* Thai translation (for worker tasks) */}
                {task.content_th && task.content_th !== task.content && (
                  <div className="bg-slate-50 border border-slate-200 rounded p-2.5">
                    <p className="text-xs text-slate-600 flex items-center gap-1.5">
                      <span>🇹🇭</span>
                      <span className="font-medium">{task.content_th}</span>
                    </p>
                  </div>
                )}

                {/* Metadata */}
                <div className="flex items-center gap-1.5 sm:gap-2 text-xs text-slate-500 flex-wrap">
                  {view === 'assigned_by_me' && task.profiles && (
                    <>
                      <span>담당: {task.profiles.display_name || task.profiles.email}</span>
                      <span>·</span>
                    </>
                  )}
                  {view === 'assigned_to_me' && task.assigner && (
                    <>
                      <span>지시: {task.assigner.display_name || task.assigner.email}</span>
                      <span>·</span>
                    </>
                  )}
                  {view === 'all' && (
                    <>
                      {task.assigner && <span>지시: {task.assigner.display_name || task.assigner.email}</span>}
                      {task.assigner && task.profiles && <span>·</span>}
                      {task.profiles && <span>담당: {task.profiles.display_name || task.profiles.email}</span>}
                      {(task.assigner || task.profiles) && <span>·</span>}
                    </>
                  )}
                  <span>{new Date(task.created_at).toLocaleString('ko-KR')}</span>
                  {task.due_date && (
                    <>
                      <span>·</span>
                      <span>마감 {new Date(task.due_date).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}</span>
                    </>
                  )}
                </div>

                {/* Inline chat */}
                {chatTaskId === task.id && (
                  <div className="mt-4 border-t border-slate-200 pt-4">
                    <TaskChat taskId={task.id} userId={userId} onClose={() => setChatTaskId(null)} locale="ko" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// AdminDirectiveTable: bbg_admin 지시현황 테이블 (별도 export)
// ----------------------------------------------------------------
export function AdminDirectiveTable() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAssigner, setFilterAssigner] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  useEffect(() => {
    const fetchAll = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/tasks?view=all', {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const data = await res.json();
      setTasks(data.tasks || []);
      setLoading(false);
    };
    fetchAll();
  }, []);

  const assigners = Array.from(new Map(
    tasks
      .filter((t) => t.assigner)
      .map((t) => [t.assigner.id, t.assigner])
  ).values());
  const assignees = Array.from(new Map(
    tasks
      .filter((t) => t.profiles)
      .map((t) => [t.profiles.id, t.profiles])
  ).values());

  const filtered = tasks.filter((t) => {
    if (filterAssigner && t.assigner?.id !== filterAssigner) return false;
    if (filterAssignee && t.profiles?.id !== filterAssignee) return false;
    if (filterStatus && t.status !== filterStatus) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={filterAssigner}
          onChange={(e) => setFilterAssigner(e.target.value)}
          className="h-9 px-3 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
        >
          <option value="">지시자 전체</option>
          {assigners.map((a: any) => (
            <option key={a.id} value={a.id}>{a.display_name || a.email}</option>
          ))}
        </select>
        <select
          value={filterAssignee}
          onChange={(e) => setFilterAssignee(e.target.value)}
          className="h-9 px-3 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
        >
          <option value="">수행자 전체</option>
          {assignees.map((a: any) => (
            <option key={a.id} value={a.id}>{a.display_name || a.email}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="h-9 px-3 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
        >
          <option value="">상태 전체</option>
          <option value="pending">대기</option>
          <option value="done">완료</option>
        </select>
      </div>

      {loading ? (
        <p className="text-center text-slate-500 py-12">불러오는 중...</p>
      ) : filtered.length === 0 ? (
        <p className="text-center text-slate-500 py-12">지시된 업무가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 px-3 text-xs font-semibold text-slate-600">지시자</th>
                <th className="text-left py-3 px-3 text-xs font-semibold text-slate-600">수행자</th>
                <th className="text-left py-3 px-3 text-xs font-semibold text-slate-600">업무내용</th>
                <th className="text-left py-3 px-3 text-xs font-semibold text-slate-600">유형</th>
                <th className="text-left py-3 px-3 text-xs font-semibold text-slate-600">상태</th>
                <th className="text-left py-3 px-3 text-xs font-semibold text-slate-600">날짜</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((task) => (
                <tr key={task.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3 px-3 text-slate-700">
                    {task.assigner?.display_name || task.assigner?.email || '-'}
                  </td>
                  <td className="py-3 px-3 text-slate-700">
                    {task.profiles?.display_name || task.profiles?.email || '-'}
                  </td>
                  <td className="py-3 px-3 text-slate-900 max-w-xs truncate" title={task.content}>
                    {task.content}
                  </td>
                  <td className="py-3 px-3">
                    {task.request_type === 'cooperation' ? (
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">협조요청</span>
                    ) : task.request_type === 'directive' ? (
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">업무지시</span>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      task.status === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {task.status === 'done' ? '완료' : '대기'}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-slate-500 whitespace-nowrap">
                    {new Date(task.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// StaffDashboard: main export
// ----------------------------------------------------------------
export default function StaffDashboard({ user, profile }: { user: any; profile: any }) {
  const [activeTab, setActiveTab] = useState<Tab>('내가 지시한 업무');
  const [refreshKey, setRefreshKey] = useState(0);

  // Password change modal
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);

  const openPasswordModal = () => {
    setPwCurrent('');
    setPwNew('');
    setPwConfirm('');
    setPwError('');
    setPwSuccess(false);
    setShowPasswordModal(true);
  };

  const handlePasswordChange = async () => {
    setPwError('');
    if (!pwCurrent || !pwNew || !pwConfirm) {
      setPwError('모든 필드를 입력해주세요.');
      return;
    }
    if (pwNew !== pwConfirm) {
      setPwError('새 비밀번호가 일치하지 않습니다.');
      return;
    }
    if (pwNew.length < 6) {
      setPwError('새 비밀번호는 최소 6자 이상이어야 합니다.');
      return;
    }
    setPwLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setPwError('세션이 만료되었습니다. 다시 로그인해주세요.'); return; }
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNew }),
      });
      const data = await res.json();
      if (!res.ok) { setPwError(data.error || '비밀번호 변경에 실패했습니다.'); return; }
      setPwSuccess(true);
      console.log('[ChangePassword] Password changed successfully');
    } catch (err) {
      console.error('[ChangePassword] Error:', err);
      setPwError('오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setPwLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const getHierarchyBadge = (level: number | null) => {
    if (level === null || level === undefined) return null;
    if (level <= 10) return <span className="px-2.5 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">임원</span>;
    if (level <= 20) return <span className="px-2.5 py-1 bg-indigo-100 text-indigo-700 text-xs font-medium rounded-full">부장</span>;
    if (level <= 30) return <span className="px-2.5 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">과장</span>;
    if (level <= 40) return <span className="px-2.5 py-1 bg-sky-100 text-sky-700 text-xs font-medium rounded-full">대리</span>;
    return <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded-full">직원</span>;
  };

  const tabs: Tab[] = ['내가 지시한 업무', '나에게 온 업무', '채팅', '상담'];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
          <h1 className="text-base sm:text-lg font-semibold text-slate-900">SyncBridge</h1>
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <span className="text-xs sm:text-sm text-slate-600 truncate max-w-[120px] sm:max-w-none">
              {profile?.display_name || profile?.email || user.email}
            </span>
            {getHierarchyBadge(profile?.hierarchy_level)}
            <span className="px-2 py-0.5 sm:px-2.5 sm:py-1 bg-orange-100 text-orange-700 text-xs font-medium rounded-full whitespace-nowrap">
              한국 직원
            </span>
            <button
              onClick={openPasswordModal}
              className="text-xs sm:text-sm text-slate-500 hover:text-slate-700 transition-colors flex items-center gap-1 whitespace-nowrap"
              title="비밀번호 변경"
            >
              <Lock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">비밀번호</span>
            </button>
            <button
              onClick={handleLogout}
              className="text-xs sm:text-sm text-slate-500 hover:text-slate-700 transition-colors whitespace-nowrap"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      {/* Password Change Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">비밀번호 변경</h2>
            {pwSuccess ? (
              <div className="space-y-4">
                <p className="text-sm text-emerald-600 font-medium">비밀번호가 성공적으로 변경되었습니다.</p>
                <button
                  onClick={() => setShowPasswordModal(false)}
                  className="w-full py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
                >
                  닫기
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">현재 비밀번호</label>
                  <input
                    type="password"
                    value={pwCurrent}
                    onChange={(e) => setPwCurrent(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    placeholder="현재 비밀번호 입력"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">새 비밀번호</label>
                  <input
                    type="password"
                    value={pwNew}
                    onChange={(e) => setPwNew(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    placeholder="새 비밀번호 (최소 6자)"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">새 비밀번호 확인</label>
                  <input
                    type="password"
                    value={pwConfirm}
                    onChange={(e) => setPwConfirm(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    placeholder="새 비밀번호 재입력"
                    onKeyDown={(e) => e.key === 'Enter' && handlePasswordChange()}
                  />
                </div>
                {pwError && <p className="text-xs text-red-500">{pwError}</p>}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => setShowPasswordModal(false)}
                    className="flex-1 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    취소
                  </button>
                  <button
                    onClick={handlePasswordChange}
                    disabled={pwLoading}
                    className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                  >
                    {pwLoading ? '변경 중...' : '변경'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Desktop Tab Bar */}
      <div className="hidden md:flex px-4 sm:px-6 border-b border-slate-200 bg-white">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              'relative px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab
                ? 'text-blue-600 border-blue-600'
                : 'text-slate-500 border-transparent hover:text-slate-700',
            ].join(' ')}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <main className="flex-1 px-4 sm:px-6 py-4 pb-20 md:pb-6 space-y-4 overflow-y-auto">
        {activeTab === '내가 지시한 업무' && (
          <>
            <StaffTaskAssign onCreated={() => setRefreshKey((k) => k + 1)} />
            <StaffTaskList
              view="assigned_by_me"
              userId={user.id}
              title="내가 지시한 업무"
              refreshKey={refreshKey}
            />
          </>
        )}

        {activeTab === '나에게 온 업무' && (
          <>
            {!profile?.client_id && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
                client_id가 설정되지 않아 일부 기능이 제한될 수 있습니다.
              </div>
            )}
            <StaffTaskList
              view="assigned_to_me"
              userId={user.id}
              title="나에게 온 업무"
              showComplete
              refreshKey={refreshKey}
            />
          </>
        )}

        {activeTab === '채팅' && (
          <>
            {!profile?.client_id ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
                채팅을 사용하려면 client_id가 필요합니다. 관리자에게 문의해주세요.
              </div>
            ) : (
              <ChatLayout userId={user.id} clientId={profile.client_id} locale="ko" assigneeId={user.id} />
            )}
          </>
        )}

        {activeTab === '상담' && (
          <MessagingLayout userRole={profile?.role || 'staff'} userId={user.id} locale="ko" />
        )}
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-10 flex">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              'relative flex-1 py-3 text-[10px] font-medium transition-colors leading-tight px-1',
              activeTab === tab
                ? 'text-blue-600'
                : 'text-slate-500 hover:text-slate-700',
            ].join(' ')}
          >
            {tab}
          </button>
        ))}
      </nav>
    </div>
  );
}
