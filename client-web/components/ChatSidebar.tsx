'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
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
  activeTaskId?: string | null; // task_id of the currently open chat panel
}

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  const display = count > 99 ? '99+' : String(count);
  return (
    <span className="bg-red-500 text-white text-[10px] min-w-[18px] h-[18px] rounded-full flex items-center justify-center font-bold px-1 ml-auto flex-shrink-0">
      {display}
    </span>
  );
}

export default function ChatSidebar({ userId, clientId, assigneeId, locale = 'ko', selected, onSelect, activeTaskId }: ChatSidebarProps) {
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
  const [roomTaskIds, setRoomTaskIds] = useState<Record<string, string>>({});
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  // Keep refs for values used in realtime callback
  const activeTaskIdRef = useRef(activeTaskId);
  activeTaskIdRef.current = activeTaskId;

  // Reset unread count when activeTaskId changes
  useEffect(() => {
    if (activeTaskId) {
      setUnreadCounts(prev => {
        if (prev[activeTaskId] && prev[activeTaskId] > 0) {
          return { ...prev, [activeTaskId]: 0 };
        }
        return prev;
      });
    }
  }, [activeTaskId]);

  // Fetch unread counts for a list of task IDs
  const fetchUnreadCounts = useCallback(async (taskIds: string[]) => {
    if (taskIds.length === 0 || !userId) return;

    try {
      // Get all read statuses for this user
      const { data: readStatuses } = await supabase
        .from('chat_read_status')
        .select('task_id, last_read_at')
        .eq('user_id', userId);

      const counts: Record<string, number> = {};

      for (const taskId of taskIds) {
        const readStatus = readStatuses?.find(r => r.task_id === taskId);
        let query = supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('task_id', taskId)
          .neq('sender_id', userId);

        if (readStatus) {
          query = query.gt('created_at', readStatus.last_read_at);
        }

        const { count } = await query;
        counts[taskId] = count || 0;
      }

      // Reset count for currently active chat
      if (activeTaskIdRef.current && counts[activeTaskIdRef.current] !== undefined) {
        counts[activeTaskIdRef.current] = 0;
      }

      setUnreadCounts(prev => ({ ...prev, ...counts }));
    } catch (err) {
      console.error('[ChatSidebar] Error fetching unread counts:', err);
    }
  }, [userId]);

  // Fetch tasks and room task IDs
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
        const filteredTasks = (data.tasks || []).filter((t: any) => t.status !== 'done');
        setTasks(filteredTasks);
        return filteredTasks;
      }
      setLoadingTasks(false);
      return [];
    };

    const fetchRoomTaskIds = async () => {
      if (!clientId) return {};
      const session = (await supabase.auth.getSession()).data.session;
      const roomRes = await fetch(`/api/tasks?list_chat_rooms=true&client_id=${clientId}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (roomRes.ok) {
        const roomData = await roomRes.json();
        const map: Record<string, string> = {};
        (roomData.rooms || []).forEach((r: any) => {
          if (r.taskId) map[r.key] = r.taskId;
        });
        setRoomTaskIds(map);
        return map;
      }
      return {};
    };

    const init = async () => {
      const [fetchedTasks, roomMap] = await Promise.all([
        fetchTasks(),
        fetchRoomTaskIds(),
      ]);
      setLoadingTasks(false);

      // Collect all task IDs (rooms + tasks) for unread count fetch
      const allTaskIds = [
        ...Object.values(roomMap),
        ...fetchedTasks.map((t: any) => t.id),
      ];
      fetchUnreadCounts(allTaskIds);
    };

    init();

    const channelName = `sidebar_tasks_${assigneeId || clientId || 'all'}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        // Re-fetch tasks when task table changes; also re-fetch unread counts
        init();
      })
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [clientId, assigneeId, fetchUnreadCounts]);

  // Realtime subscription for new messages → increment unread counts
  useEffect(() => {
    const channel = supabase
      .channel('sidebar_unread_' + userId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new as any;
        if (msg.sender_id === userId) return; // own message
        if (msg.task_id === activeTaskIdRef.current) return; // currently viewing
        setUnreadCounts(prev => ({
          ...prev,
          [msg.task_id]: (prev[msg.task_id] || 0) + 1,
        }));
      })
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [userId]);

  // Helper to get unread count for a room key (via roomTaskIds mapping)
  const getRoomUnread = (roomKey: string): number => {
    const taskId = roomTaskIds[roomKey];
    if (!taskId) return 0;
    return unreadCounts[taskId] || 0;
  };

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
              <UnreadBadge count={getRoomUnread(room.key)} />
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
                <div className="flex items-center gap-1">
                  <p className="text-sm truncate flex-1">
                    {locale === 'th' ? (task.content_th || task.content) : task.content}
                  </p>
                  <UnreadBadge count={unreadCounts[task.id] || 0} />
                </div>
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
