'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { MessageSquare, Send, ChevronDown, ChevronUp, Users, Paperclip, FileText, Download, X } from 'lucide-react';

interface Member {
  id: string;
  display_name: string;
  email: string;
  role: string;
  status: string; // online | away | offline
}

export default function GeneralChat({ userId, clientId }: { userId: string; clientId?: string }) {
  const [chatTaskId, setChatTaskId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [members, setMembers] = useState<Member[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ name: string; url: string; type: string } | null>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const messagesRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 전체 채팅방 task ID 확보
  useEffect(() => {
    if (!clientId) return;
    const init = async () => {
      const session = (await supabase.auth.getSession()).data.session;
      const params = new URLSearchParams({ general_chat: 'true', client_id: clientId });
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
  }, [clientId]);

  // 참여자 목록 + 접속 상태 로드
  const fetchMembers = useCallback(async () => {
    if (!clientId) return;
    // 같은 client_id 소속 전체 사용자
    const { data: allProfiles } = await supabase
      .from('profiles')
      .select('id, display_name, email, role')
      .eq('client_id', clientId);
    if (!allProfiles) return;

    // worker들의 최신 time_log 상태 가져오기
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

    // 정렬: online → away → client → offline
    const order: Record<string, number> = { online: 0, away: 1, client: 2, offline: 3 };
    result.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
    setMembers(result);
  }, [clientId]);

  useEffect(() => {
    fetchMembers();
    // time_logs 실시간 구독 (접속 상태 변경 감지)
    if (!clientId) return;
    const ch = supabase
      .channel('general_chat_status')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'time_logs' }, () => {
        fetchMembers();
      })
      .subscribe();
    return () => { ch.unsubscribe(); };
  }, [clientId, fetchMembers]);

  // 메시지 로드
  const fetchMessages = useCallback(async () => {
    if (!chatTaskId) return;
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('task_id', chatTaskId)
      .order('created_at', { ascending: true });
    setMessages(data || []);

    // 발신자 프로필 로드
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
  }, [chatTaskId]);

  useEffect(() => {
    if (!chatTaskId) return;
    fetchMessages();
    const ch = supabase
      .channel('general_chat_' + chatTaskId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `task_id=eq.${chatTaskId}` }, () => {
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

  // @멘션 감지
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
      content_ko: original,
      content_th: original,
      sender_lang: 'ko',
      mentions: mentionedIds,
    }).select('id').single();
    setSending(false);

    if (inserted?.id) {
      fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: original, targetLang: 'th' }),
      }).then(res => res.ok ? res.json() : null).then(d => {
        if (d?.translated) {
          supabase.from('messages').update({ content_th: d.translated }).eq('id', inserted.id);
        }
      }).catch(() => {});
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !chatTaskId) return;
    if (file.size > 10 * 1024 * 1024) {
      alert('파일 크기는 10MB 이하만 가능합니다.');
      return;
    }
    setUploading(true);
    const ext = file.name.split('.').pop();
    const path = `${chatTaskId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from('chat-files').upload(path, file);
    if (error) {
      alert('파일 업로드 실패: ' + error.message);
      setUploading(false);
      return;
    }
    const { data: urlData } = supabase.storage.from('chat-files').getPublicUrl(path);
    const fileUrl = urlData.publicUrl;

    await supabase.from('messages').insert({
      task_id: chatTaskId,
      sender_id: userId,
      content: `📎 ${file.name}`,
      content_ko: `📎 ${file.name}`,
      content_th: `📎 ${file.name}`,
      sender_lang: 'ko',
      file_url: fileUrl,
      file_name: file.name,
      file_type: file.type,
    });
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
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
      case 'online': return '접속중';
      case 'away': return '자리비움';
      case 'client': return '관리자';
      default: return '오프라인';
    }
  };

  if (loading) return null;
  if (!chatTaskId) return null;

  const onlineCount = members.filter(m => m.status === 'online' || m.status === 'client').length;

  return (
    <div className="bg-gradient-to-r from-indigo-50/70 to-white rounded-xl shadow-sm border border-indigo-100 border-l-4 border-l-indigo-400 overflow-hidden">
      {/* Header (접기/펼치기) */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-6 py-4"
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-indigo-500" />
          <h2 className="text-lg font-semibold text-slate-900">전체 톡방</h2>
          <span className="text-xs text-slate-500">({messages.length})</span>
          <span className="flex items-center gap-1 text-xs text-emerald-600 ml-2">
            <Users className="w-3.5 h-3.5" />
            {onlineCount}명 접속중
          </span>
        </div>
        {collapsed ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-slate-400" />}
      </button>

      {/* 이미지 미리보기 모달 */}
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

      {!collapsed && (
        <div className="px-6 pb-6">
          {/* 참여자 목록 */}
          <div className="flex flex-wrap gap-2 mb-3">
            {members.map((m) => (
              <div
                key={m.id}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                  m.id === userId
                    ? 'bg-indigo-100 border-indigo-200 text-indigo-700'
                    : m.status === 'online' ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : m.status === 'away' ? 'bg-amber-50 border-amber-200 text-amber-700'
                    : m.status === 'client' ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'bg-slate-50 border-slate-200 text-slate-400'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${getStatusDot(m.status)}`} />
                {m.display_name}
                {m.id === userId && <span className="text-[10px] opacity-60">(나)</span>}
              </div>
            ))}
          </div>

          {/* Messages */}
          <div ref={messagesRef} className="h-[360px] overflow-y-auto rounded-lg bg-white border border-slate-200 p-4 space-y-3 mb-3">
            {messages.length === 0 && (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-slate-400">메시지가 없습니다. 첫 메시지를 보내보세요.</p>
              </div>
            )}
            {messages.map((m) => {
              const isMine = m.sender_id === userId;
              const senderName = profiles[m.sender_id] || '...';
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
                          <img
                            src={m.file_url}
                            alt={m.file_name}
                            className="max-w-full max-h-48 rounded cursor-pointer"
                            onClick={() => setPreviewFile({ name: m.file_name, url: m.file_url, type: m.file_type })}
                          />
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
                      <p className="text-sm">{renderContent(m.content_ko || m.content, isMine)}</p>
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
          <div className="flex gap-2">
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
              title="파일 첨부"
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
                      <span className="text-xs text-slate-400">{m.role === 'worker' ? '직원' : '관리자'}</span>
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
                placeholder="메시지 입력... (@로 멘션)"
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
              전송
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
