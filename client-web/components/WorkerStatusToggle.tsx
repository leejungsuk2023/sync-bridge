'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

const STATUS_OPTIONS = [
  { value: 'online', label: 'เข้างาน', badge: 'bg-emerald-500', text: 'text-white', ring: 'ring-emerald-400' },
  { value: 'away', label: 'ไม่อยู่', badge: 'bg-amber-400', text: 'text-slate-800', ring: 'ring-amber-300' },
  { value: 'offline', label: 'เลิกงาน', badge: 'bg-slate-400', text: 'text-white', ring: 'ring-slate-300' },
] as const;

type StatusValue = (typeof STATUS_OPTIONS)[number]['value'];

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export default function WorkerStatusToggle({ userId }: { userId: string }) {
  const [status, setStatus] = useState<StatusValue>('offline');
  const [statusStartedAt, setStatusStartedAt] = useState<number>(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(false);

  // Restore last status from time_logs on mount
  useEffect(() => {
    const restoreStatus = async () => {
      const { data } = await supabase
        .from('time_logs')
        .select('status, created_at')
        .eq('worker_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (data) {
        const validStatuses: StatusValue[] = ['online', 'away', 'offline'];
        const restoredStatus = validStatuses.includes(data.status as StatusValue)
          ? (data.status as StatusValue)
          : 'offline';
        setStatus(restoredStatus);
        setStatusStartedAt(new Date(data.created_at).getTime());
      }
    };

    restoreStatus();
  }, [userId]);

  // Elapsed time ticker
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - statusStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [statusStartedAt]);

  const handleStatusChange = useCallback(
    async (newStatus: StatusValue) => {
      if (newStatus === status || loading) return;
      setLoading(true);
      const now = Date.now();

      const { error: logError } = await supabase
        .from('time_logs')
        .insert({ worker_id: userId, status: newStatus });

      if (logError) {
        console.error('[WorkerStatusToggle] Failed to insert time_log:', logError);
      }

      if (!logError) {
        setStatus(newStatus);
        setStatusStartedAt(now);
        setElapsed(0);
      }

      setLoading(false);
    },
    [status, userId, loading]
  );

  const currentOption = STATUS_OPTIONS.find((o) => o.value === status) ?? STATUS_OPTIONS[2];

  return (
    <div className="bg-gradient-to-r from-blue-50/70 to-white rounded-xl shadow-sm border border-blue-100 border-l-4 border-l-blue-400 p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-semibold text-slate-900">สถานะของฉัน</h2>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`inline-block w-2 h-2 rounded-full ${currentOption.badge}`}
            />
            <span className="text-sm text-slate-600">{currentOption.label}</span>
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              {formatDuration(elapsed)}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((option) => {
            const isActive = status === option.value;
            return (
              <button
                key={option.value}
                onClick={() => handleStatusChange(option.value)}
                disabled={loading}
                className={[
                  'px-3 py-1.5 rounded-full text-sm font-medium transition-all',
                  option.badge,
                  option.text,
                  isActive
                    ? `ring-2 ring-offset-1 ${option.ring} opacity-100 scale-105`
                    : 'opacity-60 hover:opacity-90',
                  loading ? 'cursor-not-allowed' : 'cursor-pointer',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
