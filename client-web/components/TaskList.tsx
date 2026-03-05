'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Star, MessageCircle, Trash2, RotateCcw, Calendar, X, CheckCircle } from 'lucide-react';
import TaskChat from './TaskChat';

export default function TaskList({ clientId, userId, canComplete = false, assigneeId, title, locale = 'ko' }: { clientId?: string; userId: string; canComplete?: boolean; assigneeId?: string; title?: string; locale?: 'ko' | 'th' }) {
  // Locale-aware label map
  const L = locale === 'th' ? {
    defaultTitle: 'รายการงาน',
    loading: 'กำลังโหลด...',
    noTasks: 'ไม่มีงานที่กำลังดำเนินการ',
    showDone: (n: number) => `ดูงานเสร็จแล้ว ${n} รายการ`,
    hideDone: (n: number) => `ซ่อนงานเสร็จแล้ว ${n} รายการ`,
    done: 'เสร็จแล้ว',
    pending: 'รอดำเนินการ',
    chat: 'แชท',
    complete: 'เสร็จ',
    cancel: 'ยกเลิก',
    rate: 'ให้คะแนน',
    quality: 'คุณภาพ:',
    assignedBy: 'มอบหมาย:',
    assignee: 'รับผิดชอบ:',
    confirmDelete: 'ต้องการลบงานนี้หรือไม่? ประวัติแชทจะถูกลบด้วย',
    confirmRevert: 'ต้องการเปลี่ยนงานนี้กลับเป็นกำลังดำเนินการหรือไม่?',
    confirmComplete: 'ต้องการทำเครื่องหมายว่างานนี้เสร็จแล้วหรือไม่?',
    overdue: 'เลยกำหนด',
    duePrefix: 'กำหนดส่ง',
    setDue: 'ตั้งกำหนดส่ง',
    delete: 'ลบ',
  } : {
    defaultTitle: '업무 목록',
    loading: '불러오는 중...',
    noTasks: '진행 중인 업무가 없습니다.',
    showDone: (n: number) => `완료 ${n}건 보기`,
    hideDone: (n: number) => `완료 ${n}건 숨기기`,
    done: '완료',
    pending: '대기',
    chat: '채팅',
    complete: '완료',
    cancel: '취소',
    rate: '평가하기',
    quality: '품질:',
    assignedBy: '할당:',
    assignee: '담당:',
    confirmDelete: '이 업무를 삭제하시겠습니까? 채팅 내역도 함께 삭제됩니다.',
    confirmRevert: '이 업무를 다시 진행 중으로 되돌리시겠습니까?',
    confirmComplete: '이 업무를 완료 처리하시겠습니까?',
    overdue: '기한초과',
    duePrefix: '마감',
    setDue: '기한 설정',
    delete: '삭제',
  };
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatTaskId, setChatTaskId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    const fetchTasks = async () => {
      const session = (await supabase.auth.getSession()).data.session;
      const searchParams = new URLSearchParams();
      if (clientId) searchParams.set('client_id', clientId);
      if (assigneeId) searchParams.set('assignee_id', assigneeId);
      const params = searchParams.toString() ? `?${searchParams.toString()}` : '';
      const res = await fetch(`/api/tasks${params}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const data = await res.json();
      setTasks(data.tasks || []);
      setLoading(false);
    };

    fetchTasks();

    const channelName = `tasks_${assigneeId || clientId || 'all'}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        fetchTasks();
      })
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [clientId, assigneeId]);

  const [ratingTaskId, setRatingTaskId] = useState<string | null>(null);
  const [ratingValue, setRatingValue] = useState<number | null>(null);
  const [editDueDateTaskId, setEditDueDateTaskId] = useState<string | null>(null);

  const submitRating = async (taskId: string, rating: number) => {
    const session = (await supabase.auth.getSession()).data.session;
    const res = await fetch('/api/tasks', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ id: taskId, rating, rated_by: userId, rated_at: new Date().toISOString() }),
    });
    if (!res.ok) console.error('[TaskList] submitRating failed:', await res.text());
    setRatingTaskId(null);
    setRatingValue(null);
  };

  const deleteTask = async (taskId: string) => {
    if (!confirm(L.confirmDelete)) return;
    const session = (await supabase.auth.getSession()).data.session;
    const res = await fetch(`/api/tasks?id=${taskId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    if (!res.ok) {
      console.error('[TaskList] deleteTask failed:', await res.text());
      return;
    }
    setTasks(prev => prev.filter(t => t.id !== taskId));
  };

  const revertTask = async (taskId: string) => {
    if (!confirm(L.confirmRevert)) return;
    const session = (await supabase.auth.getSession()).data.session;
    const res = await fetch('/api/tasks', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ id: taskId, status: 'pending', rating: null, rated_by: null, rated_at: null }),
    });
    if (!res.ok) console.error('[TaskList] revertTask failed:', await res.text());
  };

  const completeTask = async (taskId: string) => {
    if (!confirm(L.confirmComplete)) return;
    const session = (await supabase.auth.getSession()).data.session;
    const res = await fetch('/api/tasks', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ id: taskId, status: 'done' }),
    });
    if (!res.ok) console.error('[TaskList] completeTask failed:', await res.text());
  };

  const updateDueDate = async (taskId: string, newDueDate: string) => {
    const session = (await supabase.auth.getSession()).data.session;
    const res = await fetch('/api/tasks', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ id: taskId, due_date: newDueDate ? new Date(newDueDate).toISOString() : null }),
    });
    if (!res.ok) console.error('[TaskList] updateDueDate failed:', await res.text());
    setEditDueDateTaskId(null);
  };

  const pendingTasks = tasks.filter(t => t.status !== 'done');
  const doneTasks = tasks.filter(t => t.status === 'done');

  const Stars = ({ task }: { task: any }) => {
    if (task.status !== 'done') return null;
    if (task.rating != null) {
      return (
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star
              key={n}
              className={`w-4 h-4 ${n <= task.rating ? 'fill-amber-500 text-amber-500' : 'text-slate-300'}`}
            />
          ))}
        </div>
      );
    }
    if (ratingTaskId !== task.id) {
      return (
        <button
          type="button"
          onClick={() => setRatingTaskId(task.id)}
          className="text-xs text-blue-600 hover:text-blue-700 font-medium"
        >
          {L.rate}
        </button>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star
              key={n}
              className={`w-4 h-4 cursor-pointer transition-colors ${
                n <= (ratingValue ?? 0) ? 'fill-amber-500 text-amber-500' : 'text-slate-300 hover:text-amber-400'
              }`}
              onMouseEnter={() => setRatingValue(n)}
              onMouseLeave={() => setRatingValue(null)}
              onClick={() => submitRating(task.id, n)}
            />
          ))}
        </div>
        <button type="button" onClick={() => setRatingTaskId(null)} className="text-xs text-slate-500 hover:text-slate-700">
          {L.cancel}
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-amber-50/70 to-white rounded-xl shadow-sm border border-amber-100 border-l-4 border-l-amber-400 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-slate-900">{title || L.defaultTitle}</h2>
          {doneTasks.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDone(!showDone)}
              className="text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
            >
              {showDone ? L.hideDone(doneTasks.length) : L.showDone(doneTasks.length)}
            </button>
          )}
        </div>
        {loading ? (
          <p className="text-center text-slate-500 py-12">{L.loading}</p>
        ) : pendingTasks.length === 0 && !showDone ? (
          <p className="text-center text-slate-500 py-12">{L.noTasks}</p>
        ) : (
          <div className="space-y-4 max-h-[800px] overflow-y-auto pr-2">
            {[...pendingTasks, ...(showDone ? doneTasks : [])].map((task) => (
              <div key={task.id} className="border border-slate-200 rounded-lg p-4 space-y-3">
                {/* Content + Status + Chat */}
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm text-slate-900 flex-1">{task.content}</p>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      task.status === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {task.status === 'done' ? L.done : L.pending}
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
                      {L.chat}
                    </button>
                    {task.status === 'pending' && canComplete && (
                      <button
                        type="button"
                        onClick={() => completeTask(task.id)}
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs text-emerald-600 border border-emerald-300 hover:bg-emerald-50 transition-colors"
                      >
                        <CheckCircle className="w-3 h-3" />
                        {L.complete}
                      </button>
                    )}
                    {task.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => deleteTask(task.id)}
                        className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs text-red-500 border border-red-200 hover:bg-red-50 transition-colors"
                      >
                        <X className="w-3 h-3" />
                        {L.cancel}
                      </button>
                    )}
                    {task.status === 'done' && (
                      <>
                        <button
                          type="button"
                          onClick={() => revertTask(task.id)}
                          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs text-amber-600 border border-amber-300 hover:bg-amber-50 transition-colors"
                          title="업무 되돌리기"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteTask(task.id)}
                          className="inline-flex items-center h-7 px-2 rounded-md text-xs text-red-500 border border-red-200 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Thai translation */}
                {task.content_th && (
                  <div className="bg-slate-50 border border-slate-200 rounded p-2.5">
                    <p className="text-xs text-slate-600 flex items-center gap-1.5">
                      <span>🇹🇭</span>
                      {task.content_th}
                    </p>
                  </div>
                )}

                {/* Rating */}
                {task.status === 'done' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-700">{L.quality}</span>
                    <Stars task={task} />
                  </div>
                )}

                {/* Metadata */}
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  {task.assigner && (
                    <>
                      <span>{L.assignedBy} {task.assigner.display_name || task.assigner.email}</span>
                      <span>·</span>
                    </>
                  )}
                  <span>{L.assignee} {task.profiles?.display_name || task.profiles?.email || '-'}</span>
                  <span>·</span>
                  <span>{new Date(task.created_at).toLocaleString('ko-KR')}</span>
                  {(() => {
                    if (editDueDateTaskId === task.id) {
                      const currentValue = task.due_date
                        ? new Date(task.due_date).toLocaleString('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(' ', 'T')
                        : '';
                      return (
                        <>
                          <span>·</span>
                          <input
                            type="datetime-local"
                            defaultValue={currentValue}
                            onChange={(e) => updateDueDate(task.id, e.target.value)}
                            className="h-6 px-1 border border-blue-300 rounded text-xs focus:ring-1 focus:ring-blue-500 outline-none"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => setEditDueDateTaskId(null)}
                            className="text-xs text-slate-400 hover:text-slate-600"
                          >
                            {L.cancel}
                          </button>
                          {task.due_date && (
                            <button
                              type="button"
                              onClick={() => updateDueDate(task.id, '')}
                              className="text-xs text-red-400 hover:text-red-600"
                            >
                              {L.delete}
                            </button>
                          )}
                        </>
                      );
                    }
                    if (task.due_date) {
                      const due = new Date(task.due_date);
                      const isOverdue = task.status === 'pending' && due < new Date();
                      const hasTime = !task.due_date.endsWith('T00:00:00+00:00') && !task.due_date.endsWith('T00:00:00.000Z');
                      const dateStr = due.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
                      const timeStr = hasTime ? ` ${due.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}` : '';
                      return (
                        <>
                          <span>·</span>
                          {isOverdue ? (
                            <button type="button" onClick={() => setEditDueDateTaskId(task.id)} className="text-red-600 font-medium hover:underline">⚠ {L.overdue}</button>
                          ) : (
                            <button type="button" onClick={() => setEditDueDateTaskId(task.id)} className="hover:text-blue-600 hover:underline transition-colors">📅 {L.duePrefix} {dateStr}{timeStr}</button>
                          )}
                        </>
                      );
                    }
                    return (
                      <>
                        <span>·</span>
                        <button type="button" onClick={() => setEditDueDateTaskId(task.id)} className="text-blue-500 hover:text-blue-700 hover:underline transition-colors">
                          <Calendar className="w-3 h-3 inline mr-0.5" />{L.setDue}
                        </button>
                      </>
                    );
                  })()}
                </div>

                {/* Chat panel inline */}
                {chatTaskId === task.id && (
                  <div className="mt-4 border-t border-slate-200 pt-4">
                    <TaskChat taskId={task.id} userId={userId} onClose={() => setChatTaskId(null)} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
