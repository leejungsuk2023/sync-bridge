'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import {
  Link as LinkIcon,
  Lock,
  Users,
  MessageSquare,
  ClipboardList,
  Calendar,
  Clock,
  GitBranch,
  FileText,
  Headphones,
  TrendingUp,
  Monitor,
  Building,
  Layers,
  BookOpen,
  UserCog,
  ChevronDown,
} from 'lucide-react';

const WorkerDashboard = dynamic(() => import('./WorkerDashboard'), { ssr: false });
const HospitalDashboard = dynamic(() => import('./HospitalDashboard'), { ssr: false });
const StaffDashboard = dynamic(() => import('./StaffDashboard'), { ssr: false });
const ChatLayout = dynamic(() => import('./ChatLayout'), { ssr: false });

interface NavCard {
  title: string;
  description: string;
  url: string;
  icon: React.ElementType;
  color: string;
  summary?: string;
}

const ADMIN_CARDS: NavCard[] = [
  { title: '직원 현황', description: '실시간 직원 상태', url: '/admin/workers', icon: Users, color: 'emerald' },
  { title: '업무 관리', description: '업무 할당 + 목록', url: '/admin/tasks', icon: ClipboardList, color: 'amber' },
  { title: '직원별 현황', description: '직원별 업무 현황', url: '/admin/calendar', icon: Calendar, color: 'purple' },
  { title: '근무 리포트', description: '오늘 근무 리포트', url: '/admin/time-report', icon: Clock, color: 'orange' },
  { title: '지시 현황', description: '지시/협조 현황', url: '/admin/directives', icon: GitBranch, color: 'indigo' },
  { title: '월간 보고서', description: '월간 보고서', url: '/admin/reports', icon: FileText, color: 'rose' },
  { title: '상담', description: '고객 상담', url: '/consultation', icon: Headphones, color: 'teal' },
  { title: 'Sales', description: '성과 분석', url: '/sales', icon: TrendingUp, color: 'pink' },
  { title: '모니터링', description: '실시간 관제', url: '/admin/monitoring', icon: Monitor, color: 'slate' },
  { title: '병원KB', description: '병원 정보 관리', url: '/admin/hospital-kb', icon: Building, color: 'cyan' },
  { title: '업무 프리셋', description: '프리셋 관리', url: '/admin/presets', icon: Layers, color: 'lime' },
  { title: '용어집', description: '용어집 관리', url: '/admin/glossary', icon: BookOpen, color: 'violet' },
  { title: '계정 관리', description: '계정 생성/관리', url: '/admin/users', icon: UserCog, color: 'gray' },
];

const CLIENT_CARD_URLS = new Set([
  '/admin/tasks',
  '/admin/calendar',
  '/admin/time-report',
  '/consultation',
  '/admin/reports',
]);

const STAFF_EXCLUDED_URLS = new Set([
  '/admin/calendar',
  '/admin/users',
]);

const COLOR_MAP: Record<string, { bg: string; hover: string; iconBg: string; iconHoverBg: string; iconText: string; border: string; summaryText: string }> = {
  emerald: { bg: 'bg-white', hover: 'hover:border-emerald-200', iconBg: 'bg-emerald-50', iconHoverBg: 'group-hover:bg-emerald-100', iconText: 'text-emerald-600', border: 'border-slate-200', summaryText: 'text-emerald-600' },
  blue:    { bg: 'bg-white', hover: 'hover:border-blue-200',    iconBg: 'bg-blue-50',    iconHoverBg: 'group-hover:bg-blue-100',    iconText: 'text-blue-600',    border: 'border-slate-200', summaryText: 'text-blue-600' },
  amber:   { bg: 'bg-white', hover: 'hover:border-amber-200',   iconBg: 'bg-amber-50',   iconHoverBg: 'group-hover:bg-amber-100',   iconText: 'text-amber-600',   border: 'border-slate-200', summaryText: 'text-amber-600' },
  purple:  { bg: 'bg-white', hover: 'hover:border-purple-200',  iconBg: 'bg-purple-50',  iconHoverBg: 'group-hover:bg-purple-100',  iconText: 'text-purple-600',  border: 'border-slate-200', summaryText: 'text-purple-600' },
  orange:  { bg: 'bg-white', hover: 'hover:border-orange-200',  iconBg: 'bg-orange-50',  iconHoverBg: 'group-hover:bg-orange-100',  iconText: 'text-orange-600',  border: 'border-slate-200', summaryText: 'text-orange-600' },
  indigo:  { bg: 'bg-white', hover: 'hover:border-indigo-200',  iconBg: 'bg-indigo-50',  iconHoverBg: 'group-hover:bg-indigo-100',  iconText: 'text-indigo-600',  border: 'border-slate-200', summaryText: 'text-indigo-600' },
  rose:    { bg: 'bg-white', hover: 'hover:border-rose-200',    iconBg: 'bg-rose-50',    iconHoverBg: 'group-hover:bg-rose-100',    iconText: 'text-rose-600',    border: 'border-slate-200', summaryText: 'text-rose-600' },
  teal:    { bg: 'bg-white', hover: 'hover:border-teal-200',    iconBg: 'bg-teal-50',    iconHoverBg: 'group-hover:bg-teal-100',    iconText: 'text-teal-600',    border: 'border-slate-200', summaryText: 'text-teal-600' },
  pink:    { bg: 'bg-white', hover: 'hover:border-pink-200',    iconBg: 'bg-pink-50',    iconHoverBg: 'group-hover:bg-pink-100',    iconText: 'text-pink-600',    border: 'border-slate-200', summaryText: 'text-pink-600' },
  slate:   { bg: 'bg-white', hover: 'hover:border-slate-300',   iconBg: 'bg-slate-50',   iconHoverBg: 'group-hover:bg-slate-100',   iconText: 'text-slate-600',   border: 'border-slate-200', summaryText: 'text-slate-600' },
  cyan:    { bg: 'bg-white', hover: 'hover:border-cyan-200',    iconBg: 'bg-cyan-50',    iconHoverBg: 'group-hover:bg-cyan-100',    iconText: 'text-cyan-600',    border: 'border-slate-200', summaryText: 'text-cyan-600' },
  lime:    { bg: 'bg-white', hover: 'hover:border-lime-200',    iconBg: 'bg-lime-50',    iconHoverBg: 'group-hover:bg-lime-100',    iconText: 'text-lime-600',    border: 'border-slate-200', summaryText: 'text-lime-600' },
  violet:  { bg: 'bg-white', hover: 'hover:border-violet-200',  iconBg: 'bg-violet-50',  iconHoverBg: 'group-hover:bg-violet-100',  iconText: 'text-violet-600',  border: 'border-slate-200', summaryText: 'text-violet-600' },
  gray:    { bg: 'bg-white', hover: 'hover:border-gray-300',    iconBg: 'bg-gray-50',    iconHoverBg: 'group-hover:bg-gray-100',    iconText: 'text-gray-600',    border: 'border-slate-200', summaryText: 'text-gray-600' },
};

function NavCardItem({ card }: { card: NavCard & { summary?: string } }) {
  const c = COLOR_MAP[card.color] ?? COLOR_MAP['slate'];
  const Icon = card.icon;
  return (
    <a
      href={card.url}
      className={`group block ${c.bg} rounded-xl shadow-sm border ${c.border} ${c.hover} p-5 hover:shadow-md transition-all`}
    >
      <div className="flex items-start gap-4">
        <div className={`w-11 h-11 rounded-lg ${c.iconBg} ${c.iconHoverBg} flex items-center justify-center flex-shrink-0 transition-colors`}>
          <Icon className={`w-5 h-5 ${c.iconText}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900 text-sm">{card.title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{card.description}</p>
          {card.summary && (
            <p className={`text-xs ${c.summaryText} font-medium mt-2`}>{card.summary}</p>
          )}
        </div>
      </div>
    </a>
  );
}

export default function Dashboard({ user }: { user: any }) {
  const [profile, setProfile] = useState<any>(null);
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [chatCollapsed, setChatCollapsed] = useState(false);

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

      if (profileData?.role === 'bbg_admin' || profileData?.role === 'staff') {
        const [workersRes, pendingRes] = await Promise.all([
          supabase.from('profiles').select('*, clients(name)').eq('role', 'worker'),
          supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        ]);
        setWorkers(workersRes.data || []);
        setPendingCount(pendingRes.count ?? null);
      } else if (profileData?.client_id) {
        const [workersRes, pendingRes] = await Promise.all([
          supabase.from('profiles').select('*, clients(name)').eq('role', 'worker').eq('client_id', profileData.client_id),
          supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('client_id', profileData.client_id),
        ]);
        setWorkers(workersRes.data || []);
        setPendingCount(pendingRes.count ?? null);
      } else {
        setWorkers([]);
        setPendingCount(null);
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

  // staff uses same grid dashboard as bbg_admin (filtered cards)

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'bbg_admin':
        return <span className="px-2.5 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">관리자</span>;
      case 'client':
        return <span className="px-2.5 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">병원</span>;
      case 'worker':
        return <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full">직원</span>;
      case 'staff':
        return <span className="px-2.5 py-1 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">한국직원</span>;
      case 'hospital':
        return <span className="px-2.5 py-1 bg-teal-100 text-teal-700 text-xs font-medium rounded-full">파트너 병원</span>;
      default:
        return <span className="px-2.5 py-1 bg-slate-100 text-slate-500 text-xs font-medium rounded-full">{role}</span>;
    }
  };

  // Build cards with dynamic summary info
  const activeWorkerCount = workers.filter((w) => w.status === 'active').length;

  const cards: (NavCard & { summary?: string })[] = ADMIN_CARDS.map((card) => {
    if (card.url === '/admin/workers') {
      return { ...card, summary: activeWorkerCount > 0 ? `활성 ${activeWorkerCount}명` : undefined };
    }
    if (card.url === '/admin/tasks' && pendingCount !== null) {
      return { ...card, summary: `대기 ${pendingCount}건` };
    }
    return { ...card };
  });

  const visibleCards =
    profile?.role === 'bbg_admin'
      ? cards
      : profile?.role === 'staff'
        ? cards.filter((c) => !STAFF_EXCLUDED_URLS.has(c.url))
        : cards.filter((c) => CLIENT_CARD_URLS.has(c.url));

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
        {/* Chat — always visible at top */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setChatCollapsed(!chatCollapsed)}
            className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-blue-600" />
              <h2 className="text-sm font-semibold text-slate-900">채팅</h2>
            </div>
            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${chatCollapsed ? '' : 'rotate-180'}`} />
          </button>
          {!chatCollapsed && (
            <div className="border-t border-slate-100 p-4">
              <ChatLayout userId={user.id} clientId={profile?.client_id} />
            </div>
          )}
        </div>

        {/* Grid cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {visibleCards.map((card) => (
            <NavCardItem key={card.url} card={card} />
          ))}
        </div>
      </main>
    </div>
  );
}
