'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2 } from 'lucide-react';

export default function TaskPropose({ userId }: { userId: string }) {
  const [contentTh, setContentTh] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contentTh.trim()) {
      setError('업무 내용을 입력해 주세요. (กรุณากรอกเนื้อหางาน)');
      return;
    }

    setLoading(true);
    setError('');
    setPreview('');
    setSubmitted(false);

    // 1. Translate Thai → Korean
    let contentKo = '';
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: contentTh.trim(), targetLang: 'ko' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError('번역 실패: ' + (data.error || '알 수 없는 오류'));
        setLoading(false);
        return;
      }
      contentKo = data.translated || '';
      setPreview(contentKo);
    } catch (err: any) {
      setError('번역 요청 실패: ' + err.message);
      setLoading(false);
      return;
    }

    // 2. Insert task via API route (bypasses RLS)
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          assignee_id: userId,
          content: contentKo || contentTh.trim(),
          content_th: contentTh.trim(),
          source: 'worker_proposed',
        }),
      });
      const result = await res.json();
      setLoading(false);
      if (!res.ok) {
        setError('업무 제안 실패: ' + (result.error || '알 수 없는 오류'));
        return;
      }
    } catch (err: any) {
      setLoading(false);
      setError('업무 제안 실패: ' + err.message);
      return;
    }

    setContentTh('');
    setSubmitted(true);
  };

  return (
    <div className="bg-gradient-to-r from-violet-50/70 to-white rounded-xl shadow-sm border border-violet-100 border-l-4 border-l-violet-400 p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">업무 제안 (เสนองานใหม่)</h2>
      <form onSubmit={handleSubmit}>
        <div className="mb-3">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            업무 내용 — 태국어로 입력하면 한국어로 자동번역됩니다
          </label>
          <textarea
            value={contentTh}
            onChange={(e) => {
              setContentTh(e.target.value);
              setPreview('');
              setSubmitted(false);
            }}
            placeholder="เสนองานใหม่... (새 업무 제안...)"
            rows={3}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg resize-none text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none transition-shadow"
            required
          />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="w-full sm:w-auto px-6 py-2 rounded-lg bg-violet-600 text-white font-semibold hover:bg-violet-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                제안 중... (กำลังส่ง...)
              </>
            ) : (
              '업무 제안 (เสนองาน)'
            )}
          </button>
        </div>

        {preview && (
          <div className="mt-3 bg-violet-50 border border-violet-200 rounded-lg p-3">
            <p className="text-xs font-medium text-violet-900 mb-1">한국어 번역 미리보기</p>
            <p className="text-sm text-violet-800">{preview}</p>
          </div>
        )}

        {submitted && (
          <div className="mt-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            업무 제안이 전송되었습니다. (ส่งการเสนองานเรียบร้อยแล้ว)
          </div>
        )}

        {error && (
          <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
            {error}
          </div>
        )}
      </form>
    </div>
  );
}
