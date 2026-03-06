-- Add followup tracking columns to zendesk_analyses
ALTER TABLE zendesk_analyses ADD COLUMN IF NOT EXISTS followup_status text DEFAULT 'pending';
ALTER TABLE zendesk_analyses ADD COLUMN IF NOT EXISTS followup_note text;
ALTER TABLE zendesk_analyses ADD COLUMN IF NOT EXISTS followup_updated_by uuid REFERENCES profiles(id);
ALTER TABLE zendesk_analyses ADD COLUMN IF NOT EXISTS followup_updated_at timestamptz;
