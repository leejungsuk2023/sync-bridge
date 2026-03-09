'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Send, Users, Paperclip, FileText, Download, X, ArrowLeft, Pencil } from 'lucide-react';
import ImageAnnotator from './ImageAnnotator';

interface Member {
  id: string;
  display_name: string;
  email: string;
  role: string;
  status: string;
}

interface ChatPanelProps {
  userId: string;
  clientId?: string;
  roomSentinel?: string;
  taskId?: string;
  locale?: 'ko' | 'th';
  roomLabel?: string;
  onBack?: () => void;
  onMarkRead?: (taskId: string) => void;
}

export default function ChatPanel({ userId, clientId, roomSentinel, taskId: taskIdProp, locale = 'ko', roomLabel, onBack, onMarkRead }: ChatPanelProps) {
  const L = locale === 'th' ? {
    noMessages: 'ยังไม่มีข้อความ ส่งข้อความแรกเลย',
    inputPlaceholder: 'พิมพ์ข้อความ... (ใช้ @ เพื่อเมนชัน)',
    send: 'ส่ง',
    online: 'ออนไลน์',
    away: 'ไม่อยู่',
    manager: 'ผู้จัดการ',
    offline: 'ออฟไลน์',
    onlineCount: (n: number) => `${n} คนออนไลน์`,
    worker: 'พนักงาน',
    attachFile: 'แนบไฟล์',
    fileSizeError: 'ขนาดไฟล์ต้องไม่เกิน 10MB',
    uploadError: 'อัปโหลดไฟล์ไม่สำเร็จ: ',
    me: '(ฉัน)',
  } : {
    noMessages: '메시지가 없습니다. 첫 메시지를 보내보세요.',
    inputPlaceholder: '메시지 입력... (@로 멘션)',
    send: '전송',
    online: '접속중',
    away: '자리비움',
    manager: '관리자',
    offline: '오프라인',
    onlineCount: (n: number) => `${n}명 접속중`,
    worker: '직원',
    attachFile: '파일 첨부',
    fileSizeError: '파일 크기는 10MB 이하만 가능합니다.',
    uploadError: '파일 업로드 실패: ',
    me: '(나)',
  };

  const [chatTaskId, setChatTaskId] = useState<string | null>(taskIdProp || null);
  const [messages, setMessages] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [members, setMembers] = useState<Member[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ name: string; url: string; type: string } | null>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [annotatingImage, setAnnotatingImage] = useState<{ url: string; name: string } | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const retryingIdsRef = useRef<Set<string>>(new Set());

  // Resolve chat task ID for room sentinel
  useEffect(() => {
    if (taskIdProp) {
      setChatTaskId(taskIdProp);
      setLoading(false);
      return;
    }
    if (!roomSentinel || !clientId) {
      setLoading(false);
      return;
    }
    const init = async () => {
      const session = (await supabase.auth.getSession()).data.session;
      const roomKey = roomSentinel.replace('__CHAT_', '').replace('__', '');
      const params = new URLSearchParams({ chat_room: roomKey, client_id: clientId });
      const res = await fetch(`/api/tasks?${params}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.task?.id) setChatTaskId(data.task.id);
      }
      setLoading(false);
    };
    init();
  }, [clientId, roomSentinel, taskIdProp]);

  // Load members + online status
  const fetchMembers = useCallback(async () => {
    if (!clientId) return;
    const { data: allProfiles } = await supabase
      .from('profiles')
      .select('id, display_name, email, role')
      .eq('client_id', clientId);
    if (!allProfiles) return;

    const workerIds = allProfiles.filter(p => p.role === 'worker').map(p => p.id);
    const statusMap: Record<string, string> = {};

    if (workerIds.length > 0) {
      for (const wid of workerIds) {
        const { data: logs } = await supabase
          .from('time_logs')
          .select('status')
          .eq('worker_id', wid)
          .order('created_at', { ascending: false })
          .limit(1);
        statusMap[wid] = logs?.[0]?.status || 'offline';
      }
    }

    const result: Member[] = allProfiles.map(p => ({
      id: p.id,
      display_name: p.display_name || p.email?.split('@')[0] || '?',
      email: p.email,
      role: p.role,
      status: p.role === 'worker' ? (statusMap[p.id] || 'offline') : 'client',
    }));

    const order: Record<string, number> = { online: 0, away: 1, client: 2, offline: 3 };
    result.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
    setMembers(result);
  }, [clientId]);

  useEffect(() => {
    fetchMembers();
    if (!clientId) return;
    const ch = supabase
      .channel('chat_panel_status_' + clientId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'time_logs' }, () => {
        fetchMembers();
      })
      .subscribe();
    return () => { ch.unsubscribe(); };
  }, [clientId, fetchMembers]);

  // Request notification permission
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Load messages
  const fetchMessages = useCallback(async () => {
    if (!chatTaskId) return;
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('task_id', chatTaskId)
      .order('created_at', { ascending: true });
    setMessages(data || []);

    const senderIds = [...new Set((data || []).map(m => m.sender_id))];
    const unknown = senderIds.filter(id => !profiles[id]);
    if (unknown.length > 0) {
      const { data: pData } = await supabase
        .from('profiles')
        .select('id, display_name, email')
        .in('id', unknown);
      if (pData) {
        setProfiles(prev => {
          const next = { ...prev };
          pData.forEach(p => { next[p.id] = p.display_name || p.email?.split('@')[0] || '?'; });
          return next;
        });
      }
    }

    // Mark as read
    if (chatTaskId && userId) {
      supabase
        .from('chat_read_status')
        .upsert({ user_id: userId, task_id: chatTaskId, last_read_at: new Date().toISOString() }, { onConflict: 'user_id,task_id' })
        .then(({ error }) => { if (error) console.error('[ChatPanel] mark read error:', error.message); });
      onMarkRead?.(chatTaskId);
    }
  }, [chatTaskId]);

  useEffect(() => {
    if (!chatTaskId) return;
    fetchMessages();
    const ch = supabase
      .channel('chat_panel_' + chatTaskId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `task_id=eq.${chatTaskId}` }, (payload) => {
        fetchMessages();
        // Mark as read if tab is visible
        if (!document.hidden && chatTaskId && userId) {
          supabase
            .from('chat_read_status')
            .upsert({ user_id: userId, task_id: chatTaskId, last_read_at: new Date().toISOString() }, { onConflict: 'user_id,task_id' })
            .then(({ error }) => { if (error) console.error('[ChatPanel] mark read error:', error.message); });
          onMarkRead?.(chatTaskId);
        }
        // Show browser notification if tab is hidden and message is from someone else
        if (document.hidden && payload.new && (payload.new as any).sender_id !== userId) {
          const senderName = profiles[(payload.new as any).sender_id] || '';
          const content = (payload.new as any).content || '';
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(senderName ? `${senderName} (${roomLabel || 'Chat'})` : (roomLabel || 'Chat'), {
              body: content.length > 100 ? content.slice(0, 100) + '...' : content,
              icon: '/favicon.ico',
              tag: 'syncbridge-chat-' + chatTaskId,
            });
          }
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `task_id=eq.${chatTaskId}` }, () => {
        fetchMessages();
      })
      .subscribe();
    return () => { ch.unsubscribe(); };
  }, [chatTaskId, fetchMessages]);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages]);

  // @mention detection
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInput(value);
    const cursor = e.target.selectionStart || value.length;
    const before = value.substring(0, cursor);
    const match = before.match(/@([^\s]*)$/);
    if (match) {
      setMentionFilter(match[1].toLowerCase());
      setShowMentions(true);
    } else {
      setShowMentions(false);
    }
  };

  const filteredMentions = members
    .filter(m => m.id !== userId)
    .filter(m => m.display_name.toLowerCase().includes(mentionFilter));

  const selectMention = (member: Member) => {
    const el = inputRef.current;
    if (!el) return;
    const cursor = el.selectionStart || input.length;
    const before = input.substring(0, cursor);
    const after = input.substring(cursor);
    const match = before.match(/@([^\s]*)$/);
    if (!match) return;
    const beforeAt = before.substring(0, match.index);
    const newText = `${beforeAt}@${member.display_name} ${after}`;
    const newCursor = beforeAt.length + member.display_name.length + 2;
    setInput(newText);
    setShowMentions(false);
    setTimeout(() => { el.focus(); el.setSelectionRange(newCursor, newCursor); }, 0);
  };

  const parseMentions = (text: string): string[] => {
    const ids: string[] = [];
    const regex = /@(\S+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const member = members.find(mb => mb.display_name === match![1]);
      if (member) ids.push(member.id);
    }
    return [...new Set(ids)];
  };

  const renderContent = (text: string, isMine: boolean) => {
    if (!text) return null;
    const parts = text.split(/(@\S+)/g);
    return parts.map((part, i) =>
      part.startsWith('@')
        ? <span key={i} className={`font-bold ${isMine ? 'text-yellow-200' : 'text-indigo-600'}`}>{part}</span>
        : <span key={i}>{part}</span>
    );
  };

  const send = async () => {
    if (!input.trim() || !chatTaskId) return;
    setSending(true);
    setShowMentions(false);
    const original = input.trim();
    const mentionedIds = parseMentions(original);
    setInput('');

    const { data: inserted } = await supabase.from('messages').insert({
      task_id: chatTaskId,
      sender_id: userId,
      content: original,
      content_ko: locale === 'ko' ? original : null,
      content_th: locale === 'th' ? original : null,
      sender_lang: locale === 'th' ? 'th' : 'ko',
      mentions: mentionedIds,
    }).select('id').single();
    setSending(false);

    if (inserted?.id) {
      const targetLang = locale === 'th' ? 'ko' : 'th';
      fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: original, targetLang }),
      }).then(res => {
        if (!res.ok) { console.error('[ChatPanel] translate API error:', res.status); return null; }
        return res.json();
      }).then(d => {
        if (d?.translated) {
          const updateField = targetLang === 'th' ? 'content_th' : 'content_ko';
          supabase.from('messages').update({ [updateField]: d.translated }).eq('id', inserted.id)
            .then(({ error }) => { if (error) console.error('[ChatPanel] update error:', error.message); });
        }
      }).catch(err => console.error('[ChatPanel] translate fetch error:', err));
    }
  };

  const uploadAndSendFile = async (file: File) => {
    if (!chatTaskId) return;
    if (file.size > 10 * 1024 * 1024) {
      alert(L.fileSizeError);
      return;
    }
    setUploading(true);
    const ext = file.name.split('.').pop() || 'png';
    const path = `${chatTaskId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from('chat-files').upload(path, file);
    if (error) {
      alert(L.uploadError + error.message);
      setUploading(false);
      return;
    }
    const { data: urlData } = supabase.storage.from('chat-files').getPublicUrl(path);
    await supabase.from('messages').insert({
      task_id: chatTaskId,
      sender_id: userId,
      content: `📎 ${file.name}`,
      content_ko: `📎 ${file.name}`,
      content_th: `📎 ${file.name}`,
      sender_lang: locale === 'th' ? 'th' : 'ko',
      file_url: urlData.publicUrl,
      file_name: file.name,
      file_type: file.type,
    });
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadAndSendFile(file);
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) {
          const namedFile = new File([file], `pasted_${Date.now()}.png`, { type: file.type });
          await uploadAndSendFile(namedFile);
        }
        return;
      }
    }
  };

  const handleAnnotationSend = async (blob: Blob, fileName: string) => {
    const file = new File([blob], fileName, { type: 'image/png' });
    await uploadAndSendFile(file);
    setAnnotatingImage(null);
  };

  const isImageType = (type: string) => type?.startsWith('image/');

  const getStatusDot = (status: string) => {
    switch (status) {
      case 'online': return 'bg-emerald-500';
      case 'away': return 'bg-amber-400';
      case 'client': return 'bg-blue-400';
      default: return 'bg-slate-300';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'online': return L.online;
      case 'away': return L.away;
      case 'client': return L.manager;
      default: return L.offline;
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!chatTaskId) return null;

  const onlineCount = members.filter(m => m.status === 'online' || m.status === 'client').length;
  const myLang = locale === 'th' ? 'th' : 'ko';
  const myField = locale === 'th' ? 'content_th' : 'content_ko';

  return (
    <div className="h-full flex flex-col bg-white" onPaste={handlePaste}>
      {/* Header */}
      <div className="shrink-0 bg-gradient-to-r from-indigo-50 to-white border-b border-indigo-100 px-4 py-3 flex items-center gap-3">
        {onBack && (
          <button type="button" onClick={onBack} className="text-slate-500 hover:text-slate-700 md:hidden">
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-slate-900 truncate">{roomLabel || 'Chat'}</h2>
          <span className="flex items-center gap-1 text-xs text-emerald-600">
            <Users className="w-3 h-3" />
            {L.onlineCount(onlineCount)}
          </span>
        </div>
      </div>

      {/* Members bar */}
      <div className="shrink-0 px-4 py-2 border-b border-slate-100 overflow-x-auto">
        <div className="flex gap-1.5">
          {members.map((m) => (
            <div
              key={m.id}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap ${
                m.id === userId
                  ? 'bg-indigo-100 border-indigo-200 text-indigo-700'
                  : m.status === 'online' ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : m.status === 'away' ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : m.status === 'client' ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-slate-50 border-slate-200 text-slate-400'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${getStatusDot(m.status)}`} />
              {m.display_name}
              {m.id === userId && <span className="text-[9px] opacity-60">{L.me}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Image preview modal */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setPreviewFile(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setPreviewFile(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center text-slate-600 hover:text-slate-900 z-10">
              <X className="w-4 h-4" />
            </button>
            <img src={previewFile.url} alt={previewFile.name} className="max-w-full max-h-[85vh] rounded-lg shadow-2xl" />
            <p className="text-center text-white text-sm mt-2">{previewFile.name}</p>
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={messagesRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-slate-400">{L.noMessages}</p>
          </div>
        )}
        {messages.map((m) => {
          const isMine = m.sender_id === userId;
          const senderName = profiles[m.sender_id] || '...';
          // Smart display: same language → original, different → translated field
          const senderLang = m.sender_lang || 'ko';
          let displayText: string;
          if (senderLang === myLang) {
            // Same language — show original content
            displayText = m.content;
          } else {
            // Different language — show translated field
            const translated = m[myField];
            // Check if translation exists and is different from original
            if (translated && translated !== m.content) {
              displayText = translated;
            } else {
              // Translation not ready or failed — show placeholder and trigger re-translate
              displayText = m.content;
              if (!retryingIdsRef.current.has(m.id) && m.id) {
                retryingIdsRef.current.add(m.id);
                fetch('/api/translate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ text: m.content, targetLang: myLang }),
                }).then(r => r.ok ? r.json() : null).then(d => {
                  if (d?.translated && d.translated !== m.content) {
                    supabase.from('messages').update({ [myField]: d.translated }).eq('id', m.id);
                  }
                }).catch(() => {});
              }
            }
          }
          return (
            <div key={m.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
              {!isMine && (
                <span className="text-[11px] font-medium text-indigo-600 mb-0.5 ml-1">{senderName}</span>
              )}
              <div className={`max-w-[70%] rounded-lg px-4 py-2.5 ${
                isMine ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-900'
              }`}>
                {m.file_url ? (
                  isImageType(m.file_type) ? (
                    <div>
                      <div className="relative group">
                        <img
                          src={m.file_url}
                          alt={m.file_name}
                          className="max-w-full max-h-48 rounded cursor-pointer"
                          onClick={() => setPreviewFile({ name: m.file_name, url: m.file_url, type: m.file_type })}
                        />
                        {!isMine && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setAnnotatingImage({ url: m.file_url, name: m.file_name }); }}
                            className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 bg-black/60 hover:bg-black/80 text-white rounded-md px-2 py-1 text-xs flex items-center gap-1 transition-opacity"
                            title="수정 요청"
                          >
                            <Pencil className="w-3 h-3" />
                            수정
                          </button>
                        )}
                      </div>
                      <p className="text-xs mt-1 opacity-70">{m.file_name}</p>
                    </div>
                  ) : (
                    <a href={m.file_url} target="_blank" rel="noopener noreferrer"
                      className={`flex items-center gap-2 ${isMine ? 'text-white hover:text-indigo-200' : 'text-indigo-600 hover:text-indigo-800'}`}>
                      <FileText className="w-4 h-4 shrink-0" />
                      <span className="text-sm underline truncate">{m.file_name}</span>
                      <Download className="w-3.5 h-3.5 shrink-0" />
                    </a>
                  )
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{renderContent(displayText, isMine)}</p>
                )}
              </div>
              <span className={`text-[10px] mt-0.5 ${isMine ? 'text-indigo-400' : 'text-slate-400'}`}>
                {new Date(m.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          );
        })}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-slate-200 p-3 bg-white flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
          onChange={handleFileSelect}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-slate-300 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 disabled:opacity-50 transition-colors"
          title={L.attachFile}
        >
          {uploading ? (
            <span className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <Paperclip className="w-4 h-4" />
          )}
        </button>
        <div className="relative flex-1">
          {showMentions && filteredMentions.length > 0 && (
            <div className="absolute bottom-full mb-1 left-0 right-0 bg-white border border-indigo-200 rounded-lg shadow-lg max-h-40 overflow-y-auto z-20">
              {filteredMentions.slice(0, 6).map((m) => (
                <button key={m.id} type="button"
                  onMouseDown={(e) => { e.preventDefault(); selectMention(m); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 flex items-center gap-2 transition-colors">
                  <span className={`w-2 h-2 rounded-full ${getStatusDot(m.status)}`} />
                  <span className="font-medium text-slate-700">{m.display_name}</span>
                  <span className="text-xs text-slate-400">{m.role === 'worker' ? L.worker : L.manager}</span>
                </button>
              ))}
            </div>
          )}
          <input
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setShowMentions(false); return; }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
            }}
            onBlur={() => setTimeout(() => setShowMentions(false), 200)}
            placeholder={L.inputPlaceholder}
            className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
          />
        </div>
        <button
          type="button"
          onClick={send}
          disabled={sending || !input.trim()}
          className="inline-flex items-center gap-1.5 px-5 h-10 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          <Send className="w-4 h-4" />
          {L.send}
        </button>
      </div>

      {annotatingImage && (
        <ImageAnnotator
          imageUrl={annotatingImage.url}
          imageName={annotatingImage.name}
          onSend={handleAnnotationSend}
          onClose={() => setAnnotatingImage(null)}
        />
      )}
    </div>
  );
}
