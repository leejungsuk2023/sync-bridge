'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Send, Paperclip, ArrowLeft, Lock, Globe, ChevronDown, Download, FileText, X } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────

interface Conversation {
  id: string;
  comment_id: number;
  author_type: 'customer' | 'agent' | 'system';
  author_name: string | null;
  body: string;
  body_html: string | null;
  is_public: boolean;
  channel: string | null;
  attachments: any[] | null;
  created_at_zd: string;
}

interface TicketInfo {
  ticket_id: number;
  subject: string;
  status: string;
  requester_name: string;
  channel: string;
  tags: string[];
}

interface ZendeskChatPanelProps {
  ticketId: number;
  user: any;
  profile: any;
  onBack?: () => void;
  onTicketUpdate?: () => void;
  injectedReply?: string | null;
  onInjectedReplyConsumed?: () => void;
}

// ─── Constants ──────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  new:     { label: 'ใหม่',      bg: 'bg-purple-100', text: 'text-purple-700' },
  open:    { label: 'เปิด',      bg: 'bg-emerald-100', text: 'text-emerald-700' },
  pending: { label: 'รอตอบ',     bg: 'bg-amber-100',   text: 'text-amber-700' },
  hold:    { label: 'พักไว้',    bg: 'bg-orange-100',  text: 'text-orange-700' },
  solved:  { label: 'แก้แล้ว',   bg: 'bg-slate-100',   text: 'text-slate-500' },
  closed:  { label: 'ปิดแล้ว',   bg: 'bg-slate-100',   text: 'text-slate-400' },
};

const STATUS_OPTIONS = ['open', 'pending', 'solved'] as const;

function getChannelIcon(channel: string | null): string {
  switch (channel?.toLowerCase()) {
    case 'facebook':
    case 'facebook_messenger':
      return '📱';
    case 'line':
      return '💬';
    case 'email':
      return '✉️';
    case 'web':
    case 'web_widget':
      return '🌐';
    default:
      return '💬';
  }
}

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i.test(url);
}

// ─── Component ──────────────────────────────────────────────────────

export default function ZendeskChatPanel({
  ticketId,
  user,
  profile,
  onBack,
  onTicketUpdate,
  injectedReply,
  onInjectedReplyConsumed,
}: ZendeskChatPanelProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [ticket, setTicket] = useState<TicketInfo | null>(null);
  const [input, setInput] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);

  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);

  // Accept injected reply text from AI panel
  useEffect(() => {
    if (injectedReply) {
      setInput(injectedReply);
      onInjectedReplyConsumed?.();
      textareaRef.current?.focus();
    }
  }, [injectedReply, onInjectedReplyConsumed]);

  const getSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  }, []);

  // ─── Fetch conversations ──────────────────────────────────────

  const fetchConversations = useCallback(async () => {
    try {
      const session = await getSession();
      if (!session) return;

      const res = await fetch(`/api/zendesk/conversations?ticket_id=${ticketId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        console.error('[ZendeskChatPanel] Failed to fetch conversations:', res.status);
        return;
      }

      const data = await res.json();
      setConversations(data.conversations || []);
      if (data.ticket) {
        setTicket(data.ticket);
      }
    } catch (err) {
      console.error('[ZendeskChatPanel] Error fetching conversations:', err);
    } finally {
      setLoading(false);
    }
  }, [ticketId, getSession]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // ─── Realtime subscription ────────────────────────────────────

  useEffect(() => {
    const channel = supabase
      .channel('zendesk_chat_' + ticketId)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'zendesk_conversations',
          filter: `ticket_id=eq.${ticketId}`,
        },
        () => {
          console.log('[ZendeskChatPanel] New conversation for ticket', ticketId);
          fetchConversations();
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [ticketId, fetchConversations]);

  // ─── Auto-scroll ──────────────────────────────────────────────

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [conversations]);

  // ─── Auto-resize textarea ─────────────────────────────────────

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  // ─── Send reply ───────────────────────────────────────────────

  const sendReply = async () => {
    if (!input.trim() || sending) return;
    setSending(true);

    try {
      const session = await getSession();
      if (!session) return;

      const res = await fetch('/api/zendesk/reply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          ticket_id: ticketId,
          body: input.trim(),
          is_public: isPublic,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error('[ZendeskChatPanel] Failed to send reply:', res.status, errData);
        alert('ส่งข้อความไม่สำเร็จ: ' + (errData.error || res.statusText));
        return;
      }

      setInput('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
      // Fetch updated conversations
      await fetchConversations();
    } catch (err) {
      console.error('[ZendeskChatPanel] Send error:', err);
      alert('เกิดข้อผิดพลาดในการส่งข้อความ');
    } finally {
      setSending(false);
    }
  };

  // ─── Change status ────────────────────────────────────────────

  const changeStatus = async (newStatus: string) => {
    setUpdatingStatus(true);
    setShowStatusMenu(false);

    try {
      const session = await getSession();
      if (!session) return;

      const res = await fetch('/api/zendesk/reply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          ticket_id: ticketId,
          status: newStatus,
        }),
      });

      if (res.ok) {
        setTicket((prev) => (prev ? { ...prev, status: newStatus } : prev));
        onTicketUpdate?.();
      } else {
        console.error('[ZendeskChatPanel] Failed to change status:', res.status);
      }
    } catch (err) {
      console.error('[ZendeskChatPanel] Status change error:', err);
    } finally {
      setUpdatingStatus(false);
    }
  };

  // ─── File upload placeholder ──────────────────────────────────

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // TODO Phase 2: implement file upload via Zendesk API
    alert('การแนบไฟล์จะเปิดใช้งานเร็วๆ นี้');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ─── Close status menu on outside click ───────────────────────

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setShowStatusMenu(false);
      }
    };
    if (showStatusMenu) {
      document.addEventListener('mousedown', handleClick);
    }
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showStatusMenu]);

  // ─── Render ───────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const currentStatusConf = STATUS_CONFIG[ticket?.status || 'open'] || STATUS_CONFIG.open;

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="shrink-0 bg-gradient-to-r from-indigo-50 to-white border-b border-indigo-100 px-4 py-3">
        <div className="flex items-center gap-3">
          {onBack && (
            <button type="button" onClick={onBack} className="text-slate-500 hover:text-slate-700 md:hidden">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-900 truncate">
                {ticket?.requester_name || 'ลูกค้า'}
              </span>
              <span className="text-xs" title={ticket?.channel || ''}>
                {getChannelIcon(ticket?.channel || null)}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                #{ticketId}
              </span>
            </div>
          </div>

          {/* Status dropdown */}
          <div className="relative" ref={statusMenuRef}>
            <button
              type="button"
              onClick={() => setShowStatusMenu(!showStatusMenu)}
              disabled={updatingStatus}
              className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full transition-colors ${currentStatusConf.bg} ${currentStatusConf.text}`}
            >
              {updatingStatus ? (
                <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  {currentStatusConf.label}
                  <ChevronDown className="w-3 h-3" />
                </>
              )}
            </button>
            {showStatusMenu && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1 min-w-[120px]">
                {STATUS_OPTIONS.map((s) => {
                  const conf = STATUS_CONFIG[s];
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => changeStatus(s)}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 transition-colors flex items-center gap-2 ${
                        ticket?.status === s ? 'font-semibold' : ''
                      }`}
                    >
                      <span className={`inline-block w-2 h-2 rounded-full ${conf.bg.replace('100', '400')}`} />
                      {conf.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Subject line */}
        {ticket?.subject && (
          <p className="text-xs text-slate-500 mt-1 truncate pl-0 md:pl-0">
            {ticket.subject}
          </p>
        )}

        {/* Tags */}
        {ticket?.tags && ticket.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {ticket.tags.slice(0, 5).map((tag) => (
              <span key={tag} className="inline-flex px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-500 rounded border border-slate-200">
                {tag}
              </span>
            ))}
            {ticket.tags.length > 5 && (
              <span className="text-[10px] text-slate-400">+{ticket.tags.length - 5}</span>
            )}
          </div>
        )}
      </div>

      {/* Image preview modal */}
      {previewImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setPreviewImage(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center text-slate-600 hover:text-slate-900 z-10"
            >
              <X className="w-4 h-4" />
            </button>
            <img src={previewImage.url} alt={previewImage.name} className="max-w-full max-h-[85vh] rounded-lg shadow-2xl" />
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={messagesRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {conversations.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-slate-400">ยังไม่มีข้อความ</p>
          </div>
        )}
        {conversations.map((conv) => {
          const isAgent = conv.author_type === 'agent';
          const isSystem = conv.author_type === 'system';
          const isInternal = !conv.is_public;

          if (isSystem) {
            return (
              <div key={conv.id} className="flex justify-center">
                <span className="text-[11px] text-slate-400 bg-slate-50 px-3 py-1 rounded-full">
                  {conv.body}
                </span>
              </div>
            );
          }

          return (
            <div key={conv.id} className={`flex flex-col ${isAgent ? 'items-end' : 'items-start'}`}>
              {/* Author name */}
              <span className={`text-[11px] font-medium mb-0.5 ${isAgent ? 'text-indigo-600 mr-1' : 'text-slate-600 ml-1'}`}>
                {conv.author_name || (isAgent ? 'เจ้าหน้าที่' : 'ลูกค้า')}
                {isInternal && (
                  <span className="ml-1 text-amber-600 font-normal">(Internal Note)</span>
                )}
              </span>

              {/* Message bubble */}
              <div
                className={`max-w-[75%] rounded-lg px-4 py-2.5 ${
                  isInternal
                    ? 'bg-yellow-50 border border-yellow-200 text-slate-800 italic'
                    : isAgent
                    ? 'bg-indigo-50 text-slate-900'
                    : 'bg-white border border-slate-200 text-slate-900'
                }`}
              >
                {isInternal && (
                  <div className="flex items-center gap-1 mb-1">
                    <Lock className="w-3 h-3 text-amber-500" />
                    <span className="text-[10px] font-medium text-amber-600">Internal Note</span>
                  </div>
                )}

                {/* Body — render HTML if available, else plain text */}
                {conv.body_html ? (
                  <div
                    className="text-sm prose prose-sm max-w-none [&_a]:text-indigo-600 [&_a]:underline [&_img]:max-w-xs [&_img]:rounded"
                    dangerouslySetInnerHTML={{ __html: conv.body_html }}
                  />
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{conv.body}</p>
                )}

                {/* Attachments */}
                {conv.attachments && conv.attachments.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {conv.attachments.map((att: any, idx: number) => {
                      const url = att.content_url || att.url || '';
                      const name = att.file_name || att.name || `file-${idx + 1}`;

                      if (isImageUrl(url) || att.content_type?.startsWith('image/')) {
                        return (
                          <img
                            key={idx}
                            src={url}
                            alt={name}
                            className="max-w-xs max-h-48 rounded cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => setPreviewImage({ url, name })}
                          />
                        );
                      }

                      return (
                        <a
                          key={idx}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-indigo-600 hover:text-indigo-800 text-sm"
                        >
                          <FileText className="w-4 h-4 shrink-0" />
                          <span className="underline truncate">{name}</span>
                          <Download className="w-3.5 h-3.5 shrink-0" />
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Timestamp */}
              <span className={`text-[10px] mt-0.5 ${isAgent ? 'text-indigo-400' : 'text-slate-400'}`}>
                {formatTimestamp(conv.created_at_zd)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-slate-200 bg-white">
        {/* Public / Internal toggle */}
        <div className="px-3 pt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsPublic(true)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
              isPublic
                ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            <Globe className="w-3 h-3" />
            สาธารณะ
          </button>
          <button
            type="button"
            onClick={() => setIsPublic(false)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
              !isPublic
                ? 'bg-amber-100 text-amber-700 border border-amber-200'
                : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            <Lock className="w-3 h-3" />
            บันทึกภายใน
          </button>
        </div>

        {/* Text input + actions */}
        <div className="p-3 flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip"
            onChange={handleFileSelect}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-slate-300 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 transition-colors flex-shrink-0"
            title="แนบไฟล์"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                sendReply();
              }
            }}
            placeholder={isPublic ? 'พิมพ์ข้อความถึงลูกค้า... (Ctrl+Enter ส่ง)' : 'บันทึกภายใน... (Ctrl+Enter ส่ง)'}
            rows={1}
            className="flex-1 min-h-[40px] max-h-[120px] px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow resize-none"
          />

          <button
            type="button"
            onClick={sendReply}
            disabled={sending || !input.trim()}
            className="inline-flex items-center gap-1.5 px-5 h-10 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors flex-shrink-0"
          >
            {sending ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            ส่ง
          </button>
        </div>
      </div>
    </div>
  );
}
