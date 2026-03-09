'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { MessageSquare } from 'lucide-react';
import ZendeskTicketList from './ZendeskTicketList';
import ZendeskChatPanel from './ZendeskChatPanel';
import AISuggestPanel from './AISuggestPanel';

interface Ticket {
  ticket_id: number;
  subject: string;
  status: string;
  requester_name: string;
  channel: string;
  last_customer_comment_at: string | null;
  last_agent_comment_at: string | null;
  is_read: boolean;
  assignee_email: string | null;
  tags: string[];
  preview: string | null;
}

type TicketFilter = 'mine' | 'all' | 'waiting';

export default function ZendeskChatLayout({ user, profile, locale = 'th' }: { user: any; profile: any; locale?: 'ko' | 'th' }) {
  // Admin/client see all tickets by default; workers see their own
  const defaultFilter: TicketFilter = profile?.role === 'worker' ? 'mine' : 'all';
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState<TicketFilter>(defaultFilter);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [injectedReply, setInjectedReply] = useState<string | null>(null);
  const selectedTicketIdRef = useRef(selectedTicketId);
  selectedTicketIdRef.current = selectedTicketId;

  const getSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  }, []);

  const fetchTickets = useCallback(async (pageNum: number = 1) => {
    try {
      const session = await getSession();
      if (!session) return;
      if (pageNum > 1) setLoadingMore(true);

      const res = await fetch(`/api/zendesk/tickets-live?filter=${filter}&page=${pageNum}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        console.error('[ZendeskChat] Failed to fetch tickets:', res.status);
        return;
      }

      const data = await res.json();
      const newTickets = data.tickets || [];

      if (pageNum === 1) {
        setTickets(newTickets);
      } else {
        setTickets(prev => {
          const existingIds = new Set(prev.map(t => t.ticket_id));
          const unique = newTickets.filter((t: any) => !existingIds.has(t.ticket_id));
          return [...prev, ...unique];
        });
      }
      setPage(pageNum);
      setHasMore(newTickets.length >= 20);
    } catch (err) {
      console.error('[ZendeskChat] Error fetching tickets:', err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filter, getSession]);

  useEffect(() => {
    setLoading(true);
    fetchTickets();
  }, [fetchTickets]);

  // Supabase Realtime: subscribe to zendesk_conversations INSERT events
  useEffect(() => {
    const channel = supabase
      .channel('zendesk_chat_realtime_' + user.id)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'zendesk_conversations' },
        (payload) => {
          const row = payload.new as any;
          if (row.ticket_id === selectedTicketIdRef.current) {
            // Current ticket — ZendeskChatPanel handles its own realtime
            return;
          }
          // Other ticket — update unread in ticket list
          setTickets((prev) =>
            prev.map((t) =>
              t.ticket_id === row.ticket_id ? { ...t, is_read: false } : t
            )
          );
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [user.id]);

  const handleLoadMore = useCallback(() => {
    if (!loadingMore && hasMore) {
      fetchTickets(page + 1);
    }
  }, [fetchTickets, page, loadingMore, hasMore]);

  const handleSelectTicket = (ticketId: number) => {
    setSelectedTicketId(ticketId);
    setShowChat(true);
    // Mark selected ticket as read in local state
    setTickets((prev) =>
      prev.map((t) => (t.ticket_id === ticketId ? { ...t, is_read: true } : t))
    );
  };

  const handleBack = () => {
    setShowChat(false);
  };

  const handleTicketUpdate = () => {
    // Re-fetch tickets when a ticket status changes
    fetchTickets();
  };

  return (
    <div
      className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden"
      style={{ height: 'calc(100vh - 220px)', minHeight: '500px' }}
    >
      <div className="flex h-full">
        {/* Ticket List — always visible on desktop, toggleable on mobile */}
        <div className={`w-full md:w-72 md:shrink-0 md:block ${showChat ? 'hidden' : 'block'}`}>
          <ZendeskTicketList
            tickets={tickets}
            selectedTicketId={selectedTicketId}
            onSelect={handleSelectTicket}
            filter={filter}
            onFilterChange={setFilter}
            loading={loading}
            locale={locale}
            hasMore={hasMore}
            onLoadMore={handleLoadMore}
            loadingMore={loadingMore}
          />
        </div>

        {/* Chat Panel — always visible on desktop, toggleable on mobile */}
        <div className={`flex-1 min-w-0 md:block ${showChat ? 'block' : 'hidden'}`}>
          {selectedTicketId ? (
            <ZendeskChatPanel
              key={selectedTicketId}
              ticketId={selectedTicketId}
              user={user}
              profile={profile}
              onBack={handleBack}
              onTicketUpdate={handleTicketUpdate}
              injectedReply={injectedReply}
              onInjectedReplyConsumed={() => setInjectedReply(null)}
              locale={locale}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3">
              <MessageSquare className="w-10 h-10 text-slate-300" />
              <p className="text-sm">{locale === 'ko' ? '티켓을 선택하세요' : 'เลือกตั๋วเพื่อเริ่มแชท'}</p>
            </div>
          )}
        </div>

        {/* AI Suggest Panel — desktop only, collapsible */}
        <div className="hidden lg:block w-72 shrink-0 border-l border-slate-200 overflow-y-auto bg-slate-50">
          <AISuggestPanel
            ticketId={selectedTicketId}
            onUseReply={(text) => setInjectedReply(text)}
            user={user}
            locale={locale}
          />
        </div>
      </div>
    </div>
  );
}
