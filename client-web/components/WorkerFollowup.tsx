'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

interface FollowupCustomer {
  id: number;
  ticket_id: number;
  customer_name: string;
  customer_phone: string | null;
  interested_procedure: string | null;
  hospital_name: string | null;
  followup_reason: string | null;
  followup_status: string;
  followup_note: string | null;
  created_at: string;
  updated_at: string;
}

type FollowupStatus = 'pending' | 'contacted' | 'scheduled' | 'converted' | 'lost';

const STATUS_CONFIG: Record<FollowupStatus, { label: string; bg: string; text: string }> = {
  pending:   { label: 'รอดำเนินการ', bg: 'bg-amber-100',   text: 'text-amber-700' },
  contacted: { label: 'ติดต่อแล้ว',  bg: 'bg-blue-100',    text: 'text-blue-700' },
  scheduled: { label: 'นัดหมายแล้ว', bg: 'bg-indigo-100',  text: 'text-indigo-700' },
  converted: { label: 'สำเร็จ',      bg: 'bg-emerald-100', text: 'text-emerald-700' },
  lost:      { label: 'ไม่สำเร็จ',   bg: 'bg-red-100',     text: 'text-red-700' },
};

const ACTION_BUTTONS: { status: FollowupStatus; label: string; color: string }[] = [
  { status: 'contacted', label: 'ติดต่อแล้ว',  color: 'bg-blue-500 hover:bg-blue-600 text-white' },
  { status: 'scheduled', label: 'นัดหมายแล้ว', color: 'bg-indigo-500 hover:bg-indigo-600 text-white' },
  { status: 'converted', label: 'สำเร็จ',      color: 'bg-emerald-500 hover:bg-emerald-600 text-white' },
  { status: 'lost',      label: 'ไม่สำเร็จ',   color: 'bg-red-500 hover:bg-red-600 text-white' },
];

export default function WorkerFollowup({ userId }: { userId: string }) {
  const [customers, setCustomers] = useState<FollowupCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  const fetchCustomers = useCallback(async () => {
    try {
      setError(null);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('กรุณาเข้าสู่ระบบใหม่');
        return;
      }

      const res = await fetch('/api/zendesk/followup-customers', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      setCustomers(data.customers || []);
    } catch (err) {
      console.error('[WorkerFollowup] Failed to fetch customers:', err);
      setError('ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const handleStatusChange = async (ticketId: number, status: FollowupStatus) => {
    setUpdating(ticketId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch('/api/zendesk/followup-customers', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          ticket_id: ticketId,
          status,
          note: notes[ticketId] || undefined,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      // Clear note after successful update
      setNotes((prev) => {
        const next = { ...prev };
        delete next[ticketId];
        return next;
      });

      // Refresh list
      await fetchCustomers();
    } catch (err) {
      console.error('[WorkerFollowup] Failed to update status:', err);
      setError('ไม่สามารถอัปเดตสถานะได้ กรุณาลองใหม่');
    } finally {
      setUpdating(null);
    }
  };

  const pendingCount = customers.filter((c) => c.followup_status === 'pending').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        <span className="ml-3 text-sm text-slate-500">กำลังโหลด...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
        <p className="text-sm text-red-600">{error}</p>
        <button
          onClick={() => { setLoading(true); fetchCustomers(); }}
          className="mt-2 text-sm text-red-500 hover:text-red-700 underline"
        >
          ลองใหม่
        </button>
      </div>
    );
  }

  if (customers.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
        <div className="text-3xl mb-2">-</div>
        <p className="text-sm text-slate-500">ยังไม่มีลูกค้าที่ต้องติดตาม</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with count */}
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold text-slate-900">ลูกค้าติดตาม</h2>
        {pendingCount > 0 && (
          <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">
            {pendingCount} รอดำเนินการ
          </span>
        )}
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3 font-medium text-slate-600">ชื่อลูกค้า</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">เบอร์โทร</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">หัตถการ</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">โรงพยาบาล</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">เหตุผล</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">สถานะ</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">บันทึก</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">การดำเนินการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {customers.map((customer) => {
              const statusConf = STATUS_CONFIG[customer.followup_status as FollowupStatus] || STATUS_CONFIG.pending;
              const isUpdating = updating === customer.ticket_id;

              return (
                <tr key={customer.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-900">{customer.customer_name}</td>
                  <td className="px-4 py-3 text-slate-600">{customer.customer_phone || '-'}</td>
                  <td className="px-4 py-3 text-slate-600">{customer.interested_procedure || '-'}</td>
                  <td className="px-4 py-3 text-slate-600">{customer.hospital_name || '-'}</td>
                  <td className="px-4 py-3 text-slate-600 max-w-[200px] truncate">{customer.followup_reason || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${statusConf.bg} ${statusConf.text}`}>
                      {statusConf.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      placeholder="บันทึกเพิ่มเติม..."
                      value={notes[customer.ticket_id] || ''}
                      onChange={(e) => setNotes((prev) => ({ ...prev, [customer.ticket_id]: e.target.value }))}
                      className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      disabled={isUpdating}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {ACTION_BUTTONS.filter((a) => a.status !== customer.followup_status).map((action) => (
                        <button
                          key={action.status}
                          onClick={() => handleStatusChange(customer.ticket_id, action.status)}
                          disabled={isUpdating}
                          className={`text-[11px] px-2 py-1 rounded-lg font-medium transition-colors disabled:opacity-50 ${action.color}`}
                        >
                          {isUpdating ? '...' : action.label}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Card Layout */}
      <div className="md:hidden space-y-3">
        {customers.map((customer) => {
          const statusConf = STATUS_CONFIG[customer.followup_status as FollowupStatus] || STATUS_CONFIG.pending;
          const isUpdating = updating === customer.ticket_id;

          return (
            <div key={customer.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
              {/* Customer info */}
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-slate-900">{customer.customer_name}</p>
                  {customer.customer_phone && (
                    <p className="text-xs text-slate-500 mt-0.5">{customer.customer_phone}</p>
                  )}
                </div>
                <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${statusConf.bg} ${statusConf.text}`}>
                  {statusConf.label}
                </span>
              </div>

              {/* Details */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                {customer.interested_procedure && (
                  <div>
                    <span className="text-slate-400">หัตถการ:</span>
                    <p className="text-slate-700">{customer.interested_procedure}</p>
                  </div>
                )}
                {customer.hospital_name && (
                  <div>
                    <span className="text-slate-400">โรงพยาบาล:</span>
                    <p className="text-slate-700">{customer.hospital_name}</p>
                  </div>
                )}
                {customer.followup_reason && (
                  <div className="col-span-2">
                    <span className="text-slate-400">เหตุผล:</span>
                    <p className="text-slate-700">{customer.followup_reason}</p>
                  </div>
                )}
              </div>

              {/* Note input */}
              <input
                type="text"
                placeholder="บันทึกเพิ่มเติม..."
                value={notes[customer.ticket_id] || ''}
                onChange={(e) => setNotes((prev) => ({ ...prev, [customer.ticket_id]: e.target.value }))}
                className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
                disabled={isUpdating}
              />

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2">
                {ACTION_BUTTONS.filter((a) => a.status !== customer.followup_status).map((action) => (
                  <button
                    key={action.status}
                    onClick={() => handleStatusChange(customer.ticket_id, action.status)}
                    disabled={isUpdating}
                    className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 ${action.color}`}
                  >
                    {isUpdating ? '...' : action.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
