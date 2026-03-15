-- Add payment_confirmed to channel_conversations status check constraint
ALTER TABLE channel_conversations DROP CONSTRAINT IF EXISTS channel_conversations_status_check;
ALTER TABLE channel_conversations ADD CONSTRAINT channel_conversations_status_check
  CHECK (status IN ('new', 'open', 'pending', 'solved', 'closed', 'payment_confirmed'));
