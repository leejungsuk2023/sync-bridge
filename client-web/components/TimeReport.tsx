'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function TimeReport({ workers }: { workers: any[] }) {
  const [report, setReport] = useState<Record<string, { total: number; online: number; away: number }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (workers.length === 0) {
      setLoading(false);
      return;
    }

    const fetchReport = async () => {
      const workerIds = workers.map((w) => w.id);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { data } = await supabase
        .from('time_logs')
        .select('worker_id, status, created_at')
        .in('worker_id', workerIds)
        .gte('created_at', today.toISOString());

      const summary: Record<string, { total: number; online: number; away: number }> = {};
      workerIds.forEach((id) => {
        summary[id] = { total: 0, online: 0, away: 0 };
      });

      data?.forEach((log) => {
        summary[log.worker_id].total++;
        if (log.status === 'online') summary[log.worker_id].online++;
        if (log.status === 'away') summary[log.worker_id].away++;
      });

      setReport(summary);
      setLoading(false);
    };

    fetchReport();
  }, [workers]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
      <h2 className="text-lg font-semibold text-slate-900 mb-6">오늘 근무 리포트</h2>
      {loading ? (
        <p className="text-center text-slate-500 py-12">불러오는 중...</p>
      ) : workers.length === 0 ? (
        <p className="text-center text-slate-500 py-12">할당된 직원이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-700 uppercase tracking-wider">직원</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-slate-700 uppercase tracking-wider">총 기록</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-slate-700 uppercase tracking-wider">출근</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-slate-700 uppercase tracking-wider">자리 비움</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-slate-700 uppercase tracking-wider">출근율</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((worker) => {
                const stats = report[worker.id] || { total: 0, online: 0, away: 0 };
                const onlineRatio = stats.total > 0 ? (stats.online / stats.total) * 100 : 0;
                const awayRatio = stats.total > 0 ? (stats.away / stats.total) * 100 : 0;
                return (
                  <tr key={worker.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-4">
                      <span className="text-sm font-medium text-slate-900">{worker.display_name || worker.email}</span>
                    </td>
                    <td className="py-4 px-4 text-right">
                      <span className="text-sm text-slate-700">{stats.total}회</span>
                    </td>
                    <td className="py-4 px-4 text-right">
                      <span className={`text-sm font-medium ${
                        onlineRatio >= 80 ? 'text-emerald-700' : onlineRatio >= 60 ? 'text-amber-700' : 'text-slate-700'
                      }`}>
                        {stats.online}회
                      </span>
                    </td>
                    <td className="py-4 px-4 text-right">
                      <span className={`text-sm ${awayRatio > 30 ? 'text-amber-700 font-medium' : 'text-slate-700'}`}>
                        {stats.away}회
                      </span>
                    </td>
                    <td className="py-4 px-4 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${
                              onlineRatio >= 80 ? 'bg-emerald-500' : onlineRatio >= 60 ? 'bg-amber-500' : 'bg-slate-400'
                            }`}
                            style={{ width: `${onlineRatio}%` }}
                          />
                        </div>
                        <span className={`text-sm font-medium min-w-[3ch] ${
                          onlineRatio >= 80 ? 'text-emerald-700' : onlineRatio >= 60 ? 'text-amber-700' : 'text-slate-700'
                        }`}>
                          {stats.total > 0 ? `${onlineRatio.toFixed(0)}%` : '-'}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
