'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Bell, ChevronDown, ChevronUp, Clock, Star, Info, X, AlertTriangle } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────

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

type LostReason = 'no_response' | 'customer_rejected' | 'competitor' | 'price_issue' | 'other';

// ─── Constants ──────────────────────────────────────────────────────

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

const LOST_REASONS: { value: LostReason; label: string }[] = [
  { value: 'no_response',       label: 'ติดต่อไม่ได้' },
  { value: 'customer_rejected', label: 'ลูกค้าปฏิเสธ' },
  { value: 'competitor',        label: 'เลือกคู่แข่ง' },
  { value: 'price_issue',       label: 'ปัญหาเรื่องราคา' },
  { value: 'other',             label: 'อื่นๆ' },
];

const LOST_REASON_LABELS: Record<string, string> = {
  no_response: 'ติดต่อไม่ได้',
  customer_rejected: 'ลูกค้าปฏิเสธ',
  competitor: 'เลือกคู่แข่ง',
  price_issue: 'ปัญหาเรื่องราคา',
  other: 'อื่นๆ',
};

// Active statuses are sorted first, then converted, then lost
const STATUS_ORDER: Record<string, number> = {
  pending: 0,
  contacted: 1,
  scheduled: 2,
  converted: 3,
  lost: 4,
};

// ─── Helpers ────────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const absDiffMs = Math.abs(diffMs);
  const hours = absDiffMs / (1000 * 60 * 60);

  if (hours < 6) {
    if (hours < 1) {
      const mins = Math.round(absDiffMs / (1000 * 60));
      return diffMs > 0 ? `อีก ${mins} นาที` : `${mins} นาทีที่แล้ว`;
    }
    const h = Math.round(hours * 10) / 10;
    return diffMs > 0 ? `อีก ${h} ชม.` : `${h} ชม.ที่แล้ว`;
  }

  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Lost Modal ─────────────────────────────────────────────────────

function FollowupLostModal({
  customerName,
  onConfirm,
  onClose,
  isSubmitting,
}: {
  customerName: string;
  onConfirm: (reason: LostReason, detail: string | null, comment: string) => void;
  onClose: () => void;
  isSubmitting: boolean;
}) {
  const [reason, setReason] = useState<LostReason | ''>('');
  const [detail, setDetail] = useState('');
  const [comment, setComment] = useState('');

  const canConfirm = reason !== '' && (reason !== 'other' || detail.trim().length > 0);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">บันทึกเหตุผล</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <p className="text-sm text-slate-600">
          ลูกค้า: <span className="font-medium text-slate-800">{customerName}</span>
        </p>

        {/* Reason dropdown */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">เหตุผล</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as LostReason | '')}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="">เลือกเหตุผล...</option>
            {LOST_REASONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        {/* Detail textarea (shown when reason is 'other') */}
        {reason === 'other' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">รายละเอียด (จำเป็น)</label>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="กรุณาระบุเหตุผล..."
              rows={2}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
            />
          </div>
        )}

        {/* Action comment */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">บันทึกเพิ่มเติม</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="บันทึกสิ่งที่ทำ..."
            rows={2}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-sm px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            onClick={() => onConfirm(reason as LostReason, reason === 'other' ? detail : null, comment)}
            disabled={!canConfirm || isSubmitting}
            className="text-sm px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'กำลังบันทึก...' : 'ยืนยัน'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Action Timeline ────────────────────────────────────────────────

function ActionTimeline({ ticketId }: { ticketId: number }) {
  const [actions, setActions] = useState<FollowupAction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const res = await fetch(`/api/zendesk/followup-actions?ticket_id=${ticketId}`, {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        });

        if (res.ok) {
          const data = await res.json();
          setActions(data.actions || []);
        }
      } catch (err) {
        console.error('[WorkerFollowup] Failed to load actions:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [ticketId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400" />
        <span className="text-xs text-slate-400">กำลังโหลดประวัติ...</span>
      </div>
    );
  }

  if (actions.length === 0) {
    return <p className="text-xs text-slate-400 py-2">ยังไม่มีประวัติ</p>;
  }

  return (
    <div className="space-y-2 py-2">
      {actions.map((action) => {
        const isWorker = action.action_type === 'worker_action';
        const isAI = action.action_type === 'ai_instruction';
        // system_note is the default

        return (
          <div key={action.id} className="flex gap-2 text-xs">
            {/* Icon */}
            <div className="flex-shrink-0 mt-0.5">
              {isWorker && <div className="w-4 h-4 rounded-full bg-blue-400 flex items-center justify-center"><div className="w-2 h-2 rounded-full bg-white" /></div>}
              {isAI && <Star size={16} className="text-amber-400 fill-amber-400" />}
              {!isWorker && !isAI && <Info size={16} className="text-slate-400" />}
            </div>
            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className="text-slate-700">{action.content_th || action.content}</p>
              {action.status_before && action.status_after && action.status_before !== action.status_after && (
                <p className="text-slate-400 mt-0.5">
                  {STATUS_CONFIG[action.status_before as FollowupStatus]?.label || action.status_before}
                  {' → '}
                  {STATUS_CONFIG[action.status_after as FollowupStatus]?.label || action.status_after}
                </p>
              )}
              <p className="text-slate-400 mt-0.5">{formatTimestamp(action.created_at)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export default function WorkerFollowup({ userId }: { userId: string }) {
  const [customers, setCustomers] = useState<FollowupCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<number | null>(null);
  const [comments, setComments] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  // Notification state
  const [notifications, setNotifications] = useState<FollowupNotification[]>([]);

  // AI instruction state per customer: latest unread ai_instruction
  const [aiInstructions, setAiInstructions] = useState<Record<number, FollowupAction>>({});

  // Timeline expand state
  const [expandedTimelines, setExpandedTimelines] = useState<Record<number, boolean>>({});

  // Lost modal state
  const [lostModalTicketId, setLostModalTicketId] = useState<number | null>(null);

  // ─── Data fetching ─────────────────────────────────────────────

  const getSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  }, []);

  const fetchCustomers = useCallback(async () => {
    try {
      setError(null);
      const session = await getSession();
      if (!session) {
        setError('กรุณาเข้าสู่ระบบใหม่');
        return;
      }

      const res = await fetch('/api/zendesk/followup-customers', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const fetched: FollowupCustomer[] = data.customers || [];
      setCustomers(fetched);

      // Extract latest unread AI instruction per customer from response if available
      if (data.latest_ai_instructions) {
        const instructions: Record<number, FollowupAction> = {};
        for (const instr of data.latest_ai_instructions) {
          instructions[instr.ticket_id] = instr;
        }
        setAiInstructions(instructions);
      }
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
        headers: { 'Authorization': `Bearer ${session.access_token}` },
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

  // ─── Notification actions ──────────────────────────────────────

  const markAllNotificationsRead = async () => {
    try {
      const session = await getSession();
      if (!session) return;

      const res = await fetch('/api/zendesk/followup-notifications', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ mark_all_read: true }),
      });

      if (res.ok) {
        setNotifications([]);
      }
    } catch (err) {
      console.error('[WorkerFollowup] Failed to mark notifications read:', err);
    }
  };

  // ─── AI instruction read ──────────────────────────────────────

  const markInstructionRead = async (ticketId: number, actionId: string) => {
    try {
      const session = await getSession();
      if (!session) return;

      await fetch('/api/zendesk/followup-actions', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action_id: actionId }),
      });

      // Remove from local state
      setAiInstructions((prev) => {
        const next = { ...prev };
        delete next[ticketId];
        return next;
      });
    } catch (err) {
      console.error('[WorkerFollowup] Failed to mark instruction read:', err);
    }
  };

  // ─── Status change ────────────────────────────────────────────

  const handleStatusChange = async (
    ticketId: number,
    status: FollowupStatus,
    lostReason?: LostReason,
    lostReasonDetail?: string | null,
    lostComment?: string,
  ) => {
    setUpdating(ticketId);
    try {
      const session = await getSession();
      if (!session) return;

      const body: Record<string, any> = {
        ticket_id: ticketId,
        status,
        note: comments[ticketId] || undefined,
        action_comment: lostComment ?? (comments[ticketId] || undefined),
      };

      if (status === 'lost' && lostReason) {
        body.lost_reason = lostReason;
        if (lostReasonDetail) {
          body.lost_reason_detail = lostReasonDetail;
        }
      }

      const res = await fetch('/api/zendesk/followup-customers', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Clear comment
      setComments((prev) => {
        const next = { ...prev };
        delete next[ticketId];
        return next;
      });

      // Close lost modal
      setLostModalTicketId(null);

      // Refresh
      await fetchCustomers();
    } catch (err) {
      console.error('[WorkerFollowup] Failed to update status:', err);
      setError('ไม่สามารถอัปเดตสถานะได้ กรุณาลองใหม่');
    } finally {
      setUpdating(null);
    }
  };

  // ─── Sorting ──────────────────────────────────────────────────

  const sortedCustomers = useMemo(() => {
    return [...customers].sort((a, b) => {
      const orderA = STATUS_ORDER[a.followup_status] ?? 99;
      const orderB = STATUS_ORDER[b.followup_status] ?? 99;
      if (orderA !== orderB) return orderA - orderB;

      // Within active statuses, sort by next_check_at (soonest first)
      if (a.next_check_at && b.next_check_at) {
        return new Date(a.next_check_at).getTime() - new Date(b.next_check_at).getTime();
      }
      if (a.next_check_at) return -1;
      if (b.next_check_at) return 1;

      return 0;
    });
  }, [customers]);

  const pendingCount = customers.filter((c) => c.followup_status === 'pending').length;
  const unreadNotifCount = notifications.length;
  const hasHighUrgency = notifications.some((n) => n.body.toLowerCase().includes('urgency: high') || n.body.toLowerCase().includes('urgency:high'));

  // ─── Timeline toggle ──────────────────────────────────────────

  const toggleTimeline = (ticketId: number) => {
    setExpandedTimelines((prev) => ({ ...prev, [ticketId]: !prev[ticketId] }));
  };

  // ─── Render helpers ────────────────────────────────────────────

  const isLost = (status: string) => status === 'lost';
  const isConverted = (status: string) => status === 'converted';
  const isTerminal = (status: string) => isLost(status) || isConverted(status);

  // ─── Loading / Error / Empty ───────────────────────────────────

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

  // ─── Customer Card (shared for mobile + desktop) ───────────────

  const renderCustomerCard = (customer: FollowupCustomer) => {
    const statusConf = STATUS_CONFIG[customer.followup_status as FollowupStatus] || STATUS_CONFIG.pending;
    const isUpdating = updating === customer.ticket_id;
    const lost = isLost(customer.followup_status);
    const converted = isConverted(customer.followup_status);
    const terminal = isTerminal(customer.followup_status);
    const aiInstruction = aiInstructions[customer.ticket_id];
    const timelineExpanded = expandedTimelines[customer.ticket_id] || false;

    return (
      <div
        key={customer.id}
        className={`bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3 ${
          lost ? 'opacity-60' : converted ? 'opacity-80' : ''
        }`}
      >
        {/* AI Instruction Highlight */}
        {aiInstruction && !aiInstruction.read_at && (
          <div
            className="bg-amber-50 border border-amber-200 rounded-lg p-3 cursor-pointer relative"
            onClick={() => markInstructionRead(customer.ticket_id, aiInstruction.id)}
          >
            <div className="flex items-start gap-2">
              <Star size={14} className="text-amber-500 fill-amber-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-amber-700">คำแนะนำจาก AI</span>
                  {/* Blue unread dot */}
                  <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                </div>
                <p className="text-xs text-amber-800 mt-1">
                  {aiInstruction.content_th || aiInstruction.content}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Customer info */}
        <div className="flex items-start justify-between">
          <div>
            <p className="font-medium text-slate-900">{customer.customer_name}</p>
            {customer.customer_phone && (
              <p className="text-xs text-slate-500 mt-0.5">{customer.customer_phone}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Next check timer */}
            {customer.next_check_at && !terminal && (
              <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                <Clock size={10} />
                {formatRelativeTime(customer.next_check_at)}
              </span>
            )}
            <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${statusConf.bg} ${statusConf.text}`}>
              {statusConf.label}
            </span>
          </div>
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
          {customer.subject && (
            <div className="col-span-2">
              <span className="text-slate-400">หัวข้อ:</span>
              <p className="text-slate-700">{customer.subject}</p>
            </div>
          )}
        </div>

        {/* Lost reason badge */}
        {lost && customer.lost_reason && (
          <div className="flex items-center gap-1">
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-500 border border-red-200">
              {LOST_REASON_LABELS[customer.lost_reason] || customer.lost_reason}
            </span>
            {customer.lost_reason === 'other' && customer.lost_reason_detail && (
              <span className="text-xs text-slate-400 truncate">— {customer.lost_reason_detail}</span>
            )}
          </div>
        )}

        {/* Action comment textarea (disabled for terminal statuses) */}
        {!terminal && (
          <textarea
            placeholder="บันทึกสิ่งที่ทำ..."
            value={comments[customer.ticket_id] || ''}
            onChange={(e) => setComments((prev) => ({ ...prev, [customer.ticket_id]: e.target.value }))}
            rows={2}
            className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
            disabled={isUpdating}
          />
        )}

        {/* Action buttons (hidden for terminal statuses) */}
        {!terminal && (
          <div className="flex flex-wrap gap-2">
            {ACTION_BUTTONS.filter((a) => a.status !== customer.followup_status).map((action) => (
              <button
                key={action.status}
                onClick={() => {
                  if (action.status === 'lost') {
                    setLostModalTicketId(customer.ticket_id);
                  } else {
                    handleStatusChange(customer.ticket_id, action.status);
                  }
                }}
                disabled={isUpdating}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 ${action.color}`}
              >
                {isUpdating ? '...' : action.label}
              </button>
            ))}
          </div>
        )}

        {/* Timeline toggle */}
        <button
          onClick={() => toggleTimeline(customer.ticket_id)}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
        >
          {timelineExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {timelineExpanded ? 'ซ่อนประวัติ' : 'ดูประวัติ'}
        </button>

        {/* Timeline */}
        {timelineExpanded && (
          <div className="border-t border-slate-100 pt-2">
            <ActionTimeline ticketId={customer.ticket_id} />
          </div>
        )}
      </div>
    );
  };

  // ─── Main Render ───────────────────────────────────────────────

  const lostModalCustomer = lostModalTicketId
    ? customers.find((c) => c.ticket_id === lostModalTicketId)
    : null;

  return (
    <div className="space-y-4">
      {/* Notification Banner */}
      {unreadNotifCount > 0 && (
        <div className={`rounded-xl p-3 flex items-center justify-between ${
          hasHighUrgency ? 'bg-red-50 border border-red-200' : 'bg-blue-50 border border-blue-200'
        }`}>
          <div className="flex items-center gap-2">
            {hasHighUrgency ? (
              <AlertTriangle size={16} className="text-red-500" />
            ) : (
              <Bell size={16} className="text-blue-500" />
            )}
            <span className={`text-sm font-medium ${hasHighUrgency ? 'text-red-700' : 'text-blue-700'}`}>
              มีคำแนะนำใหม่ {unreadNotifCount} รายการ
            </span>
          </div>
          <button
            onClick={markAllNotificationsRead}
            className={`text-xs font-medium px-3 py-1 rounded-lg transition-colors ${
              hasHighUrgency
                ? 'text-red-600 hover:bg-red-100'
                : 'text-blue-600 hover:bg-blue-100'
            }`}
          >
            อ่านทั้งหมด
          </button>
        </div>
      )}

      {/* Header with count */}
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold text-slate-900">ลูกค้าติดตาม</h2>
        {pendingCount > 0 && (
          <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">
            {pendingCount} รอดำเนินการ
          </span>
        )}
      </div>

      {/* Card Layout (unified for mobile and desktop) */}
      <div className="space-y-3">
        {sortedCustomers.map((customer) => renderCustomerCard(customer))}
      </div>

      {/* Lost Modal */}
      {lostModalCustomer && (
        <FollowupLostModal
          customerName={lostModalCustomer.customer_name}
          isSubmitting={updating === lostModalCustomer.ticket_id}
          onClose={() => setLostModalTicketId(null)}
          onConfirm={(reason, detail, comment) => {
            handleStatusChange(lostModalCustomer.ticket_id, 'lost', reason, detail, comment);
          }}
        />
      )}
    </div>
  );
}
