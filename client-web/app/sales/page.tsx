'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import SalesPerformance from '@/components/SalesPerformance';

export default function SalesPage() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        router.push('/app');
        return;
      }
      setUser(session.user);
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();
      if (profileData?.role !== 'bbg_admin') {
        router.push('/app');
        return;
      }
      setProfile(profileData);
      setLoading(false);
    };
    init();
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/app');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-slate-500">로딩 중...</p>
      </div>
    );
  }

  if (!user || !profile) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-slate-800">Sales 성과 분석</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-600">{profile.email}</span>
          <span className="text-xs px-2 py-1 rounded bg-indigo-100 text-indigo-700 font-medium">Sales</span>
          <a href="/app" className="text-sm text-slate-500 hover:text-slate-700">대시보드</a>
          <a href="/admin/monitoring" className="text-sm text-slate-500 hover:text-slate-700">모니터링</a>
          <button onClick={handleLogout} className="text-sm text-slate-500 hover:text-slate-700">
            로그아웃
          </button>
        </div>
      </header>
      <main className="p-6 max-w-7xl mx-auto">
        <SalesPerformance />
      </main>
    </div>
  );
}
