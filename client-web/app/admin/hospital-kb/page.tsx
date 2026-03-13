'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import dynamic from 'next/dynamic';
import { ChevronLeft } from 'lucide-react';

const HospitalKBManager = dynamic(() => import('@/components/HospitalKBManager'), { ssr: false });

export default function HospitalKBPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);

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
      if (profileData?.role !== 'bbg_admin' && profileData?.role !== 'staff') {
        router.push('/app');
        return;
      }
      setProfile(profileData);
      setAuthLoading(false);
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) router.push('/app');
    });
    return () => subscription.unsubscribe();
  }, [router]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <p className="text-slate-500">로딩 중...</p>
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-center">
          <p className="text-slate-500 mb-2">접근 권한이 없습니다.</p>
          <a href="/app" className="text-sm text-emerald-600 hover:underline">대시보드로 이동</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center gap-4">
          <a
            href="/app"
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            대시보드
          </a>
          <div className="h-4 w-px bg-slate-200" />
          <h1 className="text-lg font-semibold text-slate-900">병원 지식 베이스 관리</h1>
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700 ml-1">
            bbg_admin
          </span>
          <div className="flex-1" />
          <span className="text-sm text-slate-500 hidden sm:inline">{profile.email}</span>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-[1440px] mx-auto px-4 py-6 sm:px-6">
        <HospitalKBManager userId={user.id} />
      </main>
    </div>
  );
}
