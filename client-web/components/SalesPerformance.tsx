'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { BarChart3, Star, RefreshCw, Users, TrendingUp, AlertTriangle, Search, Building2, ArrowUpRight, ArrowDownRight } from 'lucide-react';

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
  const [workers, setWorkers] = useState<{id: string, display_name: string, email: string}[]>([]);
  const [assigningTicketId, setAssigningTicketId] = useState<number | null>(null);
  const [selectedWorker, setSelectedWorker] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [ticketLimit, setTicketLimit] = useState(20);
  const [ticketHospitalFilter, setTicketHospitalFilter] = useState('');
  const [analyzingTicketId, setAnalyzingTicketId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [hospitals, setHospitals] = useState<{tag_prefix: string; display_name: string; ticket_count: number}[]>([]);
  const [selectedHospital, setSelectedHospital] = useState('');
  const [hospitalStats, setHospitalStats] = useState<any>(null);
  const [hospitalLoading, setHospitalLoading] = useState(false);
  const [hospitalPeriod, setHospitalPeriod] = useState<'week' | 'month'>('month');

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

  useEffect(() => {
    const fetchWorkers = async () => {
      const { data } = await supabase.from('profiles').select('id, display_name, email').eq('role', 'worker');
      setWorkers(data || []);
    };
    fetchWorkers();
  }, []);

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

  const handleAssignFollowup = async (ticket: RecentTicket) => {
    if (!selectedWorker) return;
    setAssigning(true);
    try {
      const headers = await getAuthHeader();
      // Translate ticket subject to Thai
      let contentTh = '';
      try {
        const trRes = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `[팔로업] ${ticket.subject}`, targetLang: 'th' }),
        });
        if (trRes.ok) {
          const trData = await trRes.json();
          contentTh = trData.translated || '';
        }
      } catch {}

      // Translate description (summary) to Thai
      let descTh = '';
      const desc = ticket.summary || '';
      if (desc) {
        try {
          const trRes = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: desc, targetLang: 'th' }),
          });
          if (trRes.ok) {
            const trData = await trRes.json();
            descTh = trData.translated || '';
          }
        } catch {}
      }

      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignee_id: selectedWorker,
          content: `[팔로업] ${ticket.subject}`,
          content_th: contentTh,
          description: desc,
          description_th: descTh,
          source: 'zendesk_followup',
        }),
      });

      if (res.ok) {
        setAssigningTicketId(null);
        setSelectedWorker('');
      }
    } catch (err) {
      console.error('[SalesPerformance] Followup assign failed:', err);
    } finally {
      setAssigning(false);
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
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-slate-900">Sales 성과 트래킹</h2>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={e => setPeriod(e.target.value as 'week' | 'month')}
            className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="week">최근 7일</option>
            <option value="month">최근 30일</option>
          </select>
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
                            {t.needs_followup === true ? (
                              <button
                                onClick={() => setAssigningTicketId(assigningTicketId === t.ticket_id ? null : t.ticket_id)}
                                className="px-2 py-1 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                              >
                                배정
                              </button>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                        </tr>
                        {assigningTicketId === t.ticket_id && (
                          <tr className="bg-indigo-50">
                            <td colSpan={8} className="px-3 py-3">
                              <div className="flex items-center gap-3">
                                <span className="text-sm text-slate-700 font-medium">담당자 배정:</span>
                                <select
                                  value={selectedWorker}
                                  onChange={e => setSelectedWorker(e.target.value)}
                                  className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                  <option value="">선택하세요</option>
                                  {workers.map(w => (
                                    <option key={w.id} value={w.id}>{w.display_name || w.email}</option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => handleAssignFollowup(t)}
                                  disabled={!selectedWorker || assigning}
                                  className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                                >
                                  {assigning ? '배정 중...' : '배정'}
                                </button>
                                <button
                                  onClick={() => { setAssigningTicketId(null); setSelectedWorker(''); }}
                                  className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700"
                                >
                                  취소
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
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
      {/* Hospital BI Section */}
      <div className="border-t border-slate-200 pt-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-slate-900">병원별 성과 분석</h2>
          </div>
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
    </div>
  );
}
