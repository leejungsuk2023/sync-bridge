'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { MessageSquare, Bot } from 'lucide-react';
import ConversationList, { type Conversation } from './ConversationList';
import MessagePanel from './MessagePanel';
import AISuggestPanel from './AISuggestPanel';

// ─── Channel chatbot toggle bar types ─────────────────────────────
interface ChannelInfo {
  id: string;
  channel_type: 'line' | 'facebook' | string;
  chatbot_enabled: boolean;
}

type ConversationFilter = 'mine' | 'all' | 'waiting' | 'payment_confirmed';
type ChannelFilter = 'all' | 'line' | 'facebook';

export default function MessagingLayout({
  userRole,
  userId,
  locale = 'th',
}: {
  userRole: string;
  userId: string;
  locale?: 'ko' | 'th';
}) {
  // Admin/client see all conversations by default; workers see their own
  const defaultFilter: ConversationFilter = userRole === 'worker' ? 'mine' : 'all';
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [filter, setFilter] = useState<ConversationFilter>(defaultFilter);
  const [hospitalFilter, setHospitalFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [injectedReply, setInjectedReply] = useState<string | null>(null);
  // Bump this to force a re-sort in the conversation list (e.g. on filter/hospital/channel change)
  const [sortEpoch, setSortEpoch] = useState(0);
  const selectedConversationIdRef = useRef(selectedConversationId);
  selectedConversationIdRef.current = selectedConversationId;

  const getSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  }, []);

  // ─── Channel-level chatbot toggle state ───────────────────────
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [lineToggleLoading, setLineToggleLoading] = useState(false);
  const [facebookToggleLoading, setFacebookToggleLoading] = useState(false);

  // Fetch all channels on mount (staff/bbg_admin only)
  useEffect(() => {
    if (userRole !== 'staff' && userRole !== 'bbg_admin') return;
    const fetchChannels = async () => {
      try {
        const session = await getSession();
        if (!session) return;
        const res = await fetch('/api/channels/chatbot-toggle', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) {
          console.error('[MessagingLayout] Failed to fetch channels:', res.status);
          return;
        }
        const data = await res.json();
        setChannels(data.channels || []);
      } catch (err) {
        console.error('[MessagingLayout] Error fetching channels:', err);
      }
    };
    fetchChannels();
  }, [userRole, getSession]);

  const lineChannels = channels.filter(c => c.channel_type === 'line');
  const facebookChannels = channels.filter(c => c.channel_type === 'facebook');
  const lineAllOn = lineChannels.length > 0 && lineChannels.every(c => c.chatbot_enabled);
  const facebookAllOn = facebookChannels.length > 0 && facebookChannels.every(c => c.chatbot_enabled);

  const handleLineToggle = async () => {
    if (lineToggleLoading || lineChannels.length === 0) return;
    setLineToggleLoading(true);
    try {
      const session = await getSession();
      if (!session) return;
      const newValue = !lineAllOn;
      await Promise.all(
        lineChannels.map(ch =>
          fetch('/api/channels/chatbot-toggle', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ channel_id: ch.id, chatbot_enabled: newValue }),
          })
        )
      );
      setChannels(prev =>
        prev.map(c => c.channel_type === 'line' ? { ...c, chatbot_enabled: newValue } : c)
      );
      console.log(`[MessagingLayout] LINE chatbot ${newValue ? 'enabled' : 'disabled'} for all LINE channels`);
    } catch (err) {
      console.error('[MessagingLayout] Failed to toggle LINE chatbot:', err);
    } finally {
      setLineToggleLoading(false);
    }
  };

  const handleFacebookToggle = async () => {
    if (facebookToggleLoading || facebookChannels.length === 0) return;
    setFacebookToggleLoading(true);
    try {
      const session = await getSession();
      if (!session) return;
      const newValue = !facebookAllOn;
      await Promise.all(
        facebookChannels.map(ch =>
          fetch('/api/channels/chatbot-toggle', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ channel_id: ch.id, chatbot_enabled: newValue }),
          })
        )
      );
      setChannels(prev =>
        prev.map(c => c.channel_type === 'facebook' ? { ...c, chatbot_enabled: newValue } : c)
      );
      console.log(`[MessagingLayout] Facebook chatbot ${newValue ? 'enabled' : 'disabled'} for all Facebook channels`);
    } catch (err) {
      console.error('[MessagingLayout] Failed to toggle Facebook chatbot:', err);
    } finally {
      setFacebookToggleLoading(false);
    }
  };

  const fetchConversations = useCallback(async (pageNum: number = 1) => {
    try {
      const session = await getSession();
      if (!session) return;
      if (pageNum > 1) setLoadingMore(true);

      const hospitalParam = hospitalFilter ? `&hospital=${encodeURIComponent(hospitalFilter)}` : '';
      const channelParam = channelFilter !== 'all' ? `&channel=${encodeURIComponent(channelFilter)}` : '';
      const res = await fetch(
        `/api/messaging/conversations?filter=${filter}&page=${pageNum}${hospitalParam}${channelParam}`,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }
      );

      if (!res.ok) {
        console.error('[MessagingLayout] Failed to fetch conversations:', res.status);
        return;
      }

      const data = await res.json();
      const newConversations: Conversation[] = data.conversations || [];

      if (pageNum === 1) {
        // Merge strategy: update existing conversations in-place, prepend truly new ones.
        // This preserves the user's visual order during polling.
        setConversations(prev => {
          if (prev.length === 0) {
            // First load — just set directly
            return newConversations;
          }
          const merged: Conversation[] = [];
          const seenIds = new Set<string>();

          // Keep existing conversations in their current order, update their data
          for (const old of prev) {
            const fresh = newConversations.find(c => c.id === old.id);
            if (fresh) {
              merged.push(fresh);
              seenIds.add(fresh.id);
            } else {
              // If conversation disappeared from API response, still keep it
              // (it may have been filtered out server-side, but removing mid-scroll is jarring)
              merged.push(old);
              seenIds.add(old.id);
            }
          }

          // Prepend truly new conversations (not seen before) at the top
          const brandNew = newConversations.filter(c => !seenIds.has(c.id));
          return [...brandNew, ...merged];
        });
      } else {
        setConversations(prev => {
          const existingIds = new Set(prev.map(c => c.id));
          const unique = newConversations.filter((c: Conversation) => !existingIds.has(c.id));
          return [...prev, ...unique];
        });
      }
      setPage(pageNum);
      setHasMore(newConversations.length >= 20);
    } catch (err) {
      console.error('[MessagingLayout] Error fetching conversations:', err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filter, hospitalFilter, channelFilter, getSession]);

  useEffect(() => {
    setLoading(true);
    setConversations([]); // Clear stale conversations when filter/hospital/channel changes
    setSortEpoch(e => e + 1);
    fetchConversations();
  }, [fetchConversations]);

  // Periodic polling: refresh conversation list every 30 seconds as fallback
  useEffect(() => {
    const interval = setInterval(() => {
      fetchConversations();
    }, 30_000);
    return () => clearInterval(interval);
  }, [fetchConversations]);

  // Supabase Realtime: subscribe to messages table INSERT events
  useEffect(() => {
    const realtimeChannel = supabase
      .channel('messaging_realtime_' + userId)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'channel_messages' },
        (payload) => {
          const row = payload.new as any;
          if (row.conversation_id === selectedConversationIdRef.current) {
            // Current conversation — MessagePanel handles its own realtime
            return;
          }
          // Other conversation — move to top, mark unread, update preview
          setConversations((prev) => {
            const idx = prev.findIndex(c => c.id === row.conversation_id);
            if (idx === -1) {
              // Unknown conversation — trigger a full refresh
              fetchConversations();
              return prev;
            }
            const updated = {
              ...prev[idx],
              is_read: false,
              last_message_at: row.created_at ?? prev[idx].last_message_at,
              last_message_preview: row.body ?? prev[idx].last_message_preview,
            };
            const rest = prev.filter((_, i) => i !== idx);
            return [updated, ...rest];
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'channel_conversations' },
        (payload) => {
          const row = payload.new as any;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === row.id
                ? {
                    ...c,
                    status: row.status ?? c.status,
                    assigned_agent_id: row.assignee_id ?? c.assigned_agent_id,
                    last_message_at: row.last_message_at ?? c.last_message_at,
                    is_read: row.is_read ?? c.is_read,
                  }
                : c
            )
          );
        }
      )
      .subscribe();

    return () => {
      realtimeChannel.unsubscribe();
    };
  }, [userId, fetchConversations]);

  const handleLoadMore = useCallback(() => {
    if (!loadingMore && hasMore) {
      fetchConversations(page + 1);
    }
  }, [fetchConversations, page, loadingMore, hasMore]);

  const handleSelectConversation = async (conversationId: string) => {
    setSelectedConversationId(conversationId);
    setShowPanel(true);
    // Mark selected conversation as read in local state
    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId ? { ...c, is_read: true } : c))
    );
    // Persist read status to API
    try {
      const session = await getSession();
      if (session) {
        fetch(`/api/messaging/read`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ conversation_id: conversationId }),
        });
      }
    } catch {}
  };

  const handleBack = () => {
    setShowPanel(false);
  };

  const handleConversationUpdate = () => {
    // Re-fetch conversations when a conversation status changes
    fetchConversations();
  };

  return (
    <div
      className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden"
      style={{ height: 'calc(100vh - 220px)', minHeight: '500px' }}
    >
      {/* ── Channel-level AI chatbot toggle bar (staff/bbg_admin only) ── */}
      {(userRole === 'staff' || userRole === 'bbg_admin') && (lineChannels.length > 0 || facebookChannels.length > 0) && (
        <div className="shrink-0 bg-slate-50 border-b border-slate-200 px-4 py-2 flex items-center gap-3">
          <Bot className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="text-xs text-slate-500 font-medium mr-1">AI 챗봇:</span>

          {/* LINE toggle */}
          {lineChannels.length > 0 && (
            <button
              type="button"
              onClick={handleLineToggle}
              disabled={lineToggleLoading}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors disabled:opacity-50 ${
                lineAllOn ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-600'
              }`}
              title={lineAllOn ? 'LINE AI 챗봇 끄기' : 'LINE AI 챗봇 켜기'}
            >
              {lineToggleLoading ? (
                <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <span
                  className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-white text-[9px] font-bold shrink-0"
                  style={{ background: lineAllOn ? 'rgba(255,255,255,0.3)' : '#06C755' }}
                >
                  L
                </span>
              )}
              LINE AI 챗봇
            </button>
          )}

          {/* Facebook toggle */}
          {facebookChannels.length > 0 && (
            <button
              type="button"
              onClick={handleFacebookToggle}
              disabled={facebookToggleLoading}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors disabled:opacity-50 ${
                facebookAllOn ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-600'
              }`}
              title={facebookAllOn ? 'Facebook AI 챗봇 끄기' : 'Facebook AI 챗봇 켜기'}
            >
              {facebookToggleLoading ? (
                <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <span
                  className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-white text-[9px] font-bold shrink-0"
                  style={{ background: facebookAllOn ? 'rgba(255,255,255,0.3)' : 'linear-gradient(135deg, #1877f2, #42a5f5)' }}
                >
                  f
                </span>
              )}
              Facebook AI 챗봇
            </button>
          )}
        </div>
      )}

      <div className="flex h-full">
        {/* Conversation List — always visible on desktop, toggleable on mobile */}
        <div className={`w-full md:w-72 md:shrink-0 md:block ${showPanel ? 'hidden' : 'block'}`}>
          <ConversationList
            conversations={conversations}
            selectedConversationId={selectedConversationId}
            onSelect={handleSelectConversation}
            filter={filter}
            onFilterChange={setFilter}
            channelFilter={channelFilter}
            onChannelFilterChange={setChannelFilter}
            loading={loading}
            locale={locale}
            hasMore={hasMore}
            onLoadMore={handleLoadMore}
            loadingMore={loadingMore}
            hospital={hospitalFilter}
            onHospitalChange={setHospitalFilter}
            sortEpoch={sortEpoch}
          />
        </div>

        {/* Message Panel — always visible on desktop, toggleable on mobile */}
        <div className={`flex-1 min-w-0 md:block ${showPanel ? 'block' : 'hidden'}`}>
          {selectedConversationId ? (
            <MessagePanel
              key={selectedConversationId}
              conversationId={selectedConversationId}
              userId={userId}
              userRole={userRole}
              onBack={handleBack}
              onConversationUpdate={handleConversationUpdate}
              injectedReply={injectedReply}
              onInjectedReplyConsumed={() => setInjectedReply(null)}
              locale={locale}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3">
              <MessageSquare className="w-10 h-10 text-slate-300" />
              <p className="text-sm">
                {locale === 'ko' ? '대화를 선택하세요' : 'เลือกการสนทนาเพื่อเริ่มแชท'}
              </p>
            </div>
          )}
        </div>

        {/* Right Panel — AI Suggest, desktop only */}
        <div className="hidden lg:block w-72 shrink-0 border-l border-slate-200 overflow-y-auto bg-slate-50">
          <AISuggestPanel
            ticketId={null}
            conversationId={selectedConversationId || null}
            onUseReply={(text) => setInjectedReply(text)}
            user={{ id: userId }}
            locale={locale}
          />
        </div>
      </div>
    </div>
  );
}
