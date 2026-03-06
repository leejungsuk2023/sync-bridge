'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { RefreshCw, ArrowUpRight, ArrowDownRight, LogOut } from 'lucide-react';

const HOSPITAL_NAMES: Record<string, string> = {
  thebb: 'TheBB', delphic: 'Delphic Clinic', will: 'Will Plastic Surgery',
  mikclinicthai: 'MikClinic', jyclinicthai: 'JY Clinic', du: 'DU Plastic Surgery',
  koreandiet: 'Korean Diet', ourpthai: 'OURP', everbreastthai: 'EverBreast',
  clyveps_th: 'Clyveps', mycell: 'Mycell Clinic', nbclinici: 'NB Clinic',
  'dr.song': 'Dr. Song', lacela: 'Lacela', artline: 'Artline', kleam: 'Kleam',
};

interface HospitalStats {
  totalInquiries: number;
  meaningfulInquiries: number;
  conversions: number;
  growth?: {
    totalInquiries: number;
    meaningfulInquiries: number;
    conversions: number;
  };
  dailyTrend?: { date: string; total: number; meaningful: number; conversions: number }[];
}

interface Insights {
  hospital_strategy: string;
  sales_improvement: string;
  hq_management: string;
}

interface RecentTicket {
  ticket_id: number;
  subject: string;
  quality_score: number | null;
  reservation_converted: boolean | null;
  summary: string | null;
  created_at_zd: string;
}

export default function HospitalDashboard({ user, profile }: { user: any; profile: any }) {
  const [period, setPeriod] = useState<'week' | 'month'>('month');
  const [stats, setStats] = useState<HospitalStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState(false);
  const [insightsKey, setInsightsKey] = useState(0);
  const [tickets, setTickets] = useState<RecentTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);

  const hospitalPrefix = profile?.hospital_prefix || '';
  const displayName = HOSPITAL_NAMES[hospitalPrefix] || hospitalPrefix;

  const getAuthHeader = async () => {
    const session = (await supabase.auth.getSession()).data.session;
    return { Authorization: `Bearer ${session?.access_token}` };
  };

  // Fetch hospital stats
  useEffect(() => {
    if (!hospitalPrefix) return;
    const fetchStats = async () => {
      setStatsLoading(true);
      try {
        const headers = await getAuthHeader();
        const res = await fetch(`/api/zendesk/hospital-stats?hospital=${encodeURIComponent(hospitalPrefix)}&period=${period}`, { headers });
        if (res.ok) {
          const data = await res.json();
          setStats(data.stats || null);
        }
      } catch (err) {
        console.error('[HospitalDashboard] Failed to fetch stats:', err);
      } finally {
        setStatsLoading(false);
      }
    };
    fetchStats();
  }, [hospitalPrefix, period]);

  // Fetch AI insights
  useEffect(() => {
    if (!displayName) return;
    const fetchInsights = async () => {
      setInsightsLoading(true);
      setInsights(null);
      setInsightsError(false);
      try {
        const headers = await getAuthHeader();
        const res = await fetch('/api/zendesk/insights', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ hospital: displayName }),
        });
        if (res.ok) {
          const data = await res.json();
          setInsights(data.insights || null);
        } else {
          setInsightsError(true);
        }
      } catch (err) {
        console.error('[HospitalDashboard] Failed to fetch insights:', err);
        setInsightsError(true);
      } finally {
        setInsightsLoading(false);
      }
    };
    fetchInsights();
  }, [displayName, insightsKey]);

  // Fetch recent tickets
  useEffect(() => {
    if (!displayName) return;
    const fetchTickets = async () => {
      setTicketsLoading(true);
      try {
        const headers = await getAuthHeader();
        const res = await fetch(`/api/zendesk/stats?period=${period}&hospital=${encodeURIComponent(displayName)}`, { headers });
        if (res.ok) {
          const data = await res.json();
          setTickets(data.recentTickets || []);
        }
      } catch (err) {
        console.error('[HospitalDashboard] Failed to fetch tickets:', err);
      } finally {
        setTicketsLoading(false);
      }
    };
    fetchTickets();
  }, [displayName, period]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

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

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-slate-900">{displayName}</h1>
            <span className="px-2.5 py-1 bg-teal-100 text-teal-700 text-xs font-medium rounded-full">SyncBridge 파트너</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600">{profile?.email || user.email}</span>
            <button onClick={handleLogout} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
              <LogOut className="w-4 h-4" />
              로그아웃
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-[1440px] mx-auto p-6 space-y-6">
        {/* Period Selector */}
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={e => setPeriod(e.target.value as 'week' | 'month')}
            className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <option value="week">최근 7일</option>
            <option value="month">최근 30일</option>
          </select>
        </div>

        {/* Overview Cards */}
        {statsLoading ? (
          <div className="flex items-center gap-2 text-slate-500 py-4">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>데이터 로딩 중...</span>
          </div>
        ) : stats ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {(() => {
                const conversionRate = stats.meaningfulInquiries > 0
                  ? Math.round((stats.conversions / stats.meaningfulInquiries) * 100)
                  : 0;
                const prevMeaningful = stats.meaningfulInquiries > 0 && stats.growth?.conversions != null && stats.growth?.meaningfulInquiries != null
                  ? stats.meaningfulInquiries / (1 + (stats.growth.meaningfulInquiries || 0) / 100)
                  : 0;
                const prevConversions = stats.conversions > 0 && stats.growth?.conversions != null
                  ? stats.conversions / (1 + (stats.growth.conversions || 0) / 100)
                  : 0;
                const prevRate = prevMeaningful > 0 ? (prevConversions / prevMeaningful) * 100 : 0;
                const rateGrowth = prevRate > 0 ? Math.round(((conversionRate - prevRate) / prevRate) * 100) : 0;

                return (
                  <>
                    <div className="bg-gradient-to-br from-blue-50 to-white border border-blue-100 rounded-xl p-4">
                      <span className="text-xs font-medium text-blue-600">총 문의</span>
                      <p className="text-2xl font-bold text-slate-900 mt-1">{stats.totalInquiries}</p>
                      <div className="mt-1">{growthBadge(stats.growth?.totalInquiries ?? 0)}</div>
                    </div>
                    <div className="bg-gradient-to-br from-indigo-50 to-white border border-indigo-100 rounded-xl p-4">
                      <span className="text-xs font-medium text-indigo-600">의미있는 문의 (4+대화)</span>
                      <p className="text-2xl font-bold text-slate-900 mt-1">{stats.meaningfulInquiries}</p>
                      <div className="mt-1">{growthBadge(stats.growth?.meaningfulInquiries ?? 0)}</div>
                    </div>
                    <div className="bg-gradient-to-br from-emerald-50 to-white border border-emerald-100 rounded-xl p-4">
                      <span className="text-xs font-medium text-emerald-600">예약 전환</span>
                      <p className="text-2xl font-bold text-slate-900 mt-1">{stats.conversions}</p>
                      <div className="mt-1">{growthBadge(stats.growth?.conversions ?? 0)}</div>
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
            {stats.dailyTrend && stats.dailyTrend.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
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
                    const maxVal = Math.max(...stats.dailyTrend!.map((d) => d.total), 1);
                    return stats.dailyTrend!.map((day, i) => {
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
          </>
        ) : (
          <div className="text-center py-8 text-slate-500">
            <p>데이터를 불러올 수 없습니다.</p>
          </div>
        )}

        {/* AI Insights */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">AI 인사이트</h3>
          {insightsLoading && (
            <div className="flex items-center gap-2 text-slate-500 py-4">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span className="text-sm">인사이트 분석 중...</span>
            </div>
          )}
          {insightsError && !insightsLoading && (
            <div className="flex items-center gap-3 py-3 px-4 bg-red-50 border border-red-200 rounded-xl">
              <span className="text-sm text-red-600">인사이트 분석에 실패했습니다.</span>
              <button
                onClick={() => setInsightsKey(prev => prev + 1)}
                className="text-xs px-3 py-1 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                재시도
              </button>
            </div>
          )}
          {insights && !insightsLoading && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
        </div>

        {/* Recent Analyzed Tickets */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">최근 분석 티켓</h3>
          {ticketsLoading ? (
            <div className="flex items-center gap-2 text-slate-500 py-4">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>티켓 로딩 중...</span>
            </div>
          ) : tickets.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <p>분석된 티켓이 없습니다.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-600">
                    <th className="text-left px-3 py-2 font-medium rounded-tl-lg">제목</th>
                    <th className="text-center px-3 py-2 font-medium">품질</th>
                    <th className="text-center px-3 py-2 font-medium">전환</th>
                    <th className="text-left px-3 py-2 font-medium rounded-tr-lg">요약</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map(t => (
                    <tr key={t.ticket_id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 max-w-[250px]">
                        <div className="truncate text-slate-900" title={t.subject || ''}>
                          {t.subject || '-'}
                        </div>
                        <div className="text-xs text-slate-400">
                          {t.created_at_zd ? new Date(t.created_at_zd).toLocaleDateString('ko-KR') : ''}
                        </div>
                      </td>
                      <td className="text-center px-3 py-2">{qualityBadge(t.quality_score)}</td>
                      <td className="text-center px-3 py-2">{boolBadge(t.reservation_converted)}</td>
                      <td className="px-3 py-2">
                        {t.summary ? (
                          <div className="text-slate-600 text-xs leading-relaxed whitespace-pre-wrap">{t.summary}</div>
                        ) : (
                          <span className="text-xs text-slate-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
