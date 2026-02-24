'use client';

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { X, Send } from 'lucide-react';

export default function TaskChat({ taskId, userId, onClose }: { taskId: string; userId: string; onClose: () => void }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [task, setTask] = useState<any>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.from('tasks').select('content, content_th').eq('id', taskId).single().then(({ data }) => setTask(data));
  }, [taskId]);

  const fetchMessages = async () => {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });
    setMessages(data || []);
  };

  useEffect(() => {
    fetchMessages();
    const ch = supabase
      .channel('chat_' + taskId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `task_id=eq.${taskId}` }, () => {
        fetchMessages();
      })
      .subscribe();
    return () => { ch.unsubscribe(); };
  }, [taskId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    if (!input.trim()) return;
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
      task_id: taskId,
      sender_id: userId,
      content: original,
      content_ko: original,
      content_th: contentTh || original,
      sender_lang: 'ko',
    });
    setSending(false);
  };

  return (
    <div className="bg-white rounded-lg border border-slate-300 overflow-hidden flex flex-col" style={{ height: '480px' }}>
      {/* Header */}
      <div className="shrink-0 bg-slate-50 border-b border-slate-200 p-4 flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900">업무 채팅</h3>
          {task && <p className="text-xs text-slate-600 mt-1 truncate">{task.content}</p>}
        </div>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors ml-2">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 bg-slate-50 space-y-3">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-slate-500">메시지가 없습니다</p>
          </div>
        )}
        {messages.map((m) => {
          const isMine = m.sender_id === userId;
          return (
            <div key={m.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
              <div className={`max-w-[75%] rounded-lg px-4 py-2.5 ${
                isMine ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-900'
              }`}>
                <p className="text-sm">{m.content_ko || m.content}</p>
              </div>
              <span className={`text-[10px] mt-1 ${isMine ? 'text-emerald-700' : 'text-slate-500'}`}>
                {new Date(m.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-slate-200 p-4 bg-white flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
          placeholder="한국어로 메시지 입력..."
          className="flex-1 h-10 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !input.trim()}
          className="inline-flex items-center gap-1.5 px-5 h-10 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          <Send className="w-4 h-4" />
          전송
        </button>
      </div>
    </div>
  );
}
