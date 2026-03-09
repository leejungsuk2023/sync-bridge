-- Add Thai translation columns for worker-facing fields
ALTER TABLE zendesk_analyses ADD COLUMN IF NOT EXISTS followup_reason_th text;
ALTER TABLE zendesk_analyses ADD COLUMN IF NOT EXISTS interested_procedure_th text;
