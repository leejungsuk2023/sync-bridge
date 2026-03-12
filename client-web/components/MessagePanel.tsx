'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Send,
  Paperclip,
  ArrowLeft,
  Lock,
  Globe,
  ChevronDown,
  Download,
  FileText,
  X,
  MapPin,
  Play,
  Volume2,
  MessageCircle,
  Image as ImageIcon,
  File,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────

interface Message {
  id: string;
  conversation_id: string;
  sender_type: 'customer' | 'agent' | 'system' | 'bot';
  sender_name?: string;
  message_type: 'text' | 'image' | 'file' | 'sticker' | 'video' | 'audio' | 'location' | 'template' | 'system';
  body?: string;
  body_ko?: string;
  body_html?: string;
  media_url?: string;
  media_type?: string;
  media_metadata?: any;
  attachments?: any[];
  is_public: boolean;
  created_at: string;
}

interface ConversationInfo {
  id: string;
  customer_name?: string;
  channel?: string;      // 'line' | 'facebook' | etc.
  status?: string;
  hospital_name?: string;
}

interface MessagePanelProps {
  conversationId: string;  // UUID
  locale?: 'ko' | 'th';
  userId: string;
  userRole?: string;
  onBack?: () => void;
  onConversationUpdate?: () => void;
  injectedReply?: string | null;
  onInjectedReplyConsumed?: () => void;
  onSuggestionSelect?: (text: string, suggestionId: string, index: number) => void;
}

// ─── i18n ────────────────────────────────────────────────────────────

const PANEL_TEXT = {
  ko: {
    public: '공개',
    internal: '내부 메모',
    placeholder: '메시지를 입력하세요... (Ctrl+Enter 전송)',
    placeholderInternal: '내부 메모 작성... (Ctrl+Enter 전송)',
    send: '전송',
    sending: '전송 중...',
    noMessages: '메시지가 없습니다',
    back: '뒤로',
    agent: '상담원',
    customer: '고객',
    bot: '봇',
    internalNote: '내부 메모',
    sendFailed: '메시지 전송 실패: ',
    sendError: '메시지 전송 중 오류가 발생했습니다',
    attachSoon: '파일 첨부 기능은 곧 제공됩니다',
    attachFile: '파일 첨부',
    statusNew: '신규',
    statusOpen: '열림',
    statusPending: '대기 중',
    statusResolved: '해결됨',
    statusClosed: '종료',
    openMaps: '지도에서 보기',
    downloadFile: '파일 다운로드',
    playVideo: '동영상 재생',
    viewOriginal: '원문 보기',
    viewTranslation: '번역 보기',
  },
  th: {
    public: 'สาธารณะ',
    internal: 'บันทึกภายใน',
    placeholder: 'พิมพ์ข้อความถึงลูกค้า... (Ctrl+Enter ส่ง)',
    placeholderInternal: 'บันทึกภายใน... (Ctrl+Enter ส่ง)',
    send: 'ส่ง',
    sending: 'กำลังส่ง...',
    noMessages: 'ยังไม่มีข้อความ',
    back: 'กลับ',
    agent: 'เจ้าหน้าที่',
    customer: 'ลูกค้า',
    bot: 'บอท',
    internalNote: 'บันทึกภายใน',
    sendFailed: 'ส่งข้อความไม่สำเร็จ: ',
    sendError: 'เกิดข้อผิดพลาดในการส่งข้อความ',
    attachSoon: 'การแนบไฟล์จะเปิดใช้งานเร็วๆ นี้',
    attachFile: 'แนบไฟล์',
    statusNew: 'ใหม่',
    statusOpen: 'เปิด',
    statusPending: 'รอตอบ',
    statusResolved: 'แก้แล้ว',
    statusClosed: 'ปิดแล้ว',
    openMaps: 'เปิดในแผนที่',
    downloadFile: 'ดาวน์โหลดไฟล์',
    playVideo: 'เล่นวิดีโอ',
    viewOriginal: 'ดูต้นฉบับ',
    viewTranslation: 'ดูคำแปล',
  },
} as const;

// ─── Constants ──────────────────────────────────────────────────────

function getStatusConfig(locale: 'ko' | 'th'): Record<string, { label: string; bg: string; text: string }> {
  const t = PANEL_TEXT[locale];
  return {
    new:      { label: t.statusNew,      bg: 'bg-purple-100',  text: 'text-purple-700' },
    open:     { label: t.statusOpen,     bg: 'bg-emerald-100', text: 'text-emerald-700' },
    pending:  { label: t.statusPending,  bg: 'bg-amber-100',   text: 'text-amber-700' },
    resolved: { label: t.statusResolved, bg: 'bg-slate-100',   text: 'text-slate-500' },
    closed:   { label: t.statusClosed,   bg: 'bg-slate-100',   text: 'text-slate-400' },
  };
}

const STATUS_OPTIONS = ['open', 'pending', 'resolved'] as const;

function getChannelIcon(channel: string | undefined | null): React.ReactNode {
  switch (channel?.toLowerCase()) {
    case 'facebook':
    case 'facebook_messenger':
      return (
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[11px] font-bold"
          style={{ background: 'linear-gradient(135deg, #1877f2, #42a5f5)' }}
          title="Facebook Messenger"
        >
          f
        </span>
      );
    case 'line':
      return (
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[10px] font-bold"
          style={{ background: '#06C755' }}
          title="LINE"
        >
          L
        </span>
      );
    default:
      return <MessageCircle className="w-4 h-4 text-slate-400" />;
  }
}

function formatTimestamp(dateStr: string, locale: 'ko' | 'th' = 'th'): string {
  const date = new Date(dateStr);
  return date.toLocaleString(locale === 'ko' ? 'ko-KR' : 'th-TH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i.test(url);
}

// ─── Rich message-type renderers ────────────────────────────────────

function ImageMessage({
  url,
  alt,
  isSticker,
  onImageClick,
}: {
  url: string;
  alt?: string;
  isSticker?: boolean;
  onImageClick: (url: string, name: string) => void;
}) {
  return (
    <img
      src={url}
      alt={alt || 'image'}
      className={`rounded-lg cursor-pointer hover:opacity-90 transition-opacity mt-1 ${
        isSticker ? 'max-w-[120px] max-h-[120px]' : 'max-w-[280px] max-h-56'
      }`}
      onClick={() => !isSticker && onImageClick(url, alt || 'image')}
    />
  );
}

function VideoMessage({ url, metadata }: { url: string; metadata?: any }) {
  const poster = metadata?.thumbnail_url || metadata?.preview_url || undefined;
  return (
    <div className="mt-1 max-w-[280px]">
      <video
        controls
        poster={poster}
        className="w-full rounded-lg"
        style={{ maxHeight: '200px' }}
        preload="metadata"
      >
        <source src={url} />
      </video>
    </div>
  );
}

function AudioMessage({ url }: { url: string }) {
  return (
    <div className="mt-1 flex items-center gap-2">
      <Volume2 className="w-4 h-4 text-slate-400 shrink-0" />
      <audio controls className="h-8 max-w-[220px]" preload="metadata">
        <source src={url} />
      </audio>
    </div>
  );
}

function FileMessage({ url, name, label }: { url: string; name: string; label: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 text-indigo-600 hover:text-indigo-800 text-sm mt-1 underline"
    >
      <File className="w-4 h-4 shrink-0" />
      <span className="truncate">{name}</span>
      <Download className="w-3.5 h-3.5 shrink-0" />
    </a>
  );
}

function LocationMessage({
  body,
  metadata,
  label,
}: {
  body?: string;
  metadata?: any;
  label: string;
}) {
  const lat = metadata?.latitude;
  const lng = metadata?.longitude;
  const address = metadata?.address || body || '';
  const mapsUrl =
    lat && lng
      ? `https://www.google.com/maps?q=${lat},${lng}`
      : address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
      : null;

  return (
    <div className="mt-1 flex flex-col gap-1">
      <div className="flex items-start gap-1.5">
        <MapPin className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
        <span className="text-sm text-slate-700">{address || '위치 정보'}</span>
      </div>
      {mapsUrl && (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-indigo-600 hover:underline ml-5"
        >
          {label}
        </a>
      )}
    </div>
  );
}

// ─── Main message content dispatcher ─────────────────────────────────

function MessageContent({
  message,
  locale,
  onImageClick,
}: {
  message: Message;
  locale: 'ko' | 'th';
  onImageClick: (url: string, name: string) => void;
}) {
  const t = PANEL_TEXT[locale];
  const { message_type, media_url, media_metadata, body, body_ko, body_html, attachments } = message;
  const [showOriginal, setShowOriginal] = useState(false);

  const displayBody = locale === 'ko' && body_ko ? (showOriginal ? body : body_ko) : body;

  switch (message_type) {
    case 'image':
      return (
        <>
          {media_url && (
            <ImageMessage url={media_url} alt={body} isSticker={false} onImageClick={onImageClick} />
          )}
          {body && <p className="text-sm whitespace-pre-wrap break-words mt-1 text-slate-600 italic">{body}</p>}
        </>
      );

    case 'sticker':
      return media_url ? (
        <ImageMessage url={media_url} alt="sticker" isSticker={true} onImageClick={onImageClick} />
      ) : null;

    case 'video':
      return (
        <>
          {media_url && <VideoMessage url={media_url} metadata={media_metadata} />}
          {body && <p className="text-sm whitespace-pre-wrap break-words mt-1">{body}</p>}
        </>
      );

    case 'audio':
      return media_url ? <AudioMessage url={media_url} /> : null;

    case 'file':
      return media_url ? (
        <FileMessage
          url={media_url}
          name={media_metadata?.filename || body || 'file'}
          label={t.downloadFile}
        />
      ) : null;

    case 'location':
      return (
        <LocationMessage body={body} metadata={media_metadata} label={t.openMaps} />
      );

    case 'template':
    case 'text':
    default: {
      const renderBody = displayBody || body || '';
      return (
        <>
          {body_html && !(locale === 'ko' && body_ko) ? (
            <div
              className="text-sm prose prose-sm max-w-none [&_a]:text-indigo-600 [&_a]:underline [&_img]:max-w-xs [&_img]:rounded"
              dangerouslySetInnerHTML={{ __html: body_html }}
            />
          ) : (
            renderBody && (
              <p className="text-sm whitespace-pre-wrap break-words">{renderBody}</p>
            )
          )}

          {/* Korean translation toggle */}
          {locale === 'ko' && body_ko && (
            <button
              type="button"
              onClick={() => setShowOriginal((v) => !v)}
              className="text-[10px] text-slate-400 hover:text-indigo-500 mt-0.5"
            >
              {showOriginal ? t.viewTranslation : t.viewOriginal}
            </button>
          )}

          {/* Attachments */}
          {attachments && attachments.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {attachments.map((att: any, idx: number) => {
                const url = att.url || att.content_url || '';
                const name = att.filename || att.name || `file-${idx + 1}`;
                if (isImageUrl(url) || att.content_type?.startsWith('image/')) {
                  return (
                    <img
                      key={idx}
                      src={url}
                      alt={name}
                      className="max-w-xs max-h-48 rounded cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => onImageClick(url, name)}
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
        </>
      );
    }
  }
}

// ─── Component ──────────────────────────────────────────────────────

export default function MessagePanel({
  conversationId,
  locale = 'th',
  userId,
  userRole,
  onBack,
  onConversationUpdate,
  injectedReply,
  onInjectedReplyConsumed,
  onSuggestionSelect,
}: MessagePanelProps) {
  const t = PANEL_TEXT[locale];
  const STATUS_CONFIG = getStatusConfig(locale);

  const [messages, setMessages] = useState<Message[]>([]);
  const [conversation, setConversation] = useState<ConversationInfo | null>(null);
  const [input, setInput] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<{
    file: File;
    localUrl: string;
    messageType: 'image' | 'file';
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Track whether user has scrolled up (suppress auto-scroll)
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef(0);

  // ─── Accept injected reply from AI panel ─────────────────────

  useEffect(() => {
    if (injectedReply) {
      setInput(injectedReply);
      onInjectedReplyConsumed?.();
      textareaRef.current?.focus();
    }
  }, [injectedReply, onInjectedReplyConsumed]);

  // ─── Session helper ───────────────────────────────────────────

  const getSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  }, []);

  // ─── Fetch messages ───────────────────────────────────────────

  const fetchMessages = useCallback(async () => {
    try {
      const session = await getSession();
      if (!session) return;

      const res = await fetch(
        `/api/messaging/messages?conversation_id=${conversationId}&locale=${locale}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );

      if (!res.ok) {
        console.error('[MessagePanel] Failed to fetch messages:', res.status);
        return;
      }

      const data = await res.json();
      setMessages(data.messages || []);
      if (data.conversation) {
        setConversation(data.conversation);
      }

      // Mark conversation as read
      fetch('/api/messaging/read', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ conversation_id: conversationId }),
      }).catch((err) => console.error('[MessagePanel] Mark read error:', err));
    } catch (err) {
      console.error('[MessagePanel] Error fetching messages:', err);
    } finally {
      setLoading(false);
    }
  }, [conversationId, locale, getSession]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // ─── Periodic polling (fallback for missed realtime events) ───

  useEffect(() => {
    const interval = setInterval(() => {
      fetchMessages();
    }, 15_000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  // ─── Realtime subscription ────────────────────────────────────

  useEffect(() => {
    const channel = supabase
      .channel('messages_panel_' + conversationId)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'channel_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          console.log('[MessagePanel] New message for conversation', conversationId);
          const newMsg = payload.new as Message;
          setMessages((prev) => {
            // Avoid duplicate if polling already added it
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [conversationId]);

  // ─── Auto-scroll ──────────────────────────────────────────────

  const handleScroll = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setUserScrolledUp(distanceFromBottom > 80);
  }, []);

  useEffect(() => {
    if (!userScrolledUp && messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages, userScrolledUp]);

  // ─── Auto-resize textarea ─────────────────────────────────────

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  // ─── Send message ─────────────────────────────────────────────

  const sendMessage = async () => {
    const hasText = input.trim().length > 0;
    const hasAttachment = !!pendingAttachment;
    if ((!hasText && !hasAttachment) || sending || uploading) return;

    setSending(true);

    try {
      const session = await getSession();
      if (!session) return;

      let mediaUrl: string | undefined;
      let messageType: string | undefined;
      let fileName: string | undefined;

      // ── Step 1: upload attachment if present ──────────────────
      if (pendingAttachment) {
        setUploading(true);
        try {
          const formData = new FormData();
          formData.append('file', pendingAttachment.file);

          const uploadRes = await fetch('/api/messaging/upload', {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}` },
            body: formData,
          });

          if (!uploadRes.ok) {
            const errData = await uploadRes.json().catch(() => ({}));
            console.error('[MessagePanel] Upload failed:', uploadRes.status, errData);
            alert(t.sendFailed + (errData.error || uploadRes.statusText));
            return;
          }

          const uploadData = await uploadRes.json();
          mediaUrl = uploadData.url;
          messageType = uploadData.message_type;
          fileName = uploadData.file_name;
        } finally {
          setUploading(false);
        }
      }

      // ── Step 2: send the reply ────────────────────────────────
      const replyPayload: Record<string, any> = {
        conversation_id: conversationId,
        is_public: isPublic,
      };
      if (hasText) replyPayload.body = input.trim();
      if (mediaUrl) {
        replyPayload.media_url = mediaUrl;
        replyPayload.message_type = messageType;
        if (fileName) replyPayload.file_name = fileName;
      }

      const res = await fetch('/api/messaging/reply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(replyPayload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error('[MessagePanel] Failed to send message:', res.status, errData);
        alert(t.sendFailed + (errData.error || res.statusText));
        return;
      }

      setInput('');
      clearAttachment();
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
      setUserScrolledUp(false);
      await fetchMessages();
    } catch (err) {
      console.error('[MessagePanel] Send error:', err);
      alert(t.sendError);
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

      const res = await fetch('/api/messaging/status', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ conversation_id: conversationId, status: newStatus }),
      });

      if (res.ok) {
        setConversation((prev) => (prev ? { ...prev, status: newStatus } : prev));
        onConversationUpdate?.();
      } else {
        console.error('[MessagePanel] Failed to change status:', res.status);
      }
    } catch (err) {
      console.error('[MessagePanel] Status change error:', err);
    } finally {
      setUpdatingStatus(false);
    }
  };

  // ─── File select — stage the attachment for preview ──────────

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = '';

    const isImage = file.type.startsWith('image/');
    const localUrl = URL.createObjectURL(file);
    setPendingAttachment({ file, localUrl, messageType: isImage ? 'image' : 'file' });
  };

  // ─── Drag-and-drop handlers ───────────────────────────────────

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) setDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setDragOver(false);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    dragCounterRef.current = 0;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const isImage = file.type.startsWith('image/');
    const localUrl = URL.createObjectURL(file);
    setPendingAttachment({ file, localUrl, messageType: isImage ? 'image' : 'file' });
  };

  // ─── Clear pending attachment ──────────────────────────────────

  const clearAttachment = () => {
    if (pendingAttachment) {
      URL.revokeObjectURL(pendingAttachment.localUrl);
    }
    setPendingAttachment(null);
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

  const currentStatus = conversation?.status || 'open';
  const currentStatusConf = STATUS_CONFIG[currentStatus] || STATUS_CONFIG.open;

  return (
    <div className="h-full flex flex-col bg-white relative" onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}>
      {dragOver && (
        <div className="absolute inset-0 z-40 bg-indigo-500/20 border-2 border-dashed border-indigo-400 rounded-xl flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-xl px-6 py-4 shadow-lg text-center">
            <p className="text-indigo-600 font-semibold text-sm">{locale === 'th' ? 'วางไฟล์ที่นี่' : '파일을 여기에 놓으세요'}</p>
            <p className="text-slate-400 text-xs mt-1">{locale === 'th' ? 'รูปภาพ, เอกสาร ฯลฯ' : '이미지, 문서 등'}</p>
          </div>
        </div>
      )}
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="shrink-0 bg-gradient-to-r from-indigo-50 to-white border-b border-indigo-100 px-4 py-3">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="text-slate-500 hover:text-slate-700 md:hidden"
              aria-label={t.back}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-slate-900 truncate">
                {conversation?.customer_name || t.customer}
              </span>
              {/* Channel icon */}
              <span title={conversation?.channel || ''}>
                {getChannelIcon(conversation?.channel)}
              </span>
              {/* Hospital name for Facebook conversations */}
              {conversation?.hospital_name && (
                <span className="text-[10px] text-slate-400 font-medium truncate">
                  {conversation.hospital_name}
                </span>
              )}
              <span className="text-[10px] text-slate-400 font-mono truncate">
                {conversationId.slice(0, 8)}
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
              <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1 min-w-[130px]">
                {STATUS_OPTIONS.map((s) => {
                  const conf = STATUS_CONFIG[s];
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => changeStatus(s)}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 transition-colors flex items-center gap-2 ${
                        currentStatus === s ? 'font-semibold' : ''
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
      </div>

      {/* ── Image lightbox ─────────────────────────────────────── */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center text-slate-600 hover:text-slate-900 z-10"
            >
              <X className="w-4 h-4" />
            </button>
            <img
              src={previewImage.url}
              alt={previewImage.name}
              className="max-w-full max-h-[85vh] rounded-lg shadow-2xl"
            />
          </div>
        </div>
      )}

      {/* ── Messages ───────────────────────────────────────────── */}
      <div
        ref={messagesRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-3"
      >
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-slate-400">{t.noMessages}</p>
          </div>
        )}

        {messages.map((msg) => {
          const isAgent = msg.sender_type === 'agent' || msg.sender_type === 'bot';
          const isSystem = msg.sender_type === 'system' || msg.message_type === 'system';
          const isInternal = !msg.is_public;

          // System messages — centered pill
          if (isSystem) {
            return (
              <div key={msg.id} className="flex justify-center">
                <span className="text-[11px] text-slate-400 bg-slate-50 px-3 py-1 rounded-full">
                  {msg.body || ''}
                </span>
              </div>
            );
          }

          const senderLabel =
            msg.sender_name ||
            (isAgent
              ? msg.sender_type === 'bot'
                ? t.bot
                : t.agent
              : t.customer);

          return (
            <div key={msg.id} className={`flex flex-col ${isAgent ? 'items-end' : 'items-start'}`}>
              {/* Sender name */}
              <span
                className={`text-[11px] font-medium mb-0.5 ${
                  isAgent ? 'text-indigo-600 mr-1' : 'text-slate-600 ml-1'
                }`}
              >
                {senderLabel}
                {isInternal && (
                  <span className="ml-1 text-amber-600 font-normal">({t.internalNote})</span>
                )}
              </span>

              {/* Bubble */}
              <div
                className={`max-w-[75%] rounded-lg px-4 py-2.5 ${
                  isInternal
                    ? 'bg-yellow-50 border border-yellow-200 text-slate-800 italic'
                    : isAgent
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white border border-slate-200 text-slate-900'
                }`}
              >
                {isInternal && (
                  <div className="flex items-center gap-1 mb-1">
                    <Lock className="w-3 h-3 text-amber-500" />
                    <span className="text-[10px] font-medium text-amber-600">{t.internalNote}</span>
                  </div>
                )}
                <MessageContent
                  message={msg}
                  locale={locale}
                  onImageClick={(url, name) => setPreviewImage({ url, name })}
                />
              </div>

              {/* Timestamp */}
              <span
                className={`text-[10px] mt-0.5 ${isAgent ? 'text-indigo-400' : 'text-slate-400'}`}
              >
                {formatTimestamp(msg.created_at, locale)}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Input area ─────────────────────────────────────────── */}
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
            {t.public}
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
            {t.internal}
          </button>
        </div>

        {/* Pending attachment preview */}
        {pendingAttachment && (
          <div className="px-3 pb-2 flex items-center gap-2">
            {pendingAttachment.messageType === 'image' ? (
              <img
                src={pendingAttachment.localUrl}
                alt="attachment preview"
                className="h-16 w-16 object-cover rounded-lg border border-slate-200"
              />
            ) : (
              <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700">
                <File className="w-4 h-4 shrink-0 text-slate-400" />
                <span className="truncate max-w-[160px]">{pendingAttachment.file.name}</span>
              </div>
            )}
            <button
              type="button"
              onClick={clearAttachment}
              className="w-6 h-6 rounded-full bg-slate-200 hover:bg-slate-300 flex items-center justify-center text-slate-600 transition-colors"
              title="Remove attachment"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

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
            title={t.attachFile}
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
                sendMessage();
              }
            }}
            placeholder={isPublic ? t.placeholder : t.placeholderInternal}
            rows={3}
            className="flex-1 min-h-[72px] max-h-[200px] px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow resize-y"
          />

          <button
            type="button"
            onClick={sendMessage}
            disabled={sending || uploading || (!input.trim() && !pendingAttachment)}
            className="inline-flex items-center gap-1.5 px-5 h-10 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors flex-shrink-0"
          >
            {sending || uploading ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {sending || uploading ? t.sending : t.send}
          </button>
        </div>
      </div>
    </div>
  );
}
