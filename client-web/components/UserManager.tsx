'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Trash2, ChevronDown } from 'lucide-react';

interface UserInfo {
  id: string;
  email: string;
  display_name: string;
  role: string;
  client_id: string | null;
  created_at: string;
}

export default function UserManager({ clients }: { clients: any[] }) {
  const [collapsed, setCollapsed] = useState(true);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({
    email: '',
    password: '',
    displayName: '',
    role: 'worker' as 'client' | 'worker' | 'staff',
    clientId: '',
  });

  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || '';
  };

  const fetchUsers = async () => {
    const token = await getToken();
    const res = await fetch('/api/admin/users', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreate = async () => {
    if (!form.email || !form.password || !form.role) {
      setError('이메일, 비밀번호, 역할은 필수입니다.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');

    const token = await getToken();
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        email: form.email,
        password: form.password,
        displayName: form.displayName,
        role: form.role,
        clientId: form.clientId || null,
      }),
    });

    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(data.error || '생성 실패');
      return;
    }

    setSuccess(`${data.email} (${data.role}) 계정이 생성되었습니다.`);
    setForm({ email: '', password: '', displayName: '', role: 'worker', clientId: '' });
    fetchUsers();
  };

  const handleDelete = async (userId: string, email: string) => {
    if (!confirm(`${email} 계정을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;

    const token = await getToken();
    const res = await fetch(`/api/admin/users?id=${userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      setSuccess(`${email} 계정이 삭제되었습니다.`);
      fetchUsers();
    } else {
      const data = await res.json();
      setError(data.error || '삭제 실패');
    }
  };

  const getClientName = (clientId: string | null) => {
    if (!clientId) return '—';
    const c = clients.find(c => c.id === clientId);
    return c?.name || '—';
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'bbg_admin':
        return <span className="px-2.5 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">관리자</span>;
      case 'client':
        return <span className="px-2.5 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">병원</span>;
      case 'worker':
        return <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full">태국직원</span>;
      case 'staff':
        return <span className="px-2.5 py-1 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">한국직원</span>;
      default:
        return <span className="px-2.5 py-1 bg-slate-100 text-slate-500 text-xs font-medium rounded-full">{role}</span>;
    }
  };

  if (loading) return <p className="text-sm text-slate-500">로딩 중...</p>;

  return (
    <div className="bg-gradient-to-r from-slate-100/70 to-white rounded-xl shadow-sm border border-slate-200 border-l-4 border-l-slate-400 p-6">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between cursor-pointer mb-0"
      >
        <div>
          <h2 className="text-lg font-semibold text-slate-900 text-left">계정 관리</h2>
          <p className="text-xs text-slate-500 mt-1 text-left">한국직원(staff), 태국직원(worker), 병원(client) 계정을 생성하고 관리합니다.</p>
        </div>
        <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform shrink-0 ${collapsed ? '' : 'rotate-180'}`} />
      </button>
      {!collapsed && (<>

      {/* Create form */}
      <div className="space-y-4 pb-6 border-b border-slate-200">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">이메일</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="user@example.com"
              className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">비밀번호</label>
            <input
              type="text"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder="6자 이상"
              className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">이름</label>
            <input
              value={form.displayName}
              onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
              placeholder="표시 이름"
              className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">역할</label>
            <select
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value as 'client' | 'worker' | 'staff' }))}
              className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow bg-white"
            >
              <option value="worker">태국 직원 (Worker)</option>
              <option value="staff">한국 직원 (Staff)</option>
              <option value="client">병원 (Client)</option>
            </select>
          </div>
          {form.role !== 'staff' && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">소속 병원</label>
              <select
                value={form.clientId}
                onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}
                className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-shadow bg-white"
              >
                <option value="">선택하세요</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
            {error}
          </div>
        )}
        {success && (
          <div className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            {success}
          </div>
        )}

        <button
          type="button"
          onClick={handleCreate}
          disabled={saving || !form.email || !form.password}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          {saving ? '생성 중...' : '계정 생성'}
        </button>
      </div>

      {/* User list */}
      <div className="mt-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">등록된 계정 ({users.length})</h3>
        {users.length === 0 ? (
          <p className="text-sm text-slate-500">등록된 계정이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-700">이메일</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-700">이름</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-700">역할</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-700">소속 병원</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-slate-700">작업</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4">
                      <span className="text-sm text-slate-900">{u.email}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm text-slate-900">{u.display_name || '—'}</span>
                    </td>
                    <td className="py-3 px-4">{getRoleBadge(u.role)}</td>
                    <td className="py-3 px-4">
                      <span className="text-sm text-slate-600">{getClientName(u.client_id)}</span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {u.role !== 'bbg_admin' ? (
                        <button
                          type="button"
                          onClick={() => handleDelete(u.id, u.email)}
                          className="text-red-600 hover:text-red-700 text-xs font-medium inline-flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" />
                          삭제
                        </button>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>)}
    </div>
  );
}
