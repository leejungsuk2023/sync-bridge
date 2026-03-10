'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { ChevronDown, FileText, Upload, Sparkles, Save, Send, Loader2, Download } from 'lucide-react';
import { HOSPITALS } from './ZendeskTicketList';

interface MonthlyReportProps {
  userId: string;
  clientId: string | null;
  role: 'bbg_admin' | 'client' | 'hospital' | 'worker';
  hospitalPrefix?: string;
}

interface AdCampaign {
  name: string;
  status: string;
  result_type: string;
  result_type_label: string;
  results: number;
  cost_per_result: number;
  spend: number;
  impressions: number;
  reach: number;
  report_start: string;
  report_end: string;
}

interface AdTotals {
  total_spend: number;
  total_impressions: number;
  total_reach: number;
  total_results: number;
  avg_cost_per_result: number;
}

interface AdParsedData {
  totals: AdTotals;
  campaigns: AdCampaign[];
  by_objective?: Record<string, unknown>;
}

interface ConsultationData {
  totalInquiries: number;
  meaningfulInquiries: number;
  conversions: number;
  conversionRate: number;
  topProcedures: [string, number][];
  growth: { totalInquiries: number; conversions: number };
  summaries: string[];
}

interface ContentPlanItem {
  promised: number | null;
  actual: number | null;
  next_month: number | null;
}

interface ContentPlan {
  photo: ContentPlanItem;
  reels: ContentPlanItem;
  reviewer: ContentPlanItem;
}

interface ReportData {
  id: string;
  hospital_tag: string;
  report_month: string;
  status: 'draft' | 'generating' | 'review' | 'published';
  ad_parsed_data: AdParsedData | null;
  ad_summary: string | null;
  consultation_data: ConsultationData | null;
  consultation_summary: string | null;
  content_plan: ContentPlan | null;
  strategy_current: string | null;
  strategy_next: string | null;
  hospital_requests: string | null;
  sales_focus: string | null;
}

const CONTENT_PLAN_LABELS: Record<keyof ContentPlan, string> = {
  photo: '사진',
  reels: '릴스',
  reviewer: '체험단',
};

const DEFAULT_CONTENT_PLAN: ContentPlan = {
  photo: { promised: 12, actual: null, next_month: null },
  reels: { promised: 3, actual: null, next_month: null },
  reviewer: { promised: 2, actual: null, next_month: null },
};

function getRecentPeriods(count: number): { value: string; label: string }[] {
  const periods: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() - i * 30);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 30);
    const value = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    const label = `${startDate.getMonth() + 1}/${startDate.getDate()} ~ ${endDate.getMonth() + 1}/${endDate.getDate()}`;
    periods.push({ value, label });
  }
  return periods;
}

export default function MonthlyReport({ userId, clientId, role, hospitalPrefix }: MonthlyReportProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [selectedHospital, setSelectedHospital] = useState(hospitalPrefix || '');
  const [selectedPeriod, setSelectedPeriod] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const reportContentRef = useRef<HTMLDivElement>(null);
  const periods = getRecentPeriods(12);
  const isAdmin = role === 'bbg_admin';
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getAuthHeader = useCallback(async () => {
    const session = (await supabase.auth.getSession()).data.session;
    return { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' };
  }, []);

  const hospitalTag = isAdmin ? selectedHospital : (hospitalPrefix || '');

  // Fetch report
  const fetchReport = useCallback(async () => {
    if (!hospitalTag) {
      setReport(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`/api/monthly-report?hospital_tag=${encodeURIComponent(hospitalTag)}&month=${selectedPeriod}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setReport(data.report || null);
      } else if (res.status === 404) {
        setReport(null);
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || 'Failed to fetch report');
      }
    } catch (err) {
      console.error('[MonthlyReport] fetch error:', err);
      setError('보고서를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [hospitalTag, selectedPeriod, getAuthHeader]);

  useEffect(() => {
    if (!collapsed) {
      fetchReport();
    }
  }, [collapsed, fetchReport]);

  // Auto-save debounce for strategy fields
  const autoSave = useCallback(async (updatedReport: ReportData) => {
    if (!isAdmin) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const headers = await getAuthHeader();
        await fetch('/api/monthly-report', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            action: 'update_content',
            hospital_tag: hospitalTag,
            month: selectedPeriod,
            strategy_current: updatedReport.strategy_current,
            strategy_next: updatedReport.strategy_next,
            hospital_requests: updatedReport.hospital_requests,
            sales_focus: updatedReport.sales_focus,
            content_plan: updatedReport.content_plan,
          }),
        });
      } catch (err) {
        console.error('[MonthlyReport] auto-save error:', err);
      }
    }, 1000);
  }, [isAdmin, hospitalTag, selectedPeriod, getAuthHeader]);

  const updateField = (field: keyof ReportData, value: string) => {
    if (!report) return;
    const updated = { ...report, [field]: value };
    setReport(updated);
    autoSave(updated);
  };

  const updateContentPlan = (key: keyof ContentPlan, field: 'actual' | 'next_month', value: number) => {
    if (!report) return;
    const plan = { ...(report.content_plan || DEFAULT_CONTENT_PLAN) };
    plan[key] = { ...plan[key], [field]: value };
    const updated = { ...report, content_plan: plan };
    setReport(updated);
    autoSave(updated);
  };

  // Save
  const handleSave = async () => {
    if (!report) return;
    setSaving(true);
    try {
      const headers = await getAuthHeader();
      const res = await fetch('/api/monthly-report', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'update_content',
          hospital_tag: hospitalTag,
          month: selectedPeriod,
          strategy_current: report.strategy_current,
          strategy_next: report.strategy_next,
          hospital_requests: report.hospital_requests,
          sales_focus: report.sales_focus,
          content_plan: report.content_plan,
          ad_summary: report.ad_summary,
          consultation_summary: report.consultation_summary,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setReport(data.report || report);
      }
    } catch (err) {
      console.error('[MonthlyReport] save error:', err);
    } finally {
      setSaving(false);
    }
  };

  // Generate AI
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const headers = await getAuthHeader();
      const res = await fetch('/api/monthly-report/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ hospital_tag: hospitalTag, month: selectedPeriod }),
      });
      if (res.ok) {
        const data = await res.json();
        setReport(data.report || null);
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || 'AI 생성 실패');
      }
    } catch (err) {
      console.error('[MonthlyReport] generate error:', err);
      setError('AI 생성 중 오류가 발생했습니다.');
    } finally {
      setGenerating(false);
    }
  };

  // Publish
  const handlePublish = async () => {
    if (!confirm('보고서를 발행하시겠습니까? 발행 후 고객사에서 열람할 수 있습니다.')) return;
    setPublishing(true);
    try {
      const headers = await getAuthHeader();
      const res = await fetch('/api/monthly-report', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'publish', hospital_tag: hospitalTag, month: selectedPeriod }),
      });
      if (res.ok) {
        const data = await res.json();
        setReport(data.report || null);
      }
    } catch (err) {
      console.error('[MonthlyReport] publish error:', err);
    } finally {
      setPublishing(false);
    }
  };

  // CSV Upload
  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const formData = new FormData();
      formData.append('file', file);
      formData.append('hospital_tag', hospitalTag);
      formData.append('month', selectedPeriod);
      const res = await fetch('/api/monthly-report/upload-csv', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setReport(data.report || null);
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || 'CSV 업로드 실패');
      }
    } catch (err) {
      console.error('[MonthlyReport] CSV upload error:', err);
      setError('CSV 업로드 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // PDF Export
  const handleExportPdf = async () => {
    if (!reportContentRef.current || !report) return;
    setExporting(true);
    try {
      const html2canvas = (await import('html2canvas-pro')).default;
      const { jsPDF } = await import('jspdf');

      const element = reportContentRef.current;
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      });

      const imgData = canvas.toDataURL('image/png');
      const imgWidth = 210; // A4 width in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const pageHeight = 297; // A4 height in mm

      const pdf = new jsPDF('p', 'mm', 'a4');
      let yOffset = 0;

      // Multi-page support
      while (yOffset < imgHeight) {
        if (yOffset > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, -yOffset, imgWidth, imgHeight);
        yOffset += pageHeight;
      }

      const hospitalName = HOSPITALS.find(h => h.prefix === hospitalTag)?.name || hospitalTag;
      const periodLabel = periods.find(p => p.value === selectedPeriod)?.label || selectedPeriod;
      pdf.save(`${hospitalName}_보고서_${periodLabel.replace(/\s/g, '')}.pdf`);
    } catch (err) {
      console.error('[MonthlyReport] PDF export error:', err);
      setError('PDF 내보내기에 실패했습니다.');
    } finally {
      setExporting(false);
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs font-medium rounded-full">작성중</span>;
      case 'generating':
        return (
          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-full inline-flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />생성중
          </span>
        );
      case 'review':
        return <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs font-medium rounded-full">검토중</span>;
      case 'published':
        return <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">발행됨</span>;
      default:
        return null;
    }
  };

  const contentPlan = report?.content_plan || DEFAULT_CONTENT_PLAN;
  const ad = report?.ad_parsed_data;
  const consultation = report?.consultation_data;

  return (
    <div className="bg-gradient-to-r from-amber-50/70 to-white rounded-xl shadow-sm border border-amber-100 border-l-4 border-l-amber-400 p-6">
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-amber-600" />
          <h2 className="text-lg font-semibold text-slate-900">월간 보고서</h2>
          {report && statusBadge(report.status)}
        </div>
        <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
      </button>

      {!collapsed && (
        <div className="mt-6 space-y-6">
          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            {isAdmin && (
              <select
                value={selectedHospital}
                onChange={(e) => setSelectedHospital(e.target.value)}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-300"
              >
                <option value="">병원 선택</option>
                {HOSPITALS.map((h) => (
                  <option key={h.prefix} value={h.prefix}>{h.name}</option>
                ))}
              </select>
            )}
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-300"
            >
              {periods.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
              <span className="ml-2 text-slate-500">로딩 중...</span>
            </div>
          ) : !hospitalTag ? (
            <div className="text-center py-8 text-slate-400">병원을 선택해 주세요.</div>
          ) : (
            <>
              <div ref={reportContentRef}>
              {/* ===== 1장: 성과 요약 ===== */}
              <div className="space-y-5">
                <h3 className="text-base font-semibold text-slate-800 border-b border-amber-200 pb-2">1장: 성과 요약</h3>

                {/* 2-1. 광고 성과 */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-slate-700">광고 성과</h4>

                  {ad && (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <MetricCard label="총 지출" value={`${ad.totals?.total_spend?.toLocaleString() ?? '-'}원`} />
                        <MetricCard label="총 노출" value={ad.totals?.total_impressions?.toLocaleString() ?? '-'} />
                        <MetricCard label="총 도달" value={ad.totals?.total_reach?.toLocaleString() ?? '-'} />
                        <MetricCard label="총 결과" value={ad.totals?.total_results?.toLocaleString() ?? '-'} />
                        <MetricCard label="평균 결과당 비용" value={`${ad.totals?.avg_cost_per_result?.toLocaleString() ?? '-'}원`} />
                        <MetricCard label="캠페인 수" value={(ad.campaigns?.length ?? 0).toString()} />
                      </div>

                      {ad.campaigns && ad.campaigns.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm border-collapse">
                            <thead>
                              <tr className="bg-amber-50">
                                <th className="text-left p-2 border-b border-amber-200 font-medium text-slate-600">캠페인</th>
                                <th className="text-left p-2 border-b border-amber-200 font-medium text-slate-600">상태</th>
                                <th className="text-left p-2 border-b border-amber-200 font-medium text-slate-600">유형</th>
                                <th className="text-right p-2 border-b border-amber-200 font-medium text-slate-600">결과</th>
                                <th className="text-right p-2 border-b border-amber-200 font-medium text-slate-600">비용</th>
                                <th className="text-right p-2 border-b border-amber-200 font-medium text-slate-600">노출</th>
                                <th className="text-right p-2 border-b border-amber-200 font-medium text-slate-600">도달</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ad.campaigns.map((c, i) => (
                                <tr key={i} className="border-b border-slate-100 hover:bg-amber-50/50">
                                  <td className="p-2 text-slate-800 max-w-[200px] truncate">{c.name}</td>
                                  <td className="p-2 text-slate-600">{c.status}</td>
                                  <td className="p-2 text-slate-600">{c.result_type_label || c.result_type}</td>
                                  <td className="p-2 text-right text-slate-800">{c.results?.toLocaleString() ?? '-'}</td>
                                  <td className="p-2 text-right text-slate-800">{c.spend?.toLocaleString() ?? '-'}</td>
                                  <td className="p-2 text-right text-slate-800">{c.impressions?.toLocaleString() ?? '-'}</td>
                                  <td className="p-2 text-right text-slate-800">{c.reach?.toLocaleString() ?? '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}

                  {isAdmin && (
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-amber-300 rounded-lg cursor-pointer hover:bg-amber-50 transition-colors text-sm text-amber-700">
                        <Upload className="w-4 h-4" />
                        {uploading ? '업로드 중...' : 'CSV 업로드'}
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".csv"
                          onChange={handleCsvUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                  )}

                  {report?.ad_summary && (
                    <div className="p-3 bg-amber-50 rounded-lg text-sm text-slate-700 whitespace-pre-wrap">{report.ad_summary}</div>
                  )}
                </div>

                {/* 2-2. 상담 내용 요약 */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-slate-700">상담 내용 요약</h4>

                  {consultation && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <MetricCard label="총 상담" value={(consultation.totalInquiries ?? 0).toString()} />
                      <MetricCard label="의미있는 상담" value={(consultation.meaningfulInquiries ?? 0).toString()} />
                      <MetricCard label="예약 전환" value={(consultation.conversions ?? 0).toString()} />
                      <MetricCard label="전환율" value={`${consultation.conversionRate ?? 0}%`} />
                    </div>
                  )}

                  {report?.consultation_summary && (
                    <div className="p-3 bg-amber-50 rounded-lg text-sm text-slate-700 whitespace-pre-wrap">{report.consultation_summary}</div>
                  )}
                </div>

                {/* 2-3. 콘텐츠 업로드 현황 */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-slate-700">콘텐츠 업로드 현황</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-amber-50">
                          <th className="text-left p-2 border-b border-amber-200 font-medium text-slate-600">항목</th>
                          <th className="text-center p-2 border-b border-amber-200 font-medium text-slate-600">약속</th>
                          <th className="text-center p-2 border-b border-amber-200 font-medium text-slate-600">실제</th>
                          <th className="text-center p-2 border-b border-amber-200 font-medium text-slate-600">달성률</th>
                          <th className="text-center p-2 border-b border-amber-200 font-medium text-slate-600">다음달</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(Object.keys(contentPlan) as Array<keyof ContentPlan>).map((key) => {
                          const row = contentPlan[key];
                          const promised = row.promised ?? 0;
                          const actual = row.actual ?? 0;
                          const rate = promised > 0 ? Math.round((actual / promised) * 100) : 0;
                          return (
                            <tr key={key} className="border-b border-slate-100">
                              <td className="p-2 text-slate-800 font-medium">{CONTENT_PLAN_LABELS[key]}</td>
                              <td className="p-2 text-center text-slate-600">{promised}</td>
                              <td className="p-2 text-center">
                                {isAdmin ? (
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={actual || ''}
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value) || 0;
                                      updateContentPlan(key, 'actual', val);
                                    }}
                                    placeholder="0"
                                    className="w-20 text-center px-1 py-0.5 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-amber-300"
                                  />
                                ) : (
                                  <span className="text-slate-800">{actual}</span>
                                )}
                              </td>
                              <td className="p-2 text-center">
                                <div className="flex items-center justify-center gap-2">
                                  <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${rate >= 100 ? 'bg-green-500' : rate >= 50 ? 'bg-amber-500' : 'bg-red-400'}`}
                                      style={{ width: `${Math.min(rate, 100)}%` }}
                                    />
                                  </div>
                                  <span className={`text-xs font-medium ${rate >= 100 ? 'text-green-600' : rate >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                                    {rate}%
                                  </span>
                                </div>
                              </td>
                              <td className="p-2 text-center">
                                {isAdmin ? (
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={row.next_month || ''}
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value) || 0;
                                      updateContentPlan(key, 'next_month', val);
                                    }}
                                    placeholder="0"
                                    className="w-20 text-center px-1 py-0.5 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-amber-300"
                                  />
                                ) : (
                                  <span className="text-slate-800">{row.next_month ?? 0}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* ===== 2장: 전략 ===== */}
              <div className="space-y-4">
                <h3 className="text-base font-semibold text-slate-800 border-b border-amber-200 pb-2">2장: 전략</h3>

                <StrategySection
                  label="이번달 전략"
                  value={report?.strategy_current || ''}
                  onChange={(v) => updateField('strategy_current', v)}
                  editable={isAdmin}
                />
                <StrategySection
                  label="다음달 전략"
                  value={report?.strategy_next || ''}
                  onChange={(v) => updateField('strategy_next', v)}
                  editable={isAdmin}
                />
                <StrategySection
                  label="병원 요청"
                  value={report?.hospital_requests || ''}
                  onChange={(v) => updateField('hospital_requests', v)}
                  editable={isAdmin}
                />
                <StrategySection
                  label="세일즈 포인트"
                  value={report?.sales_focus || ''}
                  onChange={(v) => updateField('sales_focus', v)}
                  editable={isAdmin}
                />
              </div>

              </div>{/* end reportContentRef */}

              {/* Action buttons */}
              <div className="flex flex-wrap gap-3 pt-2">
                {isAdmin && (
                  <>
                    <button
                      onClick={handleGenerate}
                      disabled={generating}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 text-white text-sm font-medium rounded-lg hover:from-amber-600 hover:to-amber-700 disabled:opacity-50 transition-all shadow-sm"
                    >
                      {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      AI 생성
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-amber-300 text-amber-700 text-sm font-medium rounded-lg hover:bg-amber-50 disabled:opacity-50 transition-all"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      저장
                    </button>
                    <button
                      onClick={handlePublish}
                      disabled={publishing || report?.status === 'published'}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-all shadow-sm"
                    >
                      {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      발행
                    </button>
                  </>
                )}
                <button
                  onClick={handleExportPdf}
                  disabled={exporting || !report}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-all"
                >
                  {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  PDF 내보내기
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-amber-100 rounded-lg p-3 shadow-sm">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className="text-lg font-bold text-slate-800">{value}</div>
    </div>
  );
}

/** Parse a value that might be a JSON array string into a string array, or return null */
function tryParseJsonArray(value: string): string[] | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return parsed;
    }
  } catch {}
  return null;
}

/** Render text that might be a JSON array as a bullet list */
function SmartTextDisplay({ value }: { value: string }) {
  if (!value) return <span className="text-slate-400">(내용 없음)</span>;
  const items = tryParseJsonArray(value);
  if (items && items.length > 0) {
    return (
      <ul className="list-disc list-inside space-y-1">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    );
  }
  return <>{value}</>;
}

function StrategySection({ label, value, onChange, editable }: { label: string; value: string; onChange: (v: string) => void; editable: boolean }) {
  // For editable mode, normalize JSON arrays to newline-separated text
  const displayValue = (() => {
    if (!editable) return value;
    const items = tryParseJsonArray(value);
    if (items) return items.join('\n');
    return value;
  })();

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {editable ? (
        <textarea
          value={displayValue}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 resize-y"
          placeholder={`${label}을 입력하세요...`}
        />
      ) : (
        <div className="p-3 bg-slate-50 rounded-lg text-sm text-slate-700 whitespace-pre-wrap min-h-[60px]">
          <SmartTextDisplay value={value} />
        </div>
      )}
    </div>
  );
}
