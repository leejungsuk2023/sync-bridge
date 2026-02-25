'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Star, MessageCircle } from 'lucide-react';
import TaskChat from './TaskChat';

export default function TaskList({ workers, clientId, userId }: { workers: any[]; clientId?: string; userId: string }) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatTaskId, setChatTaskId] = useState<string | null>(null);

  useEffect(() => {
    const fetchTasks = async () => {
      const session = (await supabase.auth.getSession()).data.session;
      const params = clientId ? `?client_id=${clientId}` : '';
      const res = await fetch(`/api/tasks${params}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const data = await res.json();
      setTasks(data.tasks || []);
      setLoading(false);
    };

    fetchTasks();

    const channel = supabase
      .channel('tasks_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        fetchTasks();
      })
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [clientId]);

  const [ratingTaskId, setRatingTaskId] = useState<string | null>(null);
  const [ratingValue, setRatingValue] = useState<number | null>(null);

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
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-6">업무 목록</h2>
        {loading ? (
          <p className="text-center text-slate-500 py-12">불러오는 중...</p>
        ) : tasks.length === 0 ? (
          <p className="text-center text-slate-500 py-12">할당된 업무가 없습니다.</p>
        ) : (
          <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
            {tasks.map((task) => (
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
                  <span>담당: {task.profiles?.display_name || task.profiles?.email || '-'}</span>
                  <span>·</span>
                  <span>{new Date(task.created_at).toLocaleString('ko-KR')}</span>
                  {task.due_date && (() => {
                    const due = new Date(task.due_date);
                    const isOverdue = task.status === 'pending' && due < new Date();
                    return (
                      <>
                        <span>·</span>
                        {isOverdue ? (
                          <span className="text-red-600 font-medium">⚠ 기한초과</span>
                        ) : (
                          <span>📅 마감 {due.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} {due.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
                        )}
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
