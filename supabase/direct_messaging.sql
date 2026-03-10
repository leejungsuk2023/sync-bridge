-- Direct Messaging Integration: replaces Zendesk with native LINE / Facebook Messenger support.
-- Includes unified customer identity, conversation tracking, AI suggestions, webhook logging.
-- Run this after zendesk_chat_integration.sql.

-- ============================================================
-- 1. messaging_channels: LINE / Facebook channel configurations
-- ============================================================
CREATE TABLE IF NOT EXISTS messaging_channels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('line', 'facebook')),
  channel_name TEXT NOT NULL,
  config JSONB,                         -- encrypted tokens, page IDs, etc.
  is_active BOOLEAN DEFAULT true,
  hospital_prefix TEXT,                 -- NULL for LINE (one global account); set per FB page
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (channel_type, channel_name)
);

-- ============================================================
-- 2. customers: unified customer identity across channels
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  display_name TEXT,
  avatar_url TEXT,
  phone TEXT,
  email TEXT,
  line_user_id TEXT UNIQUE,
  facebook_user_id TEXT UNIQUE,
  language TEXT DEFAULT 'th',
  first_contact_at TIMESTAMPTZ,
  last_contact_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_line_user ON customers(line_user_id);
CREATE INDEX IF NOT EXISTS idx_customers_fb_user ON customers(facebook_user_id);

-- ============================================================
-- 3. conversations: replaces zendesk_tickets
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(id),
  channel_id UUID NOT NULL REFERENCES messaging_channels(id),
  channel_type TEXT NOT NULL,           -- denormalized from messaging_channels for query perf
  external_thread_id TEXT,
  subject TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('new', 'open', 'pending', 'solved', 'closed')),
  priority TEXT CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_agent_id UUID REFERENCES auth.users(id),
  hospital_prefix TEXT,                 -- derived from channel for FB pages; NULL for LINE
  tags TEXT[] DEFAULT '{}',
  last_message_at TIMESTAMPTZ,
  last_customer_message_at TIMESTAMPTZ,
  last_agent_message_at TIMESTAMPTZ,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_customer ON conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_conv_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conv_channel_type ON conversations(channel_type);
CREATE INDEX IF NOT EXISTS idx_conv_agent ON conversations(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_conv_last_message ON conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_hospital ON conversations(hospital_prefix);
CREATE INDEX IF NOT EXISTS idx_conv_tags ON conversations USING GIN (tags);

-- ============================================================
-- 4. messages: replaces zendesk_conversations
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer', 'agent', 'system', 'bot')),
  sender_customer_id UUID REFERENCES customers(id),
  sender_agent_id UUID REFERENCES auth.users(id),
  sender_name TEXT,
  message_type TEXT DEFAULT 'text' CHECK (message_type IN (
    'text', 'image', 'file', 'sticker', 'video', 'audio', 'location', 'template', 'system'
  )),
  body TEXT,
  body_ko TEXT,                         -- Korean translation cache
  body_html TEXT,
  media_url TEXT,
  media_type TEXT,
  media_metadata JSONB,
  attachments JSONB,
  external_message_id TEXT,
  is_public BOOLEAN DEFAULT true,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_external_id ON messages(external_message_id);

-- ============================================================
-- 5. conversation_analyses: replaces zendesk_analyses
-- ============================================================
CREATE TABLE IF NOT EXISTS conversation_analyses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID UNIQUE NOT NULL REFERENCES conversations(id),
  customer_id UUID REFERENCES customers(id),
  quality_score INTEGER CHECK (quality_score BETWEEN 1 AND 5),
  reservation_converted BOOLEAN DEFAULT false,
  needs_followup BOOLEAN DEFAULT false,
  followup_reason TEXT,
  followup_reason_th TEXT,
  interested_procedure TEXT,
  interested_procedure_th TEXT,
  summary TEXT,
  issues TEXT[],
  hospital_name TEXT,
  followup_status TEXT DEFAULT 'pending',
  followup_check_count INTEGER DEFAULT 0,
  analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 6. ai_suggestions: replaces ai_reply_suggestions
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_suggestions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  trigger_message_id UUID REFERENCES messages(id),
  suggestions JSONB NOT NULL,
  context_used JSONB,
  model_version TEXT DEFAULT 'gemini-2.5-flash',
  selected_index INTEGER,
  was_edited BOOLEAN,
  final_text TEXT,
  used_at TIMESTAMPTZ,
  response_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_suggestions_conversation ON ai_suggestions(conversation_id);

-- ============================================================
-- 7. webhook_log: replaces zendesk_webhook_log
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_type TEXT NOT NULL,
  event_type TEXT,
  external_id TEXT,
  payload JSONB NOT NULL,
  processed BOOLEAN DEFAULT false,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_log_channel ON webhook_log(channel_type, created_at);

-- ============================================================
-- 8. RLS policies
-- ============================================================

-- messaging_channels
ALTER TABLE messaging_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on messaging_channels"
  ON messaging_channels FOR ALL
  USING (true) WITH CHECK (true);

-- customers
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on customers"
  ON customers FOR ALL
  USING (true) WITH CHECK (true);

-- conversations
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on conversations"
  ON conversations FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read conversations"
  ON conversations FOR SELECT
  TO authenticated
  USING (true);

-- messages
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on messages"
  ON messages FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read messages"
  ON messages FOR SELECT
  TO authenticated
  USING (true);

-- conversation_analyses
ALTER TABLE conversation_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on conversation_analyses"
  ON conversation_analyses FOR ALL
  USING (true) WITH CHECK (true);

-- ai_suggestions
ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on ai_suggestions"
  ON ai_suggestions FOR ALL
  USING (true) WITH CHECK (true);

-- webhook_log
ALTER TABLE webhook_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on webhook_log"
  ON webhook_log FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================================
-- 9. Supabase Realtime
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;

-- ============================================================
-- 10. Seed data: messaging_channels (1 LINE + 16 Facebook)
-- ============================================================
INSERT INTO messaging_channels (channel_type, channel_name, is_active, hospital_prefix) VALUES
  -- LINE Official Account (single shared account, no hospital_prefix)
  ('line',     'LINE Official',      true, NULL),

  -- Facebook pages, one per hospital
  ('facebook', 'TheBB Facebook',       true, 'thebb'),
  ('facebook', 'Delphic Facebook',     true, 'delphic'),
  ('facebook', 'Will Facebook',        true, 'will'),
  ('facebook', 'Mik Clinic Facebook',  true, 'mikclinicthai'),
  ('facebook', 'JY Clinic Facebook',   true, 'jyclinicthai'),
  ('facebook', 'DU Facebook',          true, 'du'),
  ('facebook', 'Korean Diet Facebook', true, 'koreandiet'),
  ('facebook', 'OurP Facebook',        true, 'ourpthai'),
  ('facebook', 'EverBreast Facebook',  true, 'everbreastthai'),
  ('facebook', 'Clyveps Facebook',     true, 'clyveps_th'),
  ('facebook', 'MyCell Facebook',      true, 'mycell'),
  ('facebook', 'NBC Clinic Facebook',  true, 'nbclinici'),
  ('facebook', 'Dr.Song Facebook',     true, 'dr.song'),
  ('facebook', 'Lacela Facebook',      true, 'lacela'),
  ('facebook', 'Artline Facebook',     true, 'artline'),
  ('facebook', 'Kleam Facebook',       true, 'kleam')
ON CONFLICT (channel_type, channel_name) DO NOTHING;
