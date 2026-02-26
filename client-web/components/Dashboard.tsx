'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Link as LinkIcon } from 'lucide-react';
import WorkerStatus from './WorkerStatus';
import TaskAssign from './TaskAssign';
import TaskList from './TaskList';
import TimeReport from './TimeReport';
import TaskCalendar from './TaskCalendar';
import TaskPresetManager from './TaskPresetManager';
import UserManager from './UserManager';

export default function Dashboard({ user }: { user: any }) {
  const [profile, setProfile] = useState<any>(null);
  const [workers, setWorkers] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      const { data: profileData, error: profileError } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (profileError) {
        console.error('Profile load error:', profileError);
      }
      setProfile(profileData);

      if (profileData?.role === 'bbg_admin') {
        const { data: workersData } = await supabase.from('profiles').select('*, clients(name)').eq('role', 'worker');
        setWorkers(workersData || []);
        const { data: clientsData } = await supabase.from('clients').select('*');
        setClients(clientsData || []);
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

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'bbg_admin':
        return <span className="px-2.5 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">관리자</span>;
      case 'client':
        return <span className="px-2.5 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">병원</span>;
      case 'worker':
        return <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full">직원</span>;
      default:
        return <span className="px-2.5 py-1 bg-slate-100 text-slate-500 text-xs font-medium rounded-full">{role}</span>;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LinkIcon className="w-5 h-5 text-emerald-600" />
            <h1 className="text-lg font-semibold text-slate-900">SyncBridge 관리자</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600">{profile?.email || user.email}</span>
            {getRoleBadge(profile?.role || 'unknown')}
            <button onClick={handleLogout} className="text-sm text-slate-500 hover:text-slate-700 transition-colors">
              로그아웃
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-[1440px] mx-auto p-6 space-y-6">
        <WorkerStatus workers={workers} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TaskAssign workers={workers} clientId={profile?.client_id} />
          <TaskList workers={workers} clientId={profile?.client_id} userId={user.id} />
        </div>
        {profile?.role === 'bbg_admin' && (
          <TaskPresetManager profile={profile} clients={clients} />
        )}
        <TaskCalendar workers={workers} clientId={profile?.client_id} />
        <TimeReport workers={workers} />
        {profile?.role === 'bbg_admin' && (
          <UserManager clients={clients} />
        )}
      </main>
    </div>
  );
}
