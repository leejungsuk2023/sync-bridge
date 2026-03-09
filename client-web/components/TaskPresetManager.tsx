'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Pencil, Trash2, Loader2, ChevronDown } from 'lucide-react';

export default function TaskPresetManager({ profile, clients }: { profile: any; clients: any[] }) {
  const [collapsed, setCollapsed] = useState(true);
  const [presets, setPresets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ clientId: '', titleKo: '', contentKo: '' });

  const fetchPresets = async () => {
    const { data } = await supabase
      .from('task_presets')
      .select('*')
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });
    setPresets(data || []);
  };

  useEffect(() => {
    const load = async () => {
      await fetchPresets();
      setLoading(false);
    };
    load();
  }, []);

  const handleSave = async () => {
    if (!form.titleKo.trim() || !form.contentKo.trim()) return;
    setSaving(true);
    const clientId = form.clientId || null;

    let titleTh = '';
    let contentTh = '';
    try {
      const [t1, t2] = await Promise.all([
        fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: form.titleKo.trim(), targetLang: 'th' }) }),
        fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: form.contentKo.trim(), targetLang: 'th' }) }),
      ]);
      if (t1.ok) titleTh = (await t1.json()).translated || '';
      if (t2.ok) contentTh = (await t2.json()).translated || '';
    } catch (_) {}

    if (editing) {
      await supabase.from('task_presets').update({
        client_id: clientId,
        title_ko: form.titleKo.trim(),
        title_th: titleTh || form.titleKo.trim(),
        content_ko: form.contentKo.trim(),
        content_th: contentTh || form.contentKo.trim(),
        updated_at: new Date().toISOString(),
      }).eq('id', editing);
    } else {
      await supabase.from('task_presets').insert({
        client_id: clientId,
        title_ko: form.titleKo.trim(),
        title_th: titleTh || form.titleKo.trim(),
        content_ko: form.contentKo.trim(),
        content_th: contentTh || form.contentKo.trim(),
      });
    }

    setEditing(null);
    setForm({ clientId: '', titleKo: '', contentKo: '' });
    setSaving(false);
    fetchPresets();
  };

  const handleEdit = (item: any) => {
    setEditing(item.id);
    setForm({ clientId: item.client_id || '', titleKo: item.title_ko, contentKo: item.content_ko });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 프리셋을 삭제할까요?')) return;
    await supabase.from('task_presets').delete().eq('id', id);
    fetchPresets();
  };

  const getClientName = (clientId: string | null) => {
    if (!clientId) return '전체 공용';
    const c = clients.find((c) => c.id === clientId);
    return c?.name || clientId;
  };

  if (loading) return <p className="text-sm text-slate-500">로딩 중...</p>;

  return (
    <div className="bg-gradient-to-r from-rose-50/70 to-white rounded-xl shadow-sm border border-rose-100 border-l-4 border-l-rose-400 p-6">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between cursor-pointer mb-0"
      >
        <div>
          <h2 className="text-lg font-semibold text-slate-900 text-left">업무 프리셋 관리</h2>
          <p className="text-xs text-slate-500 mt-1 text-left">자주 사용하는 업무 지시를 프리셋으로 등록하면, 병원이 업무 배정 시 선택만으로 바로 할당할 수 있습니다.</p>
        </div>
        <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform shrink-0 ${collapsed ? '' : 'rotate-180'}`} />
      </button>
      {!collapsed && (<>

      <div className="space-y-4 pb-6 border-b border-slate-200 mt-6">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700">적용 병원</label>
          <select
            value={form.clientId}
            onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
            className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow bg-white"
          >
            <option value="">전체 공용</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">프리셋 이름 (한국어)</label>
            <input
              value={form.titleKo}
              onChange={(e) => setForm((f) => ({ ...f, titleKo: e.target.value }))}
              placeholder="예: SNS 게시글 업로드"
              className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">업무 내용 (한국어)</label>
            <textarea
              value={form.contentKo}
              onChange={(e) => setForm((f) => ({ ...f, contentKo: e.target.value }))}
              placeholder="예: 오늘 오후 2시까지 페이스북 이벤트 게시글을 작성하여 업로드해 주세요."
              rows={3}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !form.titleKo.trim() || !form.contentKo.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                번역 및 저장 중...
              </>
            ) : editing ? '수정' : '추가'}
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => { setEditing(null); setForm({ clientId: '', titleKo: '', contentKo: '' }); }}
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            >
              취소
            </button>
          )}
        </div>
      </div>

      {presets.length === 0 ? (
        <p className="mt-6 text-center text-slate-500 py-8">등록된 프리셋이 없습니다.</p>
      ) : (
        <div className="mt-6 space-y-3">
          {presets.map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-3 p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">{item.title_ko}</h3>
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded-full shrink-0">
                    {getClientName(item.client_id)}
                  </span>
                </div>
                <p className="text-xs text-slate-600 line-clamp-2">{item.content_ko}</p>
                {item.title_th && (
                  <p className="text-xs text-amber-700 flex items-center gap-1 line-clamp-1">
                    <span>🇹🇭</span> {item.title_th} — {item.content_th}
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => handleEdit(item)} className="text-blue-600 hover:text-blue-700 text-xs font-medium inline-flex items-center gap-1">
                  <Pencil className="w-3 h-3" />
                  수정
                </button>
                <button type="button" onClick={() => handleDelete(item.id)} className="text-red-600 hover:text-red-700 text-xs font-medium inline-flex items-center gap-1">
                  <Trash2 className="w-3 h-3" />
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      </>)}
    </div>
  );
}
