'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { MessageSquare } from 'lucide-react';
import ConversationList, { type Conversation } from './ConversationList';
import MessagePanel from './MessagePanel';
import AISuggestPanel from './AISuggestPanel';

type ConversationFilter = 'mine' | 'all' | 'waiting';
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
    // Bump sortEpoch so conversation list re-sorts when filter/hospital/channel changes
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
          {/* AISuggestPanel currently expects a numeric Zendesk ticketId.
              It will be adapted to accept a UUID conversationId in a future update.
              Pass null for now so it renders in its empty/idle state. */}
          <AISuggestPanel
            ticketId={null}
            onUseReply={(text) => setInjectedReply(text)}
            user={{ id: userId }}
            locale={locale}
          />
        </div>
      </div>
    </div>
  );
}
