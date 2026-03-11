'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import WorkerStatusToggle from './WorkerStatusToggle';
import TaskList from './TaskList';
import TaskPropose from './TaskPropose';
import dynamic from 'next/dynamic';

// Lazy load tab components (only one tab visible at a time):
const ChatLayout = dynamic(() => import('./ChatLayout'), { ssr: false });
const TranslationHelper = dynamic(() => import('./TranslationHelper'), { ssr: false });
const WorkerFollowup = dynamic(() => import('./WorkerFollowup'), { ssr: false });
const MessagingLayout = dynamic(() => import('./MessagingLayout'), { ssr: false });

type Tab = 'งาน' | 'แชท' | 'ให้คำปรึกษา' | 'ติดตาม' | 'เครื่องมือ';

export default function WorkerDashboard({ user, profile }: { user: any; profile: any }) {
  const [activeTab, setActiveTab] = useState<Tab>('งาน');
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasUrgent, setHasUrgent] = useState(false);

  useEffect(() => {
    const loadRating = async () => {
      const { data } = await supabase
        .from('tasks')
        .select('rating')
        .eq('assignee_id', user.id)
        .not('rating', 'is', null);

      if (data && data.length > 0) {
        const sum = data.reduce((acc: number, t: any) => acc + (t.rating ?? 0), 0);
        setAvgRating(Math.round((sum / data.length) * 10) / 10);
      }
    };
    loadRating();
  }, [user.id]);

  useEffect(() => {
    const fetchNotifCount = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch('/api/zendesk/followup-notifications', {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const notifs = data.notifications || [];
          setUnreadCount(notifs.length);
          setHasUrgent(notifs.some((n: any) =>
            n.body?.toLowerCase().includes('urgency: high') ||
            n.body?.toLowerCase().includes('urgency:high') ||
            n.title?.includes('เร่งด่วน')
          ));
        }
      } catch (err) {
        console.error('[WorkerDashboard] Failed to fetch notifications:', err);
      }
    };
    fetchNotifCount();
    const interval = setInterval(fetchNotifCount, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const [profileState, setProfileState] = useState(profile);

  const refreshProfile = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    if (data) setProfileState(data);
  };

  const tabs: Tab[] = ['งาน', 'แชท', 'ให้คำปรึกษา', 'ติดตาม', 'เครื่องมือ'];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
          <h1 className="text-base sm:text-lg font-semibold text-slate-900">SyncBridge</h1>
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <span className="text-xs sm:text-sm text-slate-600 truncate max-w-[120px] sm:max-w-none">
              {profile?.email || user.email}
            </span>
            <span className="px-2 py-0.5 sm:px-2.5 sm:py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full whitespace-nowrap">
              พนักงาน
            </span>
            <button
              onClick={handleLogout}
              className="text-xs sm:text-sm text-slate-500 hover:text-slate-700 transition-colors whitespace-nowrap"
            >
              ออกจากระบบ
            </button>
          </div>
        </div>
      </header>

      {/* Status + Rating */}
      <div className="px-4 sm:px-6 pt-4 pb-2 space-y-2">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <WorkerStatusToggle userId={user.id} />
          </div>
          {avgRating !== null && (
            <div className="flex-shrink-0 flex flex-col items-center bg-white border border-amber-200 rounded-xl px-3 py-2 shadow-sm">
              <span className="text-lg font-bold text-amber-500">{avgRating}</span>
              <span className="text-[10px] text-slate-500">คะแนนเฉลี่ย</span>
            </div>
          )}
        </div>
      </div>

      {/* Urgent Followup Banner */}
      {hasUrgent && activeTab !== 'ติดตาม' && (
        <div
          onClick={() => setActiveTab('ติดตาม')}
          className="mx-4 sm:mx-6 mt-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-red-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
            </span>
            <span className="text-sm font-medium text-red-700">มีคำสั่งเร่งด่วนที่ต้องดำเนินการ</span>
          </div>
          <span className="text-xs text-red-500 font-medium">ดูเลย →</span>
        </div>
      )}

      {/* Desktop Tab Bar */}
      <div className="hidden md:flex px-4 sm:px-6 border-b border-slate-200 bg-white">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              'relative px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab
                ? 'text-blue-600 border-blue-600'
                : 'text-slate-500 border-transparent hover:text-slate-700',
            ].join(' ')}
          >
            {tab}
            {tab === 'ติดตาม' && unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold text-white bg-red-500 rounded-full min-w-[18px] leading-none">
                {unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <main className="flex-1 px-4 sm:px-6 py-4 pb-20 md:pb-6 space-y-4 overflow-y-auto">
        {activeTab === 'งาน' && (
          <>
            <TaskList assigneeId={user.id} userId={user.id} title="งานของฉัน" locale="th" />
            <TaskPropose userId={user.id} />
            <TaskList clientId={profile.client_id} userId={user.id} title="งานทั้งหมดของทีม" locale="th" />
          </>
        )}
        {activeTab === 'แชท' && (
          <ChatLayout userId={user.id} clientId={profile.client_id} locale="th" assigneeId={user.id} />
        )}
        {activeTab === 'ให้คำปรึกษา' && (
          <MessagingLayout userRole={profileState?.role || 'worker'} userId={user.id} locale="th" />
        )}
        {activeTab === 'ติดตาม' && (
          <WorkerFollowup userId={user.id} onNotificationsRead={() => { setUnreadCount(0); setHasUrgent(false); }} />
        )}
        {activeTab === 'เครื่องมือ' && (
          <TranslationHelper />
        )}
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-10 flex">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              'relative flex-1 py-3 text-xs font-medium transition-colors',
              activeTab === tab
                ? 'text-blue-600'
                : 'text-slate-500 hover:text-slate-700',
            ].join(' ')}
          >
            {tab}
            {tab === 'ติดตาม' && unreadCount > 0 && (
              <span className="absolute top-1 right-1/4 inline-flex items-center justify-center px-1 py-0.5 text-[9px] font-bold text-white bg-red-500 rounded-full min-w-[16px] leading-none">
                {unreadCount}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
