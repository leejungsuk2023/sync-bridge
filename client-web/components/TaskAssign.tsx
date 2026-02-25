'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2 } from 'lucide-react';

export default function TaskAssign({ workers, clientId }: { workers: any[]; clientId?: string }) {
  const [assigneeId, setAssigneeId] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [dueDate, setDueDate] = useState('');

  // 프리셋
  const [presets, setPresets] = useState<any[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [presetContentTh, setPresetContentTh] = useState('');

  useEffect(() => {
    const fetchPresets = async () => {
      let query = supabase
        .from('task_presets')
        .select('*')
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: true });

      const { data } = await query;
      setPresets(data || []);
    };
    fetchPresets();
  }, [clientId]);

  const handlePresetChange = (presetId: string) => {
    setSelectedPresetId(presetId);
    if (!presetId) {
      setPresetContentTh('');
      return;
    }
    const preset = presets.find(p => p.id === presetId);
    if (preset) {
      setContent(preset.content_ko);
      setPresetContentTh(preset.content_th || '');
      setPreview('');
      setError('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigneeId || !content.trim()) {
      setError('담당자와 업무 내용을 입력해 주세요.');
      return;
    }
    let targetClientId = clientId;
    if (!targetClientId) {
      const selectedWorker = workers.find((w) => w.id === assigneeId);
      if (!selectedWorker?.client_id) {
        setError('담당자의 고객사 정보를 찾을 수 없습니다.');
        return;
      }
      targetClientId = selectedWorker.client_id;
    }
    setLoading(true);
    setError('');
    setPreview('');

    let contentTh = '';
    if (presetContentTh && selectedPresetId) {
      const preset = presets.find(p => p.id === selectedPresetId);
      if (preset && content.trim() === preset.content_ko) {
        contentTh = presetContentTh;
        setPreview(contentTh);
      }
    }

    if (!contentTh) {
      try {
        const res = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: content.trim(), targetLang: 'th' }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError('번역 실패: ' + (data.error || '알 수 없는 오류'));
          setLoading(false);
          return;
        }
        contentTh = data.translated || '';
        setPreview(contentTh);
      } catch (err: any) {
        setError('번역 요청 실패: ' + err.message);
        setLoading(false);
        return;
      }
    }

    const insertData: any = {
      client_id: targetClientId,
      assignee_id: assigneeId,
      content: content.trim(),
      content_th: contentTh,
      status: 'pending',
    };
    if (dueDate) insertData.due_date = new Date(dueDate).toISOString();

    try {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify(insertData),
      });
      const result = await res.json();
      setLoading(false);
      if (!res.ok) {
        setError(result.error || '업무 할당 실패');
        return;
      }
    } catch (err: any) {
      setLoading(false);
      setError(err.message);
      return;
    }
    setContent('');
    setAssigneeId('');
    setPreview('');
    setSelectedPresetId('');
    setPresetContentTh('');
    setDueDate('');
    alert('업무가 할당되었습니다.');
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
      <h2 className="text-lg font-semibold text-slate-900 mb-6">업무 할당</h2>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700">담당자</label>
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow bg-white"
            required
          >
            <option value="">선택하세요</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.display_name || w.email}
              </option>
            ))}
          </select>
        </div>

        {presets.length > 0 && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">
              프리셋 선택 <span className="text-xs text-slate-500 ml-1">(선택사항)</span>
            </label>
            <select
              value={selectedPresetId}
              onChange={(e) => handlePresetChange(e.target.value)}
              className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow bg-white"
            >
              <option value="">직접 입력</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>{p.title_ko}</option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700">업무 내용 (한국어)</label>
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              if (selectedPresetId) {
                const preset = presets.find(p => p.id === selectedPresetId);
                if (preset && e.target.value.trim() !== preset.content_ko) {
                  setPresetContentTh('');
                }
              }
            }}
            placeholder="예: 오늘 오후 2시 페이스북 이벤트 게시글 업로드"
            rows={3}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg resize-none text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow"
            required
          />
          <p className="text-xs text-slate-500">한국어로 작성하면 직원에게는 태국어로 자동 번역되어 표시됩니다.</p>
        </div>

        {preview && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p className="text-xs font-medium text-amber-900 mb-2">태국어 번역 미리보기</p>
            <p className="text-sm text-amber-800">{preview}</p>
          </div>
        )}

        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700">
            마감일 <span className="text-xs text-slate-500 ml-1">(선택사항)</span>
          </label>
          <input
            type="datetime-local"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow"
          />
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
            {error}
          </div>
        )}
        {workers.length === 0 && (
          <p className="text-sm text-amber-600">할당 가능한 직원이 없습니다.</p>
        )}
        <button
          type="submit"
          disabled={loading || workers.length === 0}
          className="w-full h-11 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              번역 및 할당 중...
            </>
          ) : (
            '업무 할당'
          )}
        </button>
      </form>
    </div>
  );
}
