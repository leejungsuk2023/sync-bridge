'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { CheckCircle, AlertCircle, Loader2, Link2, Unlink } from 'lucide-react';

interface ZendeskSetupProps {
  user: any;
  profile: any;
  onConnected?: () => void;
}

interface ConnectionStatus {
  connected: boolean;
  email: string | null;
  zendesk_user_id: number | null;
  polite_particle: string | null;
}

export default function ZendeskSetup({ user, profile, onConnected }: ZendeskSetupProps) {
  const [email, setEmail] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [politeParticle, setPoliteParticle] = useState<'ค่ะ' | 'ครับ'>('ค่ะ');
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const getSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  }, []);

  // ─── Check current connection ─────────────────────────────────

  const checkConnection = useCallback(async () => {
    try {
      const session = await getSession();
      if (!session) return;

      const res = await fetch('/api/zendesk/agent-token', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        if (data.email) {
          setEmail(data.email);
        }
        if (data.polite_particle) {
          setPoliteParticle(data.polite_particle);
        }
      } else {
        setStatus({ connected: false, email: null, zendesk_user_id: null, polite_particle: null });
      }
    } catch (err) {
      console.error('[ZendeskSetup] Failed to check connection:', err);
      setStatus({ connected: false, email: null, zendesk_user_id: null, polite_particle: null });
    } finally {
      setLoading(false);
    }
  }, [getSession]);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  // ─── Connect ──────────────────────────────────────────────────

  const handleConnect = async () => {
    setError(null);
    setSuccess(null);

    if (!email.trim()) {
      setError('กรุณากรอกอีเมล Zendesk');
      return;
    }
    if (!apiToken.trim()) {
      setError('กรุณากรอก API Token');
      return;
    }

    setConnecting(true);

    try {
      const session = await getSession();
      if (!session) {
        setError('กรุณาเข้าสู่ระบบใหม่');
        return;
      }

      const res = await fetch('/api/zendesk/agent-token', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: email.trim(),
          api_token: apiToken.trim(),
          polite_particle: politeParticle,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'เชื่อมต่อไม่สำเร็จ');
        return;
      }

      setSuccess('เชื่อมต่อสำเร็จ!');
      setApiToken('');
      setStatus({
        connected: true,
        email: data.email || email.trim(),
        zendesk_user_id: data.zendesk_user_id || null,
        polite_particle: politeParticle,
      });
      onConnected?.();
    } catch (err) {
      console.error('[ZendeskSetup] Connect error:', err);
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setConnecting(false);
    }
  };

  // ─── Disconnect ───────────────────────────────────────────────

  const handleDisconnect = async () => {
    setError(null);
    setSuccess(null);
    setDisconnecting(true);

    try {
      const session = await getSession();
      if (!session) return;

      const res = await fetch('/api/zendesk/agent-token', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.ok) {
        setStatus({ connected: false, email: null, zendesk_user_id: null, polite_particle: null });
        setEmail('');
        setApiToken('');
        setSuccess('ยกเลิกการเชื่อมต่อแล้ว');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'ยกเลิกการเชื่อมต่อไม่สำเร็จ');
      }
    } catch (err) {
      console.error('[ZendeskSetup] Disconnect error:', err);
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setDisconnecting(false);
    }
  };

  // ─── Loading state ────────────────────────────────────────────

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 shadow-sm">
        <div className="flex items-center justify-center gap-3">
          <span className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-slate-500">กำลังตรวจสอบ...</span>
        </div>
      </div>
    );
  }

  // ─── Connected state ──────────────────────────────────────────

  if (status?.connected) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-50 to-white border-b border-emerald-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">เชื่อมต่อ Zendesk แล้ว</h3>
              <p className="text-sm text-slate-500">บัญชีของคุณเชื่อมต่อกับ Zendesk เรียบร้อยแล้ว</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">อีเมล</span>
            <span className="text-sm font-medium text-slate-900">{status.email}</span>
          </div>
          {status.zendesk_user_id && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">Zendesk User ID</span>
              <span className="text-sm font-mono text-slate-700">{status.zendesk_user_id}</span>
            </div>
          )}
          {status.polite_particle && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">คำลงท้าย</span>
              <span className="text-sm font-medium text-slate-900">{status.polite_particle}</span>
            </div>
          )}

          {success && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-sm text-emerald-700">
              {success}
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="w-full py-2.5 text-sm font-medium border border-red-200 text-red-600 hover:bg-red-50 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {disconnecting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Unlink className="w-4 h-4" />
            )}
            ยกเลิกการเชื่อมต่อ
          </button>
        </div>
      </div>
    );
  }

  // ─── Setup form ───────────────────────────────────────────────

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-indigo-50 to-white border-b border-indigo-100 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
            <Link2 className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">เชื่อมต่อ Zendesk</h3>
            <p className="text-sm text-slate-500">เชื่อมต่อบัญชี Zendesk เพื่อตอบแชทลูกค้า</p>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 space-y-4">
        {/* Instructions */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs text-slate-600 space-y-2">
          <p className="font-medium text-slate-700">วิธีรับ API Token:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>เข้าสู่ระบบ Zendesk ของคุณ</li>
            <li>ไปที่ Admin Center &rarr; Apps and integrations &rarr; APIs &rarr; Zendesk API</li>
            <li>เปิดใช้งาน Token Access แล้วกด Add API token</li>
            <li>คัดลอก token มาวางด้านล่าง</li>
          </ol>
        </div>

        {/* Email input */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            อีเมล Zendesk
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
          />
        </div>

        {/* API Token input */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            API Token
          </label>
          <input
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxx"
            className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow font-mono"
          />
        </div>

        {/* Polite Particle select */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            คำลงท้าย (สรรพนาม)
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setPoliteParticle('ค่ะ')}
              className={`flex-1 py-2.5 text-sm font-medium rounded-lg border transition-colors ${
                politeParticle === 'ค่ะ'
                  ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                  : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              ค่ะ <span className="text-xs text-slate-400">(ผู้หญิง)</span>
            </button>
            <button
              type="button"
              onClick={() => setPoliteParticle('ครับ')}
              className={`flex-1 py-2.5 text-sm font-medium rounded-lg border transition-colors ${
                politeParticle === 'ครับ'
                  ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                  : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              ครับ <span className="text-xs text-slate-400">(ผู้ชาย)</span>
            </button>
          </div>
        </div>

        {/* Error / Success messages */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-sm text-emerald-700">
            {success}
          </div>
        )}

        {/* Connect button */}
        <button
          type="button"
          onClick={handleConnect}
          disabled={connecting}
          className="w-full py-2.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {connecting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              กำลังเชื่อมต่อ...
            </>
          ) : (
            <>
              <Link2 className="w-4 h-4" />
              เชื่อมต่อ
            </>
          )}
        </button>
      </div>
    </div>
  );
}
