-- Add customer info fields to zendesk_analyses for followup tracking
ALTER TABLE zendesk_analyses ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE zendesk_analyses ADD COLUMN IF NOT EXISTS customer_phone text;
ALTER TABLE zendesk_analyses ADD COLUMN IF NOT EXISTS interested_procedure text;
ALTER TABLE zendesk_analyses ADD COLUMN IF NOT EXISTS customer_age integer;
