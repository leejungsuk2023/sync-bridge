'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface QuickReply {
  id: string;
  title_th: string;
  body_th: string;
}

interface QuickReplyChipsProps {
  onSelect: (text: string) => void;
}

export default function QuickReplyChips({ onSelect }: QuickReplyChipsProps) {
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchReplies = async () => {
      try {
        const { data, error } = await supabase
          .from('quick_replies')
          .select('id, title_th, body_th')
          .limit(10);

        if (error) {
          console.error('[QuickReply] Failed to fetch:', error.message);
          return;
        }

        setReplies(data || []);
      } catch (err) {
        console.error('[QuickReply] Fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchReplies();
  }, []);

  const handleSelect = (reply: QuickReply) => {
    onSelect(reply.body_th);
  };

  if (loading || replies.length === 0) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-slate-500">📋 คำตอบด่วน</h4>
      <div className="flex overflow-x-auto gap-2 pb-1">
        {replies.map((reply) => (
          <button
            key={reply.id}
            onClick={() => handleSelect(reply)}
            className="shrink-0 rounded-full bg-gray-100 hover:bg-indigo-100 px-3 py-1 text-sm text-slate-700 cursor-pointer transition-colors whitespace-nowrap"
          >
            {reply.title_th}
          </button>
        ))}
      </div>
    </div>
  );
}
