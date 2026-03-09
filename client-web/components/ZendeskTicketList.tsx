'use client';

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Search } from 'lucide-react';

interface Ticket {
  ticket_id: number;
  subject: string;
  status: string;
  requester_name: string;
  channel: string;
  last_customer_comment_at: string | null;
  last_agent_comment_at: string | null;
  last_message_at: string | null;
  is_read: boolean;
  assignee_email: string | null;
  tags: string[];
  preview: string | null;
}

type TicketFilter = 'mine' | 'all' | 'waiting';

interface ZendeskTicketListProps {
  tickets: Ticket[];
  selectedTicketId: number | null;
  onSelect: (ticketId: number) => void;
  filter: TicketFilter;
  onFilterChange: (filter: TicketFilter) => void;
  loading: boolean;
  locale?: 'ko' | 'th';
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}

const TEXT = {
  ko: {
    search: '티켓 검색...',
    mine: '내 티켓',
    all: '전체',
    waiting: '대기',
    noTickets: '티켓이 없습니다',
    loading: '로딩 중...',
    customer: '고객',
    noSubject: '(제목 없음)',
    statusNew: '신규',
    statusOpen: '열림',
    statusPending: '대기 중',
    statusHold: '보류',
    statusSolved: '해결됨',
    statusClosed: '종료',
    loadMore: '더 보기',
  },
  th: {
    search: 'ค้นหาตั๋ว...',
    mine: 'ของฉัน',
    all: 'ทั้งหมด',
    waiting: 'รอ',
    noTickets: 'ไม่พบตั๋ว',
    loading: 'กำลังโหลด...',
    customer: 'ลูกค้า',
    noSubject: '(ไม่มีหัวข้อ)',
    statusNew: 'ใหม่',
    statusOpen: 'เปิด',
    statusPending: 'รอตอบ',
    statusHold: 'พักไว้',
    statusSolved: 'แก้แล้ว',
    statusClosed: 'ปิดแล้ว',
    loadMore: 'โหลดเพิ่ม',
  },
} as const;

// ─── Helpers ────────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string, locale: 'ko' | 'th' = 'th'): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const mins = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (locale === 'ko') {
    if (mins < 1) return '방금';
    if (mins < 60) return `${mins}분 전`;
    if (hours < 24) return `${hours}시간 전`;
    if (days < 7) return `${days}일 전`;
    return date.toLocaleDateString('ko-KR', { day: 'numeric', month: 'short' });
  }

  if (mins < 1) return 'เมื่อกี้';
  if (mins < 60) return `${mins} นาที`;
  if (hours < 24) return `${hours} ชม.`;
  if (days < 7) return `${days} วัน`;
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

function getChannelIcon(channel: string): string {
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

function getStatusConfig(locale: 'ko' | 'th'): Record<string, { label: string; bg: string; text: string }> {
  const t = TEXT[locale];
  return {
    new:     { label: t.statusNew,     bg: 'bg-purple-100',  text: 'text-purple-700' },
    open:    { label: t.statusOpen,    bg: 'bg-emerald-100', text: 'text-emerald-700' },
    pending: { label: t.statusPending, bg: 'bg-amber-100',   text: 'text-amber-700' },
    hold:    { label: t.statusHold,    bg: 'bg-orange-100',  text: 'text-orange-700' },
    solved:  { label: t.statusSolved,  bg: 'bg-slate-100',   text: 'text-slate-500' },
    closed:  { label: t.statusClosed,  bg: 'bg-slate-100',   text: 'text-slate-400' },
  };
}

function getFilterTabs(locale: 'ko' | 'th'): { key: TicketFilter; label: string }[] {
  const t = TEXT[locale];
  return [
    { key: 'mine', label: t.mine },
    { key: 'all', label: t.all },
    { key: 'waiting', label: t.waiting },
  ];
}

// ─── Component ──────────────────────────────────────────────────────

export default function ZendeskTicketList({
  tickets,
  selectedTicketId,
  onSelect,
  filter,
  onFilterChange,
  loading,
  locale = 'th',
  hasMore = false,
  onLoadMore,
  loadingMore = false,
}: ZendeskTicketListProps) {
  const [search, setSearch] = useState('');
  const t = TEXT[locale];
  const STATUS_CONFIG = getStatusConfig(locale);
  const FILTER_TABS = getFilterTabs(locale);

  const filteredTickets = useMemo(() => {
    if (!search.trim()) return tickets;
    const q = search.toLowerCase();
    return tickets.filter(
      (t) =>
        t.subject?.toLowerCase().includes(q) ||
        t.requester_name?.toLowerCase().includes(q) ||
        String(t.ticket_id).includes(q)
    );
  }, [tickets, search]);

  // Sort: unread first, then by last message time
  const sortedTickets = useMemo(() => {
    return [...filteredTickets].sort((a, b) => {
      // Unread first
      if (!a.is_read && b.is_read) return -1;
      if (a.is_read && !b.is_read) return 1;
      // Then by most recent message
      const dateA = a.last_message_at || a.last_customer_comment_at || a.last_agent_comment_at || '';
      const dateB = b.last_message_at || b.last_customer_comment_at || b.last_agent_comment_at || '';
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });
  }, [filteredTickets]);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !hasMore || !onLoadMore) return;

    const handleScroll = () => {
      if (loadingMore) return;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      if (nearBottom) onLoadMore();
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [hasMore, onLoadMore, loadingMore]);

  return (
    <div className="h-full flex flex-col bg-white border-r border-slate-200">
      {/* Search */}
      <div className="p-3 border-b border-slate-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.search}
            className="w-full h-9 pl-9 pr-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
          />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex border-b border-slate-200">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onFilterChange(tab.key)}
            className={[
              'flex-1 py-2 text-xs font-medium transition-colors border-b-2 -mb-px',
              filter === tab.key
                ? 'text-indigo-600 border-indigo-600'
                : 'text-slate-500 border-transparent hover:text-slate-700',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Ticket List */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <span className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : sortedTickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <p className="text-sm">{t.noTickets}</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {sortedTickets.map((ticket) => {
              const isSelected = ticket.ticket_id === selectedTicketId;
              const statusConf = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.open;
              const lastActivity = ticket.last_message_at || ticket.last_customer_comment_at || ticket.last_agent_comment_at;

              return (
                <button
                  key={ticket.ticket_id}
                  type="button"
                  onClick={() => onSelect(ticket.ticket_id)}
                  className={[
                    'w-full text-left px-3 py-3 transition-colors relative',
                    isSelected
                      ? 'bg-indigo-50 border-l-2 border-indigo-500'
                      : 'hover:bg-slate-50 border-l-2 border-transparent',
                  ].join(' ')}
                >
                  <div className="flex items-start gap-2">
                    {/* Unread indicator */}
                    <div className="flex-shrink-0 mt-1.5">
                      {!ticket.is_read ? (
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                      ) : (
                        <div className="w-2 h-2" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Top row: customer name + time */}
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-sm truncate ${!ticket.is_read ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
                          {ticket.requester_name || t.customer}
                        </span>
                        <span className="text-[10px] text-slate-400 whitespace-nowrap flex-shrink-0">
                          {lastActivity ? formatRelativeTime(lastActivity, locale) : ''}
                        </span>
                      </div>

                      {/* Subject */}
                      <p className={`text-xs truncate mt-0.5 ${!ticket.is_read ? 'text-slate-700' : 'text-slate-500'}`}>
                        {ticket.subject || t.noSubject}
                      </p>

                      {/* Bottom row: channel + status */}
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-xs" title={ticket.channel}>
                          {getChannelIcon(ticket.channel)}
                        </span>
                        <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-medium rounded-full ${statusConf.bg} ${statusConf.text}`}>
                          {statusConf.label}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          #{ticket.ticket_id}
                        </span>
                      </div>

                      {/* Preview */}
                      {ticket.preview && (
                        <p className="text-[11px] text-slate-400 truncate mt-1">
                          {ticket.preview}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        {hasMore && !loading && (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="w-full py-3 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors disabled:text-slate-400 flex items-center justify-center gap-2"
          >
            {loadingMore ? (
              <span className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            ) : null}
            {loadingMore ? t.loading : t.loadMore}
          </button>
        )}
      </div>
    </div>
  );
}
