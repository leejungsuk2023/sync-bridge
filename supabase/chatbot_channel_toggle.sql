ALTER TABLE messaging_channels ADD COLUMN IF NOT EXISTS chatbot_enabled BOOLEAN DEFAULT false;
