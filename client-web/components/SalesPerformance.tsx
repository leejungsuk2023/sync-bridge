'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { BarChart3, Star, RefreshCw, Users, TrendingUp, AlertTriangle, Search, Building2, ArrowUpRight, ArrowDownRight, RotateCcw, X, Send, Trash2, Eye, Clock, Info } from 'lucide-react';

interface Overview {
  totalTickets: number;
  analyzedTickets: number;
  avgQualityScore: number;
  conversionRate: number;
  followupNeeded: number;
  unassigned: number;
}

interface AssigneeStat {
  name: string;
  email: string;
  ticketCount: number;
  avgQuality: number;
  conversions: number;
}

interface RecentTicket {
  ticket_id: number;
  subject: string;
  assignee_name: string | null;
  quality_score: number | null;
  reservation_converted: boolean | null;
  needs_followup: boolean | null;
  followup_status: string | null;
  summary: string | null;
  created_at_zd: string;
  comment_count: number;
  status: string;
  hospital_name: string | null;
}

interface StatsData {
  overview: Overview;
  byAssignee: AssigneeStat[];
  recentTickets: RecentTicket[];
  totalCount: number;
}

export default function SalesPerformance() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [period, setPeriod] = useState<'week' | 'month'>('month');
  const [ticketLimit, setTicketLimit] = useState(20);
  const [ticketHospitalFilter, setTicketHospitalFilter] = useState('');
  const [analyzingTicketId, setAnalyzingTicketId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [hospitals, setHospitals] = useState<{tag_prefix: string; display_name: string; ticket_count: number}[]>([]);
  const [selectedHospital, setSelectedHospital] = useState('');
  const [hospitalStats, setHospitalStats] = useState<any>(null);
  const [hospitalLoading, setHospitalLoading] = useState(false);
  const [hospitalPeriod, setHospitalPeriod] = useState<'week' | 'month'>('month');
  const [activeTab, setActiveTab] = useState<'sales' | 'hospital' | 'followup'>('sales');
  const [insights, setInsights] = useState<{hospital_strategy: string; sales_improvement: string; hq_management: string} | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState(false);
  const [insightsKey, setInsightsKey] = useState(0);
  const [followupBadge, setFollowupBadge] = useState(0);

  const getAuthHeader = async () => {
    const session = (await supabase.auth.getSession()).data.session;
    return { Authorization: `Bearer ${session?.access_token}` };
  };

  const fetchStats = async () => {
    try {
      const headers = await getAuthHeader();
      const hospitalParam = ticketHospitalFilter ? `&hospital=${encodeURIComponent(ticketHospitalFilter)}` : '';
      const res = await fetch(`/api/zendesk/stats?period=${period}&limit=${ticketLimit}${hospitalParam}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
        setAuthError(false);
      } else if (res.status === 403) {
        setAuthError(true);
      }
    } catch (err) {
      console.error('[SalesPerformance] Failed to fetch stats:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchStats();
  }, [period, ticketLimit, ticketHospitalFilter, refreshKey]);


  // Fetch hospital list on mount
  useEffect(() => {
    const fetchHospitals = async () => {
      try {
        const headers = await getAuthHeader();
        const res = await fetch('/api/zendesk/hospital-stats', { headers });
        if (res.ok) {
          const data = await res.json();
          setHospitals(data.hospitals || []);
        }
      } catch (err) {
        console.error('[SalesPerformance] Failed to fetch hospitals:', err);
      }
    };
    fetchHospitals();
  }, []);

  // Fetch hospital stats when selection or period changes
  useEffect(() => {
    if (!selectedHospital) {
      setHospitalStats(null);
      return;
    }
    const fetchHospitalStats = async () => {
      setHospitalLoading(true);
      try {
        const headers = await getAuthHeader();
        const res = await fetch(`/api/zendesk/hospital-stats?hospital=${encodeURIComponent(selectedHospital)}&period=${hospitalPeriod}`, { headers });
        if (res.ok) {
          const data = await res.json();
          setHospitalStats(data.stats || null);
        }
      } catch (err) {
        console.error('[SalesPerformance] Failed to fetch hospital stats:', err);
      } finally {
        setHospitalLoading(false);
      }
    };
    fetchHospitalStats();
  }, [selectedHospital, hospitalPeriod]);

  // Fetch AI insights when ticket hospital filter changes
  useEffect(() => {
    if (!ticketHospitalFilter) {
      setInsights(null);
      setInsightsError(false);
      return;
    }
    const fetchInsights = async () => {
      setInsightsLoading(true);
      setInsights(null);
      setInsightsError(false);
      try {
        const headers = await getAuthHeader();
        const res = await fetch('/api/zendesk/insights', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ hospital: ticketHospitalFilter }),
        });
        if (res.ok) {
          const data = await res.json();
          setInsights(data.insights || null);
        } else {
          setInsightsError(true);
        }
      } catch (err) {
        console.error('[SalesPerformance] Failed to fetch insights:', err);
        setInsightsError(true);
      } finally {
        setInsightsLoading(false);
      }
    };
    fetchInsights();
  }, [ticketHospitalFilter, insightsKey]);

  // Fetch unread followup actions count for badge
  useEffect(() => {
    const fetchBadge = async () => {
      try {
        const headers = await getAuthHeader();
        const res = await fetch('/api/zendesk/followup-actions?unread_count=true', { headers });
        if (res.ok) {
          const data = await res.json();
          setFollowupBadge(data.unread_count || 0);
        }
      } catch (err) {
        console.error('[SalesPerformance] Badge fetch error:', err);
      }
    };
    fetchBadge();
    const interval = setInterval(fetchBadge, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleMarkFollowup = async (ticketId: number) => {
    try {
      const headers = await getAuthHeader();
      const res = await fetch('/api/zendesk/followup-customers', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticketId, status: 'pending' }),
      });
      if (res.ok) {
        setRefreshKey(prev => prev + 1);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`팔로우업 등록 실패: ${err.error || res.status}`);
      }
    } catch (err) {
      console.error('[SalesPerformance] Followup mark failed:', err);
      alert('팔로우업 등록 중 오류가 발생했습니다.');
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncProgress('');
    let page = 1;
    let totalSynced = 0;
    try {
      const headers = await getAuthHeader();
      while (true) {
        setSyncProgress(`${totalSynced}건 동기화 중... (page ${page})`);
        const res = await fetch('/api/zendesk/sync', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ page, per_page: 20 }),
        });
        if (!res.ok) break;
        const data = await res.json();
        totalSynced += data.synced || 0;
        if (!data.hasMore) break;
        page++;
      }
      setSyncProgress(`${totalSynced}건 동기화 완료`);
      setRefreshKey(prev => prev + 1);
    } catch (err) {
      console.error('[SalesPerformance] Sync failed:', err);
      setSyncProgress('동기화 실패');
    } finally {
      setSyncing(false);
    }
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const headers = await getAuthHeader();
      await fetch('/api/zendesk/analyze', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      setRefreshKey(prev => prev + 1);
    } catch (err) {
      console.error('[SalesPerformance] Analyze failed:', err);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAnalyzeSingle = async (ticketId: number) => {
    setAnalyzingTicketId(ticketId);
    try {
      const headers = await getAuthHeader();
      const res = await fetch('/api/zendesk/analyze', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticketId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`분석 실패: ${err.error || res.status}`);
      } else {
        setRefreshKey(prev => prev + 1);
      }
    } catch (err) {
      console.error('[SalesPerformance] Single analyze failed:', err);
      alert('분석 중 오류가 발생했습니다.');
    } finally {
      setAnalyzingTicketId(null);
    }
  };

  const qualityBadge = (score: number | null) => {
    if (score == null) return <span className="text-slate-400">-</span>;
    if (score <= 2) return <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded-full">{score}</span>;
    if (score === 3) return <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">{score}</span>;
    return <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full">{score}</span>;
  };

  const boolBadge = (val: boolean | null) => {
    if (val == null) return <span className="text-slate-400">-</span>;
    return val
      ? <span className="text-emerald-600 font-medium">O</span>
      : <span className="text-slate-400">X</span>;
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center gap-2 text-slate-500">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Sales 데이터 로딩 중...</span>
        </div>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-red-200 p-6 text-center">
        <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-red-400" />
        <p className="text-red-600 font-medium">세션이 만료되었습니다</p>
        <p className="text-sm text-slate-500 mt-1">로그아웃 후 다시 로그인해 주세요.</p>
      </div>
    );
  }

  const overview = stats?.overview;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-6">
      {/* Header + Actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-slate-900">Sales 성과 트래킹</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            Sync
          </button>
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            <Search className={`w-3.5 h-3.5 ${analyzing ? 'animate-spin' : ''}`} />
            Analyze
          </button>
          {syncProgress && (
            <span className="text-xs text-slate-500">{syncProgress}</span>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('sales')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'sales'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4" />
            Sales 성과
          </span>
        </button>
        <button
          onClick={() => setActiveTab('hospital')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'hospital'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <Building2 className="w-4 h-4" />
            병원별 분석
          </span>
        </button>
        <button
          onClick={() => setActiveTab('followup')}
          className={`relative px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'followup'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <Users className="w-4 h-4" />
            팔로업 고객
          </span>
          {followupBadge > 0 && (
            <span className="absolute -top-1 -right-1 inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold text-white bg-red-500 rounded-full min-w-[18px] leading-none">
              {followupBadge > 99 ? '99+' : followupBadge}
            </span>
          )}
        </button>
      </div>

      {/* Tab: Sales Performance */}
      {activeTab === 'sales' && (<>
      {/* Period Selector */}
      <div className="flex items-center gap-2">
        <select
          value={period}
          onChange={e => setPeriod(e.target.value as 'week' | 'month')}
          className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="week">최근 7일</option>
          <option value="month">최근 30일</option>
        </select>
      </div>

      {/* Overview Cards */}
      {overview && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-gradient-to-br from-blue-50 to-white border border-blue-100 rounded-xl p-4">
            <div className="flex items-center gap-2 text-blue-600 mb-1">
              <Users className="w-4 h-4" />
              <span className="text-xs font-medium">전체 티켓</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">{overview.totalTickets}</p>
            <p className="text-xs text-slate-500 mt-1">분석 완료: {overview.analyzedTickets}건</p>
          </div>
          <div className="bg-gradient-to-br from-amber-50 to-white border border-amber-100 rounded-xl p-4">
            <div className="flex items-center gap-2 text-amber-600 mb-1">
              <Star className="w-4 h-4" />
              <span className="text-xs font-medium">평균 응대 품질</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">{overview.avgQualityScore}<span className="text-sm font-normal text-slate-500"> / 5.0</span></p>
          </div>
          <div className="bg-gradient-to-br from-emerald-50 to-white border border-emerald-100 rounded-xl p-4">
            <div className="flex items-center gap-2 text-emerald-600 mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-xs font-medium">예약 전환율</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">{overview.conversionRate}<span className="text-sm font-normal text-slate-500">%</span></p>
          </div>
          <div className="bg-gradient-to-br from-red-50 to-white border border-red-100 rounded-xl p-4">
            <div className="flex items-center gap-2 text-red-600 mb-1">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-xs font-medium">팔로업 필요</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">{overview.followupNeeded}</p>
            <p className="text-xs text-slate-500 mt-1">미배정: {overview.unassigned}건</p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!stats || stats.byAssignee.length === 0 && stats.recentTickets.length === 0 ? (
        overview && overview.totalTickets === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <BarChart3 className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            <p>아직 동기화된 티켓이 없습니다.</p>
            <p className="text-sm mt-1">Sync 버튼을 눌러 Zendesk 데이터를 가져오세요.</p>
          </div>
        ) : null
      ) : (
        <>
          {/* Assignee Performance Table */}
          {stats.byAssignee.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-3">담당자별 성과</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600">
                      <th className="text-left px-3 py-2 font-medium rounded-tl-lg">담당자</th>
                      <th className="text-center px-3 py-2 font-medium">처리 건수</th>
                      <th className="text-center px-3 py-2 font-medium">평균 품질</th>
                      <th className="text-center px-3 py-2 font-medium">전환 건수</th>
                      <th className="text-center px-3 py-2 font-medium rounded-tr-lg">전환율</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byAssignee.map((a, i) => (
                      <tr key={a.email || i} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-900">{a.name}</div>
                          {a.email && <div className="text-xs text-slate-500">{a.email}</div>}
                        </td>
                        <td className="text-center px-3 py-2 text-slate-700">{a.ticketCount}</td>
                        <td className="text-center px-3 py-2">{qualityBadge(a.avgQuality || null)}</td>
                        <td className="text-center px-3 py-2 text-slate-700">{a.conversions}</td>
                        <td className="text-center px-3 py-2 text-slate-700">
                          {a.ticketCount > 0 ? Math.round((a.conversions / a.ticketCount) * 100) : 0}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent Tickets Table */}
          {stats.recentTickets.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-700">최근 티켓</h3>
                <div className="flex items-center gap-2">
                  {ticketHospitalFilter && (
                    <span className="text-xs text-slate-500">
                      의미있는 문의 ({stats.totalCount}건)
                    </span>
                  )}
                  <select
                    value={ticketHospitalFilter}
                    onChange={e => { setTicketHospitalFilter(e.target.value); setTicketLimit(20); }}
                    className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">전체 병원</option>
                    {hospitals.map(h => (
                      <option key={h.tag_prefix} value={h.display_name}>{h.display_name} ({h.ticket_count})</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* AI Insights Cards */}
              {ticketHospitalFilter && insightsLoading && (
                <div className="flex items-center gap-2 text-slate-500 py-4">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span className="text-sm">인사이트 분석 중...</span>
                </div>
              )}
              {ticketHospitalFilter && insightsError && !insightsLoading && (
                <div className="flex items-center gap-3 py-3 px-4 bg-red-50 border border-red-200 rounded-xl mb-4">
                  <span className="text-sm text-red-600">인사이트 분석에 실패했습니다.</span>
                  <button
                    onClick={() => setInsightsKey(prev => prev + 1)}
                    className="text-xs px-3 py-1 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                  >
                    재시도
                  </button>
                </div>
              )}
              {ticketHospitalFilter && insights && !insightsLoading && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div className="border border-slate-200 border-l-4 border-l-blue-500 rounded-xl shadow-sm p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                      <span className="text-sm font-semibold text-blue-700">병원 전략 제안</span>
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{insights.hospital_strategy}</p>
                  </div>
                  <div className="border border-slate-200 border-l-4 border-l-amber-500 rounded-xl shadow-sm p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                      <span className="text-sm font-semibold text-amber-700">Sales팀 개선 방향</span>
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{insights.sales_improvement}</p>
                  </div>
                  <div className="border border-slate-200 border-l-4 border-l-indigo-500 rounded-xl shadow-sm p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                      <span className="text-sm font-semibold text-indigo-700">본사 관리 방향</span>
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{insights.hq_management}</p>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600">
                      <th className="text-left px-3 py-2 font-medium rounded-tl-lg">제목</th>
                      <th className="text-left px-3 py-2 font-medium">병원</th>
                      <th className="text-left px-3 py-2 font-medium">담당자</th>
                      <th className="text-center px-3 py-2 font-medium">품질</th>
                      <th className="text-center px-3 py-2 font-medium">전환</th>
                      <th className="text-center px-3 py-2 font-medium">팔로업</th>
                      <th className="text-left px-3 py-2 font-medium">요약</th>
                      <th className="text-center px-3 py-2 font-medium rounded-tr-lg">작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentTickets.map(t => (
                      <React.Fragment key={t.ticket_id}>
                        <tr className="border-t border-slate-100 hover:bg-slate-50">
                          <td className="px-3 py-2 max-w-[200px]">
                            <div className="truncate text-slate-900" title={t.subject || ''}>
                              {t.subject || '-'}
                            </div>
                            <div className="text-xs text-slate-400">
                              {t.created_at_zd ? new Date(t.created_at_zd).toLocaleDateString('ko-KR') : ''}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-slate-700 text-xs">{t.hospital_name || '-'}</td>
                          <td className="px-3 py-2 text-slate-700">{t.assignee_name || '-'}</td>
                          <td className="text-center px-3 py-2">{qualityBadge(t.quality_score)}</td>
                          <td className="text-center px-3 py-2">{boolBadge(t.reservation_converted)}</td>
                          <td className="text-center px-3 py-2">{boolBadge(t.needs_followup)}</td>
                          <td className="px-3 py-2">
                            {t.summary ? (
                              <div className="text-slate-600 text-xs leading-relaxed whitespace-pre-wrap">
                                {t.summary}
                              </div>
                            ) : t.comment_count < 4 ? (
                              <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                                대화 {t.comment_count}건 (4건 미만)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-2">
                                {!['open', 'pending', 'new'].includes(t.status) ? (
                                  <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                                    종결 ({t.status})
                                  </span>
                                ) : (
                                  <span className="text-xs text-amber-500">분석 대기</span>
                                )}
                                <button
                                  onClick={() => handleAnalyzeSingle(t.ticket_id)}
                                  disabled={analyzingTicketId === t.ticket_id}
                                  className="px-2 py-0.5 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50 transition-colors"
                                >
                                  {analyzingTicketId === t.ticket_id ? '분석중...' : '분석'}
                                </button>
                              </span>
                            )}
                          </td>
                          <td className="text-center px-3 py-2">
                            {t.followup_status ? (
                              <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                FOLLOWUP_STATUS_CONFIG[t.followup_status]?.bg || 'bg-slate-100'
                              } ${
                                FOLLOWUP_STATUS_CONFIG[t.followup_status]?.color || 'text-slate-600'
                              }`}>
                                {FOLLOWUP_STATUS_CONFIG[t.followup_status]?.label || t.followup_status}
                              </span>
                            ) : t.quality_score != null ? (
                              <button
                                onClick={() => handleMarkFollowup(t.ticket_id)}
                                className="px-2 py-1 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                              >
                                팔로우업
                              </button>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                        </tr>
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              {!ticketHospitalFilter && stats.recentTickets.length >= ticketLimit && (
                <div className="text-center mt-4">
                  <button
                    onClick={() => setTicketLimit(prev => prev + 20)}
                    className="px-4 py-2 text-sm text-indigo-600 border border-indigo-300 rounded-lg hover:bg-indigo-50 transition-colors"
                  >
                    더 보기
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
      </>)}

      {/* Tab: Hospital BI */}
      {activeTab === 'hospital' && (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <select
            value={selectedHospital}
            onChange={e => setSelectedHospital(e.target.value)}
            className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">병원 선택</option>
            {hospitals.map(h => (
              <option key={h.tag_prefix} value={h.tag_prefix}>
                {h.display_name} ({h.ticket_count})
              </option>
            ))}
          </select>
          <select
            value={hospitalPeriod}
            onChange={e => setHospitalPeriod(e.target.value as 'week' | 'month')}
            className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="week">최근 7일</option>
            <option value="month">최근 30일</option>
          </select>
        </div>

        {!selectedHospital ? (
          <div className="text-center py-8 text-slate-500">
            <Building2 className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            <p>병원을 선택하세요</p>
          </div>
        ) : hospitalLoading ? (
          <div className="flex items-center gap-2 text-slate-500 py-4">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>데이터 로딩 중...</span>
          </div>
        ) : hospitalStats ? (
          <div className="space-y-6">
            {/* BI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {(() => {
                const conversionRate = hospitalStats.meaningfulInquiries > 0
                  ? Math.round((hospitalStats.conversions / hospitalStats.meaningfulInquiries) * 100)
                  : 0;
                const prevMeaningful = hospitalStats.meaningfulInquiries > 0 && hospitalStats.growth?.conversions != null && hospitalStats.growth?.meaningfulInquiries != null
                  ? hospitalStats.meaningfulInquiries / (1 + (hospitalStats.growth.meaningfulInquiries || 0) / 100)
                  : 0;
                const prevConversions = hospitalStats.conversions > 0 && hospitalStats.growth?.conversions != null
                  ? hospitalStats.conversions / (1 + (hospitalStats.growth.conversions || 0) / 100)
                  : 0;
                const prevRate = prevMeaningful > 0 ? (prevConversions / prevMeaningful) * 100 : 0;
                const rateGrowth = prevRate > 0 ? Math.round(((conversionRate - prevRate) / prevRate) * 100) : 0;

                const growthBadge = (g: number) => {
                  if (g > 0) return (
                    <span className="inline-flex items-center gap-0.5 text-xs text-emerald-600">
                      <ArrowUpRight className="w-3 h-3" />{g}%
                    </span>
                  );
                  if (g < 0) return (
                    <span className="inline-flex items-center gap-0.5 text-xs text-red-600">
                      <ArrowDownRight className="w-3 h-3" />{Math.abs(g)}%
                    </span>
                  );
                  return <span className="text-xs text-slate-400">-</span>;
                };

                return (
                  <>
                    <div className="bg-gradient-to-br from-blue-50 to-white border border-blue-100 rounded-xl p-4">
                      <span className="text-xs font-medium text-blue-600">총 문의</span>
                      <p className="text-2xl font-bold text-slate-900 mt-1">{hospitalStats.totalInquiries}</p>
                      <div className="mt-1">{growthBadge(hospitalStats.growth?.totalInquiries ?? 0)}</div>
                    </div>
                    <div className="bg-gradient-to-br from-indigo-50 to-white border border-indigo-100 rounded-xl p-4">
                      <span className="text-xs font-medium text-indigo-600">의미있는 문의 (4+대화)</span>
                      <p className="text-2xl font-bold text-slate-900 mt-1">{hospitalStats.meaningfulInquiries}</p>
                      <div className="mt-1">{growthBadge(hospitalStats.growth?.meaningfulInquiries ?? 0)}</div>
                    </div>
                    <div className="bg-gradient-to-br from-emerald-50 to-white border border-emerald-100 rounded-xl p-4">
                      <span className="text-xs font-medium text-emerald-600">예약 전환</span>
                      <p className="text-2xl font-bold text-slate-900 mt-1">{hospitalStats.conversions}</p>
                      <div className="mt-1">{growthBadge(hospitalStats.growth?.conversions ?? 0)}</div>
                    </div>
                    <div className="bg-gradient-to-br from-amber-50 to-white border border-amber-100 rounded-xl p-4">
                      <span className="text-xs font-medium text-amber-600">전환율</span>
                      <p className="text-2xl font-bold text-slate-900 mt-1">{conversionRate}%</p>
                      <div className="mt-1">{growthBadge(rateGrowth)}</div>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Daily Trend Chart */}
            {hospitalStats.dailyTrend && hospitalStats.dailyTrend.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">일별 추이</h3>
                {/* Legend */}
                <div className="flex items-center gap-4 mb-3 text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-blue-500" />
                    <span className="text-slate-600">전체</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-indigo-500" />
                    <span className="text-slate-600">의미있는 문의</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-emerald-500" />
                    <span className="text-slate-600">전환</span>
                  </div>
                </div>
                {/* Bar chart */}
                <div className="flex items-end gap-2 h-40">
                  {(() => {
                    const maxVal = Math.max(...hospitalStats.dailyTrend.map((d: any) => d.total), 1);
                    return hospitalStats.dailyTrend.map((day: any, i: number) => {
                      const dateStr = new Date(day.date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' });
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1">
                          <div className="flex items-end gap-0.5 w-full h-32">
                            <div
                              className="flex-1 bg-blue-500 rounded-t"
                              style={{ height: `${(day.total / maxVal) * 100}%`, minHeight: day.total > 0 ? '4px' : '0' }}
                              title={`전체: ${day.total}`}
                            />
                            <div
                              className="flex-1 bg-indigo-500 rounded-t"
                              style={{ height: `${(day.meaningful / maxVal) * 100}%`, minHeight: day.meaningful > 0 ? '4px' : '0' }}
                              title={`의미있는: ${day.meaningful}`}
                            />
                            <div
                              className="flex-1 bg-emerald-500 rounded-t"
                              style={{ height: `${(day.conversions / maxVal) * 100}%`, minHeight: day.conversions > 0 ? '4px' : '0' }}
                              title={`전환: ${day.conversions}`}
                            />
                          </div>
                          <span className="text-[10px] text-slate-500">{dateStr}</span>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
      )}

      {/* Tab: Followup Customers */}
      {activeTab === 'followup' && (
      <div className="space-y-4">
        <p className="text-sm text-slate-500">팔로업이 필요한 고객의 정보를 자동으로 추출합니다. (AI 분석 시 대화에서 추출)</p>
        <FollowupCustomerTable getAuthHeader={getAuthHeader} onBadgeUpdate={(n: number) => setFollowupBadge(n)} />
      </div>
      )}
    </div>
  );
}

// Status display configuration
const FOLLOWUP_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pending: { label: '대기', color: 'text-amber-700', bg: 'bg-amber-100', border: 'border-amber-300' },
  contacted: { label: '연락완료', color: 'text-blue-700', bg: 'bg-blue-100', border: 'border-blue-300' },
  scheduled: { label: '예약됨', color: 'text-indigo-700', bg: 'bg-indigo-100', border: 'border-indigo-300' },
  converted: { label: '성공', color: 'text-emerald-700', bg: 'bg-emerald-100', border: 'border-emerald-300' },
  lost: { label: 'Lost', color: 'text-red-700', bg: 'bg-red-100', border: 'border-red-300' },
};

// Lost reason labels in Korean
const LOST_REASON_LABELS: Record<string, string> = {
  no_response: '연락 안 됨',
  customer_rejected: '고객 거절',
  competitor: '경쟁사 선택',
  price_issue: '가격 문제',
  other: '기타',
};

interface FollowupAction {
  id: string;
  ticket_id: number;
  action_type: 'worker_action' | 'ai_instruction' | 'system_note';
  content: string;
  content_th: string | null;
  status_before: string | null;
  status_after: string | null;
  created_by: string | null;
  created_at: string;
  read_at: string | null;
}

function FollowupCustomerTable({ getAuthHeader, onBadgeUpdate }: { getAuthHeader: () => Promise<{ Authorization: string }>; onBadgeUpdate?: (count: number) => void }) {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [fetchKey, setFetchKey] = useState(0);
  const [changingStatus, setChangingStatus] = useState<number | null>(null);

  // Modal state
  const [selectedTicket, setSelectedTicket] = useState<number | null>(null);
  const [actions, setActions] = useState<FollowupAction[]>([]);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [pushMessage, setPushMessage] = useState('');
  const [pushing, setPushing] = useState(false);

  useEffect(() => {
    const fetchFollowups = async () => {
      setLoading(true);
      try {
        const headers = await getAuthHeader();
        const url = statusFilter
          ? `/api/zendesk/followup-customers?status=${statusFilter}`
          : '/api/zendesk/followup-customers';
        const res = await fetch(url, { headers });
        if (res.ok) {
          const data = await res.json();
          setCustomers(data.customers || []);
        }
      } catch (err) {
        console.error('[SalesPerformance] Failed to fetch followup customers:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchFollowups();
  }, [statusFilter, fetchKey]);

  // Fetch actions when modal opens
  useEffect(() => {
    if (selectedTicket === null) return;
    const fetchActions = async () => {
      setActionsLoading(true);
      try {
        const headers = await getAuthHeader();
        const res = await fetch(`/api/zendesk/followup-actions?ticket_id=${selectedTicket}`, { headers });
        if (res.ok) {
          const data = await res.json();
          // API returns desc order, reverse for chronological (oldest first)
          setActions((data.actions || []).reverse());
          // Refresh badge (actions were marked read by API)
          const badgeRes = await fetch('/api/zendesk/followup-actions?unread_count=true', { headers });
          if (badgeRes.ok) {
            const badgeData = await badgeRes.json();
            onBadgeUpdate?.(badgeData.unread_count || 0);
          }
        }
      } catch (err) {
        console.error('[SalesPerformance] Failed to fetch actions:', err);
      } finally {
        setActionsLoading(false);
      }
    };
    fetchActions();
  }, [selectedTicket]);

  const handleStatusChange = async (ticketId: number, newStatus: string) => {
    setChangingStatus(ticketId);
    try {
      const headers = await getAuthHeader();
      const res = await fetch('/api/zendesk/followup-customers', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_id: ticketId,
          status: newStatus,
          action_comment: `Admin changed status to ${newStatus}`,
          ...(newStatus === 'lost' ? { lost_reason: 'other', lost_reason_detail: 'Admin decision' } : {}),
        }),
      });
      if (res.ok) {
        setFetchKey(prev => prev + 1);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`상태 변경 실패: ${err.error || res.status}`);
      }
    } catch (err) {
      console.error('[SalesPerformance] Status change failed:', err);
    } finally {
      setChangingStatus(null);
    }
  };

  const handleRevert = async (ticketId: number) => {
    if (!confirm('Lost 처리를 되돌리고 팔로업을 재개합니까?')) return;
    try {
      const headers = await getAuthHeader();
      const res = await fetch('/api/zendesk/followup-customers', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_id: ticketId,
          status: 'contacted',
          action_comment: 'Admin reverted from lost',
        }),
      });
      if (res.ok) {
        setFetchKey(prev => prev + 1);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`되돌리기 실패: ${err.error || res.status}`);
      }
    } catch (err) {
      console.error('[SalesPerformance] Revert failed:', err);
      alert('되돌리기 중 오류가 발생했습니다.');
    }
  };

  const handlePush = async (ticketId: number) => {
    if (!pushMessage.trim()) return;
    setPushing(true);
    try {
      const headers = await getAuthHeader();
      const res = await fetch('/api/zendesk/followup-actions', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticketId, content: pushMessage.trim() }),
      });
      if (res.ok) {
        setPushMessage('');
        // Refresh actions
        const actionsRes = await fetch(`/api/zendesk/followup-actions?ticket_id=${ticketId}`, { headers });
        if (actionsRes.ok) {
          const data = await actionsRes.json();
          setActions((data.actions || []).reverse());
        }
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Push 실패: ${err.error || res.status}`);
      }
    } catch (err) {
      console.error('[SalesPerformance] Push failed:', err);
      alert('Push 중 오류가 발생했습니다.');
    } finally {
      setPushing(false);
    }
  };

  const handleDrop = async (ticketId: number) => {
    if (!confirm('이 고객을 Lost 처리하시겠습니까?')) return;
    try {
      const headers = await getAuthHeader();
      const res = await fetch('/api/zendesk/followup-customers', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_id: ticketId,
          status: 'lost',
          lost_reason: 'other',
          lost_reason_detail: 'Admin dropped',
        }),
      });
      if (res.ok) {
        setSelectedTicket(null);
        setFetchKey(prev => prev + 1);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Drop 실패: ${err.error || res.status}`);
      }
    } catch (err) {
      console.error('[SalesPerformance] Drop failed:', err);
      alert('Drop 처리 중 오류가 발생했습니다.');
    }
  };

  // Compute status counts
  const statusCounts = customers.reduce<Record<string, number>>((acc, c) => {
    const s = c.followup_status || 'pending';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  // Format datetime
  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) + ' ' +
      d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  };

  // Status badge renderer
  const statusBadge = (status: string) => {
    const config = FOLLOWUP_STATUS_CONFIG[status] || FOLLOWUP_STATUS_CONFIG.pending;
    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${config.bg} ${config.color}`}>
        {config.label}
      </span>
    );
  };

  // BI summary card config
  const biCards = [
    { key: 'pending', label: '대기', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', icon: 'bg-amber-100' },
    { key: 'contacted', label: '연락완료', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200', icon: 'bg-blue-100' },
    { key: 'scheduled', label: '예약됨', color: 'text-indigo-700', bg: 'bg-indigo-50', border: 'border-indigo-200', icon: 'bg-indigo-100' },
    { key: 'converted', label: '성공', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', icon: 'bg-emerald-100' },
    { key: 'lost', label: 'Lost', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', icon: 'bg-red-100' },
  ];

  // Status filter pills
  const filterPills = [
    { key: '', label: '전체', activeClass: 'bg-slate-800 text-white border-slate-800' },
    { key: 'pending', label: '대기', activeClass: 'bg-amber-100 text-amber-700 border-amber-300' },
    { key: 'contacted', label: '연락완료', activeClass: 'bg-blue-100 text-blue-700 border-blue-300' },
    { key: 'scheduled', label: '예약됨', activeClass: 'bg-indigo-100 text-indigo-700 border-indigo-300' },
    { key: 'converted', label: '성공', activeClass: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
    { key: 'lost', label: 'Lost', activeClass: 'bg-red-100 text-red-700 border-red-300' },
  ];

  const selectedCustomer = selectedTicket !== null
    ? customers.find(c => c.ticket_id === selectedTicket)
    : null;

  return (
    <div className="space-y-4">
      {/* 1. BI Summary Cards */}
      <div className="grid grid-cols-5 gap-3">
        {biCards.map(card => (
          <div key={card.key} className={`${card.bg} ${card.border} border rounded-xl px-4 py-3 text-center`}>
            <div className={`text-2xl font-bold ${card.color}`}>
              {loading ? '-' : (statusCounts[card.key] || 0)}
            </div>
            <div className={`text-xs font-medium ${card.color} mt-0.5`}>{card.label}</div>
          </div>
        ))}
      </div>

      {/* 2. Status Filter Pills */}
      <div className="flex flex-wrap gap-2">
        {filterPills.map(pill => {
          const isActive = statusFilter === pill.key;
          return (
            <button
              key={pill.key}
              onClick={() => setStatusFilter(pill.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                isActive ? pill.activeClass : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {pill.label}
            </button>
          );
        })}
      </div>

      {/* 3. Ticket List */}
      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 py-4">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>고객 데이터 로딩 중...</span>
        </div>
      ) : customers.length === 0 ? (
        <div className="text-center py-8 text-slate-500">
          <Users className="w-8 h-8 mx-auto mb-2 text-slate-300" />
          <p>팔로업 고객 데이터가 없습니다.</p>
          <p className="text-xs mt-1">Analyze 실행 시 대화에서 고객 정보가 자동 추출됩니다.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-600">
                <th className="text-left px-3 py-2 font-medium rounded-tl-lg">고객명</th>
                <th className="text-left px-3 py-2 font-medium">병원</th>
                <th className="text-center px-3 py-2 font-medium">상태</th>
                <th className="text-left px-3 py-2 font-medium">팔로업 사유</th>
                <th className="text-center px-3 py-2 font-medium rounded-tr-lg">상세보기</th>
              </tr>
            </thead>
            <tbody>
              {customers
                .filter(c => {
                  // Hide lost tickets in "전체" view (only show when Lost filter is active)
                  if (!statusFilter && c.followup_status === 'lost') return false;
                  return true;
                })
                .map((c, i) => {
                const status = c.followup_status || 'pending';
                const isLost = status === 'lost';
                const reason = c.followup_reason || '-';
                const truncatedReason = reason.length > 50 ? reason.slice(0, 50) + '...' : reason;
                const unread = c.unread_count || 0;
                return (
                  <tr
                    key={c.ticket_id || i}
                    className={`border-t border-slate-100 hover:bg-slate-50 ${isLost ? 'opacity-60' : ''}`}
                  >
                    <td className="px-3 py-2.5 font-medium text-slate-900">{c.customer_name || '-'}</td>
                    <td className="px-3 py-2.5 text-slate-700 text-xs">{c.hospital_name || '-'}</td>
                    <td className="text-center px-3 py-2.5">{statusBadge(status)}</td>
                    <td className="px-3 py-2.5 text-slate-600 text-xs" title={reason}>{truncatedReason}</td>
                    <td className="text-center px-3 py-2.5">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            setSelectedTicket(c.ticket_id);
                            setPushMessage('');
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-200 transition-colors"
                        >
                          <Eye className="w-3 h-3" />
                          상세
                        </button>
                        {unread > 0 && (
                          <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold text-white bg-red-500 rounded-full min-w-[18px] leading-none">
                            {unread}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 4. Detail Modal */}
      {selectedTicket !== null && selectedCustomer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedTicket(null); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col mx-4">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex-shrink-0">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-slate-900">{selectedCustomer.customer_name || '-'}</h3>
                    <span className="text-xs text-slate-400">#{selectedCustomer.ticket_id}</span>
                    {statusBadge(selectedCustomer.followup_status || 'pending')}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span>{selectedCustomer.hospital_name || '-'}</span>
                    {selectedCustomer.customer_phone && (
                      <span>{selectedCustomer.customer_phone}</span>
                    )}
                    {selectedCustomer.interested_procedure && (
                      <span>{selectedCustomer.interested_procedure}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Status Change Select */}
                  <select
                    value={selectedCustomer.followup_status || 'pending'}
                    onChange={(e) => {
                      const newStatus = e.target.value;
                      const currentStatus = selectedCustomer.followup_status || 'pending';
                      if (newStatus !== currentStatus) {
                        if (confirm(`상태를 "${FOLLOWUP_STATUS_CONFIG[newStatus]?.label || newStatus}"(으)로 변경하시겠습니까?`)) {
                          handleStatusChange(selectedCustomer.ticket_id, newStatus);
                        }
                      }
                    }}
                    disabled={changingStatus === selectedCustomer.ticket_id}
                    className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
                  >
                    <option value="pending">대기</option>
                    <option value="contacted">연락완료</option>
                    <option value="scheduled">예약됨</option>
                    <option value="converted">성공</option>
                    <option value="lost">Lost</option>
                  </select>
                  <button
                    onClick={() => setSelectedTicket(null)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Followup Reason */}
              {selectedCustomer.followup_reason && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <div className="text-xs font-medium text-amber-700 mb-1">팔로업 사유</div>
                  <div className="text-sm text-amber-900">{selectedCustomer.followup_reason}</div>
                </div>
              )}

              {/* Chat-style Timeline */}
              <div>
                <div className="text-xs font-medium text-slate-500 mb-3 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  대화 타임라인
                </div>
                {actionsLoading ? (
                  <div className="flex items-center gap-2 text-slate-400 py-4 text-sm">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>로딩 중...</span>
                  </div>
                ) : actions.length === 0 ? (
                  <div className="text-center py-6 text-slate-400 text-sm">
                    아직 기록이 없습니다.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {actions.map((action) => {
                      const isWorker = action.action_type === 'worker_action';
                      const isAI = action.action_type === 'ai_instruction';
                      const isSystem = action.action_type === 'system_note';

                      // System notes: centered small pill
                      if (isSystem) {
                        return (
                          <div key={action.id} className="flex justify-center">
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 rounded-full">
                              <Info className="w-3 h-3 text-slate-400" />
                              <span className="text-xs text-slate-500">{action.content}</span>
                              {action.status_before && action.status_after && action.status_before !== action.status_after && (
                                <span className="text-xs text-slate-400">
                                  ({FOLLOWUP_STATUS_CONFIG[action.status_before]?.label || action.status_before}
                                  {' → '}
                                  {FOLLOWUP_STATUS_CONFIG[action.status_after]?.label || action.status_after})
                                </span>
                              )}
                              <span className="text-[10px] text-slate-400 ml-1">{formatDateTime(action.created_at)}</span>
                            </div>
                          </div>
                        );
                      }

                      // AI instruction: left-aligned bubble (like incoming message)
                      if (isAI) {
                        return (
                          <div key={action.id} className="flex items-start gap-2 max-w-[85%]">
                            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center mt-0.5">
                              <Star className="w-3.5 h-3.5 text-amber-600" />
                            </div>
                            <div>
                              <div className="text-[10px] font-medium text-amber-600 mb-0.5">AI 분석 / 관리자 지시</div>
                              <div className="bg-amber-50 border border-amber-200 rounded-2xl rounded-tl-sm px-3.5 py-2.5">
                                <p className="text-sm text-amber-900 whitespace-pre-wrap">{action.content}</p>
                                {action.status_before && action.status_after && action.status_before !== action.status_after && (
                                  <p className="text-xs text-amber-600 mt-1.5 pt-1.5 border-t border-amber-200">
                                    {FOLLOWUP_STATUS_CONFIG[action.status_before]?.label || action.status_before}
                                    {' → '}
                                    {FOLLOWUP_STATUS_CONFIG[action.status_after]?.label || action.status_after}
                                  </p>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5 ml-1">{formatDateTime(action.created_at)}</div>
                            </div>
                          </div>
                        );
                      }

                      // Worker action: right-aligned bubble (like outgoing message)
                      return (
                        <div key={action.id} className="flex justify-end">
                          <div className="max-w-[85%]">
                            <div className="text-[10px] font-medium text-blue-600 mb-0.5 text-right">워커 보고</div>
                            <div className="bg-blue-500 rounded-2xl rounded-tr-sm px-3.5 py-2.5">
                              <p className="text-sm text-white whitespace-pre-wrap">{action.content}</p>
                              {action.status_before && action.status_after && action.status_before !== action.status_after && (
                                <p className="text-xs text-blue-100 mt-1.5 pt-1.5 border-t border-blue-400">
                                  {FOLLOWUP_STATUS_CONFIG[action.status_before]?.label || action.status_before}
                                  {' → '}
                                  {FOLLOWUP_STATUS_CONFIG[action.status_after]?.label || action.status_after}
                                </p>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5 mr-1 text-right">{formatDateTime(action.created_at)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Bottom: Push + Drop */}
            <div className="px-6 py-4 border-t border-slate-200 flex-shrink-0 space-y-3">
              <div className="flex gap-2">
                <textarea
                  value={pushMessage}
                  onChange={(e) => setPushMessage(e.target.value)}
                  placeholder="워커에게 보낼 지시사항을 입력하세요..."
                  rows={2}
                  className="flex-1 text-sm border border-slate-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                />
                <button
                  onClick={() => handlePush(selectedCustomer.ticket_id)}
                  disabled={pushing || !pushMessage.trim()}
                  className="self-end px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl flex items-center gap-1.5 transition-colors"
                >
                  {pushing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Push
                </button>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => handleDrop(selectedCustomer.ticket_id)}
                  className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-300 hover:bg-red-50 rounded-lg flex items-center gap-1 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  Drop
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
