import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SyncBridge - 관리자 대시보드',
  description: '원격 BPO 업무 동기화 플랫폼',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-slate-50">{children}</body>
    </html>
  );
}
