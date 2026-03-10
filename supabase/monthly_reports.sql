-- Monthly Reports: 월간 보고서 데이터
CREATE TABLE IF NOT EXISTS monthly_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_tag TEXT NOT NULL,
  report_month TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'generating', 'review', 'published')),
  ad_csv_url TEXT,
  ad_csv_filename TEXT,
  ad_parsed_data JSONB,
  ad_summary TEXT,
  consultation_data JSONB,
  consultation_summary TEXT,
  content_plan JSONB NOT NULL DEFAULT '{"photo":{"promised":12,"actual":null,"next_month":null},"reels":{"promised":3,"actual":null,"next_month":null},"reviewer":{"promised":2,"actual":null,"next_month":null}}'::jsonb,
  strategy_current TEXT,
  strategy_next TEXT,
  hospital_requests TEXT,
  sales_focus TEXT,
  generated_by UUID REFERENCES auth.users(id),
  published_by UUID REFERENCES auth.users(id),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(hospital_tag, report_month)
);

CREATE INDEX IF NOT EXISTS idx_mr_hospital_month ON monthly_reports(hospital_tag, report_month DESC);
CREATE INDEX IF NOT EXISTS idx_mr_status ON monthly_reports(status);

ALTER TABLE monthly_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on monthly_reports"
  ON monthly_reports FOR ALL USING (true) WITH CHECK (true);

-- Hospital Content Config: 병원별 콘텐츠 약속 수량
CREATE TABLE IF NOT EXISTS hospital_content_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_tag TEXT NOT NULL UNIQUE,
  photo_promised INTEGER NOT NULL DEFAULT 12,
  reels_promised INTEGER NOT NULL DEFAULT 3,
  reviewer_promised INTEGER NOT NULL DEFAULT 2,
  custom_items JSONB DEFAULT '[]'::jsonb,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE hospital_content_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on hospital_content_config"
  ON hospital_content_config FOR ALL USING (true) WITH CHECK (true);
