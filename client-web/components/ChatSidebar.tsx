'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { CHAT_ROOMS } from '@/lib/chat-rooms';
import { MessageSquare, ClipboardList } from 'lucide-react';

interface ChatSidebarProps {
  userId: string;
  clientId?: string;
  assigneeId?: string;
  locale?: 'ko' | 'th';
  selected: { type: 'room' | 'task'; id: string } | null;
  onSelect: (selection: { type: 'room' | 'task'; id: string; label: string; sentinel?: string }) => void;
}

export default function ChatSidebar({ userId, clientId, assigneeId, locale = 'ko', selected, onSelect }: ChatSidebarProps) {
  const L = locale === 'th' ? {
    chatRooms: 'ห้องแชท',
    tasks: 'งาน',
    noTasks: 'ไม่มีงาน',
    done: 'เสร็จแล้ว',
    pending: 'รอดำเนินการ',
  } : {
    chatRooms: '채팅방',
    tasks: '업무',
    noTasks: '업무가 없습니다',
    done: '완료',
    pending: '대기',
  };

  const [tasks, setTasks] = useState<any[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);

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
      if (res.ok) {
        const data = await res.json();
        setTasks((data.tasks || []).filter((t: any) => t.status !== 'done'));
      }
      setLoadingTasks(false);
    };
    fetchTasks();

    const channelName = `sidebar_tasks_${assigneeId || clientId || 'all'}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        fetchTasks();
      })
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [clientId, assigneeId]);

  const isSelected = (type: string, id: string) =>
    selected?.type === type && selected?.id === id;

  return (
    <div className="h-full flex flex-col bg-white border-r border-slate-200">
      {/* Chat Rooms Section */}
      <div className="p-3">
        <div className="flex items-center gap-1.5 px-2 mb-2">
          <MessageSquare className="w-3.5 h-3.5 text-indigo-500" />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{L.chatRooms}</span>
        </div>
        <div className="space-y-0.5">
          {CHAT_ROOMS.map((room) => (
            <button
              key={room.key}
              type="button"
              onClick={() => onSelect({ type: 'room', id: room.key, label: room.label, sentinel: room.sentinel })}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isSelected('room', room.key)
                  ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                  : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className="text-base">{room.icon}</span>
              <span>{room.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div className="mx-3 border-t border-slate-200" />

      {/* Tasks Section */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex items-center gap-1.5 px-2 mb-2">
          <ClipboardList className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{L.tasks}</span>
        </div>
        {loadingTasks ? (
          <div className="flex justify-center py-4">
            <span className="w-4 h-4 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tasks.length === 0 ? (
          <p className="text-xs text-slate-400 px-2 py-2">{L.noTasks}</p>
        ) : (
          <div className="space-y-0.5">
            {tasks.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => onSelect({
                  type: 'task',
                  id: task.id,
                  label: locale === 'th' ? (task.content_th || task.content) : task.content,
                })}
                className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                  isSelected('task', task.id)
                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <p className="text-sm truncate">
                  {locale === 'th' ? (task.content_th || task.content) : task.content}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {task.profiles && (
                    <span className="text-[10px] text-slate-400 truncate">
                      {task.profiles.display_name || task.profiles.email}
                    </span>
                  )}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    task.status === 'done'
                      ? 'bg-emerald-100 text-emerald-600'
                      : 'bg-amber-100 text-amber-600'
                  }`}>
                    {task.status === 'done' ? L.done : L.pending}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
