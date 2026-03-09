'use client';

import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

export default function TaskCalendar({ workers, clientId }: { workers: any[]; clientId?: string }) {
  const [collapsed, setCollapsed] = useState(true);
  const [selectedWorker, setSelectedWorker] = useState('');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth(); // 0-indexed
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

  // 선택된 직원이 바뀌거나 월이 바뀌면 업무 조회
  useEffect(() => {
    if (!selectedWorker) {
      setTasks([]);
      return;
    }

    const fetchTasks = async () => {
      setLoading(true);
      const session = (await supabase.auth.getSession()).data.session;
      const params = new URLSearchParams({ assignee_id: selectedWorker, month: monthStr });
      if (clientId) params.set('client_id', clientId);

      const res = await fetch(`/api/tasks?${params}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const data = await res.json();
      setTasks(data.tasks || []);
      setLoading(false);
    };

    fetchTasks();
    setSelectedDay(null);
  }, [selectedWorker, monthStr, clientId]);

  // 날짜별 업무 그룹핑
  const tasksByDay = useMemo(() => {
    const map: Record<number, any[]> = {};
    tasks.forEach((t) => {
      const day = new Date(t.created_at).getDate();
      if (!map[day]) map[day] = [];
      map[day].push(t);
    });
    return map;
  }, [tasks]);

  // 캘린더 그리드 계산
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDayOfMonth + daysInMonth) / 7) * 7;

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToday = () => setCurrentDate(new Date());

  const today = new Date();
  const isToday = (day: number) =>
    today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

  const selectedDayTasks = selectedDay ? tasksByDay[selectedDay] || [] : [];

  // 전체 요약
  const totalPending = tasks.filter(t => t.status === 'pending').length;
  const totalDone = tasks.filter(t => t.status === 'done').length;

  return (
    <div className="bg-gradient-to-r from-violet-50/70 to-white rounded-xl shadow-sm border border-violet-100 border-l-4 border-l-violet-400 p-6">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between cursor-pointer mb-0"
      >
        <h2 className="text-lg font-semibold text-slate-900">직원별 업무 현황</h2>
        <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
      </button>
      {!collapsed && (<>

      {/* 직원 선택 + 월 이동 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 mt-6">
        <select
          value={selectedWorker}
          onChange={(e) => setSelectedWorker(e.target.value)}
          className="h-10 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow bg-white min-w-[200px]"
        >
          <option value="">직원을 선택하세요</option>
          {workers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.display_name || w.email}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <button type="button" onClick={prevMonth} className="p-2 rounded-lg hover:bg-slate-100 transition-colors">
            <ChevronLeft className="w-4 h-4 text-slate-600" />
          </button>
          <span className="text-sm font-semibold text-slate-800 min-w-[120px] text-center">
            {year}년 {month + 1}월
          </span>
          <button type="button" onClick={nextMonth} className="p-2 rounded-lg hover:bg-slate-100 transition-colors">
            <ChevronRight className="w-4 h-4 text-slate-600" />
          </button>
          <button type="button" onClick={goToday} className="ml-1 px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">
            오늘
          </button>
        </div>
      </div>

      {!selectedWorker ? (
        <p className="text-center text-slate-500 py-12">직원을 선택하면 업무 현황이 표시됩니다.</p>
      ) : loading ? (
        <p className="text-center text-slate-500 py-12">불러오는 중...</p>
      ) : (
        <>
          {/* 요약 */}
          <div className="flex gap-4 mb-4">
            <span className="text-xs font-medium text-slate-600">
              이번 달: 총 {tasks.length}건
            </span>
            <span className="text-xs font-medium text-amber-600">
              대기 {totalPending}건
            </span>
            <span className="text-xs font-medium text-emerald-600">
              완료 {totalDone}건
            </span>
          </div>

          {/* 캘린더 헤더 */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS.map((d, i) => (
              <div key={d} className={`text-center text-xs font-semibold py-2 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-slate-600'}`}>
                {d}
              </div>
            ))}
          </div>

          {/* 캘린더 그리드 */}
          <div className="grid grid-cols-7 border-t border-l border-slate-200">
            {Array.from({ length: totalCells }, (_, i) => {
              const day = i - firstDayOfMonth + 1;
              const isValid = day >= 1 && day <= daysInMonth;
              const dayTasks = isValid ? tasksByDay[day] || [] : [];
              const pendingCount = dayTasks.filter(t => t.status === 'pending').length;
              const doneCount = dayTasks.filter(t => t.status === 'done').length;
              const isSelected = selectedDay === day && isValid;
              const dayOfWeek = i % 7;

              return (
                <div
                  key={i}
                  onClick={() => isValid && setSelectedDay(isSelected ? null : day)}
                  className={`border-r border-b border-slate-200 min-h-[72px] p-1.5 cursor-pointer transition-colors ${
                    !isValid ? 'bg-slate-50' :
                    isSelected ? 'bg-emerald-50' :
                    'hover:bg-slate-50'
                  }`}
                >
                  {isValid && (
                    <>
                      <div className={`text-xs font-medium mb-1 ${
                        isToday(day) ? 'w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center' :
                        dayOfWeek === 0 ? 'text-red-500' :
                        dayOfWeek === 6 ? 'text-blue-500' :
                        'text-slate-700'
                      }`}>
                        {day}
                      </div>
                      {dayTasks.length > 0 && (
                        <div className="flex flex-wrap gap-0.5">
                          {pendingCount > 0 && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-medium">
                              {pendingCount}
                            </span>
                          )}
                          {doneCount > 0 && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-medium">
                              {doneCount}
                            </span>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* 선택한 날짜의 업무 목록 */}
          {selectedDay && (
            <div className="mt-4 border border-slate-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">
                {month + 1}월 {selectedDay}일 업무 ({selectedDayTasks.length}건)
              </h3>
              {selectedDayTasks.length === 0 ? (
                <p className="text-sm text-slate-500">이 날 할당된 업무가 없습니다.</p>
              ) : (
                <ul className="space-y-2">
                  {selectedDayTasks.map((t) => (
                    <li key={t.id} className="flex items-start justify-between gap-3 p-3 rounded-lg border border-slate-100 bg-slate-50">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-900">{t.content}</p>
                        {t.content_th && (
                          <p className="text-xs text-slate-500 mt-1">🇹🇭 {t.content_th}</p>
                        )}
                      </div>
                      <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${
                        t.status === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {t.status === 'done' ? '완료' : '대기'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
      </>)}
    </div>
  );
}
