'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import { Link as LinkIcon, ChevronDown, Lock } from 'lucide-react';
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
const StaffDashboard = dynamic(() => import('./StaffDashboard'), { ssr: false });
const AdminDirectiveTable = dynamic(
  () => import('./StaffDashboard').then((mod) => ({ default: mod.AdminDirectiveTable })),
  { ssr: false },
);
const GlossaryManager = dynamic(() => import('./GlossaryManager'), { ssr: false });
const MonthlyReport = dynamic(() => import('./MonthlyReport'), { ssr: false });

function AdminDirectiveSection() {
  const [collapsed, setCollapsed] = useState(true);
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 border-l-4 border-l-indigo-400 p-4 sm:p-6">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between cursor-pointer"
      >
        <h2 className="text-lg font-semibold text-slate-900">지시 현황</h2>
        <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
      </button>
      {!collapsed && (
        <div className="mt-6">
          <AdminDirectiveTable />
        </div>
      )}
    </div>
  );
}

export default function Dashboard({ user }: { user: any }) {
  const [profile, setProfile] = useState<any>(null);
  const [workers, setWorkers] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatCollapsed, setChatCollapsed] = useState(true);

  // Password change modal state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);

  const openPasswordModal = () => {
    setPwCurrent('');
    setPwNew('');
    setPwConfirm('');
    setPwError('');
    setPwSuccess(false);
    setShowPasswordModal(true);
  };

  const handlePasswordChange = async () => {
    setPwError('');
    if (!pwCurrent || !pwNew || !pwConfirm) {
      setPwError('모든 필드를 입력해주세요.');
      return;
    }
    if (pwNew !== pwConfirm) {
      setPwError('새 비밀번호가 일치하지 않습니다.');
      return;
    }
    if (pwNew.length < 6) {
      setPwError('새 비밀번호는 최소 6자 이상이어야 합니다.');
      return;
    }
    setPwLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setPwError('세션이 만료되었습니다. 다시 로그인해주세요.'); return; }
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNew }),
      });
      const data = await res.json();
      if (!res.ok) { setPwError(data.error || '비밀번호 변경에 실패했습니다.'); return; }
      setPwSuccess(true);
      console.log('[ChangePassword] Password changed successfully');
    } catch (err) {
      console.error('[ChangePassword] Error:', err);
      setPwError('오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setPwLoading(false);
    }
  };

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

  if (profile?.role === 'staff') {
    return <StaffDashboard user={user} profile={profile} />;
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
            {profile?.role === 'bbg_admin' && (
              <a href="/admin/hospital-kb" className="text-xs sm:text-sm text-indigo-600 hover:text-indigo-800 transition-colors font-medium">
                병원KB
              </a>
            )}
            <button
              onClick={openPasswordModal}
              className="text-sm text-slate-500 hover:text-slate-700 transition-colors flex items-center gap-1"
              title="비밀번호 변경"
            >
              <Lock className="w-4 h-4" />
              <span className="hidden sm:inline">비밀번호</span>
            </button>
            <button onClick={handleLogout} className="text-sm text-slate-500 hover:text-slate-700 transition-colors">
              로그아웃
            </button>
          </div>
        </div>
      </header>

      {/* Password Change Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">비밀번호 변경</h2>
            {pwSuccess ? (
              <div className="space-y-4">
                <p className="text-sm text-emerald-600 font-medium">비밀번호가 성공적으로 변경되었습니다.</p>
                <button
                  onClick={() => setShowPasswordModal(false)}
                  className="w-full py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
                >
                  닫기
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">현재 비밀번호</label>
                  <input
                    type="password"
                    value={pwCurrent}
                    onChange={(e) => setPwCurrent(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    placeholder="현재 비밀번호 입력"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">새 비밀번호</label>
                  <input
                    type="password"
                    value={pwNew}
                    onChange={(e) => setPwNew(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    placeholder="새 비밀번호 (최소 6자)"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">새 비밀번호 확인</label>
                  <input
                    type="password"
                    value={pwConfirm}
                    onChange={(e) => setPwConfirm(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    placeholder="새 비밀번호 재입력"
                    onKeyDown={(e) => e.key === 'Enter' && handlePasswordChange()}
                  />
                </div>
                {pwError && <p className="text-xs text-red-500">{pwError}</p>}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => setShowPasswordModal(false)}
                    className="flex-1 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    취소
                  </button>
                  <button
                    onClick={handlePasswordChange}
                    disabled={pwLoading}
                    className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                  >
                    {pwLoading ? '변경 중...' : '변경'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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
        {profile?.role === 'bbg_admin' && (
          <AdminDirectiveSection />
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
