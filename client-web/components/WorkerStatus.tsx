'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Star } from 'lucide-react';

export default function WorkerStatus({ workers }: { workers: any[] }) {
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [avgRatings, setAvgRatings] = useState<Record<string, { avg: number; count: number }>>({});

  useEffect(() => {
    if (workers.length === 0) return;

    const fetchLatestStatus = async () => {
      const workerIds = workers.map((w) => w.id);
      const { data } = await supabase
        .from('time_logs')
        .select('worker_id, status, created_at')
        .in('worker_id', workerIds)
        .order('created_at', { ascending: false });

      const latest: Record<string, string> = {};
      data?.forEach((log) => {
        if (!latest[log.worker_id]) {
          latest[log.worker_id] = log.status;
        }
      });
      setStatuses(latest);
    };

    const fetchRatings = async () => {
      const workerIds = workers.map((w) => w.id);
      const { data } = await supabase
        .from('tasks')
        .select('assignee_id, rating')
        .in('assignee_id', workerIds)
        .not('rating', 'is', null);

      const byWorker: Record<string, { sum: number; count: number }> = {};
      data?.forEach((t) => {
        if (!byWorker[t.assignee_id]) byWorker[t.assignee_id] = { sum: 0, count: 0 };
        byWorker[t.assignee_id].sum += t.rating;
        byWorker[t.assignee_id].count += 1;
      });
      const result: Record<string, { avg: number; count: number }> = {};
      Object.entries(byWorker).forEach(([id, v]) => {
        result[id] = { avg: Math.round((v.sum / v.count) * 10) / 10, count: v.count };
      });
      setAvgRatings(result);
    };

    fetchLatestStatus();
    fetchRatings();
    const interval = setInterval(fetchLatestStatus, 5000);

    const channel = supabase
      .channel('time_logs_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_logs' }, () => {
        fetchLatestStatus();
      })
      .subscribe();

    const tasksChannel = supabase
      .channel('tasks_rating_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        fetchRatings();
      })
      .subscribe();

    return () => {
      clearInterval(interval);
      channel.unsubscribe();
      tasksChannel.unsubscribe();
    };
  }, [workers]);

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'online':
        return { label: '온라인', dotClass: 'bg-emerald-600', badgeClass: 'bg-emerald-100 text-emerald-700', borderClass: 'border-l-emerald-500 bg-emerald-50/30' };
      case 'away':
        return { label: '자리 비움', dotClass: 'bg-amber-600', badgeClass: 'bg-amber-100 text-amber-700', borderClass: 'border-l-amber-500 bg-amber-50/30' };
      case 'offline':
        return { label: '오프라인', dotClass: 'bg-slate-600', badgeClass: 'bg-slate-200 text-slate-700', borderClass: 'border-l-slate-400' };
      default:
        return { label: '-', dotClass: 'bg-slate-400', badgeClass: 'bg-slate-100 text-slate-500', borderClass: 'border-l-slate-300' };
    }
  };

  return (
    <div className="bg-gradient-to-r from-blue-50/70 to-white rounded-xl shadow-sm border border-blue-100 border-l-4 border-l-blue-400 p-6">
      <h2 className="text-lg font-semibold text-slate-900 mb-6">실시간 직원 상태</h2>
      {workers.length === 0 ? (
        <p className="text-center text-slate-500 py-12">할당된 직원이 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {workers.map((worker) => {
            const status = statuses[worker.id] || 'offline';
            const config = getStatusConfig(status);
            return (
              <div
                key={worker.id}
                className={`rounded-lg border-l-4 border border-slate-200 p-4 bg-slate-50/50 ${config.borderClass}`}
              >
                <div className="mb-2">
                  <h3 className="text-sm font-semibold text-slate-900">{worker.display_name || worker.email}</h3>
                  <p className="text-xs text-slate-500">{worker.clients?.name || '-'}</p>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.badgeClass}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
                    {config.label}
                  </span>
                  {avgRatings[worker.id] && (
                    <span className="text-xs text-amber-600 flex items-center gap-0.5 font-medium">
                      <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                      {avgRatings[worker.id].avg} ({avgRatings[worker.id].count})
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
