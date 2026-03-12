-- Hospital Knowledge Base (KB) Migration
-- 병원 지식 베이스: 병원 정보, 의사, 시술, 프로모션, 성공 케이스
-- Run this migration idempotently (IF NOT EXISTS / ON CONFLICT DO NOTHING)

-- ============================================================
-- TRIGGER FUNCTION: update_updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- TABLE 1: hospital_info — 병원 기본 정보
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hospital_info (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id),           -- nullable (모든 병원이 clients에 있지 않을 수 있음)
  hospital_prefix text UNIQUE NOT NULL,             -- 'thebb', 'delphic'

  -- 기본 정보
  display_name_ko text,           -- '더비비 성형외과'
  display_name_th text,           -- 'โรงพยาบาลเดอะบีบี'
  address_ko text,                -- '서울시 강남구 ...'
  address_th text,
  google_maps_url text,
  phone text,
  website text,
  operating_hours jsonb,          -- {"mon-fri": "09:00-18:00", "sat": "09:00-13:00"}

  -- 메타
  logo_url text,
  description_ko text,            -- 병원 소개 (한국어)
  description_th text,            -- 병원 소개 (태국어)
  specialties text[],             -- ['눈성형', '코성형', '지방흡입']

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.hospital_info ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hospital_info: authenticated read" ON public.hospital_info;
CREATE POLICY "hospital_info: authenticated read"
  ON public.hospital_info FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "hospital_info: admin manage" ON public.hospital_info;
CREATE POLICY "hospital_info: admin manage"
  ON public.hospital_info FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'bbg_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'bbg_admin'
    )
  );

DROP POLICY IF EXISTS "hospital_info: client update own" ON public.hospital_info;
CREATE POLICY "hospital_info: client update own"
  ON public.hospital_info FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'client'
        AND profiles.client_id = hospital_info.client_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'client'
        AND profiles.client_id = hospital_info.client_id
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hospital_info_prefix ON public.hospital_info (hospital_prefix);
CREATE INDEX IF NOT EXISTS idx_hospital_info_client_id ON public.hospital_info (client_id);
CREATE INDEX IF NOT EXISTS idx_hospital_info_specialties ON public.hospital_info USING gin(specialties);

-- Trigger
DROP TRIGGER IF EXISTS set_updated_at ON public.hospital_info;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.hospital_info
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- TABLE 2: hospital_doctors — 원장/의사 정보
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hospital_doctors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospital_info(id) ON DELETE CASCADE,

  name_ko text NOT NULL,          -- '김원장'
  name_th text,                   -- 'คุณหมอคิม'
  title_ko text,                  -- '대표원장'
  title_th text,
  specialties text[],             -- ['눈성형', '코성형']
  bio_ko text,                    -- 경력/소개
  bio_th text,
  photo_url text,

  is_active boolean DEFAULT true,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.hospital_doctors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hospital_doctors: authenticated read" ON public.hospital_doctors;
CREATE POLICY "hospital_doctors: authenticated read"
  ON public.hospital_doctors FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "hospital_doctors: admin manage" ON public.hospital_doctors;
CREATE POLICY "hospital_doctors: admin manage"
  ON public.hospital_doctors FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'bbg_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'bbg_admin'
    )
  );

DROP POLICY IF EXISTS "hospital_doctors: client update own" ON public.hospital_doctors;
CREATE POLICY "hospital_doctors: client update own"
  ON public.hospital_doctors FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.hospital_info h ON h.client_id = p.client_id
      WHERE p.id = auth.uid()
        AND p.role = 'client'
        AND h.id = hospital_doctors.hospital_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.hospital_info h ON h.client_id = p.client_id
      WHERE p.id = auth.uid()
        AND p.role = 'client'
        AND h.id = hospital_doctors.hospital_id
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hospital_doctors_hospital_id ON public.hospital_doctors (hospital_id);
CREATE INDEX IF NOT EXISTS idx_hospital_doctors_specialties ON public.hospital_doctors USING gin(specialties);

-- Trigger
DROP TRIGGER IF EXISTS set_updated_at ON public.hospital_doctors;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.hospital_doctors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- TABLE 3: hospital_procedures — 시술 정보 + 가격
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hospital_procedures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospital_info(id) ON DELETE CASCADE,

  category text NOT NULL,         -- '눈', '코', '지방흡입', '피부', '체형'
  name_ko text NOT NULL,          -- '눈매교정(절개)'
  name_th text,                   -- 'ทำตาสองชั้นแบบกรีด'
  description_ko text,            -- 상세 설명
  description_th text,

  -- 가격 (범위 지원)
  price_min numeric,              -- 최소 가격 (KRW)
  price_max numeric,              -- 최대 가격 (KRW)
  price_currency text DEFAULT 'KRW',  -- 통화 (향후 다중 통화 대비)
  price_note text,                -- '상담 후 결정', '마취비 별도' 등

  -- 참고
  duration_minutes int,           -- 시술 시간
  recovery_days int,              -- 회복 기간
  is_popular boolean DEFAULT false,
  is_active boolean DEFAULT true,

  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.hospital_procedures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hospital_procedures: authenticated read" ON public.hospital_procedures;
CREATE POLICY "hospital_procedures: authenticated read"
  ON public.hospital_procedures FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "hospital_procedures: admin manage" ON public.hospital_procedures;
CREATE POLICY "hospital_procedures: admin manage"
  ON public.hospital_procedures FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'bbg_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'bbg_admin'
    )
  );

DROP POLICY IF EXISTS "hospital_procedures: client update own" ON public.hospital_procedures;
CREATE POLICY "hospital_procedures: client update own"
  ON public.hospital_procedures FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.hospital_info h ON h.client_id = p.client_id
      WHERE p.id = auth.uid()
        AND p.role = 'client'
        AND h.id = hospital_procedures.hospital_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.hospital_info h ON h.client_id = p.client_id
      WHERE p.id = auth.uid()
        AND p.role = 'client'
        AND h.id = hospital_procedures.hospital_id
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hospital_procedures_hospital_id ON public.hospital_procedures (hospital_id);
CREATE INDEX IF NOT EXISTS idx_hospital_procedures_category ON public.hospital_procedures (category);

-- Trigger
DROP TRIGGER IF EXISTS set_updated_at ON public.hospital_procedures;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.hospital_procedures
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- TABLE 4: hospital_promotions — 프로모션/이벤트
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hospital_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospital_info(id) ON DELETE CASCADE,

  title_ko text NOT NULL,         -- '여름 맞이 눈성형 20% 할인'
  title_th text,
  description_ko text,
  description_th text,

  discount_type text,             -- 'percent', 'fixed', 'package', 'free_add'
  discount_value numeric,         -- 20 (= 20%), 500000 (= 50만원 할인)

  -- 기간
  starts_at date,
  ends_at date,                   -- NULL = 무기한
  is_active boolean DEFAULT true,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.hospital_promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hospital_promotions: authenticated read" ON public.hospital_promotions;
CREATE POLICY "hospital_promotions: authenticated read"
  ON public.hospital_promotions FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "hospital_promotions: admin manage" ON public.hospital_promotions;
CREATE POLICY "hospital_promotions: admin manage"
  ON public.hospital_promotions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'bbg_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'bbg_admin'
    )
  );

DROP POLICY IF EXISTS "hospital_promotions: client update own" ON public.hospital_promotions;
CREATE POLICY "hospital_promotions: client update own"
  ON public.hospital_promotions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.hospital_info h ON h.client_id = p.client_id
      WHERE p.id = auth.uid()
        AND p.role = 'client'
        AND h.id = hospital_promotions.hospital_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.hospital_info h ON h.client_id = p.client_id
      WHERE p.id = auth.uid()
        AND p.role = 'client'
        AND h.id = hospital_promotions.hospital_id
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hospital_promotions_hospital_id ON public.hospital_promotions (hospital_id);
CREATE INDEX IF NOT EXISTS idx_hospital_promotions_active ON public.hospital_promotions (hospital_id, is_active, ends_at);

-- Trigger
DROP TRIGGER IF EXISTS set_updated_at ON public.hospital_promotions;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.hospital_promotions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- TABLE 5: hospital_procedure_doctors — 시술-의사 조인 테이블
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hospital_procedure_doctors (
  procedure_id uuid REFERENCES public.hospital_procedures(id) ON DELETE CASCADE,
  doctor_id uuid REFERENCES public.hospital_doctors(id) ON DELETE CASCADE,
  PRIMARY KEY (procedure_id, doctor_id)
);

-- RLS
ALTER TABLE public.hospital_procedure_doctors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hospital_procedure_doctors: authenticated read" ON public.hospital_procedure_doctors;
CREATE POLICY "hospital_procedure_doctors: authenticated read"
  ON public.hospital_procedure_doctors FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "hospital_procedure_doctors: admin manage" ON public.hospital_procedure_doctors;
CREATE POLICY "hospital_procedure_doctors: admin manage"
  ON public.hospital_procedure_doctors FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'bbg_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'bbg_admin'
    )
  );

-- Index
CREATE INDEX IF NOT EXISTS idx_procedure_doctors_doctor_id ON public.hospital_procedure_doctors (doctor_id);


-- ============================================================
-- TABLE 6: hospital_promotion_procedures — 프로모션-시술 조인 테이블
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hospital_promotion_procedures (
  promotion_id uuid REFERENCES public.hospital_promotions(id) ON DELETE CASCADE,
  procedure_id uuid REFERENCES public.hospital_procedures(id) ON DELETE CASCADE,
  PRIMARY KEY (promotion_id, procedure_id)
);

-- RLS
ALTER TABLE public.hospital_promotion_procedures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hospital_promotion_procedures: authenticated read" ON public.hospital_promotion_procedures;
CREATE POLICY "hospital_promotion_procedures: authenticated read"
  ON public.hospital_promotion_procedures FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "hospital_promotion_procedures: admin manage" ON public.hospital_promotion_procedures;
CREATE POLICY "hospital_promotion_procedures: admin manage"
  ON public.hospital_promotion_procedures FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'bbg_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'bbg_admin'
    )
  );

-- Index
CREATE INDEX IF NOT EXISTS idx_promotion_procedures_procedure_id ON public.hospital_promotion_procedures (procedure_id);


-- ============================================================
-- TABLE 7: successful_cases — 수술 전환 성공 상담 케이스 (RAG용)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.successful_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospital_info(id) ON DELETE CASCADE,

  -- 소스 연결 (둘 중 하나)
  zendesk_ticket_id bigint,                         -- Zendesk 티켓
  conversation_id uuid,                             -- Facebook/LINE 대화

  -- 케이스 메타데이터
  procedure_category text,        -- '눈', '코' 등
  procedure_name_ko text,         -- '눈매교정(절개)'
  procedure_name_th text,
  customer_concern text,          -- 고객의 주요 고민/질문 요약
  customer_concern_th text,
  outcome text,                   -- 'surgery_booked', 'consultation_booked', 'revisit'

  -- 전체 대화 내용 (RAG에 통째로 주입)
  -- 저장 전 PDPA 준수 개인정보 마스킹 필수:
  --   고객명 → "고객A", 전화 → "XXX-XXXX-XXXX", 카카오톡/LINE ID → "[ID 마스킹]", 이메일 → "xxx@xxx.com"
  full_conversation text NOT NULL,

  -- Contextual Retrieval용 메타 (AI가 생성한 케이스 맥락 요약)
  contextual_summary text,        -- "TheBB 쌍꺼풀 상담. 고객이 가격/회복기간 질문, 프로모션 안내 후 예약 전환"

  -- 검색용 태그
  tags text[],                    -- ['쌍꺼풀', '가격문의', '프로모션', '수술예약']

  -- pgvector 임베딩 — pgvector 확장 활성화 후 주석 해제
  -- embedding vector(1536),

  -- 개인정보 마스킹 완료 여부
  is_masked boolean DEFAULT false,

  -- 품질
  quality_score int,              -- 1-5, 상담 품질 점수 (AI 자동 채점)
  is_verified boolean DEFAULT false,  -- 관리자가 검증한 케이스

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.successful_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "successful_cases: authenticated read" ON public.successful_cases;
CREATE POLICY "successful_cases: authenticated read"
  ON public.successful_cases FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "successful_cases: admin manage" ON public.successful_cases;
CREATE POLICY "successful_cases: admin manage"
  ON public.successful_cases FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'bbg_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'bbg_admin'
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_successful_cases_hospital ON public.successful_cases (hospital_id);
CREATE INDEX IF NOT EXISTS idx_successful_cases_category ON public.successful_cases (procedure_category);
CREATE INDEX IF NOT EXISTS idx_successful_cases_tags ON public.successful_cases USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_successful_cases_verified ON public.successful_cases (hospital_id, is_verified, quality_score DESC);
-- 향후 pgvector 활성화 시:
-- CREATE INDEX idx_successful_cases_embedding ON public.successful_cases USING ivfflat(embedding vector_cosine_ops);

-- Trigger
DROP TRIGGER IF EXISTS set_updated_at ON public.successful_cases;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.successful_cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- INITIAL SEEDING: hospital_info — 16개 병원 기본 레코드
-- HOSPITAL_NAMES 매핑 기반 (기존 하드코딩 4개 파일과 동일)
-- ============================================================

INSERT INTO public.hospital_info (hospital_prefix, display_name_ko)
VALUES
  ('thebb',          'TheBB'),
  ('delphic',        'Delphic Clinic'),
  ('will',           'Will Plastic Surgery'),
  ('mikclinicthai',  'MikClinic'),
  ('jyclinicthai',   'JY Clinic'),
  ('du',             'DU Plastic Surgery'),
  ('koreandiet',     'Korean Diet'),
  ('ourpthai',       'OURP'),
  ('everbreastthai', 'EverBreast'),
  ('clyveps_th',     'Clyveps'),
  ('mycell',         'Mycell Clinic'),
  ('nbclinici',      'NB Clinic'),
  ('dr.song',        'Dr. Song'),
  ('lacela',         'Lacela'),
  ('artline',        'Artline'),
  ('kleam',          'Kleam')
ON CONFLICT (hospital_prefix) DO NOTHING;
