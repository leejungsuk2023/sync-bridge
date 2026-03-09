'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, ChevronDown } from 'lucide-react';

export default function TaskAssign({ workers, clientId }: { workers: any[]; clientId?: string }) {
  const [collapsed, setCollapsed] = useState(true);
  const [assigneeId, setAssigneeId] = useState('');
  const [content, setContent] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [previewDesc, setPreviewDesc] = useState('');
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
    setPreviewDesc('');

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

    // Translate description if provided
    let descriptionTh = '';
    if (description.trim()) {
      try {
        const res = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: description.trim(), targetLang: 'th' }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError('상세 가이드 번역 실패: ' + (data.error || '알 수 없는 오류'));
          setLoading(false);
          return;
        }
        descriptionTh = data.translated || '';
        setPreviewDesc(descriptionTh);
      } catch (err: any) {
        setError('상세 가이드 번역 요청 실패: ' + err.message);
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
    if (description.trim()) {
      insertData.description = description.trim();
      insertData.description_th = descriptionTh;
    }

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
    setDescription('');
    setAssigneeId('');
    setPreview('');
    setPreviewDesc('');
    setSelectedPresetId('');
    setPresetContentTh('');
    setDueDate('');
    alert('업무가 할당되었습니다.');
  };

  return (
    <div className="bg-gradient-to-r from-emerald-50/70 to-white rounded-xl shadow-sm border border-emerald-100 border-l-4 border-l-emerald-400 p-4 sm:p-6">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between cursor-pointer"
      >
        <h2 className="text-lg font-semibold text-slate-900">업무 할당</h2>
        <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
      </button>
      {!collapsed && <form onSubmit={handleSubmit} className="mt-4">
        {/* 1행: 담당자 + 프리셋 + 마감일 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">담당자</label>
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
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                프리셋 <span className="text-slate-400">(선택)</span>
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

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              마감일시 <span className="text-slate-400">(선택)</span>
            </label>
            <input
              type="datetime-local"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow"
            />
          </div>
        </div>

        {/* 2행: 업무 제목 + 할당 버튼 */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end mb-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600 mb-1">업무 제목 (한국어 → 태국어 자동번역)</label>
            <input
              type="text"
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
              placeholder="예: 페이스북 이벤트 게시글 업로드"
              className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading || workers.length === 0}
            className="w-full sm:w-auto shrink-0 h-10 px-6 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                할당 중...
              </>
            ) : (
              '업무 할당'
            )}
          </button>
        </div>

        {/* 3행: 상세 가이드 (선택) */}
        <div className="mb-3">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            상세 가이드 <span className="text-slate-400">(선택사항, 태국어 자동번역)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="예: 오후 2시까지 완료, 이미지 3장 포함, 해시태그 #이벤트 추가"
            rows={3}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg resize-none text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow"
          />
        </div>

        {(preview || previewDesc) && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-xs font-medium text-amber-900 mb-1">태국어 번역 미리보기</p>
            {preview && <p className="text-sm text-amber-800 font-medium">{preview}</p>}
            {previewDesc && <p className="text-sm text-amber-800 mt-1">{previewDesc}</p>}
          </div>
        )}

        {error && (
          <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
            {error}
          </div>
        )}
        {workers.length === 0 && (
          <p className="mt-3 text-sm text-amber-600">할당 가능한 직원이 없습니다.</p>
        )}
      </form>}
    </div>
  );
}
