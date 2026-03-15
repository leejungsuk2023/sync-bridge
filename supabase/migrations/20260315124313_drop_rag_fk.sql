-- Drop FK constraints on RAG tables so they can store LINE conversation IDs (not just Zendesk ticket IDs)
ALTER TABLE case_conversations DROP CONSTRAINT IF EXISTS case_conversations_ticket_id_fkey;
ALTER TABLE case_index DROP CONSTRAINT IF EXISTS case_index_ticket_id_fkey;
