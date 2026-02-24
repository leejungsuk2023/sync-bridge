import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SyncBridge - 의료관광 BPO 솔루션',
  description: '외국인 직원 채용 대신 시스템을 구독하세요. 1:1 전담 마케터, 실시간 업무 관제, 한국인 PM 밀착 검수.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-slate-50">{children}</body>
    </html>
  );
}
