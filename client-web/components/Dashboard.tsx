'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import { Link as LinkIcon, ChevronDown } from 'lucide-react';
import WorkerStatus from './WorkerStatus';
import TaskAssign from './TaskAssign';
import TaskList from './TaskList';

const TimeReport = dynamic(() => import('./TimeReport'), { ssr: false });
const TaskCalendar = dynamic(() => import('./TaskCalendar'), { ssr: false });
const ChatLayout = dynamic(() => import('./ChatLayout'), { ssr: false });
const TaskPresetManager = dynamic(() => import('./TaskPresetManager'), { ssr: false });
const UserManager = dynamic(() => import('./UserManager'), { ssr: false });
const WorkerDashboard = dynamic(() => import('./WorkerDashboard'), { ssr: false });
const HospitalDashboard = dynamic(() => import('./HospitalDashboard'), { ssr: false });
const GlossaryManager = dynamic(() => import('./GlossaryManager'), { ssr: false });
const MonthlyReport = dynamic(() => import('./MonthlyReport'), { ssr: false });

export default function Dashboard({ user }: { user: any }) {
  const [profile, setProfile] = useState<any>(null);
  const [workers, setWorkers] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatCollapsed, setChatCollapsed] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      const { data: profileData, error: profileError } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (profileError) {
        console.error('Profile load error:', profileError);
      }
      setProfile(profileData);

      if (profileData?.role === 'bbg_admin') {
        const [workersRes, clientsRes] = await Promise.all([
          supabase.from('profiles').select('*, clients(name)').eq('role', 'worker'),
          supabase.from('clients').select('*'),
        ]);
        setWorkers(workersRes.data || []);
        setClients(clientsRes.data || []);
      } else if (profileData?.client_id) {
        const { data: workersData } = await supabase.from('profiles').select('*, clients(name)').eq('role', 'worker').eq('client_id', profileData.client_id);
        setWorkers(workersData || []);
        setClients([]);
      } else {
        setWorkers([]);
        setClients([]);
      }
      setLoading(false);
    };
    loadData();
  }, [user]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <p className="text-slate-500">로딩 중...</p>
      </div>
    );
  }

  if (profile?.role === 'worker') {
    return <WorkerDashboard user={user} profile={profile} />;
  }

  if (profile?.role === 'hospital') {
    return <HospitalDashboard user={user} profile={profile} />;
  }

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'bbg_admin':
        return <span className="px-2.5 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">관리자</span>;
      case 'client':
        return <span className="px-2.5 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">병원</span>;
      case 'worker':
        return <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full">직원</span>;
      case 'hospital':
        return <span className="px-2.5 py-1 bg-teal-100 text-teal-700 text-xs font-medium rounded-full">파트너 병원</span>;
      default:
        return <span className="px-2.5 py-1 bg-slate-100 text-slate-500 text-xs font-medium rounded-full">{role}</span>;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LinkIcon className="w-5 h-5 text-emerald-600" />
            <h1 className="text-lg font-semibold text-slate-900">SyncBridge 관리자</h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <span className="text-sm text-slate-600 hidden sm:inline">{profile?.email || user.email}</span>
            {getRoleBadge(profile?.role || 'unknown')}
            {(profile?.role === 'bbg_admin' || profile?.role === 'client') && (
              <a href="/consultation" className="text-xs sm:text-sm text-indigo-600 hover:text-indigo-800 transition-colors font-medium">
                상담
              </a>
            )}
            {profile?.role === 'bbg_admin' && (
              <a href="/admin/monitoring" className="text-xs sm:text-sm text-indigo-600 hover:text-indigo-800 transition-colors font-medium">
                모니터링
              </a>
            )}
            {profile?.role === 'bbg_admin' && (
              <a href="/sales" className="text-xs sm:text-sm text-indigo-600 hover:text-indigo-800 transition-colors font-medium">
                Sales
              </a>
            )}
            <button onClick={handleLogout} className="text-sm text-slate-500 hover:text-slate-700 transition-colors">
              로그아웃
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-[1440px] mx-auto px-3 py-4 sm:p-6 space-y-4 sm:space-y-6">
        <WorkerStatus workers={workers} />
        <div className="bg-gradient-to-r from-emerald-50/70 to-white rounded-xl shadow-sm border border-emerald-100 border-l-4 border-l-emerald-400 p-6">
          <button
            type="button"
            onClick={() => setChatCollapsed(!chatCollapsed)}
            className="w-full flex items-center justify-between cursor-pointer mb-0"
          >
            <h2 className="text-lg font-semibold text-slate-900">채팅</h2>
            <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${chatCollapsed ? '' : 'rotate-180'}`} />
          </button>
          {!chatCollapsed && (
            <div className="mt-6">
              <ChatLayout userId={user.id} clientId={profile?.client_id} />
            </div>
          )}
        </div>
        <TaskAssign workers={workers} clientId={profile?.client_id} />
        <TaskList clientId={profile?.client_id} userId={user.id} canComplete />
        {profile?.role === 'bbg_admin' && (
          <TaskPresetManager profile={profile} clients={clients} />
        )}
        <TaskCalendar workers={workers} clientId={profile?.client_id} />
        <TimeReport workers={workers} />
        {profile?.role === 'bbg_admin' && (
          <GlossaryManager userId={user.id} />
        )}
        {profile?.role === 'bbg_admin' && (
          <UserManager clients={clients} />
        )}
        {(profile?.role === 'bbg_admin' || profile?.role === 'client' || profile?.role === 'hospital') && (
          <MonthlyReport
            userId={user.id}
            clientId={profile?.client_id}
            role={profile?.role}
            hospitalPrefix={profile?.hospital_prefix}
          />
        )}
      </main>
    </div>
  );
}
