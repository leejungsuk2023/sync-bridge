'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Plus, Pencil, Trash2, X, Check, ChevronDown, ChevronUp,
  Globe, Phone, Clock, Star, Tag, AlertCircle,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface HospitalSummary {
  id: string;
  hospital_prefix: string;
  display_name_ko: string | null;
  display_name_th: string | null;
  logo_url: string | null;
  specialties: string[] | null;
  updated_at: string;
}

interface HospitalInfo extends HospitalSummary {
  client_id: string | null;
  address_ko: string | null;
  address_th: string | null;
  google_maps_url: string | null;
  phone: string | null;
  website: string | null;
  operating_hours: Record<string, string> | null;
  description_ko: string | null;
  description_th: string | null;
}

interface Doctor {
  id: string;
  hospital_id: string;
  name_ko: string;
  name_th: string | null;
  title_ko: string | null;
  title_th: string | null;
  specialties: string[] | null;
  bio_ko: string | null;
  bio_th: string | null;
  photo_url: string | null;
  is_active: boolean;
  sort_order: number;
}

interface Procedure {
  id: string;
  hospital_id: string;
  category: string;
  name_ko: string;
  name_th: string | null;
  description_ko: string | null;
  description_th: string | null;
  price_min: number | null;
  price_max: number | null;
  price_currency: string;
  price_note: string | null;
  duration_minutes: number | null;
  recovery_days: number | null;
  is_popular: boolean;
  is_active: boolean;
  sort_order: number;
}

interface Promotion {
  id: string;
  hospital_id: string;
  title_ko: string;
  title_th: string | null;
  description_ko: string | null;
  description_th: string | null;
  discount_type: string | null;
  discount_value: number | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
}

interface SuccessfulCase {
  id: string;
  hospital_id: string;
  procedure_category: string | null;
  procedure_name_ko: string | null;
  procedure_name_th: string | null;
  customer_concern: string | null;
  outcome: string | null;
  full_conversation: string;
  contextual_summary: string | null;
  tags: string[] | null;
  quality_score: number | null;
  is_verified: boolean;
  is_masked: boolean;
}

interface HospitalKBManagerProps {
  userId: string;
}

type TabKey = '기본정보' | '의사' | '시술·가격' | '프로모션' | '성공케이스';

// ── Helpers ─────────────────────────────────────────────────────────────────────

async function getAuthHeader() {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token ?? ''}`,
  };
}

function formatPrice(min: number | null, max: number | null, currency: string, note: string | null): string {
  if (!min && !max) return note ?? '-';
  const fmt = (v: number) => v.toLocaleString('ko-KR');
  const range = min && max && min !== max ? `${fmt(min)}~${fmt(max)}` : fmt((min ?? max)!);
  return `${range} ${currency}${note ? ` (${note})` : ''}`;
}

// ── Main Component ───────────────────────────────────────────────────────────────

export default function HospitalKBManager({ userId: _userId }: HospitalKBManagerProps) {
  const [hospitals, setHospitals] = useState<HospitalSummary[]>([]);
  const [hospitalsLoading, setHospitalsLoading] = useState(true);
  const [selectedHospital, setSelectedHospital] = useState<HospitalInfo | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('기본정보');

  // Sub-resource data
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [cases, setCases] = useState<SuccessfulCase[]>([]);
  const [subLoading, setSubLoading] = useState(false);

  // ── Fetch list of hospitals ──
  const fetchHospitals = useCallback(async () => {
    try {
      setHospitalsLoading(true);
      const headers = await getAuthHeader();
      const res = await fetch('/api/hospital-kb', { headers });
      if (res.ok) {
        const data = await res.json();
        setHospitals(data.hospitals ?? []);
      } else {
        console.error('[HospitalKBManager] Failed to fetch hospitals:', res.status);
      }
    } catch (err) {
      console.error('[HospitalKBManager] Fetch hospitals error:', err);
    } finally {
      setHospitalsLoading(false);
    }
  }, []);

  useEffect(() => { fetchHospitals(); }, [fetchHospitals]);

  // ── Select hospital and fetch full info ──
  const selectHospital = useCallback(async (prefix: string) => {
    try {
      setSubLoading(true);
      const headers = await getAuthHeader();
      const res = await fetch(`/api/hospital-kb?hospital_prefix=${prefix}`, { headers });
      if (!res.ok) { console.error('[HospitalKBManager] fetch hospital detail failed'); return; }
      const data = await res.json();
      setSelectedHospital(data.hospital_info ?? null);
      setDoctors(data.doctors ?? []);
      setProcedures(data.procedures ?? []);
      setPromotions(data.active_promotions ?? []);
      setActiveTab('기본정보');
    } catch (err) {
      console.error('[HospitalKBManager] selectHospital error:', err);
    } finally {
      setSubLoading(false);
    }
  }, []);

  // ── Fetch cases separately (not included in main GET) ──
  const fetchCases = useCallback(async (hospitalId: string) => {
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`/api/hospital-kb/cases?hospital_id=${hospitalId}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setCases(data.cases ?? []);
      }
    } catch (err) {
      console.error('[HospitalKBManager] fetchCases error:', err);
    }
  }, []);

  useEffect(() => {
    if (activeTab === '성공케이스' && selectedHospital) {
      fetchCases(selectedHospital.id);
    }
  }, [activeTab, selectedHospital, fetchCases]);

  // ── Auto-translate helper ──
  const autoTranslate = useCallback(async (text: string): Promise<string> => {
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ text, targetLang: 'th' }),
      });
      if (res.ok) {
        const d = await res.json();
        return d.translated ?? '';
      }
    } catch (err) {
      console.error('[HospitalKBManager] translate error:', err);
    }
    return '';
  }, []);

  // ── Loading state ──
  if (hospitalsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hospital selector */}
      <HospitalSelector
        hospitals={hospitals}
        selectedHospital={selectedHospital}
        onSelect={selectHospital}
        onRefresh={fetchHospitals}
        onCreated={async (prefix) => { await fetchHospitals(); await selectHospital(prefix); }}
      />

      {/* Detail panel */}
      {selectedHospital && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200">
          {subLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue-500" />
            </div>
          ) : (
            <>
              {/* Tabs */}
              <div className="border-b border-slate-200">
                <nav className="flex overflow-x-auto px-4">
                  {(['기본정보', '의사', '시술·가격', '프로모션', '성공케이스'] as TabKey[]).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                        activeTab === tab
                          ? 'border-blue-500 text-blue-600'
                          : 'border-transparent text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </nav>
              </div>

              {/* Tab content */}
              <div className="p-6">
                {activeTab === '기본정보' && (
                  <BasicInfoTab
                    hospital={selectedHospital}
                    autoTranslate={autoTranslate}
                    onSaved={async () => { await selectHospital(selectedHospital.hospital_prefix); }}
                  />
                )}
                {activeTab === '의사' && (
                  <DoctorsTab
                    hospitalId={selectedHospital.id}
                    doctors={doctors}
                    autoTranslate={autoTranslate}
                    onChanged={async () => { await selectHospital(selectedHospital.hospital_prefix); }}
                  />
                )}
                {activeTab === '시술·가격' && (
                  <ProceduresTab
                    hospitalId={selectedHospital.id}
                    procedures={procedures}
                    autoTranslate={autoTranslate}
                    onChanged={async () => { await selectHospital(selectedHospital.hospital_prefix); }}
                  />
                )}
                {activeTab === '프로모션' && (
                  <PromotionsTab
                    hospitalId={selectedHospital.id}
                    promotions={promotions}
                    autoTranslate={autoTranslate}
                    onChanged={async () => { await selectHospital(selectedHospital.hospital_prefix); }}
                  />
                )}
                {activeTab === '성공케이스' && (
                  <CasesTab
                    hospitalId={selectedHospital.id}
                    cases={cases}
                    onChanged={() => fetchCases(selectedHospital.id)}
                  />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Hospital Selector ────────────────────────────────────────────────────────────

function HospitalSelector({
  hospitals,
  selectedHospital,
  onSelect,
  onRefresh,
  onCreated,
}: {
  hospitals: HospitalSummary[];
  selectedHospital: HospitalInfo | null;
  onSelect: (prefix: string) => void;
  onRefresh: () => void;
  onCreated: (prefix: string) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [createPrefix, setCreatePrefix] = useState('');
  const [createName, setCreateName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!createPrefix.trim()) return;
    try {
      setCreating(true);
      const headers = await getAuthHeader();
      const res = await fetch('/api/hospital-kb', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          hospital_prefix: createPrefix.trim(),
          display_name_ko: createName.trim() || createPrefix.trim(),
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setCreatePrefix('');
        setCreateName('');
        onCreated(createPrefix.trim());
      } else {
        const err = await res.json();
        alert('생성 실패: ' + (err.error ?? ''));
      }
    } catch (err) {
      console.error('[HospitalSelector] create error:', err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-slate-900">병원 선택</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            className="px-3 py-1.5 text-sm text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            새로고침
          </button>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            <Plus className="w-4 h-4" />
            병원 추가
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
          <h3 className="text-sm font-semibold text-blue-800">새 병원 등록</h3>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="hospital_prefix (예: thebb) *"
              value={createPrefix}
              onChange={e => setCreatePrefix(e.target.value)}
              className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <input
              type="text"
              placeholder="병원 한국어 이름"
              value={createName}
              onChange={e => setCreateName(e.target.value)}
              className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className="px-4 py-1.5 text-sm border rounded-lg hover:bg-gray-50">취소</button>
            <button
              onClick={handleCreate}
              disabled={creating || !createPrefix.trim()}
              className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1"
            >
              {creating ? '생성 중...' : <><Check className="w-4 h-4" /> 생성</>}
            </button>
          </div>
        </div>
      )}

      {/* Hospital grid */}
      {hospitals.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-4">등록된 병원이 없습니다.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {hospitals.map(h => (
            <button
              key={h.id}
              onClick={() => onSelect(h.hospital_prefix)}
              className={`text-left p-3 rounded-lg border transition-all hover:shadow-sm ${
                selectedHospital?.id === h.id
                  ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <p className="text-sm font-medium text-slate-800 truncate">{h.display_name_ko ?? h.hospital_prefix}</p>
              <p className="text-xs text-slate-400 mt-0.5 truncate">{h.hospital_prefix}</p>
              {h.specialties && h.specialties.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {h.specialties.slice(0, 2).map(s => (
                    <span key={s} className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{s}</span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── BasicInfoTab ─────────────────────────────────────────────────────────────────

function BasicInfoTab({
  hospital,
  autoTranslate,
  onSaved,
}: {
  hospital: HospitalInfo;
  autoTranslate: (text: string) => Promise<string>;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<HospitalInfo>>({
    display_name_ko: hospital.display_name_ko ?? '',
    display_name_th: hospital.display_name_th ?? '',
    address_ko: hospital.address_ko ?? '',
    address_th: hospital.address_th ?? '',
    phone: hospital.phone ?? '',
    website: hospital.website ?? '',
    google_maps_url: hospital.google_maps_url ?? '',
    description_ko: hospital.description_ko ?? '',
    description_th: hospital.description_th ?? '',
    specialties: hospital.specialties ?? [],
    operating_hours: hospital.operating_hours ?? {},
  });
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [specialtyInput, setSpecialtyInput] = useState('');

  const set = (key: keyof HospitalInfo, value: any) => setForm(f => ({ ...f, [key]: value }));

  const handleAutoTranslate = async () => {
    setTranslating(true);
    try {
      const fields: Array<[keyof HospitalInfo, keyof HospitalInfo]> = [
        ['display_name_ko', 'display_name_th'],
        ['address_ko', 'address_th'],
        ['description_ko', 'description_th'],
      ];
      const updates: Partial<HospitalInfo> = {};
      await Promise.all(fields.map(async ([koKey, thKey]) => {
        const koVal = form[koKey] as string;
        if (koVal) {
          updates[thKey] = await autoTranslate(koVal) as any;
        }
      }));
      setForm(f => ({ ...f, ...updates }));
    } finally {
      setTranslating(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`/api/hospital-kb?id=${hospital.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(form),
      });
      if (res.ok) {
        onSaved();
      } else {
        const err = await res.json();
        alert('저장 실패: ' + (err.error ?? ''));
      }
    } catch (err) {
      console.error('[BasicInfoTab] save error:', err);
    } finally {
      setSaving(false);
    }
  };

  const addSpecialty = () => {
    const val = specialtyInput.trim();
    if (!val) return;
    const current = (form.specialties ?? []) as string[];
    if (!current.includes(val)) {
      set('specialties', [...current, val]);
    }
    setSpecialtyInput('');
  };

  const removeSpecialty = (s: string) => {
    set('specialties', ((form.specialties ?? []) as string[]).filter(x => x !== s));
  };

  return (
    <div className="space-y-6">
      {/* Actions */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-800">기본 정보</h3>
        <div className="flex gap-2">
          <button
            onClick={handleAutoTranslate}
            disabled={translating}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
          >
            {translating ? '번역 중...' : '한→태 자동번역'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? '저장 중...' : <><Check className="w-4 h-4" /> 저장</>}
          </button>
        </div>
      </div>

      {/* Fields grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="병원명 (한국어)" required>
          <input type="text" value={form.display_name_ko ?? ''} onChange={e => set('display_name_ko', e.target.value)} className={inputCls} />
        </FormField>
        <FormField label="ชื่อโรงพยาบาล (ไทย)">
          <input type="text" value={form.display_name_th ?? ''} onChange={e => set('display_name_th', e.target.value)} className={inputCls} />
        </FormField>

        <FormField label="주소 (한국어)">
          <textarea rows={2} value={form.address_ko ?? ''} onChange={e => set('address_ko', e.target.value)} className={inputCls} />
        </FormField>
        <FormField label="ที่อยู่ (ไทย)">
          <textarea rows={2} value={form.address_th ?? ''} onChange={e => set('address_th', e.target.value)} className={inputCls} />
        </FormField>

        <FormField label="전화번호">
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" value={form.phone ?? ''} onChange={e => set('phone', e.target.value)} className={`${inputCls} pl-9`} placeholder="02-1234-5678" />
          </div>
        </FormField>
        <FormField label="웹사이트">
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" value={form.website ?? ''} onChange={e => set('website', e.target.value)} className={`${inputCls} pl-9`} placeholder="https://..." />
          </div>
        </FormField>

        <FormField label="Google Maps URL">
          <input type="text" value={form.google_maps_url ?? ''} onChange={e => set('google_maps_url', e.target.value)} className={inputCls} placeholder="https://maps.google.com/..." />
        </FormField>
        <FormField label="운영시간">
          <div className="relative">
            <Clock className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <textarea
              rows={2}
              value={form.operating_hours ? JSON.stringify(form.operating_hours, null, 2) : ''}
              onChange={e => {
                try { set('operating_hours', JSON.parse(e.target.value)); } catch { /* ignore */ }
              }}
              className={`${inputCls} pl-9 font-mono text-xs`}
              placeholder={'{"mon-fri": "09:00-18:00"}'}
            />
          </div>
        </FormField>

        <FormField label="병원 소개 (한국어)">
          <textarea rows={3} value={form.description_ko ?? ''} onChange={e => set('description_ko', e.target.value)} className={inputCls} />
        </FormField>
        <FormField label="แนะนำโรงพยาบาล (ไทย)">
          <textarea rows={3} value={form.description_th ?? ''} onChange={e => set('description_th', e.target.value)} className={inputCls} />
        </FormField>
      </div>

      {/* Specialties */}
      <FormField label="전문 분야">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {((form.specialties ?? []) as string[]).map(s => (
              <span key={s} className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full">
                {s}
                <button onClick={() => removeSpecialty(s)} className="hover:text-blue-900"><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={specialtyInput}
              onChange={e => setSpecialtyInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addSpecialty())}
              placeholder="전문분야 입력 후 Enter"
              className={`${inputCls} flex-1`}
            />
            <button onClick={addSpecialty} className="px-3 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600">
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </FormField>
    </div>
  );
}

// ── DoctorsTab ───────────────────────────────────────────────────────────────────

function DoctorsTab({
  hospitalId,
  doctors,
  autoTranslate,
  onChanged,
}: {
  hospitalId: string;
  doctors: Doctor[];
  autoTranslate: (text: string) => Promise<string>;
  onChanged: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Doctor>>({});
  const [saving, setSaving] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);

  const blankForm = (): Partial<Doctor> => ({
    hospital_id: hospitalId,
    name_ko: '',
    name_th: '',
    title_ko: '',
    title_th: '',
    bio_ko: '',
    bio_th: '',
    is_active: true,
    sort_order: 0,
  });

  const startAdd = () => { setForm(blankForm()); setShowAdd(true); setEditId(null); };
  const startEdit = (d: Doctor) => { setForm({ ...d }); setEditId(d.id); setShowAdd(false); };
  const cancelForm = () => { setShowAdd(false); setEditId(null); setForm({}); };

  const handleTranslate = async () => {
    setTranslating(true);
    const [nameTh, titleTh, bioTh] = await Promise.all([
      form.name_ko ? autoTranslate(form.name_ko) : Promise.resolve(''),
      form.title_ko ? autoTranslate(form.title_ko) : Promise.resolve(''),
      form.bio_ko ? autoTranslate(form.bio_ko) : Promise.resolve(''),
    ]);
    setForm(f => ({ ...f, name_th: nameTh || f.name_th, title_th: titleTh || f.title_th, bio_th: bioTh || f.bio_th }));
    setTranslating(false);
  };

  const handleSave = async () => {
    if (!form.name_ko) return;
    setSaving(true);
    try {
      const headers = await getAuthHeader();
      const url = editId ? `/api/hospital-kb/doctors?id=${editId}` : '/api/hospital-kb/doctors';
      const method = editId ? 'PUT' : 'POST';
      const body = editId ? { ...form, hospital_id: undefined } : form;
      const res = await fetch(url, { method, headers, body: JSON.stringify(body) });
      if (res.ok) {
        cancelForm();
        onChanged();
      } else {
        const err = await res.json();
        alert('저장 실패: ' + (err.error ?? ''));
      }
    } catch (err) {
      console.error('[DoctorsTab] save error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 의사를 삭제하시겠습니까?')) return;
    setDeleteLoading(id);
    try {
      const headers = await getAuthHeader();
      await fetch(`/api/hospital-kb/doctors?id=${id}`, { method: 'DELETE', headers });
      onChanged();
    } catch (err) {
      console.error('[DoctorsTab] delete error:', err);
    } finally {
      setDeleteLoading(null);
    }
  };

  const toggleActive = async (d: Doctor) => {
    const headers = await getAuthHeader();
    await fetch(`/api/hospital-kb/doctors?id=${d.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ is_active: !d.is_active }),
    });
    onChanged();
  };

  const DoctorForm = () => (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3 mb-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-700">{editId ? '의사 수정' : '의사 추가'}</h4>
        <div className="flex gap-2">
          <button onClick={handleTranslate} disabled={translating} className="text-xs px-2 py-1 border rounded hover:bg-white disabled:opacity-50">
            {translating ? '번역 중...' : '한→태 번역'}
          </button>
          <button onClick={cancelForm} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label="이름 (한국어) *">
          <input type="text" value={form.name_ko ?? ''} onChange={e => setForm(f => ({ ...f, name_ko: e.target.value }))} className={inputCls} />
        </FormField>
        <FormField label="ชื่อ (ไทย)">
          <input type="text" value={form.name_th ?? ''} onChange={e => setForm(f => ({ ...f, name_th: e.target.value }))} className={inputCls} />
        </FormField>
        <FormField label="직함 (한국어)">
          <input type="text" value={form.title_ko ?? ''} onChange={e => setForm(f => ({ ...f, title_ko: e.target.value }))} className={inputCls} placeholder="대표원장" />
        </FormField>
        <FormField label="ตำแหน่ง (ไทย)">
          <input type="text" value={form.title_th ?? ''} onChange={e => setForm(f => ({ ...f, title_th: e.target.value }))} className={inputCls} />
        </FormField>
        <FormField label="소개 (한국어)">
          <textarea rows={2} value={form.bio_ko ?? ''} onChange={e => setForm(f => ({ ...f, bio_ko: e.target.value }))} className={inputCls} />
        </FormField>
        <FormField label="ประวัติ (ไทย)">
          <textarea rows={2} value={form.bio_th ?? ''} onChange={e => setForm(f => ({ ...f, bio_th: e.target.value }))} className={inputCls} />
        </FormField>
        <FormField label="정렬 순서">
          <input type="number" value={form.sort_order ?? 0} onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))} className={inputCls} />
        </FormField>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={cancelForm} className="px-4 py-1.5 text-sm border rounded-lg hover:bg-white">취소</button>
        <button
          onClick={handleSave}
          disabled={saving || !form.name_ko}
          className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1"
        >
          {saving ? '저장 중...' : <><Check className="w-4 h-4" /> 저장</>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-800">의사 목록 ({doctors.length}명)</h3>
        <button onClick={startAdd} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600">
          <Plus className="w-4 h-4" /> 추가
        </button>
      </div>

      {showAdd && <DoctorForm />}

      {doctors.length === 0 && !showAdd ? (
        <p className="text-sm text-slate-400 text-center py-8">등록된 의사가 없습니다.</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-600">이름</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">ชื่อ</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">직함</th>
                <th className="px-4 py-3 text-center font-medium text-slate-600">활성</th>
                <th className="px-4 py-3 text-right font-medium text-slate-600">작업</th>
              </tr>
            </thead>
            <tbody>
              {doctors.map(d => (
                <React.Fragment key={d.id}>
                  <tr className="border-t hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{d.name_ko}</td>
                    <td className="px-4 py-3 text-slate-600">{d.name_th ?? '-'}</td>
                    <td className="px-4 py-3 text-slate-500">{d.title_ko ?? '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => toggleActive(d)}
                        className={`px-2 py-0.5 rounded text-xs font-medium ${d.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                      >
                        {d.is_active ? '활성' : '비활성'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right space-x-1">
                      <button onClick={() => startEdit(d)} className="text-blue-500 hover:text-blue-700 p-1" title="수정">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(d.id)}
                        disabled={deleteLoading === d.id}
                        className="text-red-400 hover:text-red-600 p-1"
                        title="삭제"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                  {editId === d.id && (
                    <tr className="border-t">
                      <td colSpan={5} className="px-4 py-2">
                        <DoctorForm />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── ProceduresTab ─────────────────────────────────────────────────────────────────

function ProceduresTab({
  hospitalId,
  procedures,
  autoTranslate,
  onChanged,
}: {
  hospitalId: string;
  procedures: Procedure[];
  autoTranslate: (text: string) => Promise<string>;
  onChanged: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Procedure>>({});
  const [saving, setSaving] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');

  const categories = Array.from(new Set(procedures.map(p => p.category))).sort();
  const filtered = categoryFilter ? procedures.filter(p => p.category === categoryFilter) : procedures;

  const blankForm = (): Partial<Procedure> => ({
    hospital_id: hospitalId,
    category: '',
    name_ko: '',
    name_th: '',
    price_currency: 'KRW',
    is_popular: false,
    is_active: true,
    sort_order: 0,
  });

  const startAdd = () => { setForm(blankForm()); setShowAdd(true); setEditId(null); };
  const startEdit = (p: Procedure) => { setForm({ ...p }); setEditId(p.id); setShowAdd(false); };
  const cancelForm = () => { setShowAdd(false); setEditId(null); setForm({}); };

  const handleTranslate = async () => {
    setTranslating(true);
    const [nameTh, descTh] = await Promise.all([
      form.name_ko ? autoTranslate(form.name_ko) : Promise.resolve(''),
      form.description_ko ? autoTranslate(form.description_ko) : Promise.resolve(''),
    ]);
    setForm(f => ({ ...f, name_th: nameTh || f.name_th, description_th: descTh || f.description_th }));
    setTranslating(false);
  };

  const handleSave = async () => {
    if (!form.name_ko || !form.category) return;
    setSaving(true);
    try {
      const headers = await getAuthHeader();
      const url = editId ? `/api/hospital-kb/procedures?id=${editId}` : '/api/hospital-kb/procedures';
      const method = editId ? 'PUT' : 'POST';
      const body = editId ? { ...form, hospital_id: undefined } : form;
      const res = await fetch(url, { method, headers, body: JSON.stringify(body) });
      if (res.ok) {
        cancelForm();
        onChanged();
      } else {
        const err = await res.json();
        alert('저장 실패: ' + (err.error ?? ''));
      }
    } catch (err) {
      console.error('[ProceduresTab] save error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 시술을 삭제하시겠습니까?')) return;
    setDeleteLoading(id);
    try {
      const headers = await getAuthHeader();
      await fetch(`/api/hospital-kb/procedures?id=${id}`, { method: 'DELETE', headers });
      onChanged();
    } catch (err) {
      console.error('[ProceduresTab] delete error:', err);
    } finally {
      setDeleteLoading(null);
    }
  };

  const toggleField = async (p: Procedure, field: 'is_popular' | 'is_active') => {
    const headers = await getAuthHeader();
    await fetch(`/api/hospital-kb/procedures?id=${p.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ [field]: !p[field] }),
    });
    onChanged();
  };

  const ProcedureForm = () => (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3 mb-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-700">{editId ? '시술 수정' : '시술 추가'}</h4>
        <div className="flex gap-2">
          <button onClick={handleTranslate} disabled={translating} className="text-xs px-2 py-1 border rounded hover:bg-white disabled:opacity-50">
            {translating ? '번역 중...' : '한→태 번역'}
          </button>
          <button onClick={cancelForm} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <FormField label="카테고리 *">
          <input type="text" value={form.category ?? ''} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={inputCls} placeholder="눈, 코, 지방흡입..." list="category-list" />
          <datalist id="category-list">
            {categories.map(c => <option key={c} value={c} />)}
          </datalist>
        </FormField>
        <FormField label="시술명 (한국어) *">
          <input type="text" value={form.name_ko ?? ''} onChange={e => setForm(f => ({ ...f, name_ko: e.target.value }))} className={inputCls} />
        </FormField>
        <FormField label="ชื่อหัตถการ (ไทย)">
          <input type="text" value={form.name_th ?? ''} onChange={e => setForm(f => ({ ...f, name_th: e.target.value }))} className={inputCls} />
        </FormField>
        <FormField label="최소 가격">
          <input type="number" value={form.price_min ?? ''} onChange={e => setForm(f => ({ ...f, price_min: e.target.value ? parseFloat(e.target.value) : null }))} className={inputCls} placeholder="1500000" />
        </FormField>
        <FormField label="최대 가격">
          <input type="number" value={form.price_max ?? ''} onChange={e => setForm(f => ({ ...f, price_max: e.target.value ? parseFloat(e.target.value) : null }))} className={inputCls} placeholder="2500000" />
        </FormField>
        <FormField label="통화">
          <select value={form.price_currency ?? 'KRW'} onChange={e => setForm(f => ({ ...f, price_currency: e.target.value }))} className={inputCls}>
            <option value="KRW">KRW</option>
            <option value="THB">THB</option>
            <option value="USD">USD</option>
          </select>
        </FormField>
        <FormField label="가격 메모">
          <input type="text" value={form.price_note ?? ''} onChange={e => setForm(f => ({ ...f, price_note: e.target.value }))} className={inputCls} placeholder="마취비 별도" />
        </FormField>
        <FormField label="시술 시간 (분)">
          <input type="number" value={form.duration_minutes ?? ''} onChange={e => setForm(f => ({ ...f, duration_minutes: e.target.value ? parseInt(e.target.value) : null }))} className={inputCls} />
        </FormField>
        <FormField label="회복 기간 (일)">
          <input type="number" value={form.recovery_days ?? ''} onChange={e => setForm(f => ({ ...f, recovery_days: e.target.value ? parseInt(e.target.value) : null }))} className={inputCls} />
        </FormField>
        <FormField label="설명 (한국어)">
          <textarea rows={2} value={form.description_ko ?? ''} onChange={e => setForm(f => ({ ...f, description_ko: e.target.value }))} className={inputCls} />
        </FormField>
        <FormField label="รายละเอียด (ไทย)">
          <textarea rows={2} value={form.description_th ?? ''} onChange={e => setForm(f => ({ ...f, description_th: e.target.value }))} className={inputCls} />
        </FormField>
        <div className="flex items-center gap-4 pt-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={!!form.is_popular} onChange={e => setForm(f => ({ ...f, is_popular: e.target.checked }))} className="rounded" />
            인기 시술
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={!!form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="rounded" />
            활성
          </label>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={cancelForm} className="px-4 py-1.5 text-sm border rounded-lg hover:bg-white">취소</button>
        <button
          onClick={handleSave}
          disabled={saving || !form.name_ko || !form.category}
          className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1"
        >
          {saving ? '저장 중...' : <><Check className="w-4 h-4" /> 저장</>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold text-slate-800">시술·가격 ({procedures.length}개)</h3>
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
          >
            <option value="">전체</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <button onClick={startAdd} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600">
          <Plus className="w-4 h-4" /> 추가
        </button>
      </div>

      {showAdd && <ProcedureForm />}

      {filtered.length === 0 && !showAdd ? (
        <p className="text-sm text-slate-400 text-center py-8">등록된 시술이 없습니다.</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-3 text-left font-medium text-slate-600">카테고리</th>
                <th className="px-3 py-3 text-left font-medium text-slate-600">시술명</th>
                <th className="px-3 py-3 text-left font-medium text-slate-600">ชื่อ</th>
                <th className="px-3 py-3 text-left font-medium text-slate-600">가격</th>
                <th className="px-3 py-3 text-center font-medium text-slate-600">인기</th>
                <th className="px-3 py-3 text-center font-medium text-slate-600">활성</th>
                <th className="px-3 py-3 text-right font-medium text-slate-600">작업</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <React.Fragment key={p.id}>
                  <tr className="border-t hover:bg-slate-50">
                    <td className="px-3 py-2.5">
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{p.category}</span>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-slate-800">{p.name_ko}</td>
                    <td className="px-3 py-2.5 text-slate-500">{p.name_th ?? '-'}</td>
                    <td className="px-3 py-2.5 text-slate-600 text-xs">{formatPrice(p.price_min, p.price_max, p.price_currency, p.price_note)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <button onClick={() => toggleField(p, 'is_popular')} title="인기 토글">
                        <Star className={`w-4 h-4 ${p.is_popular ? 'text-amber-400 fill-amber-400' : 'text-slate-300'}`} />
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <button
                        onClick={() => toggleField(p, 'is_active')}
                        className={`px-2 py-0.5 rounded text-xs font-medium ${p.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                      >
                        {p.is_active ? '활성' : '비활성'}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-right space-x-1">
                      <button onClick={() => startEdit(p)} className="text-blue-500 hover:text-blue-700 p-1" title="수정">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(p.id)}
                        disabled={deleteLoading === p.id}
                        className="text-red-400 hover:text-red-600 p-1"
                        title="삭제"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                  {editId === p.id && (
                    <tr className="border-t">
                      <td colSpan={7} className="px-3 py-2">
                        <ProcedureForm />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── PromotionsTab ─────────────────────────────────────────────────────────────────

function PromotionsTab({
  hospitalId,
  promotions,
  autoTranslate,
  onChanged,
}: {
  hospitalId: string;
  promotions: Promotion[];
  autoTranslate: (text: string) => Promise<string>;
  onChanged: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Promotion>>({});
  const [saving, setSaving] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);

  const blankForm = (): Partial<Promotion> => ({
    hospital_id: hospitalId,
    title_ko: '',
    title_th: '',
    is_active: true,
  });

  const startAdd = () => { setForm(blankForm()); setShowAdd(true); setEditId(null); };
  const startEdit = (p: Promotion) => { setForm({ ...p }); setEditId(p.id); setShowAdd(false); };
  const cancelForm = () => { setShowAdd(false); setEditId(null); setForm({}); };

  const handleTranslate = async () => {
    setTranslating(true);
    const [titleTh, descTh] = await Promise.all([
      form.title_ko ? autoTranslate(form.title_ko) : Promise.resolve(''),
      form.description_ko ? autoTranslate(form.description_ko) : Promise.resolve(''),
    ]);
    setForm(f => ({ ...f, title_th: titleTh || f.title_th, description_th: descTh || f.description_th }));
    setTranslating(false);
  };

  const handleSave = async () => {
    if (!form.title_ko) return;
    setSaving(true);
    try {
      const headers = await getAuthHeader();
      const url = editId ? `/api/hospital-kb/promotions?id=${editId}` : '/api/hospital-kb/promotions';
      const method = editId ? 'PUT' : 'POST';
      const body = editId ? { ...form, hospital_id: undefined } : form;
      const res = await fetch(url, { method, headers, body: JSON.stringify(body) });
      if (res.ok) {
        cancelForm();
        onChanged();
      } else {
        const err = await res.json();
        alert('저장 실패: ' + (err.error ?? ''));
      }
    } catch (err) {
      console.error('[PromotionsTab] save error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 프로모션을 삭제하시겠습니까?')) return;
    setDeleteLoading(id);
    try {
      const headers = await getAuthHeader();
      await fetch(`/api/hospital-kb/promotions?id=${id}`, { method: 'DELETE', headers });
      onChanged();
    } catch (err) {
      console.error('[PromotionsTab] delete error:', err);
    } finally {
      setDeleteLoading(null);
    }
  };

  const toggleActive = async (p: Promotion) => {
    const headers = await getAuthHeader();
    await fetch(`/api/hospital-kb/promotions?id=${p.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ is_active: !p.is_active }),
    });
    onChanged();
  };

  const isExpired = (p: Promotion) => !!p.ends_at && new Date(p.ends_at) < new Date();

  const discountLabel = (p: Promotion) => {
    if (!p.discount_type || p.discount_value == null) return null;
    if (p.discount_type === 'percent') return `${p.discount_value}% 할인`;
    if (p.discount_type === 'fixed') return `${p.discount_value.toLocaleString('ko-KR')} KRW 할인`;
    if (p.discount_type === 'package') return '패키지';
    if (p.discount_type === 'free_add') return '무료 추가';
    return null;
  };

  const PromotionForm = () => (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3 mb-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-700">{editId ? '프로모션 수정' : '프로모션 추가'}</h4>
        <div className="flex gap-2">
          <button onClick={handleTranslate} disabled={translating} className="text-xs px-2 py-1 border rounded hover:bg-white disabled:opacity-50">
            {translating ? '번역 중...' : '한→태 번역'}
          </button>
          <button onClick={cancelForm} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label="제목 (한국어) *">
          <input type="text" value={form.title_ko ?? ''} onChange={e => setForm(f => ({ ...f, title_ko: e.target.value }))} className={inputCls} />
        </FormField>
        <FormField label="ชื่อโปรโมชัน (ไทย)">
          <input type="text" value={form.title_th ?? ''} onChange={e => setForm(f => ({ ...f, title_th: e.target.value }))} className={inputCls} />
        </FormField>
        <FormField label="설명 (한국어)">
          <textarea rows={2} value={form.description_ko ?? ''} onChange={e => setForm(f => ({ ...f, description_ko: e.target.value }))} className={inputCls} />
        </FormField>
        <FormField label="รายละเอียด (ไทย)">
          <textarea rows={2} value={form.description_th ?? ''} onChange={e => setForm(f => ({ ...f, description_th: e.target.value }))} className={inputCls} />
        </FormField>
        <FormField label="할인 유형">
          <select value={form.discount_type ?? ''} onChange={e => setForm(f => ({ ...f, discount_type: e.target.value || null }))} className={inputCls}>
            <option value="">없음</option>
            <option value="percent">퍼센트 (%)</option>
            <option value="fixed">고정 금액</option>
            <option value="package">패키지</option>
            <option value="free_add">무료 추가</option>
          </select>
        </FormField>
        <FormField label="할인 값">
          <input type="number" value={form.discount_value ?? ''} onChange={e => setForm(f => ({ ...f, discount_value: e.target.value ? parseFloat(e.target.value) : null }))} className={inputCls} />
        </FormField>
        <FormField label="시작일">
          <input type="date" value={form.starts_at ?? ''} onChange={e => setForm(f => ({ ...f, starts_at: e.target.value || null }))} className={inputCls} />
        </FormField>
        <FormField label="종료일 (비워두면 무기한)">
          <input type="date" value={form.ends_at ?? ''} onChange={e => setForm(f => ({ ...f, ends_at: e.target.value || null }))} className={inputCls} />
        </FormField>
        <div className="flex items-center gap-2 pt-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={!!form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="rounded" />
            활성
          </label>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={cancelForm} className="px-4 py-1.5 text-sm border rounded-lg hover:bg-white">취소</button>
        <button
          onClick={handleSave}
          disabled={saving || !form.title_ko}
          className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1"
        >
          {saving ? '저장 중...' : <><Check className="w-4 h-4" /> 저장</>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-800">프로모션 ({promotions.length}개)</h3>
        <button onClick={startAdd} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600">
          <Plus className="w-4 h-4" /> 추가
        </button>
      </div>

      {showAdd && <PromotionForm />}

      {promotions.length === 0 && !showAdd ? (
        <p className="text-sm text-slate-400 text-center py-8">등록된 프로모션이 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {promotions.map(p => (
            <React.Fragment key={p.id}>
              <div className={`border rounded-lg p-4 ${isExpired(p) ? 'bg-slate-50 border-slate-200' : 'bg-white border-slate-200'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-800">{p.title_ko}</span>
                      {p.title_th && <span className="text-sm text-slate-500">{p.title_th}</span>}
                      {discountLabel(p) && (
                        <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">{discountLabel(p)}</span>
                      )}
                      {isExpired(p) && (
                        <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">만료됨</span>
                      )}
                    </div>
                    {p.description_ko && (
                      <p className="text-sm text-slate-500 mt-1 line-clamp-1">{p.description_ko}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                      {p.starts_at && <span>시작: {p.starts_at}</span>}
                      <span>종료: {p.ends_at ?? '무기한'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => toggleActive(p)}
                      className={`px-2 py-0.5 rounded text-xs font-medium ${p.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                    >
                      {p.is_active ? '활성' : '비활성'}
                    </button>
                    <button onClick={() => startEdit(p)} className="text-blue-500 hover:text-blue-700 p-1"><Pencil className="w-4 h-4" /></button>
                    <button
                      onClick={() => handleDelete(p.id)}
                      disabled={deleteLoading === p.id}
                      className="text-red-400 hover:text-red-600 p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {editId === p.id && (
                  <div className="mt-4">
                    <PromotionForm />
                  </div>
                )}
              </div>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

// ── CasesTab ──────────────────────────────────────────────────────────────────────

function CasesTab({
  hospitalId,
  cases,
  onChanged,
}: {
  hospitalId: string;
  cases: SuccessfulCase[];
  onChanged: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [verifyLoading, setVerifyLoading] = useState<string | null>(null);

  const toggleVerify = async (c: SuccessfulCase) => {
    setVerifyLoading(c.id);
    try {
      const headers = await getAuthHeader();
      await fetch(`/api/hospital-kb/cases?id=${c.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ is_verified: !c.is_verified }),
      });
      onChanged();
    } catch (err) {
      console.error('[CasesTab] verify error:', err);
    } finally {
      setVerifyLoading(null);
    }
  };

  const outcomeLabel = (outcome: string | null) => {
    switch (outcome) {
      case 'surgery_booked': return '수술 예약';
      case 'consultation_booked': return '상담 예약';
      case 'revisit': return '재방문';
      default: return outcome ?? '-';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-800">성공 케이스 ({cases.length}개)</h3>
        <p className="text-xs text-slate-400">자동 수집 케이스를 검증하여 AI 추천에 활용합니다.</p>
      </div>

      {cases.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
          <p className="text-sm">수집된 성공 케이스가 없습니다.</p>
          <p className="text-xs mt-1">수술 전환 완료 상담이 자동으로 수집됩니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {cases.map(c => (
            <div key={c.id} className={`border rounded-lg overflow-hidden ${c.is_verified ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-white'}`}>
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {c.procedure_category && (
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{c.procedure_category}</span>
                      )}
                      {c.procedure_name_ko && (
                        <span className="text-sm font-medium text-slate-800">{c.procedure_name_ko}</span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        c.outcome === 'surgery_booked' ? 'bg-blue-100 text-blue-700' :
                        c.outcome === 'consultation_booked' ? 'bg-purple-100 text-purple-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>{outcomeLabel(c.outcome)}</span>
                      {c.quality_score != null && (
                        <span className="text-xs text-amber-600 font-medium">{'★'.repeat(c.quality_score)}</span>
                      )}
                      {c.is_masked && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">PDPA 마스킹</span>
                      )}
                    </div>
                    {c.contextual_summary && (
                      <p className="text-sm text-slate-600 mt-1.5 line-clamp-2">{c.contextual_summary}</p>
                    )}
                    {c.tags && c.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {c.tags.map(tag => (
                          <span key={tag} className="inline-flex items-center gap-0.5 text-[11px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                            <Tag className="w-2.5 h-2.5" />{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => toggleVerify(c)}
                      disabled={verifyLoading === c.id}
                      className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors disabled:opacity-50 ${
                        c.is_verified
                          ? 'bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {verifyLoading === c.id ? '...' : c.is_verified ? '검증됨' : '검증'}
                    </button>
                    <button
                      onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                      className="text-slate-400 hover:text-slate-600 p-1"
                    >
                      {expandedId === c.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Full conversation */}
              {expandedId === c.id && (
                <div className="border-t border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-medium text-slate-500 mb-2">전체 대화</p>
                  <pre className="text-xs text-slate-700 whitespace-pre-wrap font-mono leading-relaxed max-h-80 overflow-y-auto bg-white border border-slate-200 rounded p-3">
                    {c.full_conversation}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shared UI ─────────────────────────────────────────────────────────────────────

const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white';

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-slate-600">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
