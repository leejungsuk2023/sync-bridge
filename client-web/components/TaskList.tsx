'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Star, MessageCircle, Trash2, RotateCcw, Calendar, X, CheckCircle } from 'lucide-react';
import TaskChat from './TaskChat';

export default function TaskList({ workers, clientId, userId, canComplete = false, assigneeId, title }: { workers: any[]; clientId?: string; userId: string; canComplete?: boolean; assigneeId?: string; title?: string }) {
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
    await fetch('/api/tasks', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ id: taskId, rating, rated_by: userId, rated_at: new Date().toISOString() }),
    });
    setRatingTaskId(null);
    setRatingValue(null);
  };

  const deleteTask = async (taskId: string) => {
    if (!confirm('이 업무를 삭제하시겠습니까? 채팅 내역도 함께 삭제됩니다.')) return;
    const session = (await supabase.auth.getSession()).data.session;
    await fetch(`/api/tasks?id=${taskId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    setTasks(prev => prev.filter(t => t.id !== taskId));
  };

  const revertTask = async (taskId: string) => {
    if (!confirm('이 업무를 다시 진행 중으로 되돌리시겠습니까?')) return;
    const session = (await supabase.auth.getSession()).data.session;
    await fetch('/api/tasks', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ id: taskId, status: 'pending', rating: null, rated_by: null, rated_at: null }),
    });
  };

  const completeTask = async (taskId: string) => {
    if (!confirm('이 업무를 완료 처리하시겠습니까?')) return;
    const session = (await supabase.auth.getSession()).data.session;
    await fetch('/api/tasks', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ id: taskId, status: 'done' }),
    });
  };

  const updateDueDate = async (taskId: string, newDueDate: string) => {
    const session = (await supabase.auth.getSession()).data.session;
    await fetch('/api/tasks', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ id: taskId, due_date: newDueDate ? new Date(newDueDate).toISOString() : null }),
    });
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
          평가하기
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
          취소
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-amber-50/70 to-white rounded-xl shadow-sm border border-amber-100 border-l-4 border-l-amber-400 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-slate-900">{title || '업무 목록'}</h2>
          {doneTasks.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDone(!showDone)}
              className="text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
            >
              완료 {doneTasks.length}건 {showDone ? '숨기기' : '보기'}
            </button>
          )}
        </div>
        {loading ? (
          <p className="text-center text-slate-500 py-12">불러오는 중...</p>
        ) : pendingTasks.length === 0 && !showDone ? (
          <p className="text-center text-slate-500 py-12">진행 중인 업무가 없습니다.</p>
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
                    {task.status === 'pending' && canComplete && (
                      <button
                        type="button"
                        onClick={() => completeTask(task.id)}
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs text-emerald-600 border border-emerald-300 hover:bg-emerald-50 transition-colors"
                        title="업무 완료"
                      >
                        <CheckCircle className="w-3 h-3" />
                        완료
                      </button>
                    )}
                    {task.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => deleteTask(task.id)}
                        className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs text-red-500 border border-red-200 hover:bg-red-50 transition-colors"
                        title="업무 취소"
                      >
                        <X className="w-3 h-3" />
                        취소
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
                    <span className="text-xs font-medium text-slate-700">품질:</span>
                    <Stars task={task} />
                  </div>
                )}

                {/* Metadata */}
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  {task.assigner && (
                    <>
                      <span>할당: {task.assigner.display_name || task.assigner.email}</span>
                      <span>·</span>
                    </>
                  )}
                  <span>담당: {task.profiles?.display_name || task.profiles?.email || '-'}</span>
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
                            취소
                          </button>
                          {task.due_date && (
                            <button
                              type="button"
                              onClick={() => updateDueDate(task.id, '')}
                              className="text-xs text-red-400 hover:text-red-600"
                            >
                              삭제
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
                            <button type="button" onClick={() => setEditDueDateTaskId(task.id)} className="text-red-600 font-medium hover:underline">⚠ 기한초과</button>
                          ) : (
                            <button type="button" onClick={() => setEditDueDateTaskId(task.id)} className="hover:text-blue-600 hover:underline transition-colors">📅 마감 {dateStr}{timeStr}</button>
                          )}
                        </>
                      );
                    }
                    return (
                      <>
                        <span>·</span>
                        <button type="button" onClick={() => setEditDueDateTaskId(task.id)} className="text-blue-500 hover:text-blue-700 hover:underline transition-colors">
                          <Calendar className="w-3 h-3 inline mr-0.5" />기한 설정
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
