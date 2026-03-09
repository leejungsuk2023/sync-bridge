'use client';

import { useState } from 'react';
import ChatSidebar from './ChatSidebar';
import ChatPanel from './ChatPanel';
import { CHAT_ROOMS } from '@/lib/chat-rooms';

interface ChatLayoutProps {
  userId: string;
  clientId?: string;
  locale?: 'ko' | 'th';
  assigneeId?: string;
}

interface Selection {
  type: 'room' | 'task';
  id: string;
  label: string;
  sentinel?: string;
}

export default function ChatLayout({ userId, clientId, locale = 'ko', assigneeId }: ChatLayoutProps) {
  // Default to WORK room
  const defaultRoom = CHAT_ROOMS[0];
  const [selected, setSelected] = useState<Selection>({
    type: 'room',
    id: defaultRoom.key,
    label: defaultRoom.label,
    sentinel: defaultRoom.sentinel,
  });
  const [showPanel, setShowPanel] = useState(false); // mobile: show panel vs sidebar
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const handleSelect = (sel: Selection) => {
    setSelected(sel);
    setShowPanel(true); // on mobile, switch to panel view
    // For tasks, we know the task_id immediately
    if (sel.type === 'task') {
      setActiveTaskId(sel.id);
    } else {
      setActiveTaskId(null); // will be set by ChatPanel's onMarkRead
    }
  };

  const handleMarkRead = (taskId: string) => {
    setActiveTaskId(taskId);
  };

  const handleBack = () => {
    setShowPanel(false); // on mobile, go back to sidebar
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden" style={{ height: 'calc(100vh - 220px)', minHeight: '500px' }}>
      <div className="flex h-full">
        {/* Sidebar - always visible on desktop, toggleable on mobile */}
        <div className={`w-full md:w-64 md:shrink-0 md:block ${showPanel ? 'hidden' : 'block'}`}>
          <ChatSidebar
            userId={userId}
            clientId={clientId}
            assigneeId={assigneeId}
            locale={locale}
            selected={selected}
            onSelect={handleSelect}
            activeTaskId={activeTaskId}
          />
        </div>

        {/* Chat Panel - always visible on desktop, toggleable on mobile */}
        <div className={`flex-1 min-w-0 md:block ${showPanel ? 'block' : 'hidden'}`}>
          {selected ? (
            <ChatPanel
              key={selected.type === 'room' ? selected.sentinel : selected.id}
              userId={userId}
              clientId={clientId}
              roomSentinel={selected.type === 'room' ? selected.sentinel : undefined}
              taskId={selected.type === 'task' ? selected.id : undefined}
              locale={locale}
              roomLabel={selected.label}
              onBack={handleBack}
              onMarkRead={handleMarkRead}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-slate-400">
              {locale === 'th' ? 'เลือกห้องแชทหรืองาน' : '채팅방 또는 업무를 선택하세요'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
