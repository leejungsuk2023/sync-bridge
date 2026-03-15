'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { Search, MessageCircle } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────

export interface Conversation {
  id: string; // UUID
  customer_name: string;
  customer_avatar?: string;
  channel_type: 'line' | 'facebook';
  channel_name?: string;
  hospital_prefix?: string;
  status: 'new' | 'open' | 'pending' | 'solved' | 'closed' | 'payment_confirmed';
  subject?: string;
  last_message_preview?: string;
  last_message_at: string;
  last_customer_message_at?: string;
  is_read: boolean;
  assigned_agent_id?: string;
}

type ConversationFilter = 'mine' | 'all' | 'waiting' | 'payment_confirmed';
type ChannelFilter = 'all' | 'line' | 'facebook';

interface ConversationListProps {
  conversations: Conversation[];
  selectedConversationId: string | null;
  onSelect: (conversationId: string) => void;
  filter: ConversationFilter;
  onFilterChange: (filter: ConversationFilter) => void;
  channelFilter: ChannelFilter;
  onChannelFilterChange: (channel: ChannelFilter) => void;
  loading: boolean;
  locale?: 'ko' | 'th';
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  hospital?: string;
  onHospitalChange?: (prefix: string) => void;
  /** Increment to force a re-sort (e.g. on filter/hospital/channel change) */
  sortEpoch?: number;
}

// ─── Constants ──────────────────────────────────────────────────────

export const HOSPITALS = [
  { prefix: 'thebb', name: 'TheBB' },
  { prefix: 'delphic', name: 'Delphic' },
  { prefix: 'will', name: 'Will' },
  { prefix: 'mikclinicthai', name: 'MikClinic' },
  { prefix: 'jyclinicthai', name: 'JY Clinic' },
  { prefix: 'du', name: 'DU' },
  { prefix: 'koreandiet', name: 'Korean Diet' },
  { prefix: 'ourpthai', name: 'OURP' },
  { prefix: 'everbreastthai', name: 'EverBreast' },
  { prefix: 'clyveps_th', name: 'Clyveps' },
  { prefix: 'mycell', name: 'Mycell' },
  { prefix: 'nbclinici', name: 'NB Clinic' },
  { prefix: 'dr.song', name: 'Dr. Song' },
  { prefix: 'lacela', name: 'Lacela' },
  { prefix: 'artline', name: 'Artline' },
  { prefix: 'kleam', name: 'Kleam' },
] as const;

const TEXT = {
  ko: {
    search: '대화 검색...',
    mine: '내 대화',
    all: '전체',
    waiting: '대기',
    paymentConfirmed: '입금완료',
    channelAll: '전체',
    noConversations: '대화가 없습니다',
    loading: '로딩 중...',
    customer: '고객',
    noSubject: '(제목 없음)',
    statusNew: '신규',
    statusOpen: '열림',
    statusPending: '대기 중',
    statusSolved: '해결됨',
    statusClosed: '종료',
    statusPaymentConfirmed: '입금완료',
    loadMore: '더 보기',
    allHospitals: '전체 병원',
  },
  th: {
    search: 'ค้นหาการสนทนา...',
    mine: 'ของฉัน',
    all: 'ทั้งหมด',
    waiting: 'รอตอบ',
    paymentConfirmed: 'ชำระแล้ว',
    channelAll: 'ทั้งหมด',
    noConversations: 'ไม่พบการสนทนา',
    loading: 'กำลังโหลด...',
    customer: 'ลูกค้า',
    noSubject: '(ไม่มีหัวข้อ)',
    statusNew: 'ใหม่',
    statusOpen: 'เปิด',
    statusPending: 'รอตอบ',
    statusSolved: 'แก้แล้ว',
    statusClosed: 'ปิดแล้ว',
    statusPaymentConfirmed: 'ชำระแล้ว',
    loadMore: 'โหลดเพิ่ม',
    allHospitals: 'ทุกโรงพยาบาล',
  },
} as const;

// ─── Inline SVG Channel Icons ────────────────────────────────────────

function LineIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="LINE"
    >
      <rect width="24" height="24" rx="6" fill="#06C755" />
      <path
        d="M20 11.14C20 7.71 16.42 4.93 12 4.93S4 7.71 4 11.14c0 3.07 2.72 5.64 6.39 6.13.25.05.59.17.67.38.08.19.05.49.03.69l-.11.64c-.03.19-.15.75.66.41.81-.34 4.37-2.57 5.96-4.4C19.4 13.79 20 12.53 20 11.14z"
        fill="white"
      />
      <path
        d="M10.15 9.67H9.4a.2.2 0 00-.2.2v3.38c0 .11.09.2.2.2h.75a.2.2 0 00.2-.2V9.87a.2.2 0 00-.2-.2zM14.6 9.67h-.75a.2.2 0 00-.2.2v2.01l-1.55-2.1a.21.21 0 00-.16-.11h-.77a.2.2 0 00-.2.2v3.38c0 .11.09.2.2.2h.75a.2.2 0 00.2-.2v-2.01l1.56 2.1c.04.05.1.09.16.1h.76a.2.2 0 00.2-.2V9.87a.2.2 0 00-.2-.2z"
        fill="#06C755"
      />
    </svg>
  );
}

function FacebookIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Facebook Messenger"
    >
      <rect width="24" height="24" rx="6" fill="#0084FF" />
      <path
        d="M12 4C7.58 4 4 7.36 4 11.5c0 2.18.93 4.14 2.43 5.54V19l2.25-1.24A8.35 8.35 0 0012 18c4.42 0 8-3.36 8-7.5S16.42 4 12 4z"
        fill="white"
      />
      <path
        d="M8.5 13.5l3.08-3.28 1.44 1.44 2.98-1.44-3.08 3.28-1.44-1.44L8.5 13.5z"
        fill="#0084FF"
      />
    </svg>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

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

function getStatusConfig(locale: 'ko' | 'th'): Record<string, { label: string; bg: string; text: string }> {
  const t = TEXT[locale];
  return {
    new:               { label: t.statusNew,              bg: 'bg-blue-100',    text: 'text-blue-700' },
    open:              { label: t.statusOpen,             bg: 'bg-emerald-100', text: 'text-emerald-700' },
    pending:           { label: t.statusPending,          bg: 'bg-amber-100',   text: 'text-amber-700' },
    solved:            { label: t.statusSolved,           bg: 'bg-slate-100',   text: 'text-slate-500' },
    closed:            { label: t.statusClosed,           bg: 'bg-slate-100',   text: 'text-slate-400' },
    payment_confirmed: { label: t.statusPaymentConfirmed, bg: 'bg-green-100',   text: 'text-green-700' },
  };
}

function getFilterTabs(locale: 'ko' | 'th'): { key: ConversationFilter; label: string }[] {
  const t = TEXT[locale];
  return [
    { key: 'mine', label: t.mine },
    { key: 'all', label: t.all },
    { key: 'waiting', label: t.waiting },
    { key: 'payment_confirmed', label: t.paymentConfirmed },
  ];
}

function getChannelTabs(locale: 'ko' | 'th'): { key: ChannelFilter; label: string }[] {
  const t = TEXT[locale];
  return [
    { key: 'all', label: t.channelAll },
    { key: 'line', label: 'LINE' },
    { key: 'facebook', label: 'Facebook' },
  ];
}

function getHospitalName(prefix: string): string {
  const found = HOSPITALS.find((h) => h.prefix === prefix);
  return found ? found.name : prefix;
}

// ─── Component ───────────────────────────────────────────────────────

export default function ConversationList({
  conversations,
  selectedConversationId,
  onSelect,
  filter,
  onFilterChange,
  channelFilter,
  onChannelFilterChange,
  loading,
  locale = 'th',
  hasMore = false,
  onLoadMore,
  loadingMore = false,
  hospital = '',
  onHospitalChange,
  sortEpoch = 0,
}: ConversationListProps) {
  const [search, setSearch] = useState('');
  const t = TEXT[locale];
  const STATUS_CONFIG = getStatusConfig(locale);
  const FILTER_TABS = getFilterTabs(locale);
  const CHANNEL_TABS = getChannelTabs(locale);

  const filteredConversations = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase();
    return conversations.filter(
      (c) =>
        c.customer_name?.toLowerCase().includes(q) ||
        c.subject?.toLowerCase().includes(q) ||
        c.last_message_preview?.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
    );
  }, [conversations, search]);

  // Stable sort: keep positions stable during polling, only re-sort on meaningful changes.
  const stableOrderRef = useRef<string[]>([]);
  const lastSearchRef = useRef(search);
  const lastFilterRef = useRef(filter);
  const lastChannelRef = useRef(channelFilter);
  const lastHospitalRef = useRef(hospital);
  const lastSortEpochRef = useRef(sortEpoch);

  const needsResort =
    stableOrderRef.current.length === 0 ||
    lastSearchRef.current !== search ||
    lastFilterRef.current !== filter ||
    lastChannelRef.current !== channelFilter ||
    lastHospitalRef.current !== hospital ||
    lastSortEpochRef.current !== sortEpoch;

  const sortedConversations = useMemo(() => {
    if (needsResort) {
      const sorted = [...filteredConversations].sort((a, b) => {
        if (!a.is_read && b.is_read) return -1;
        if (a.is_read && !b.is_read) return 1;
        const dateA = a.last_message_at;
        const dateB = b.last_message_at;
        return new Date(dateB).getTime() - new Date(dateA).getTime();
      });
      stableOrderRef.current = sorted.map((c) => c.id);
      lastSearchRef.current = search;
      lastFilterRef.current = filter;
      lastChannelRef.current = channelFilter;
      lastHospitalRef.current = hospital;
      lastSortEpochRef.current = sortEpoch;
      return sorted;
    }

    // Stable mode: keep existing order, prepend brand-new conversations.
    const convMap = new Map(filteredConversations.map((c) => [c.id, c]));
    const result: Conversation[] = [];
    const placed = new Set<string>();

    for (const id of stableOrderRef.current) {
      const conv = convMap.get(id);
      if (conv) {
        result.push(conv);
        placed.add(id);
      }
    }

    const brandNew = filteredConversations.filter((c) => !placed.has(c.id));
    if (brandNew.length > 0) {
      stableOrderRef.current = [
        ...brandNew.map((c) => c.id),
        ...stableOrderRef.current,
      ];
      return [...brandNew, ...result];
    }

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredConversations, search, filter, channelFilter, hospital, sortEpoch]);

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

      {/* Channel Filter Pills */}
      <div className="px-3 py-2 border-b border-slate-100 flex gap-1.5">
        {CHANNEL_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChannelFilterChange(tab.key)}
            className={[
              'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
              channelFilter === tab.key
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            ].join(' ')}
          >
            {tab.key === 'line' && <LineIcon className="w-3 h-3" />}
            {tab.key === 'facebook' && <FacebookIcon className="w-3 h-3" />}
            {tab.key === 'all' && <MessageCircle className="w-3 h-3" />}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filter Tabs (mine / all / waiting) */}
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

      {/* Hospital Filter */}
      {onHospitalChange && (
        <div className="px-3 py-1.5 border-b border-slate-100">
          <select
            value={hospital}
            onChange={(e) => onHospitalChange(e.target.value)}
            className="w-full h-7 text-xs border border-slate-200 rounded-md bg-white text-slate-600 px-2 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none cursor-pointer"
          >
            <option value="">{t.allHospitals}</option>
            {HOSPITALS.map((h) => (
              <option key={h.prefix} value={h.prefix}>
                {h.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Conversation List */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <span className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : sortedConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
            <MessageCircle className="w-8 h-8 opacity-40" />
            <p className="text-sm">{t.noConversations}</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {sortedConversations.map((conv) => {
              const isSelected = conv.id === selectedConversationId;
              const statusConf = STATUS_CONFIG[conv.status] || STATUS_CONFIG.open;
              const timeStr = conv.last_message_at;

              return (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => onSelect(conv.id)}
                  className={[
                    'w-full text-left px-3 py-3 transition-colors relative',
                    isSelected
                      ? 'bg-indigo-50 border-l-2 border-indigo-500'
                      : 'hover:bg-slate-50 border-l-2 border-transparent',
                  ].join(' ')}
                >
                  <div className="flex items-start gap-2">
                    {/* Unread indicator dot */}
                    <div className="flex-shrink-0 mt-1.5">
                      {!conv.is_read ? (
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                      ) : (
                        <div className="w-2 h-2" />
                      )}
                    </div>

                    {/* Channel icon */}
                    <div className="flex-shrink-0 mt-0.5">
                      {conv.channel_type === 'line' ? (
                        <LineIcon className="w-5 h-5" />
                      ) : (
                        <FacebookIcon className="w-5 h-5" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Top row: customer name + time */}
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-sm truncate ${
                            !conv.is_read
                              ? 'font-semibold text-slate-900'
                              : 'font-medium text-slate-700'
                          }`}
                        >
                          {conv.customer_name || t.customer}
                        </span>
                        <span className="text-[10px] text-slate-400 whitespace-nowrap flex-shrink-0">
                          {timeStr ? formatRelativeTime(timeStr, locale) : ''}
                        </span>
                      </div>

                      {/* Subject (if any) */}
                      {conv.subject && (
                        <p
                          className={`text-xs truncate mt-0.5 ${
                            !conv.is_read ? 'text-slate-700' : 'text-slate-500'
                          }`}
                        >
                          {conv.subject}
                        </p>
                      )}

                      {/* Bottom row: status badge + hospital badge */}
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span
                          className={`inline-flex px-1.5 py-0.5 text-[10px] font-medium rounded-full ${statusConf.bg} ${statusConf.text}`}
                        >
                          {statusConf.label}
                        </span>

                        {/* Hospital prefix badge (shown for Facebook conversations or when prefix is set) */}
                        {conv.hospital_prefix && (
                          <span className="inline-flex px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-violet-100 text-violet-700">
                            {getHospitalName(conv.hospital_prefix)}
                          </span>
                        )}

                        {/* Channel name (e.g. LINE OA display name) */}
                        {conv.channel_name && (
                          <span className="text-[10px] text-slate-400 truncate max-w-[80px]">
                            {conv.channel_name}
                          </span>
                        )}
                      </div>

                      {/* Last message preview */}
                      {conv.last_message_preview && (
                        <p className="text-[11px] text-slate-400 truncate mt-1">
                          {conv.last_message_preview}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Load More Button */}
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
