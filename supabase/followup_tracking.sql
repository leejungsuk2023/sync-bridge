-- Followup tracking system: add columns and new tables
-- Run this after followup_status.sql and zendesk_customer_fields.sql

-- Add cycle control columns to zendesk_analyses
ALTER TABLE zendesk_analyses
  ADD COLUMN IF NOT EXISTS next_check_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_zendesk_comment_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS check_count INTEGER DEFAULT 0;

ALTER TABLE zendesk_analyses
  ADD COLUMN IF NOT EXISTS lost_reason TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lost_reason_detail TEXT DEFAULT NULL;

-- followup_actions: tracks worker actions, AI instructions, and system notes
CREATE TABLE IF NOT EXISTS followup_actions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id BIGINT NOT NULL,
  action_type TEXT NOT NULL,  -- 'worker_action' | 'ai_instruction' | 'system_note'
  content TEXT NOT NULL,
  content_th TEXT,
  status_before TEXT,
  status_after TEXT,
  zendesk_changes JSONB,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_followup_actions_ticket ON followup_actions(ticket_id);
CREATE INDEX IF NOT EXISTS idx_followup_actions_unread ON followup_actions(created_by, read_at)
  WHERE action_type = 'ai_instruction' AND read_at IS NULL;

-- followup_notifications: in-app (and future LINE/email) notifications
CREATE TABLE IF NOT EXISTS followup_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  action_id UUID NOT NULL REFERENCES followup_actions(id),
  ticket_id BIGINT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  channel TEXT DEFAULT 'in_app',
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_followup_notif_user ON followup_notifications(user_id, read_at)
  WHERE read_at IS NULL;

-- RLS policies
ALTER TABLE followup_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_notifications ENABLE ROW LEVEL SECURITY;

-- Service role has full access (API routes use service role key)
CREATE POLICY "Service role full access on followup_actions" ON followup_actions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on followup_notifications" ON followup_notifications FOR ALL USING (true) WITH CHECK (true);
