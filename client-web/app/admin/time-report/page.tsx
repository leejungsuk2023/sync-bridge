'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import { ArrowLeft } from 'lucide-react';

const TimeReport = dynamic(() => import('@/components/TimeReport'), { ssr: false });

export default function TimeReportPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<any>(null);
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/app'); return; }

      const { data: profileData } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (!profileData || (profileData.role !== 'bbg_admin' && profileData.role !== 'client' && profileData.role !== 'staff')) {
        router.push('/app');
        return;
      }
      setProfile(profileData);

      if (profileData.role === 'bbg_admin') {
        const { data: workersData } = await supabase.from('profiles').select('*, clients(name)').eq('role', 'worker');
        setWorkers(workersData || []);
      } else if (profileData.client_id) {
        const { data: workersData } = await supabase.from('profiles').select('*, clients(name)').eq('role', 'worker').eq('client_id', profileData.client_id);
        setWorkers(workersData || []);
      }

      setLoading(false);
    };
    loadData();
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <p className="text-slate-500">로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/app" className="flex items-center gap-2 text-slate-500 hover:text-slate-700 transition-colors">
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm">홈</span>
            </a>
            <div className="h-5 w-px bg-slate-200" />
            <h1 className="text-lg font-semibold text-slate-900">오늘 근무 리포트</h1>
          </div>
        </div>
      </header>

      <main className="max-w-[1440px] mx-auto px-3 py-4 sm:p-6">
        <TimeReport workers={workers} />
      </main>
    </div>
  );
}
