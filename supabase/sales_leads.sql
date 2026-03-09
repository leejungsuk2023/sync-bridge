-- Sales Leads: 고객 상담 → 예약 전환 추적 테이블
-- cs_message_id is intentionally not a FK (messages table structure may vary)

CREATE TABLE IF NOT EXISTS sales_leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id BIGINT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_name_ko TEXT,
  customer_age INTEGER,
  customer_gender TEXT CHECK (customer_gender IN ('male', 'female', 'other')),
  customer_phone TEXT,
  customer_line TEXT,
  customer_instagram TEXT,
  customer_sns_other JSONB,
  procedures TEXT[] NOT NULL DEFAULT '{}',
  procedures_ko TEXT[],
  body_parts TEXT[] DEFAULT '{}',
  body_parts_ko TEXT[],
  reference_photos TEXT[] DEFAULT '{}',
  medical_history TEXT,
  medical_history_ko TEXT,
  allergies TEXT,
  allergies_ko TEXT,
  current_medications TEXT,
  current_medications_ko TEXT,
  medical_confirmed BOOLEAN DEFAULT false,
  budget_thb NUMERIC,
  budget_krw NUMERIC,
  preferred_date TEXT,
  preferred_date_ko TEXT,
  special_notes TEXT,
  special_notes_ko TEXT,
  status TEXT NOT NULL DEFAULT 'collecting'
    CHECK (status IN ('collecting', 'cs_requested', 'quote_sent', 'reserved', 'completed', 'cancelled', 'no_show')),
  collected_by UUID NOT NULL REFERENCES auth.users(id),
  hospital_tag TEXT,
  cs_message_id UUID,
  ai_extraction JSONB,
  ai_confidence NUMERIC,
  extraction_model TEXT DEFAULT 'gemini-2.5-flash',
  collected_at TIMESTAMPTZ DEFAULT NOW(),
  cs_requested_at TIMESTAMPTZ,
  quote_sent_at TIMESTAMPTZ,
  reserved_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sl_ticket ON sales_leads(ticket_id);
CREATE INDEX IF NOT EXISTS idx_sl_status ON sales_leads(status);
CREATE INDEX IF NOT EXISTS idx_sl_collected_by ON sales_leads(collected_by);
CREATE INDEX IF NOT EXISTS idx_sl_hospital ON sales_leads(hospital_tag);
CREATE INDEX IF NOT EXISTS idx_sl_created ON sales_leads(created_at DESC);

ALTER TABLE sales_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on sales_leads"
  ON sales_leads FOR ALL USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE sales_leads;

-- Sales Lead Timeline: 리드 상태 변경 이력
CREATE TABLE IF NOT EXISTS sales_lead_timeline (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_data JSONB,
  status_before TEXT,
  status_after TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slt_lead ON sales_lead_timeline(lead_id, created_at);

ALTER TABLE sales_lead_timeline ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on sales_lead_timeline"
  ON sales_lead_timeline FOR ALL USING (true) WITH CHECK (true);
