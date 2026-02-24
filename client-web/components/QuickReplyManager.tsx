'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Pencil, Trash2 } from 'lucide-react';

export default function QuickReplyManager({ profile, clients }: { profile: any; clients: any[] }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ clientId: '', titleKo: '', bodyKo: '' });

  const isBbg = profile?.role === 'bbg_admin';
  const myClientId = profile?.client_id;

  const fetchItems = async () => {
    let query = supabase.from('quick_replies').select('*').order('display_order', { ascending: true }).order('created_at', { ascending: true });
    if (!isBbg && myClientId) query = query.eq('client_id', myClientId);
    const { data } = await query;
    setItems(data || []);
  };

  useEffect(() => {
    const load = async () => {
      await fetchItems();
      setLoading(false);
    };
    load();
  }, [profile?.role, profile?.client_id]);

  const handleSave = async () => {
    if (!form.titleKo.trim() || !form.bodyKo.trim()) return;
    const clientId = isBbg ? (form.clientId || null) : myClientId;
    if (!isBbg && !clientId) return;

    let titleTh = '';
    let bodyTh = '';
    try {
      const [t1, t2] = await Promise.all([
        fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: form.titleKo.trim(), targetLang: 'th' }) }),
        fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: form.bodyKo.trim(), targetLang: 'th' }) }),
      ]);
      if (t1.ok) titleTh = (await t1.json()).translated || '';
      if (t2.ok) bodyTh = (await t2.json()).translated || '';
    } catch (_) {}

    if (editing) {
      await supabase.from('quick_replies').update({
        client_id: clientId,
        title_ko: form.titleKo.trim(),
        title_th: titleTh || form.titleKo.trim(),
        body_ko: form.bodyKo.trim(),
        body_th: bodyTh || form.bodyKo.trim(),
        updated_at: new Date().toISOString(),
      }).eq('id', editing);
    } else {
      await supabase.from('quick_replies').insert({
        client_id: clientId,
        title_ko: form.titleKo.trim(),
        title_th: titleTh || form.titleKo.trim(),
        body_ko: form.bodyKo.trim(),
        body_th: bodyTh || form.bodyKo.trim(),
      });
    }
    setEditing(null);
    setForm({ clientId: '', titleKo: '', bodyKo: '' });
    fetchItems();
  };

  const handleEdit = (item: any) => {
    setEditing(item.id);
    setForm({ clientId: item.client_id || '', titleKo: item.title_ko, bodyKo: item.body_ko });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('삭제할까요?')) return;
    await supabase.from('quick_replies').delete().eq('id', id);
    fetchItems();
  };

  if (loading) return <p className="text-sm text-slate-500">로딩 중...</p>;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-slate-900">자동답변 관리</h2>
        <p className="text-xs text-slate-500 mt-1">직원용 퀵 리플라이를 등록하면 Extension에서 태국어로 보입니다.</p>
      </div>

      <div className="space-y-4 pb-6 border-b border-slate-200">
        {isBbg && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">적용 고객사</label>
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
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">제목 (한국어)</label>
            <input
              value={form.titleKo}
              onChange={(e) => setForm((f) => ({ ...f, titleKo: e.target.value }))}
              placeholder="예: 병원 위치 안내"
              className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">내용 (한국어)</label>
            <textarea
              value={form.bodyKo}
              onChange={(e) => setForm((f) => ({ ...f, bodyKo: e.target.value }))}
              placeholder="예: 저희 병원은 서울시 강남구 ..."
              rows={3}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={!form.titleKo.trim() || !form.bodyKo.trim()}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {editing ? '수정' : '추가'}
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => { setEditing(null); setForm({ clientId: '', titleKo: '', bodyKo: '' }); }}
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            >
              취소
            </button>
          )}
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {items.map((item) => (
          <div key={item.id} className="flex items-start justify-between p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-900">{item.title_ko}</h3>
              </div>
              <p className="text-xs text-slate-600 line-clamp-1">{item.body_ko}</p>
              {item.title_th && (
                <p className="text-xs text-amber-700 flex items-center gap-1">
                  <span>🇹🇭</span> {item.title_th}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 ml-4">
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
    </div>
  );
}
