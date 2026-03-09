-- Zendesk Chat Integration: agent auth tokens, realtime conversations,
-- AI reply suggestions, webhook logging, and related schema changes.
-- Run this after followup_tracking.sql.

-- ============================================================
-- 1. zendesk_agent_tokens: per-agent Zendesk API credentials
-- ============================================================
CREATE TABLE IF NOT EXISTS zendesk_agent_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  zendesk_email TEXT NOT NULL,
  zendesk_user_id BIGINT NOT NULL,
  encrypted_token TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_zat_user ON zendesk_agent_tokens(user_id);

-- ============================================================
-- 2. zendesk_conversations: individual chat messages (realtime)
-- ============================================================
CREATE TABLE IF NOT EXISTS zendesk_conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id BIGINT NOT NULL,
  comment_id BIGINT UNIQUE NOT NULL,
  author_type TEXT NOT NULL,  -- 'customer' | 'agent' | 'system'
  author_name TEXT,
  author_email TEXT,
  author_zendesk_id BIGINT,
  body TEXT NOT NULL,
  body_html TEXT,
  is_public BOOLEAN DEFAULT true,
  channel TEXT,
  attachments JSONB,
  created_at_zd TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zc_ticket ON zendesk_conversations(ticket_id, created_at_zd);
CREATE INDEX IF NOT EXISTS idx_zc_comment ON zendesk_conversations(comment_id);

-- ============================================================
-- 3. ai_reply_suggestions: AI-recommended reply options
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_reply_suggestions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id BIGINT NOT NULL,
  trigger_comment_id BIGINT,
  suggestions JSONB NOT NULL,
  context_used JSONB,
  model_version TEXT DEFAULT 'gemini-2.5-flash',
  selected_index INTEGER,
  was_edited BOOLEAN,
  final_text TEXT,
  response_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ars_ticket ON ai_reply_suggestions(ticket_id);

-- ============================================================
-- 4. zendesk_webhook_log: webhook debugging + deduplication
-- ============================================================
CREATE TABLE IF NOT EXISTS zendesk_webhook_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id BIGINT NOT NULL,
  comment_id BIGINT,
  payload JSONB NOT NULL,
  processed BOOLEAN DEFAULT false,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zwl_ticket ON zendesk_webhook_log(ticket_id, created_at);

-- ============================================================
-- 5. Alter zendesk_tickets: realtime tracking columns
-- ============================================================
ALTER TABLE zendesk_tickets
  ADD COLUMN IF NOT EXISTS last_customer_comment_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_agent_comment_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_agent_user_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS channel TEXT,
  ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_webhook_at TIMESTAMPTZ;

-- ============================================================
-- 6. Alter profiles: zendesk connection + polite particle
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS zendesk_connected BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS polite_particle TEXT DEFAULT 'ค่ะ' CHECK (polite_particle IN ('ค่ะ', 'ครับ'));

-- ============================================================
-- 7. RLS policies
-- ============================================================

-- zendesk_agent_tokens: users can read their own row, service role full
ALTER TABLE zendesk_agent_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own agent token"
  ON zendesk_agent_tokens FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on zendesk_agent_tokens"
  ON zendesk_agent_tokens FOR ALL
  USING (true) WITH CHECK (true);

-- zendesk_conversations: worker + bbg_admin access
ALTER TABLE zendesk_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on zendesk_conversations"
  ON zendesk_conversations FOR ALL
  USING (true) WITH CHECK (true);

-- ai_reply_suggestions: worker + bbg_admin access
ALTER TABLE ai_reply_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on ai_reply_suggestions"
  ON ai_reply_suggestions FOR ALL
  USING (true) WITH CHECK (true);

-- zendesk_webhook_log: service role only
ALTER TABLE zendesk_webhook_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on zendesk_webhook_log"
  ON zendesk_webhook_log FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================================
-- 8. Enable Supabase Realtime on zendesk_conversations
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE zendesk_conversations;
