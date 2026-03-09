-- Add Korean translation cache to zendesk_conversations
ALTER TABLE zendesk_conversations
  ADD COLUMN IF NOT EXISTS body_ko TEXT;
