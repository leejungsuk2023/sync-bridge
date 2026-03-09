'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { X, Star, Info, Send, ChevronDown, AlertTriangle, Bell } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────

interface FollowupCustomer {
  id: number;
  ticket_id: number;
  customer_name: string;
  customer_phone: string | null;
  interested_procedure: string | null;
  hospital_name: string | null;
  followup_reason: string | null;
  followup_reason_th: string | null;
  interested_procedure_th: string | null;
  followup_status: string;
  followup_note: string | null;
  subject: string | null;
  created_at: string;
  updated_at: string;
  next_check_at: string | null;
  last_checked_at: string | null;
  check_count: number;
  lost_reason: string | null;
  lost_reason_detail: string | null;
}

interface FollowupAction {
  id: string;
  ticket_id: number;
  action_type: 'worker_action' | 'ai_instruction' | 'system_note';
  content: string;
  content_th: string | null;
  status_before: string | null;
  status_after: string | null;
  zendesk_changes: any;
  created_by: string | null;
  created_at: string;
  read_at: string | null;
}

interface FollowupNotification {
  id: string;
  action_id: string;
  ticket_id: number;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

type FollowupStatus = 'pending' | 'contacted' | 'scheduled' | 'converted' | 'lost';

// ─── Constants ──────────────────────────────────────────────────────

const STATUS_CONFIG: Record<FollowupStatus, { label: string; bg: string; text: string; dot: string }> = {
  pending:   { label: 'รอดำเนินการ', bg: 'bg-amber-100',   text: 'text-amber-700',   dot: 'bg-amber-400' },
  contacted: { label: 'ติดต่อแล้ว',  bg: 'bg-blue-100',    text: 'text-blue-700',    dot: 'bg-blue-400' },
  scheduled: { label: 'นัดหมายแล้ว', bg: 'bg-indigo-100',  text: 'text-indigo-700',  dot: 'bg-indigo-400' },
  converted: { label: 'สำเร็จ',      bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-400' },
  lost:      { label: 'ไม่สำเร็จ',   bg: 'bg-red-100',     text: 'text-red-700',     dot: 'bg-red-400' },
};

const STATUS_ORDER: Record<string, number> = {
  pending: 0, contacted: 1, scheduled: 2, converted: 3, lost: 4,
};

const DROP_REASONS = [
  { value: 'no_response', label: 'ติดต่อไม่ได้' },
  { value: 'customer_rejected', label: 'ลูกค้าปฏิเสธ' },
  { value: 'competitor', label: 'เลือกคู่แข่ง' },
  { value: 'price_issue', label: 'ปัญหาเรื่องราคา' },
  { value: 'other', label: 'อื่นๆ' },
];

// ─── Helpers ────────────────────────────────────────────────────────

function formatTimestamp(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('th-TH', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

// ─── Detail Modal ────────────────────────────────────────────────────

function TicketDetailModal({
  customer,
  onClose,
  onPush,
  onDrop,
  pushing,
  dropping,
}: {
  customer: FollowupCustomer;
  onClose: () => void;
  onPush: (ticketId: number, comment: string) => Promise<void>;
  onDrop: (ticketId: number, reason: string, detail: string | null) => Promise<void>;
  pushing: boolean;
  dropping: boolean;
}) {
  const [actions, setActions] = useState<FollowupAction[]>([]);
  const [loadingActions, setLoadingActions] = useState(true);
  const [comment, setComment] = useState('');
  const [dropReason, setDropReason] = useState('');
  const [dropDetail, setDropDetail] = useState('');
  const [showDropConfirm, setShowDropConfirm] = useState(false);

  const statusConf = STATUS_CONFIG[customer.followup_status as FollowupStatus] || STATUS_CONFIG.pending;
  const isTerminal = customer.followup_status === 'lost' || customer.followup_status === 'converted';

  useEffect(() => {
    const load = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch(`/api/zendesk/followup-actions?ticket_id=${customer.ticket_id}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          // Reverse to show oldest first (chronological)
          setActions((data.actions || []).reverse());
        }
      } catch (err) {
        console.error('[WorkerFollowup] Failed to load actions:', err);
      } finally {
        setLoadingActions(false);
      }
    };
    load();
  }, [customer.ticket_id]);

  const handlePush = async () => {
    if (!comment.trim()) return;
    await onPush(customer.ticket_id, comment.trim());
    setComment('');
  };

  const handleDrop = async () => {
    if (!dropReason) return;
    await onDrop(customer.ticket_id, dropReason, dropReason === 'other' ? dropDetail : null);
    setShowDropConfirm(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 border-b border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-slate-900">{customer.customer_name}</h3>
                <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">#{customer.ticket_id}</span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                {customer.hospital_name && <span>{customer.hospital_name}</span>}
                {customer.interested_procedure && (
                  <span>{customer.interested_procedure_th || customer.interested_procedure}</span>
                )}
                {customer.customer_phone && <span>{customer.customer_phone}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${statusConf.bg} ${statusConf.text}`}>
                {statusConf.label}
              </span>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
                <X size={20} />
              </button>
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Followup Reason — first item in timeline */}
          {customer.followup_reason && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs font-medium text-amber-700 mb-1">เหตุผลในการติดตาม</p>
              <p className="text-sm text-amber-900">{customer.followup_reason_th || customer.followup_reason}</p>
            </div>
          )}

          {/* Action Timeline */}
          {loadingActions ? (
            <div className="flex items-center gap-2 py-4 justify-center">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-400" />
              <span className="text-sm text-slate-400">กำลังโหลด...</span>
            </div>
          ) : actions.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">ยังไม่มีประวัติการดำเนินการ</p>
          ) : (
            <div className="space-y-3">
              {actions.map((action) => {
                const isWorker = action.action_type === 'worker_action';
                const isAI = action.action_type === 'ai_instruction';
                return (
                  <div key={action.id} className={`rounded-lg p-3 ${
                    isAI ? 'bg-blue-50 border border-blue-200' :
                    isWorker ? 'bg-slate-50 border border-slate-200' :
                    'bg-slate-50 border border-slate-100'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      {isWorker && <div className="w-3 h-3 rounded-full bg-blue-400" />}
                      {isAI && <Star size={14} className="text-amber-500 fill-amber-500" />}
                      {!isWorker && !isAI && <Info size={14} className="text-slate-400" />}
                      <span className="text-[10px] font-medium text-slate-400">
                        {isAI ? 'คำแนะนำ AI' : isWorker ? 'การดำเนินการ' : 'ระบบ'}
                      </span>
                      <span className="text-[10px] text-slate-400 ml-auto">{formatTimestamp(action.created_at)}</span>
                    </div>
                    <p className="text-sm text-slate-700">{action.content_th || action.content}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Bottom Actions */}
        {!isTerminal && (
          <div className="shrink-0 border-t border-slate-200 px-5 py-3 space-y-3">
            {/* Comment + Push */}
            <div className="flex gap-2">
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handlePush(); }}
                placeholder="บันทึกสิ่งที่ทำ แล้วกด Push..."
                className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
                disabled={pushing}
              />
              <button
                onClick={handlePush}
                disabled={pushing || !comment.trim()}
                className="px-4 py-2 text-sm font-medium bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0"
              >
                <Send size={14} />
                {pushing ? '...' : 'Push'}
              </button>
            </div>

            {/* Drop */}
            {!showDropConfirm ? (
              <button
                onClick={() => setShowDropConfirm(true)}
                className="text-xs text-slate-400 hover:text-red-500 transition-colors"
              >
                Drop ลูกค้านี้...
              </button>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
                <p className="text-xs font-medium text-red-700">ยืนยันการ Drop</p>
                <select
                  value={dropReason}
                  onChange={(e) => setDropReason(e.target.value)}
                  className="w-full text-sm border border-red-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-red-400"
                >
                  <option value="">เลือกเหตุผล...</option>
                  {DROP_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                {dropReason === 'other' && (
                  <input
                    type="text"
                    value={dropDetail}
                    onChange={(e) => setDropDetail(e.target.value)}
                    placeholder="ระบุเหตุผล..."
                    className="w-full text-sm border border-red-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-red-400"
                  />
                )}
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => { setShowDropConfirm(false); setDropReason(''); setDropDetail(''); }}
                    className="text-xs px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
                  >
                    ยกเลิก
                  </button>
                  <button
                    onClick={handleDrop}
                    disabled={dropping || !dropReason || (dropReason === 'other' && !dropDetail.trim())}
                    className="text-xs px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium transition-colors disabled:opacity-50"
                  >
                    {dropping ? '...' : 'ยืนยัน Drop'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export default function WorkerFollowup({ userId }: { userId: string }) {
  const [customers, setCustomers] = useState<FollowupCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<FollowupCustomer | null>(null);
  const [pushing, setPushing] = useState(false);
  const [dropping, setDropping] = useState(false);

  // Notifications
  const [notifications, setNotifications] = useState<FollowupNotification[]>([]);

  const getSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  }, []);

  const fetchCustomers = useCallback(async () => {
    try {
      setError(null);
      const session = await getSession();
      if (!session) { setError('กรุณาเข้าสู่ระบบใหม่'); return; }
      const res = await fetch('/api/zendesk/followup-customers', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCustomers(data.customers || []);
    } catch (err) {
      console.error('[WorkerFollowup] Failed to fetch customers:', err);
      setError('ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  }, [getSession]);

  const fetchNotifications = useCallback(async () => {
    try {
      const session = await getSession();
      if (!session) return;
      const res = await fetch('/api/zendesk/followup-notifications', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
      }
    } catch (err) {
      console.error('[WorkerFollowup] Failed to fetch notifications:', err);
    }
  }, [getSession]);

  useEffect(() => {
    fetchCustomers();
    fetchNotifications();
  }, [fetchCustomers, fetchNotifications]);

  const markAllNotificationsRead = async () => {
    try {
      const session = await getSession();
      if (!session) return;
      await fetch('/api/zendesk/followup-notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ mark_all_read: true }),
      });
      setNotifications([]);
    } catch (err) {
      console.error('[WorkerFollowup] Failed to mark notifications read:', err);
    }
  };

  // Push = submit comment, auto-trigger followup loop
  const handlePush = async (ticketId: number, comment: string) => {
    setPushing(true);
    try {
      const session = await getSession();
      if (!session) return;
      const res = await fetch('/api/zendesk/followup-customers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ ticket_id: ticketId, action_comment: comment }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchCustomers();
      // Refresh modal data by re-selecting
      const updated = (await res.json()).updated;
      if (selectedTicket?.ticket_id === ticketId) {
        setSelectedTicket((prev) => prev ? { ...prev, ...updated, followup_status: updated?.followup_status || prev.followup_status } : prev);
      }
    } catch (err) {
      console.error('[WorkerFollowup] Push failed:', err);
    } finally {
      setPushing(false);
    }
  };

  // Drop = mark as lost
  const handleDrop = async (ticketId: number, reason: string, detail: string | null) => {
    setDropping(true);
    try {
      const session = await getSession();
      if (!session) return;
      const res = await fetch('/api/zendesk/followup-customers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          ticket_id: ticketId,
          status: 'lost',
          lost_reason: reason,
          lost_reason_detail: detail,
          action_comment: `Dropped: ${reason}${detail ? ` - ${detail}` : ''}`,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSelectedTicket(null);
      await fetchCustomers();
    } catch (err) {
      console.error('[WorkerFollowup] Drop failed:', err);
    } finally {
      setDropping(false);
    }
  };

  // ─── Sorting ──────────────────────────────────────────────────────

  const sortedCustomers = useMemo(() => {
    return [...customers].sort((a, b) => {
      const orderA = STATUS_ORDER[a.followup_status] ?? 99;
      const orderB = STATUS_ORDER[b.followup_status] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      if (a.next_check_at && b.next_check_at) {
        return new Date(a.next_check_at).getTime() - new Date(b.next_check_at).getTime();
      }
      return a.next_check_at ? -1 : b.next_check_at ? 1 : 0;
    });
  }, [customers]);

  // ─── BI Summary ───────────────────────────────────────────────────

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { pending: 0, contacted: 0, scheduled: 0, converted: 0, lost: 0 };
    customers.forEach((c) => { counts[c.followup_status] = (counts[c.followup_status] || 0) + 1; });
    return counts;
  }, [customers]);

  const activeCount = statusCounts.pending + statusCounts.contacted + statusCounts.scheduled;
  const unreadNotifCount = notifications.length;

  // ─── Loading / Error / Empty ──────────────────────────────────────

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
        <button onClick={() => { setLoading(true); fetchCustomers(); }} className="mt-2 text-sm text-red-500 hover:text-red-700 underline">
          ลองใหม่
        </button>
      </div>
    );
  }

  if (customers.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
        <p className="text-sm text-slate-500">ยังไม่มีลูกค้าที่ต้องติดตาม</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Notification Banner */}
      {unreadNotifCount > 0 && (
        <div className="rounded-xl p-3 flex items-center justify-between bg-blue-50 border border-blue-200">
          <div className="flex items-center gap-2">
            <Bell size={16} className="text-blue-500" />
            <span className="text-sm font-medium text-blue-700">มีคำแนะนำใหม่ {unreadNotifCount} รายการ</span>
          </div>
          <button onClick={markAllNotificationsRead} className="text-xs font-medium px-3 py-1 rounded-lg text-blue-600 hover:bg-blue-100 transition-colors">
            อ่านทั้งหมด
          </button>
        </div>
      )}

      {/* BI Summary */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-slate-900">ลูกค้าติดตาม</h2>
          <span className="text-sm text-slate-500">ทั้งหมด {customers.length} ราย</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['pending', 'contacted', 'scheduled', 'converted', 'lost'] as FollowupStatus[]).map((s) => {
            const conf = STATUS_CONFIG[s];
            const count = statusCounts[s] || 0;
            if (count === 0) return null;
            return (
              <div key={s} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${conf.bg} ${conf.text}`}>
                <div className={`w-2 h-2 rounded-full ${conf.dot}`} />
                {conf.label} {count}
              </div>
            );
          })}
          {activeCount > 0 && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 ml-auto">
              ต้องดำเนินการ {activeCount}
            </div>
          )}
        </div>
      </div>

      {/* Customer List */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="divide-y divide-slate-100">
          {sortedCustomers.map((customer) => {
            const conf = STATUS_CONFIG[customer.followup_status as FollowupStatus] || STATUS_CONFIG.pending;
            const isLost = customer.followup_status === 'lost';
            const isConverted = customer.followup_status === 'converted';
            const reason = customer.followup_reason_th || customer.followup_reason;

            return (
              <div
                key={customer.id}
                className={`px-4 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors ${
                  isLost ? 'opacity-50' : isConverted ? 'opacity-70' : ''
                }`}
              >
                {/* Status dot */}
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${conf.dot}`} />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-900 truncate">{customer.customer_name}</span>
                    <span className="text-[10px] font-mono text-slate-400">#{customer.ticket_id}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {customer.hospital_name && (
                      <span className="text-xs text-slate-500">{customer.hospital_name}</span>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${conf.bg} ${conf.text}`}>{conf.label}</span>
                  </div>
                  {reason && (
                    <p className="text-xs text-slate-400 mt-0.5 truncate">{reason}</p>
                  )}
                </div>

                {/* Detail Button */}
                <button
                  onClick={() => setSelectedTicket(customer)}
                  className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 hover:border-slate-300 transition-colors"
                >
                  ดูรายละเอียด
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail Modal */}
      {selectedTicket && (
        <TicketDetailModal
          customer={selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onPush={handlePush}
          onDrop={handleDrop}
          pushing={pushing}
          dropping={dropping}
        />
      )}
    </div>
  );
}
