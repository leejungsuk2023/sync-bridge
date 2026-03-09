'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { X, Send, CheckCircle, AlertTriangle, XCircle, Loader2 } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────

interface LeadField {
  key: string;
  label: string;
  labelTh: string;
  value: string;
  confidence: number;
  section: 'basic' | 'procedure' | 'medical' | 'other';
}

interface SuggestedQuestion {
  text: string;
  field: string;
}

interface ExtractResult {
  fields: LeadField[];
  suggestedQuestions: SuggestedQuestion[];
  hasExistingLead: boolean;
}

interface LeadInfoPanelProps {
  ticketId: number;
  user: any;
  profile: any;
  locale?: 'ko' | 'th';
  onClose: () => void;
  onQuestionInject: (text: string) => void;
  onSubmitted: () => void;
}

// ─── i18n ───────────────────────────────────────────────────────────

const LEAD_TEXT = {
  ko: {
    title: '세일즈 리드 정보',
    close: '닫기',
    loading: '대화 분석 중...',
    error: '리드 정보를 불러올 수 없습니다',
    retry: '다시 시도',
    sectionBasic: '고객 기본정보',
    sectionProcedure: '시술 관련',
    sectionMedical: '의료 정보',
    sectionOther: '기타',
    extracted: '자동 추출',
    uncertain: '불확실',
    missing: '누락',
    suggestedQuestions: 'AI 추천 질문',
    sendQuestion: '질문 전송',
    requiredInfo: '필수정보',
    complete: '완료',
    submitToCs: 'CS방에 문의',
    submitting: '전송 중...',
    submitSuccess: 'CS방에 전송되었습니다',
    submitError: '전송 실패',
    fieldName: '이름',
    fieldContact: '연락처',
    fieldProcedure: '시술',
    fieldArea: '부위',
    fieldHistory: '병력',
    fieldAllergy: '알레르기',
    fieldMedication: '약물',
  },
  th: {
    title: 'ข้อมูลลีดขาย',
    close: 'ปิด',
    loading: 'กำลังวิเคราะห์การสนทนา...',
    error: 'ไม่สามารถโหลดข้อมูลลีดได้',
    retry: 'ลองใหม่',
    sectionBasic: 'ข้อมูลพื้นฐานลูกค้า',
    sectionProcedure: 'เกี่ยวกับหัตถการ',
    sectionMedical: 'ข้อมูลทางการแพทย์',
    sectionOther: 'อื่นๆ',
    extracted: 'ดึงอัตโนมัติ',
    uncertain: 'ไม่แน่ใจ',
    missing: 'ขาดข้อมูล',
    suggestedQuestions: 'AI แนะนำคำถาม',
    sendQuestion: 'ส่งคำถาม',
    requiredInfo: 'ข้อมูลจำเป็น',
    complete: 'สำเร็จ',
    submitToCs: 'ส่งไปห้อง CS',
    submitting: 'กำลังส่ง...',
    submitSuccess: 'ส่งไปห้อง CS แล้ว',
    submitError: 'ส่งไม่สำเร็จ',
    fieldName: 'ชื่อ',
    fieldContact: 'ช่องทางติดต่อ',
    fieldProcedure: 'หัตถการ',
    fieldArea: 'บริเวณ',
    fieldHistory: 'ประวัติ',
    fieldAllergy: 'แพ้ยา',
    fieldMedication: 'ยาที่ใช้',
  },
} as const;

const REQUIRED_FIELD_KEYS = ['name', 'contact', 'procedure', 'area', 'history', 'allergy', 'medication'];

const SECTION_ORDER: Array<'basic' | 'procedure' | 'medical' | 'other'> = ['basic', 'procedure', 'medical', 'other'];

// ─── Component ──────────────────────────────────────────────────────

export default function LeadInfoPanel({
  ticketId,
  user,
  profile,
  locale = 'th',
  onClose,
  onQuestionInject,
  onSubmitted,
}: LeadInfoPanelProps) {
  const lt = LEAD_TEXT[locale];
  const [fields, setFields] = useState<LeadField[]>([]);
  const [suggestedQuestions, setSuggestedQuestions] = useState<SuggestedQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  }, []);

  // ─── Fetch AI extraction on mount ─────────────────────────────

  const fetchExtraction = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const session = await getSession();
      if (!session) return;

      const res = await fetch('/api/zendesk/extract-lead', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ ticket_id: ticketId }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: ExtractResult = await res.json();
      setFields(data.fields || []);
      setSuggestedQuestions(data.suggestedQuestions || []);
    } catch (err) {
      console.error('[LeadInfo] Failed to fetch extraction:', err);
      setError(lt.error);
    } finally {
      setLoading(false);
    }
  }, [ticketId, getSession, lt.error]);

  useEffect(() => {
    fetchExtraction();
  }, [fetchExtraction]);

  // ─── Debounced PATCH on field edit ────────────────────────────

  const handleFieldChange = (key: string, value: string) => {
    setFields((prev) =>
      prev.map((f) => (f.key === key ? { ...f, value, confidence: value.trim() ? 1 : 0 } : f))
    );

    // Debounce PATCH
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(async () => {
      try {
        const session = await getSession();
        if (!session) return;

        await fetch('/api/zendesk/extract-lead', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ ticket_id: ticketId, field: key, value }),
        });
      } catch (err) {
        console.error('[LeadInfo] Failed to save field:', err);
      }
    }, 800);
  };

  // ─── Submit to CS ─────────────────────────────────────────────

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const session = await getSession();
      if (!session) return;

      const res = await fetch('/api/zendesk/submit-lead', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          ticket_id: ticketId,
          fields: fields.reduce((acc, f) => ({ ...acc, [f.key]: f.value }), {}),
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      setSubmitSuccess(true);
      onSubmitted();
    } catch (err) {
      console.error('[LeadInfo] Submit failed:', err);
      alert(lt.submitError);
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Helpers ──────────────────────────────────────────────────

  const getConfidenceBadge = (confidence: number) => {
    if (confidence > 0.7) {
      return (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">
          <CheckCircle className="w-3 h-3" />
          {lt.extracted}
        </span>
      );
    }
    if (confidence > 0) {
      return (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">
          <AlertTriangle className="w-3 h-3" />
          {lt.uncertain}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-red-700 bg-red-100 px-1.5 py-0.5 rounded-full">
        <XCircle className="w-3 h-3" />
        {lt.missing}
      </span>
    );
  };

  const getSectionLabel = (section: string) => {
    switch (section) {
      case 'basic': return lt.sectionBasic;
      case 'procedure': return lt.sectionProcedure;
      case 'medical': return lt.sectionMedical;
      default: return lt.sectionOther;
    }
  };

  const completedCount = fields.filter(
    (f) => REQUIRED_FIELD_KEYS.includes(f.key) && f.value.trim().length > 0
  ).length;
  const totalRequired = REQUIRED_FIELD_KEYS.length;

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-slate-200 bg-white flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">{lt.title}</h3>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          title={lt.close}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-3">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-sm">{lt.loading}</p>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <button
              onClick={fetchExtraction}
              className="mt-2 text-sm text-red-500 hover:text-red-700 underline"
            >
              {lt.retry}
            </button>
          </div>
        )}

        {/* Fields grouped by section */}
        {!loading && !error && SECTION_ORDER.map((section) => {
          const sectionFields = fields.filter((f) => f.section === section);
          if (sectionFields.length === 0) return null;

          return (
            <div key={section} className="space-y-2">
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {getSectionLabel(section)}
              </h4>
              {sectionFields.map((field) => (
                <div key={field.key} className="bg-white border border-slate-200 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-700">
                      {locale === 'ko' ? field.label : field.labelTh}
                    </label>
                    {getConfidenceBadge(field.confidence)}
                  </div>
                  <input
                    type="text"
                    value={field.value}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    className={`w-full px-2.5 py-1.5 text-sm border rounded-md outline-none transition-colors focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 ${
                      field.confidence > 0.7
                        ? 'border-emerald-200 bg-emerald-50/30'
                        : field.confidence > 0
                        ? 'border-amber-200 bg-amber-50/30'
                        : 'border-red-200 bg-red-50/30'
                    }`}
                    placeholder={locale === 'ko' ? field.label : field.labelTh}
                  />
                </div>
              ))}
            </div>
          );
        })}

        {/* AI Suggested Questions */}
        {!loading && !error && suggestedQuestions.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {lt.suggestedQuestions}
            </h4>
            {suggestedQuestions.map((q, idx) => (
              <div
                key={idx}
                className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 flex items-start gap-2"
              >
                <p className="flex-1 text-sm text-indigo-900 leading-relaxed">{q.text}</p>
                <button
                  type="button"
                  onClick={() => onQuestionInject(q.text)}
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
                >
                  <Send className="w-3 h-3" />
                  {lt.sendQuestion}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer — progress + submit */}
      {!loading && !error && (
        <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 space-y-3">
          {/* Progress bar */}
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-600">
              {lt.requiredInfo}
            </span>
            <span className={`font-semibold ${completedCount === totalRequired ? 'text-emerald-600' : 'text-amber-600'}`}>
              {completedCount}/{totalRequired} {lt.complete}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all ${
                completedCount === totalRequired ? 'bg-emerald-500' : 'bg-amber-400'
              }`}
              style={{ width: `${(completedCount / totalRequired) * 100}%` }}
            />
          </div>

          {/* Submit button */}
          {submitSuccess ? (
            <div className="text-center text-sm text-emerald-600 font-medium py-2">
              <CheckCircle className="w-4 h-4 inline mr-1" />
              {lt.submitSuccess}
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-2.5 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              {submitting ? lt.submitting : lt.submitToCs}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
