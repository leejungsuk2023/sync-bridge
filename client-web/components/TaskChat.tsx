'use client';

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { X, Send, Paperclip, FileText, Download, Pencil } from 'lucide-react';
import ImageAnnotator from './ImageAnnotator';

export default function TaskChat({ taskId, userId, onClose, locale = 'ko' }: { taskId: string; userId: string; onClose: () => void; locale?: 'ko' | 'th' }) {
  // Locale-aware label map
  const L = locale === 'th' ? {
    title: 'แชทงาน',
    noMessages: 'ยังไม่มีข้อความ',
    inputPlaceholder: 'พิมพ์ข้อความ... (ใช้ @ เพื่อเมนชัน)',
    send: 'ส่ง',
    attachFile: 'แนบไฟล์',
    fileSizeError: 'ขนาดไฟล์ต้องไม่เกิน 10MB',
    uploadError: 'อัปโหลดไฟล์ไม่สำเร็จ: ',
  } : {
    title: '업무 채팅',
    noMessages: '메시지가 없습니다',
    inputPlaceholder: '메시지 입력... (@로 멘션)',
    send: '전송',
    attachFile: '파일 첨부',
    fileSizeError: '파일 크기는 10MB 이하만 가능합니다.',
    uploadError: '파일 업로드 실패: ',
  };

  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [task, setTask] = useState<any>(null);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ name: string; url: string; type: string } | null>(null);
  const [chatMembers, setChatMembers] = useState<{ id: string; display_name: string }[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [annotatingImage, setAnnotatingImage] = useState<{ url: string; name: string } | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchTask = async () => {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(`/api/tasks?id=${taskId}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const found = (data.tasks || []).find((t: any) => t.id === taskId);
        if (found) setTask(found);
      }
    };
    fetchTask();
  }, [taskId]);

  // 멘션용 멤버 로드
  useEffect(() => {
    const loadMembers = async () => {
      const { data: profile } = await supabase.from('profiles').select('client_id').eq('id', userId).single();
      if (!profile?.client_id) return;
      const { data } = await supabase.from('profiles').select('id, display_name, email').eq('client_id', profile.client_id);
      if (data) setChatMembers(data.map(p => ({ id: p.id, display_name: p.display_name || p.email?.split('@')[0] || '?' })));
    };
    loadMembers();
  }, [userId]);

  const fetchMessages = async () => {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });
    setMessages(data || []);
  };

  // Load sender profiles
  useEffect(() => {
    if (messages.length === 0) return;
    const senderIds = [...new Set(messages.map(m => m.sender_id))];
    const unknown = senderIds.filter(id => !profiles[id]);
    if (unknown.length === 0) return;
    supabase.from('profiles').select('id, display_name, email').in('id', unknown).then(({ data }) => {
      if (data) {
        setProfiles(prev => {
          const next = { ...prev };
          data.forEach((p: any) => { next[p.id] = p.display_name || p.email?.split('@')[0] || '?'; });
          return next;
        });
      }
    });
  }, [messages]);

  useEffect(() => {
    fetchMessages();
    const ch = supabase
      .channel('chat_' + taskId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `task_id=eq.${taskId}` }, () => {
        fetchMessages();
      })
      .subscribe();
    return () => { ch.unsubscribe(); };
  }, [taskId]);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages]);

  // @멘션
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInput(value);
    const cursor = e.target.selectionStart || value.length;
    const before = value.substring(0, cursor);
    const match = before.match(/@([^\s]*)$/);
    if (match) { setMentionFilter(match[1].toLowerCase()); setShowMentions(true); }
    else { setShowMentions(false); }
  };

  const filteredMentions = chatMembers
    .filter(m => m.id !== userId)
    .filter(m => m.display_name.toLowerCase().includes(mentionFilter));

  const selectMention = (member: { id: string; display_name: string }) => {
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
      const member = chatMembers.find(mb => mb.display_name === match![1]);
      if (member) ids.push(member.id);
    }
    return [...new Set(ids)];
  };

  const renderContent = (text: string, isMine: boolean) => {
    if (!text) return null;
    const parts = text.split(/(@\S+)/g);
    return parts.map((part, i) =>
      part.startsWith('@')
        ? <span key={i} className={`font-bold ${isMine ? 'text-yellow-200' : 'text-emerald-600'}`}>{part}</span>
        : <span key={i}>{part}</span>
    );
  };

  const send = async () => {
    if (!input.trim()) return;
    setSending(true);
    setShowMentions(false);
    const original = input.trim();
    const mentionedIds = parseMentions(original);
    setInput('');

    // 1. 메시지 즉시 전송 (번역 없이)
    const { data: inserted } = await supabase.from('messages').insert({
      task_id: taskId,
      sender_id: userId,
      content: original,
      content_ko: original,
      content_th: original,
      sender_lang: locale === 'th' ? 'th' : 'ko',
      mentions: mentionedIds,
    }).select('id').single();
    setSending(false);

    // 2. 번역은 백그라운드에서 처리 후 업데이트
    if (inserted?.id) {
      const targetLang = locale === 'th' ? 'ko' : 'th';
      fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: original, targetLang }),
      }).then(res => {
        if (!res.ok) { console.error('[TaskChat] translate API error:', res.status); return null; }
        return res.json();
      }).then(d => {
        if (d?.translated) {
          const updateField = targetLang === 'th' ? 'content_th' : 'content_ko';
          supabase.from('messages').update({ [updateField]: d.translated }).eq('id', inserted.id)
            .then(({ error }) => { if (error) console.error('[TaskChat] update error:', error.message); });
        }
      }).catch(err => console.error('[TaskChat] translate fetch error:', err));
    }
  };

  const uploadAndSendFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      alert(L.fileSizeError);
      return;
    }
    setUploading(true);
    const ext = file.name.split('.').pop() || 'png';
    const path = `${taskId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from('chat-files').upload(path, file);
    if (error) {
      alert(L.uploadError + error.message);
      setUploading(false);
      return;
    }
    const { data: urlData } = supabase.storage.from('chat-files').getPublicUrl(path);
    await supabase.from('messages').insert({
      task_id: taskId,
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

  return (
    <div className="bg-white rounded-lg border border-slate-300 overflow-hidden flex flex-col" style={{ height: '480px' }} onPaste={handlePaste}>
      {/* Header */}
      <div className="shrink-0 bg-slate-50 border-b border-slate-200 p-4 flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900">{L.title}</h3>
          {task && <p className="text-xs text-slate-600 mt-1 truncate">{task.content}</p>}
        </div>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors ml-2">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Messages */}
      <div ref={messagesRef} className="flex-1 overflow-y-auto p-4 bg-slate-50 space-y-3">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-slate-500">{L.noMessages}</p>
          </div>
        )}
        {messages.map((m) => {
          const isMine = m.sender_id === userId;
          const senderName = profiles[m.sender_id] || '';
          return (
            <div key={m.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
              {!isMine && senderName && (
                <span className="text-[10px] font-medium text-slate-500 mb-0.5 ml-1">{senderName}</span>
              )}
              <div className={`max-w-[75%] rounded-lg px-4 py-2.5 ${
                isMine ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-900'
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
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setAnnotatingImage({ url: m.file_url, name: m.file_name }); }}
                          className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 bg-black/60 hover:bg-black/80 text-white rounded-md px-2 py-1 text-xs flex items-center gap-1 transition-opacity"
                          title="수정 요청"
                        >
                          <Pencil className="w-3 h-3" />
                          수정
                        </button>
                      </div>
                      <p className="text-xs mt-1 opacity-70">{m.file_name}</p>
                    </div>
                  ) : (
                    <a href={m.file_url} target="_blank" rel="noopener noreferrer"
                      className={`flex items-center gap-2 ${isMine ? 'text-white hover:text-emerald-200' : 'text-emerald-600 hover:text-emerald-800'}`}>
                      <FileText className="w-4 h-4 shrink-0" />
                      <span className="text-sm underline truncate">{m.file_name}</span>
                      <Download className="w-3.5 h-3.5 shrink-0" />
                    </a>
                  )
                ) : (
                  <p className="text-sm">{renderContent(m[locale === 'th' ? 'content_th' : 'content_ko'] || m.content, isMine)}</p>
                )}
              </div>
              <span className={`text-[10px] mt-1 ${isMine ? 'text-emerald-700' : 'text-slate-500'}`}>
                {new Date(m.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          );
        })}
      </div>

      {/* Image Preview Modal */}
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

      {/* Input */}
      <div className="shrink-0 border-t border-slate-200 p-4 bg-white flex gap-2">
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
          className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-slate-300 text-slate-500 hover:text-emerald-600 hover:border-emerald-300 disabled:opacity-50 transition-colors"
          title={L.attachFile}
        >
          {uploading ? (
            <span className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <Paperclip className="w-4 h-4" />
          )}
        </button>
        <div className="relative flex-1">
          {showMentions && filteredMentions.length > 0 && (
            <div className="absolute bottom-full mb-1 left-0 right-0 bg-white border border-emerald-200 rounded-lg shadow-lg max-h-36 overflow-y-auto z-20">
              {filteredMentions.slice(0, 5).map((m) => (
                <button key={m.id} type="button"
                  onMouseDown={(e) => { e.preventDefault(); selectMention(m); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 flex items-center gap-2 transition-colors">
                  <span className="font-medium text-slate-700">{m.display_name}</span>
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
            className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow"
          />
        </div>
        <button
          type="button"
          onClick={send}
          disabled={sending || !input.trim()}
          className="inline-flex items-center gap-1.5 px-5 h-10 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
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
