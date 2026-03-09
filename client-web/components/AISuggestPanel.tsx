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

interface AISuggestPanelProps {
  ticketId: number | null;
  onUseReply: (text: string) => void;
  user: any;
  locale?: 'ko' | 'th';
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
  },
} as const;

export default function AISuggestPanel({ ticketId, onUseReply, user, locale = 'th' }: AISuggestPanelProps) {
  const at = AI_TEXT[locale];
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionId, setSuggestionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  // Fetch suggestions when ticketId changes
  useEffect(() => {
    if (!ticketId) {
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
      } catch (err) {
        console.error('[AISuggest] Failed to fetch suggestions:', err);
        setError(at.errorMsg);
      } finally {
        setLoading(false);
      }
    };

    fetchSuggestions();
  }, [ticketId]);

  // Fetch customer info from zendesk_analyses
  useEffect(() => {
    if (!ticketId) {
      setCustomerInfo(null);
      return;
    }

    const fetchCustomerInfo = async () => {
      try {
        // Fetch analysis data (no channel column here)
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
      } catch (err) {
        console.error('[AISuggest] Customer info fetch error:', err);
      }
    };

    fetchCustomerInfo();
  }, [ticketId]);

  // Subscribe to realtime AI suggestion inserts
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
    if (!ticketId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

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

  // Empty state — no ticket selected
  if (!ticketId) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-400 p-6">
        <div className="text-4xl mb-3">💬</div>
        <p className="text-sm">{at.selectTicket}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-slate-200 bg-white">
        <h3 className="text-sm font-semibold text-slate-900">🤖 {at.header}</h3>
      </div>

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
    </div>
  );
}
