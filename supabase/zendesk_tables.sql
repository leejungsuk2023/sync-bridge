-- Zendesk ticket data for Sales Performance Tracking
CREATE TABLE IF NOT EXISTS zendesk_tickets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id bigint UNIQUE NOT NULL,
  subject text,
  description text,
  status text,
  priority text,
  assignee_email text,
  assignee_name text,
  requester_email text,
  requester_name text,
  group_name text,
  tags text[],
  created_at_zd timestamptz,
  updated_at_zd timestamptz,
  first_response_at timestamptz,
  solved_at timestamptz,
  comments jsonb,
  synced_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- AI analysis results
CREATE TABLE IF NOT EXISTS zendesk_analyses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id bigint UNIQUE NOT NULL,
  quality_score integer CHECK (quality_score BETWEEN 1 AND 5),
  reservation_converted boolean DEFAULT false,
  needs_followup boolean DEFAULT false,
  followup_reason text,
  summary text,
  issues text[],
  hospital_name text,
  analyzed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_zendesk_tickets_status ON zendesk_tickets(status);
CREATE INDEX IF NOT EXISTS idx_zendesk_tickets_assignee ON zendesk_tickets(assignee_email);
CREATE INDEX IF NOT EXISTS idx_zendesk_tickets_created ON zendesk_tickets(created_at_zd);
CREATE INDEX IF NOT EXISTS idx_zendesk_analyses_ticket ON zendesk_analyses(ticket_id);
