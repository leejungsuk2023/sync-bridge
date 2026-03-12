'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import QuickReplyChips from './QuickReplyChips';

interface Suggestion {
  id: string;
  text?: string;
  reply_text?: string;
  confidence: number;
  reasoning: string;
}

interface CustomerInfo {
  customer_name: string | null;
  interested_procedure: string | null;
  channel: string | null;
  ticket_count: number;
}

interface HospitalKBData {
  hospitalInfo: {
    display_name_th: string | null;
    display_name_ko: string | null;
    address_th: string | null;
    address_ko: string | null;
    phone: string | null;
    website: string | null;
    description_th: string | null;
    specialties: string[] | null;
  } | null;
  doctors: Array<{
    name_th: string | null;
    title_th: string | null;
    specialties: string[] | null;
  }>;
  procedures: Array<{
    name_th: string | null;
    name_ko: string;
    category: string;
    price_min: number | null;
    price_max: number | null;
    price_currency: string;
    price_note: string | null;
    is_popular: boolean;
  }>;
  activePromotions: Array<{
    title_th: string | null;
    title_ko: string;
    description_th: string | null;
    ends_at: string | null;
  }>;
}

interface AISuggestPanelProps {
  ticketId: number | null;
  conversationId?: string | null;
  onUseReply: (text: string) => void;
  user: any;
  locale?: 'ko' | 'th';
}

const KRW_TO_THB = 0.025;

function formatThbApprox(krw: number): string {
  return `~${Math.round(krw * KRW_TO_THB).toLocaleString()} THB`;
}

const AI_TEXT = {
  ko: {
    header: 'AI 추천 답변',
    selectTicket: '티켓을 선택하면 AI 추천을 볼 수 있습니다',
    suggestion: '추천',
    useReply: '이 답변 사용',
    edit: '수정',
    save: '저장',
    cancel: '취소',
    retry: '다시 시도',
    noSuggestions: '이 티켓에 대한 추천이 아직 없습니다',
    errorMsg: 'AI 추천을 불러올 수 없습니다',
    customerInfo: '고객 정보',
    name: '이름:',
    procedure: '관심 시술:',
    channel: '채널:',
    prevTickets: '이전 티켓:',
    tabAI: 'AI추천',
    tabKB: '병원정보',
    kbNoData: '이 티켓의 병원 정보를 찾을 수 없습니다',
    kbDoctors: '의료진',
    kbProcedures: '시술 & 가격',
    kbPromotions: '현재 프로모션',
    kbNoEnd: '무기한',
    kbUntil: '~',
    kbPriceOnConsult: '상담 후 결정',
  },
  th: {
    header: 'AI แนะนำคำตอบ',
    selectTicket: 'เลือกตั๋วเพื่อดูคำแนะนำ',
    suggestion: 'แนะนำ',
    useReply: 'ใช้คำตอบนี้',
    edit: 'แก้ไข',
    save: 'บันทึก',
    cancel: 'ยกเลิก',
    retry: 'ลองใหม่',
    noSuggestions: 'ยังไม่มีคำแนะนำสำหรับตั๋วนี้',
    errorMsg: 'ไม่สามารถแนะนำคำตอบได้',
    customerInfo: 'ข้อมูลลูกค้า',
    name: 'ชื่อ:',
    procedure: 'หัตถการ:',
    channel: 'ช่องทาง:',
    prevTickets: 'ตั๋วก่อนหน้า:',
    tabAI: 'AI แนะนำ',
    tabKB: 'ข้อมูลโรงพยาบาล',
    kbNoData: 'ไม่พบข้อมูลโรงพยาบาลสำหรับตั๋วนี้',
    kbDoctors: 'แพทย์',
    kbProcedures: 'หัตถการ & ราคา',
    kbPromotions: 'โปรโมชั่นปัจจุบัน',
    kbNoEnd: 'ไม่มีกำหนดสิ้นสุด',
    kbUntil: 'ถึง',
    kbPriceOnConsult: 'ราคาตามการปรึกษา',
  },
} as const;

export default function AISuggestPanel({ ticketId, conversationId, onUseReply, user, locale = 'th' }: AISuggestPanelProps) {
  const at = AI_TEXT[locale];
  const [activeTab, setActiveTab] = useState<'ai' | 'kb'>('ai');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionId, setSuggestionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  // KB tab state
  const [kbData, setKbData] = useState<HospitalKBData | null>(null);
  const [kbLoading, setKbLoading] = useState(false);
  const [kbError, setKbError] = useState<string | null>(null);
  const [procedureSearch, setProcedureSearch] = useState('');

  // Fetch suggestions when ticketId or conversationId changes
  useEffect(() => {
    if (!ticketId && !conversationId) {
      setSuggestions([]);
      setSuggestionId(null);
      setCustomerInfo(null);
      return;
    }

    const fetchSuggestions = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        if (conversationId && !ticketId) {
          // Messaging flow: use /api/messaging/suggest-reply
          const res = await fetch('/api/messaging/suggest-reply', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ conversation_id: conversationId }),
          });

          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const data = await res.json();
          setSuggestions(data.suggestions || []);
          setSuggestionId(data.suggestion_id || null);
        } else if (ticketId) {
          // Zendesk flow: use /api/zendesk/suggest-reply
          const res = await fetch('/api/zendesk/suggest-reply', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ ticket_id: ticketId }),
          });

          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const data = await res.json();
          setSuggestions(data.suggestions || []);
          setSuggestionId(data.suggestion_id || null);
        }
      } catch (err) {
        console.error('[AISuggest] Failed to fetch suggestions:', err);
        setError(at.errorMsg);
      } finally {
        setLoading(false);
      }
    };

    fetchSuggestions();
  }, [ticketId, conversationId]);

  // Fetch customer info from zendesk_analyses (ticket) or conversation_analyses + customers (conversation)
  useEffect(() => {
    if (!ticketId && !conversationId) {
      setCustomerInfo(null);
      return;
    }

    const fetchCustomerInfo = async () => {
      try {
        if (conversationId && !ticketId) {
          // Messaging flow: fetch from conversation_analyses and channel_conversations -> customers
          const { data: analysis } = await supabase
            .from('conversation_analyses')
            .select('interested_procedure')
            .eq('conversation_id', conversationId)
            .maybeSingle();

          const { data: conversation } = await supabase
            .from('channel_conversations')
            .select('channel_type, customers(display_name)')
            .eq('id', conversationId)
            .single();

          const customerName =
            (conversation?.customers as any)?.display_name
            || null;

          setCustomerInfo({
            customer_name: customerName,
            interested_procedure: analysis?.interested_procedure || null,
            channel: (conversation as any)?.channel_type || null,
            ticket_count: 1,
          });
        } else if (ticketId) {
          // Zendesk flow: fetch from zendesk_analyses
          const { data, error: fetchError } = await supabase
            .from('zendesk_analyses')
            .select('customer_name, interested_procedure')
            .eq('ticket_id', ticketId)
            .single();

          if (fetchError) {
            console.error('[AISuggest] Failed to fetch customer info:', fetchError.message);
            return;
          }

          // Fetch channel from zendesk_tickets
          const { data: ticketData } = await supabase
            .from('zendesk_tickets')
            .select('channel')
            .eq('ticket_id', ticketId)
            .single();

          // Count previous tickets by same customer name
          let ticketCount = 1;
          if (data?.customer_name) {
            const { count } = await supabase
              .from('zendesk_analyses')
              .select('id', { count: 'exact', head: true })
              .eq('customer_name', data.customer_name);
            ticketCount = count || 1;
          }

          setCustomerInfo({
            customer_name: data?.customer_name || null,
            interested_procedure: data?.interested_procedure || null,
            channel: ticketData?.channel || null,
            ticket_count: ticketCount,
          });
        }
      } catch (err) {
        console.error('[AISuggest] Customer info fetch error:', err);
      }
    };

    fetchCustomerInfo();
  }, [ticketId, conversationId]);

  // Fetch Hospital KB when kb tab is selected or ticketId/conversationId changes
  useEffect(() => {
    const hasTarget = ticketId || conversationId;
    if (!hasTarget || activeTab !== 'kb') return;

    const fetchKB = async () => {
      setKbLoading(true);
      setKbError(null);
      try {
        let hospitalPrefix: string | null = null;

        if (conversationId && !ticketId) {
          // Messaging flow: get hospital_prefix directly from channel_conversations
          const { data: convData } = await supabase
            .from('channel_conversations')
            .select('hospital_prefix')
            .eq('id', conversationId)
            .single();
          hospitalPrefix = convData?.hospital_prefix || null;
        } else if (ticketId) {
          // Zendesk flow: extract from ticket tags
          const { data: ticketData } = await supabase
            .from('zendesk_tickets')
            .select('tags')
            .eq('ticket_id', ticketId)
            .single();

          const tags: string[] = ticketData?.tags || [];

          // Extract hospital prefix from tags (same logic as server-side extractHospitalPrefix)
          const KNOWN_PREFIXES = [
            'mikclinicthai', 'jyclinicthai', 'ourpthai', 'everbreastthai',
            'clyveps_th', 'koreandiet', 'dr.song', 'artline', 'nbclinici',
            'delphic', 'mycell', 'lacela', 'kleam', 'thebb', 'will', 'du',
          ].sort((a, b) => b.length - a.length);

          outer: for (const tag of tags) {
            for (const prefix of KNOWN_PREFIXES) {
              if (tag === prefix || tag.startsWith(prefix + '_')) {
                hospitalPrefix = prefix;
                break outer;
              }
            }
          }
        }

        if (!hospitalPrefix) {
          setKbData(null);
          setKbLoading(false);
          return;
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const res = await fetch(`/api/hospital-kb?hospital_prefix=${encodeURIComponent(hospitalPrefix)}`, {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // Map API response fields to component state shape
        setKbData({
          hospitalInfo: data.hospital_info ?? null,
          doctors: data.doctors ?? [],
          procedures: data.procedures ?? [],
          activePromotions: data.active_promotions ?? [],
        });
      } catch (err) {
        console.error('[AISuggest] KB fetch error:', err);
        setKbError('ไม่สามารถโหลดข้อมูลโรงพยาบาลได้');
      } finally {
        setKbLoading(false);
      }
    };

    fetchKB();
  }, [ticketId, conversationId, activeTab]);

  // Subscribe to realtime AI suggestion inserts (Zendesk ticketId flow only)
  useEffect(() => {
    if (!ticketId) return;

    const channel = supabase
      .channel(`ai_suggestions_${ticketId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ai_reply_suggestions',
          filter: `ticket_id=eq.${ticketId}`,
        },
        (payload) => {
          console.log('[AISuggest] Realtime suggestion received:', payload.new);
          const newRow = payload.new as any;
          if (newRow.suggestions) {
            // Handle both JSON object and stringified JSON from DB
            const parsed = typeof newRow.suggestions === 'string'
              ? JSON.parse(newRow.suggestions)
              : newRow.suggestions;
            setSuggestions(parsed);
            setSuggestionId(newRow.id);
            setLoading(false);
            setError(null);
          }
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [ticketId]);

  const handleRetry = async () => {
    if (!ticketId && !conversationId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      if (conversationId && !ticketId) {
        const res = await fetch('/api/messaging/suggest-reply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ conversation_id: conversationId }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        setSuggestions(data.suggestions || []);
        setSuggestionId(data.suggestion_id || null);
      } else if (ticketId) {
        const res = await fetch('/api/zendesk/suggest-reply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ ticket_id: ticketId }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        setSuggestions(data.suggestions || []);
        setSuggestionId(data.suggestion_id || null);
      }
    } catch (err) {
      console.error('[AISuggest] Retry failed:', err);
      setError('ไม่สามารถแนะนำคำตอบได้');
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (index: number, text: string) => {
    setEditingIndex(index);
    setEditText(text);
  };

  const saveEdit = (index: number) => {
    const updated = [...suggestions];
    updated[index] = { ...updated[index], text: editText };
    setSuggestions(updated);
    setEditingIndex(null);
    setEditText('');
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditText('');
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence > 0.7) return 'bg-emerald-500';
    if (confidence > 0.4) return 'bg-amber-400';
    return 'bg-red-400';
  };

  const getConfidenceBgColor = (confidence: number) => {
    if (confidence > 0.7) return 'bg-emerald-100';
    if (confidence > 0.4) return 'bg-amber-100';
    return 'bg-red-100';
  };

  // Empty state — no ticket or conversation selected
  if (!ticketId && !conversationId) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-400 p-6">
        <div className="text-4xl mb-3">💬</div>
        <p className="text-sm">{at.selectTicket}</p>
      </div>
    );
  }

  // Filter procedures by search query
  const filteredProcedures = kbData?.procedures.filter(p => {
    if (!procedureSearch) return true;
    const q = procedureSearch.toLowerCase();
    return (p.name_th || '').toLowerCase().includes(q) ||
      p.name_ko.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q);
  }) ?? [];

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-slate-200 bg-white">
        <h3 className="text-sm font-semibold text-slate-900">🤖 {at.header}</h3>
        {/* Tab toggle */}
        <div className="flex gap-1 mt-2">
          <button
            onClick={() => setActiveTab('ai')}
            className={`flex-1 py-1 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'ai'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {at.tabAI}
          </button>
          <button
            onClick={() => setActiveTab('kb')}
            className={`flex-1 py-1 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'kb'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {at.tabKB}
          </button>
        </div>
      </div>

      {/* AI Tab */}
      {activeTab === 'ai' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Loading state */}
          {loading && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 animate-pulse">
                  <div className="h-4 bg-slate-200 rounded w-20" />
                  <div className="space-y-2">
                    <div className="h-3 bg-slate-200 rounded w-full" />
                    <div className="h-3 bg-slate-200 rounded w-3/4" />
                  </div>
                  <div className="h-2 bg-slate-200 rounded w-1/3" />
                  <div className="flex gap-2">
                    <div className="h-8 bg-slate-200 rounded flex-1" />
                    <div className="h-8 bg-slate-200 rounded w-16" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Error state */}
          {error && !loading && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
              <p className="text-sm text-red-600">{error}</p>
              <button
                onClick={handleRetry}
                className="mt-2 text-sm text-red-500 hover:text-red-700 underline"
              >
                {at.retry}
              </button>
            </div>
          )}

          {/* Suggestion cards */}
          {!loading && !error && suggestions.map((suggestion, index) => (
            <div
              key={suggestion.id || index}
              className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 shadow-sm"
            >
              {/* Label */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-indigo-600">
                  {at.suggestion} {index + 1}
                </span>
                <span className="text-[10px] text-slate-400">
                  {Math.round(suggestion.confidence * 100)}%
                </span>
              </div>

              {/* Body text or edit textarea */}
              {editingIndex === index ? (
                <div className="space-y-2">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none"
                    rows={4}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEdit(index)}
                      className="flex-1 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                      {at.save}
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="px-3 py-1.5 text-xs font-medium text-slate-500 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                      {at.cancel}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-700 leading-relaxed">
                  {suggestion.text || suggestion.reply_text || ''}
                </p>
              )}

              {/* Confidence bar */}
              {editingIndex !== index && (
                <div className={`h-1.5 rounded-full ${getConfidenceBgColor(suggestion.confidence)}`}>
                  <div
                    className={`h-full rounded-full transition-all ${getConfidenceColor(suggestion.confidence)}`}
                    style={{ width: `${Math.round(suggestion.confidence * 100)}%` }}
                  />
                </div>
              )}

              {/* Reasoning */}
              {editingIndex !== index && suggestion.reasoning && (
                <p className="text-xs text-slate-400 leading-relaxed">
                  {suggestion.reasoning}
                </p>
              )}

              {/* Action buttons */}
              {editingIndex !== index && (
                <div className="flex gap-2">
                  <button
                    onClick={() => onUseReply(suggestion.text || suggestion.reply_text || '')}
                    className="flex-1 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                  >
                    {at.useReply}
                  </button>
                  <button
                    onClick={() => startEdit(index, suggestion.text || suggestion.reply_text || '')}
                    className="px-3 py-2 text-xs font-medium text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    {at.edit}
                  </button>
                </div>
              )}
            </div>
          ))}

          {/* No suggestions yet (not loading, no error, empty) */}
          {!loading && !error && suggestions.length === 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 text-center shadow-sm">
              <p className="text-sm text-slate-400">{at.noSuggestions}</p>
            </div>
          )}

          {/* Quick Replies */}
          <QuickReplyChips onSelect={onUseReply} />

          {/* Customer Info */}
          {customerInfo && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 shadow-sm">
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {at.customerInfo}
              </h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {customerInfo.customer_name && (
                  <div>
                    <span className="text-slate-400">{at.name}</span>
                    <p className="text-slate-700 font-medium">{customerInfo.customer_name}</p>
                  </div>
                )}
                {customerInfo.interested_procedure && (
                  <div>
                    <span className="text-slate-400">{at.procedure}</span>
                    <p className="text-slate-700">{customerInfo.interested_procedure}</p>
                  </div>
                )}
                {customerInfo.channel && (
                  <div>
                    <span className="text-slate-400">{at.channel}</span>
                    <p className="text-slate-700">{customerInfo.channel}</p>
                  </div>
                )}
                <div>
                  <span className="text-slate-400">{at.prevTickets}</span>
                  <p className="text-slate-700">{customerInfo.ticket_count}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* KB Tab */}
      {activeTab === 'kb' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {kbLoading && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 animate-pulse">
                  <div className="h-4 bg-slate-200 rounded w-32" />
                  <div className="h-3 bg-slate-200 rounded w-full" />
                  <div className="h-3 bg-slate-200 rounded w-3/4" />
                </div>
              ))}
            </div>
          )}

          {kbError && !kbLoading && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
              <p className="text-sm text-red-600">{kbError}</p>
            </div>
          )}

          {!kbLoading && !kbError && !kbData?.hospitalInfo && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 text-center shadow-sm">
              <p className="text-sm text-slate-400">{at.kbNoData}</p>
            </div>
          )}

          {!kbLoading && !kbError && kbData?.hospitalInfo && (
            <>
              {/* Hospital basic info card */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 shadow-sm">
                <h4 className="text-sm font-semibold text-slate-900">
                  {kbData.hospitalInfo.display_name_th || ''}
                  {kbData.hospitalInfo.display_name_ko && (
                    <span className="text-slate-500 font-normal ml-1">
                      ({kbData.hospitalInfo.display_name_ko})
                    </span>
                  )}
                </h4>
                {kbData.hospitalInfo.description_th && (
                  <p className="text-xs text-slate-600">{kbData.hospitalInfo.description_th}</p>
                )}
                <div className="space-y-1 text-xs text-slate-600">
                  {kbData.hospitalInfo.address_th && (
                    <p>📍 {kbData.hospitalInfo.address_th}</p>
                  )}
                  {kbData.hospitalInfo.phone && (
                    <p>📞 {kbData.hospitalInfo.phone}</p>
                  )}
                  {kbData.hospitalInfo.website && (
                    <p>🌐 <span className="text-indigo-600">{kbData.hospitalInfo.website}</span></p>
                  )}
                  {kbData.hospitalInfo.specialties && kbData.hospitalInfo.specialties.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {kbData.hospitalInfo.specialties.map((s, i) => (
                        <span key={i} className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full text-[10px]">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Doctors */}
              {kbData.doctors.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 shadow-sm">
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {at.kbDoctors}
                  </h4>
                  <div className="space-y-2">
                    {kbData.doctors.map((doc, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className="text-slate-400 shrink-0">👨‍⚕️</span>
                        <div>
                          <span className="font-medium text-slate-800">{doc.name_th}</span>
                          {doc.title_th && (
                            <span className="text-slate-500"> — {doc.title_th}</span>
                          )}
                          {doc.specialties && doc.specialties.length > 0 && (
                            <p className="text-slate-400 mt-0.5">{doc.specialties.join(', ')}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Procedures */}
              {kbData.procedures.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 shadow-sm">
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {at.kbProcedures}
                  </h4>
                  <input
                    type="text"
                    value={procedureSearch}
                    onChange={(e) => setProcedureSearch(e.target.value)}
                    placeholder="ค้นหา / 검색..."
                    className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <div className="space-y-2">
                    {filteredProcedures.map((proc, i) => (
                      <div key={i} className="text-xs border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                        <div className="flex items-center gap-1">
                          {proc.is_popular && <span className="text-amber-400">⭐</span>}
                          <span className="font-medium text-slate-800">{proc.name_th}</span>
                          <span className="text-slate-400">({proc.name_ko})</span>
                        </div>
                        <div className="text-slate-500 mt-0.5">
                          {proc.price_min != null ? (
                            <>
                              <span className="text-slate-700">
                                {proc.price_min.toLocaleString()}
                                {proc.price_max && proc.price_max !== proc.price_min
                                  ? `~${proc.price_max.toLocaleString()}`
                                  : ''} KRW
                              </span>
                              <span className="text-indigo-600 ml-1">
                                ({formatThbApprox(proc.price_min)}
                                {proc.price_max && proc.price_max !== proc.price_min
                                  ? `~${formatThbApprox(proc.price_max)}`
                                  : ''})
                              </span>
                            </>
                          ) : (
                            <span className="text-slate-400 italic">{at.kbPriceOnConsult}</span>
                          )}
                          {proc.price_note && (
                            <span className="text-slate-400 ml-1">• {proc.price_note}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Promotions */}
              {kbData.activePromotions.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 shadow-sm">
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {at.kbPromotions}
                  </h4>
                  <div className="space-y-2">
                    {kbData.activePromotions.map((promo, i) => (
                      <div key={i} className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs">
                        <div className="font-medium text-amber-800">
                          🎉 {promo.title_th}
                          {promo.title_ko && (
                            <span className="text-amber-600 font-normal ml-1">({promo.title_ko})</span>
                          )}
                        </div>
                        {promo.description_th && (
                          <p className="text-amber-700 mt-1">{promo.description_th}</p>
                        )}
                        <p className="text-amber-500 mt-1">
                          {promo.ends_at
                            ? `${at.kbUntil} ${promo.ends_at}`
                            : at.kbNoEnd}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
