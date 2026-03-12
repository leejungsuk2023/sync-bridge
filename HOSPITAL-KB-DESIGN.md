# 병원 지식 베이스(Hospital KB) 설계서

## 현재 문제

| 위치 | 저장된 정보 | 한계 |
|------|-----------|------|
| `clients` 테이블 | id, name만 존재 | 병원 정보 없음 |
| `HOSPITAL_NAMES` 하드코딩 | 태그→이름 매핑 16개 | 4개 파일에 중복, 코드에 박혀있음 |
| `zendesk_analyses` | AI가 추출한 시술명, 고객명 | 비정형, 대화별 파편 |
| `glossary` | 의료용어 한↔태 번역 | 병원별이 아닌 전역 |

**워커가 상담할 때:** 병원 위치, 원장 전문분야, 시술 종류/가격, 현재 프로모션을 모르면 답변 불가 → 별도 공부 필요

---

## 테이블 설계

### 1. `hospital_info` — 병원 기본 정보 (clients 확장)

```sql
CREATE TABLE hospital_info (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id),      -- nullable (모든 병원이 clients에 있지 않을 수 있음)
  hospital_prefix text UNIQUE NOT NULL,        -- 'thebb', 'delphic'

  -- 기본 정보
  display_name_ko text,          -- '더비비 성형외과'
  display_name_th text,          -- 'โรงพยาบาลเดอะบีบี'
  address_ko text,               -- '서울시 강남구 ...'
  address_th text,
  google_maps_url text,
  phone text,
  website text,
  operating_hours jsonb,         -- {"mon-fri": "09:00-18:00", "sat": "09:00-13:00"}

  -- 메타
  logo_url text,
  description_ko text,           -- 병원 소개 (한국어)
  description_th text,           -- 병원 소개 (태국어)
  specialties text[],            -- ['눈성형', '코성형', '지방흡입']

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE hospital_info ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read" ON hospital_info FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin can manage" ON hospital_info FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'bbg_admin'));
CREATE POLICY "Client can update own hospital" ON hospital_info FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'client' AND client_id = hospital_info.client_id
  ));
```

### 2. `hospital_doctors` — 원장/의사 정보

```sql
CREATE TABLE hospital_doctors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospital_info(id) ON DELETE CASCADE,

  name_ko text NOT NULL,         -- '김원장'
  name_th text,                  -- 'คุณหมอคิม'
  title_ko text,                 -- '대표원장'
  title_th text,
  specialties text[],            -- ['눈성형', '코성형']
  bio_ko text,                   -- 경력/소개
  bio_th text,
  photo_url text,

  is_active boolean DEFAULT true,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS (same pattern)
ALTER TABLE hospital_doctors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read" ON hospital_doctors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin can manage" ON hospital_doctors FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'bbg_admin'));
CREATE POLICY "Client can update own hospital data" ON hospital_doctors FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles p
    JOIN hospital_info h ON h.client_id = p.client_id
    WHERE p.id = auth.uid() AND p.role = 'client' AND h.id = hospital_doctors.hospital_id
  ));
```

### 3. `hospital_procedures` — 시술 정보 + 가격

```sql
CREATE TABLE hospital_procedures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospital_info(id) ON DELETE CASCADE,

  category text NOT NULL,        -- '눈', '코', '지방흡입', '피부', '체형'
  name_ko text NOT NULL,         -- '눈매교정(절개)'
  name_th text,                  -- 'ทำตาสองชั้นแบบกรีด'
  description_ko text,           -- 상세 설명
  description_th text,

  -- 가격 (범위 지원)
  price_min numeric,             -- 최소 가격 (KRW)
  price_max numeric,             -- 최대 가격 (KRW)
  price_currency text DEFAULT 'KRW',  -- 통화 (향후 다중 통화 대비)
  price_note text,               -- '상담 후 결정', '마취비 별도' 등

  -- 참고
  duration_minutes int,          -- 시술 시간
  recovery_days int,             -- 회복 기간
  is_popular boolean DEFAULT false,
  is_active boolean DEFAULT true,

  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE hospital_procedures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read" ON hospital_procedures FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin can manage" ON hospital_procedures FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'bbg_admin'));
CREATE POLICY "Client can update own hospital data" ON hospital_procedures FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles p
    JOIN hospital_info h ON h.client_id = p.client_id
    WHERE p.id = auth.uid() AND p.role = 'client' AND h.id = hospital_procedures.hospital_id
  ));
```

### 4. `hospital_promotions` — 프로모션/이벤트

```sql
CREATE TABLE hospital_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospital_info(id) ON DELETE CASCADE,

  title_ko text NOT NULL,        -- '여름 맞이 눈성형 20% 할인'
  title_th text,
  description_ko text,
  description_th text,

  discount_type text,            -- 'percent', 'fixed', 'package', 'free_add'
  discount_value numeric,        -- 20 (= 20%), 500000 (= 50만원 할인)

  -- 기간
  starts_at date,
  ends_at date,                  -- NULL = 무기한
  is_active boolean DEFAULT true,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE hospital_promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read" ON hospital_promotions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin can manage" ON hospital_promotions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'bbg_admin'));
CREATE POLICY "Client can update own hospital data" ON hospital_promotions FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles p
    JOIN hospital_info h ON h.client_id = p.client_id
    WHERE p.id = auth.uid() AND p.role = 'client' AND h.id = hospital_promotions.hospital_id
  ));
```

### 4-1. `hospital_procedure_doctors` — 시술-의사 연결 (조인 테이블)

```sql
CREATE TABLE hospital_procedure_doctors (
  procedure_id uuid REFERENCES hospital_procedures(id) ON DELETE CASCADE,
  doctor_id uuid REFERENCES hospital_doctors(id) ON DELETE CASCADE,
  PRIMARY KEY (procedure_id, doctor_id)
);

-- RLS
ALTER TABLE hospital_procedure_doctors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read" ON hospital_procedure_doctors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin can manage" ON hospital_procedure_doctors FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'bbg_admin'));
```

### 4-2. `hospital_promotion_procedures` — 프로모션-시술 연결 (조인 테이블)

```sql
CREATE TABLE hospital_promotion_procedures (
  promotion_id uuid REFERENCES hospital_promotions(id) ON DELETE CASCADE,
  procedure_id uuid REFERENCES hospital_procedures(id) ON DELETE CASCADE,
  PRIMARY KEY (promotion_id, procedure_id)
);

-- RLS
ALTER TABLE hospital_promotion_procedures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read" ON hospital_promotion_procedures FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin can manage" ON hospital_promotion_procedures FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'bbg_admin'));
```

### 5. `successful_cases` — 수술 전환 성공 상담 케이스 (RAG용)

```sql
CREATE TABLE successful_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospital_info(id) ON DELETE CASCADE,

  -- 소스 연결 (둘 중 하나)
  zendesk_ticket_id bigint,                    -- Zendesk 티켓
  conversation_id uuid,                        -- Facebook/LINE 대화

  -- 케이스 메타데이터
  procedure_category text,       -- '눈', '코' 등
  procedure_name_ko text,        -- '눈매교정(절개)'
  procedure_name_th text,
  customer_concern text,         -- 고객의 주요 고민/질문 요약
  customer_concern_th text,
  outcome text,                  -- 'surgery_booked', 'consultation_booked', 'revisit'

  -- 전체 대화 내용 (RAG에 통째로 주입)
  full_conversation text NOT NULL,  -- 전체 상담 대화 원문

  -- Contextual Retrieval용 메타 (청크별 컨텍스트)
  contextual_summary text,       -- AI가 생성한 이 케이스의 맥락 요약
                                 -- "TheBB 병원 쌍꺼풀 상담. 고객이 가격과 회복기간을
                                 --  질문했고, 상담원이 프로모션을 안내하여 수술 예약으로 이어진 케이스"

  -- 검색용 태그/임베딩
  tags text[],                   -- ['쌍꺼풀', '가격문의', '프로모션', '수술예약']
  embedding vector(1536),        -- pgvector 임베딩 (향후 활성화)

  -- 개인정보 마스킹
  is_masked boolean DEFAULT false,  -- 개인정보 마스킹 완료 여부

  -- 품질
  quality_score int,             -- 1-5, 상담 품질 점수
  is_verified boolean DEFAULT false,  -- 관리자가 검증한 케이스

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 검색 인덱스
CREATE INDEX idx_successful_cases_hospital ON successful_cases(hospital_id);
CREATE INDEX idx_successful_cases_category ON successful_cases(procedure_category);
CREATE INDEX idx_successful_cases_tags ON successful_cases USING gin(tags);
-- 향후: CREATE INDEX idx_successful_cases_embedding ON successful_cases USING ivfflat(embedding vector_cosine_ops);

-- RLS
ALTER TABLE successful_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read" ON successful_cases FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin can manage" ON successful_cases FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'bbg_admin'));
```

**개인정보 마스킹 (PDPA 준수):**
`full_conversation` 저장 시 자동 마스킹 적용:
- 고객 이름 → "고객A", "ลูกค้าA"
- 전화번호 → "XXX-XXXX-XXXX"
- 카카오톡/LINE ID → "[ID 마스킹]"
- 이메일 → "xxx@xxx.com"

Phase 5 자동 수집 파이프라인에 마스킹 단계 포함.

---

## 데이터 흐름

```
┌─────────────┐    CRUD     ┌──────────────────────┐
│ bbg_admin   │────────────→│  hospital_info        │
│ client 역할  │             │  hospital_doctors     │
│             │             │  hospital_procedures  │
│             │             │  hospital_promotions  │
└─────────────┘             └──────────┬───────────┘
                                       │
                      ┌────────────────┼────────────────┐
                      ▼                ▼                ▼
              ┌──────────┐    ┌──────────────┐   ┌──────────┐
              │ Worker   │    │ AI Suggest   │   │ Hospital │
              │ 상담참조   │    │ (2개 경로)    │   │ Dashboard│
              └──────────┘    └──────┬───────┘   └──────────┘
                                     │
                              ┌──────┴──────┐
                              ▼             ▼
                     ┌─────────────┐ ┌─────────────┐
                     │ Zendesk     │ │ Messaging   │
                     │ ai-suggest  │ │ suggest-    │
                     │ .ts         │ │ reply       │
                     └─────────────┘ └─────────────┘

┌──────────────────────────────────────────────────┐
│ 성공 상담 케이스 (Contextual Retrieval)              │
│                                                  │
│  수술 전환된 상담 → 전체 대화 + 맥락 요약 저장          │
│  → 유사 상담 시 성공 케이스 통째로 AI에 주입            │
└──────────────────────────────────────────────────┘
```

- **입력**: bbg_admin이 병원 정보 등록/수정, client(병원담당자)가 자기 병원 정보 수정
- **참조**: 워커가 상담 중 병원 KB 패널에서 빠르게 조회
- **AI 활용 (2개 경로)**:
  - `lib/ai-suggest.ts` — Zendesk 채팅 AI 추천
  - `/api/messaging/suggest-reply` — Facebook/LINE 다이렉트 메시징 AI 추천
  - 두 경로 모두 병원 KB + 성공 케이스를 프롬프트에 주입

---

## AI 추천 답변 연동 (핵심)

### 현재 상태

**경로 1: Zendesk (`lib/ai-suggest.ts`)**

| # | 데이터 | 소스 | 상태 |
|---|--------|------|------|
| 1 | 최근 대화 10건 | `zendesk_conversations` | ✅ |
| 2 | 고객 분석 | `zendesk_analyses` | ✅ |
| 3 | Quick Reply | `quick_replies` | ✅ |
| 4 | 의료 용어집 | `glossary` | ✅ |
| 5 | 상담원 존칭 | `profiles` | ✅ |
| 6 | 병원 시술/가격 | — | ❌ |
| 7 | 현재 프로모션 | — | ❌ |
| 8 | 병원 기본정보 | — | ❌ |
| 9 | 성공 상담 케이스 | — | ❌ |

**경로 2: Facebook/LINE (`/api/messaging/suggest-reply/route.ts`)**

별도 인라인 프롬프트 구성. `lib/ai-suggest.ts`를 사용하지 않음.
→ 동일하게 병원 KB 주입 필요 (16개 병원 대화 대부분이 이 경로)

### 변경 계획

#### 1. 공용 유틸 생성 (`lib/hospital-utils.ts`)

```typescript
// HOSPITAL_NAMES 하드코딩 4개 파일 → 이 유틸로 통합
export async function getHospitalByPrefix(prefix: string) {
  // 1차: hospital_info 테이블 조회
  // 2차: fallback to hardcoded map (점진적 제거)
}

export function extractHospitalPrefix(tags: string[]): string | null {
  // zendesk_tickets.tags에서 hospital_prefix 추출
  // 기존 4개 파일에 중복된 로직 통합
}
```

**`buildSuggestionContext()` 내 hospital_prefix 추출 (Zendesk 경로):**

```typescript
// zendesk_tickets에서 tags 조회 → prefix 추출
const { data: ticket } = await supabaseAdmin
  .from('zendesk_tickets')
  .select('tags')
  .eq('ticket_id', ticketId)
  .single();
const hospitalPrefix = extractHospitalPrefix(ticket?.tags || []);
```

**Messaging 경로는 `channel_conversations.hospital_prefix`를 직접 사용** (이미 저장됨).

#### 2. `buildSuggestionContext()` 확장 (두 경로 공통)

```typescript
export interface SuggestionContext {
  // 기존
  conversations: any[];
  analysis: any;
  quickReplies: any[];
  glossary: any[];
  politeParticle: string;
  // NEW: Hospital KB
  hospitalInfo: any | null;
  procedures: any[];           // 인기 시술 위주, limit 15
  activePromotions: any[];     // is_active + (ends_at IS NULL OR ends_at >= today)
  doctors: any[];              // limit 5
  // NEW: 성공 케이스
  successfulCases: any[];      // 유사 케이스 1-2개, 전체 대화 포함
}
```

추가 쿼리 (hospital_info 조회 후 **Promise.all 병렬 실행**):

```typescript
// hospital_info.id 확보 후 병렬 실행
const [proceduresRes, promotionsRes, doctorsRes, casesRes] = await Promise.all([
  // 시술 (인기 우선, limit 15)
  supabaseAdmin.from('hospital_procedures')
    .select('name_th, category, price_min, price_max, price_currency, price_note, is_popular')
    .eq('hospital_id', hospitalInfo.id).eq('is_active', true)
    .order('is_popular', { ascending: false }).order('sort_order').limit(15),

  // 프로모션 (활성 + 기간 내 또는 무기한)
  supabaseAdmin.from('hospital_promotions')
    .select('title_th, description_th, discount_type, discount_value, ends_at')
    .eq('hospital_id', hospitalInfo.id).eq('is_active', true)
    .or(`ends_at.is.null,ends_at.gte.${today}`),

  // 의사 (limit 5)
  supabaseAdmin.from('hospital_doctors')
    .select('name_th, title_th, specialties')
    .eq('hospital_id', hospitalInfo.id).eq('is_active', true)
    .order('sort_order').limit(5),

  // 성공 케이스 (같은 병원 + 유사 시술, limit 2)
  supabaseAdmin.from('successful_cases')
    .select('full_conversation, contextual_summary, procedure_name_th, outcome')
    .eq('hospital_id', hospitalInfo.id).eq('is_verified', true)
    .order('quality_score', { ascending: false }).limit(2),
]);
```

#### 3. 프롬프트 구조 (확장)

```
## Hospital Information
Name: โรงพยาบาลเดอะบีบี (TheBB Plastic Surgery)
Address: กรุงเทพฯ ... / 서울시 강남구 ...
Phone: 02-1234-5678
Website: https://thebb.co.kr

## Doctors
- คุณหมอคิม (대표원장) — ตาสองชั้น, เสริมจมูก
- คุณหมอปาร์ค — ดูดไขมัน, ยกกระชับ

## Available Procedures & Prices (KRW / ~THB)
⭐ ทำตาสองชั้น (눈매교정) — 1,500,000~2,500,000 KRW (~37,500~62,500 THB)
⭐ เสริมจมูก (코성형) — 3,000,000~5,000,000 KRW (~75,000~125,000 THB)
   ดูดไขมัน (지방흡입) — 2,000,000~4,000,000 KRW (~50,000~100,000 THB)

## Current Promotions
🎉 ทำตาสองชั้น ลด 20% (ถึง 2026-04-30)
🎉 แพ็คเกจ ตา+จมูก ลดพิเศษ 1,000,000 KRW (ไม่มีกำหนดสิ้นสุด)

## Successful Consultation Reference
아래는 이 병원에서 실제로 수술 예약까지 이어진 상담 사례입니다.
참고하여 비슷한 패턴으로 응대하세요:

[Case 1: ทำตาสองชั้น → 수술 예약 성공]
Context: TheBB 쌍꺼풀 상담. 고객이 가격/회복기간 질문, 프로모션 안내 후 예약 전환.
--- 전체 대화 ---
[Customer] สวัสดีค่ะ อยากสอบถามเรื่องทำตาสองชั้นค่ะ ...
[Agent] สวัสดีค่ะ ยินดีให้คำปรึกษาค่ะ ...
...
--- 대화 끝 ---

## IMPORTANT RULES
- 가격 질문 시 반드시 위 시술 목록에서 인용
- 활성 프로모션이 있으면 적극적으로 안내
- 목록에 없는 시술은 "확인 후 안내드리겠습니다"로 응대
- 성공 케이스의 응대 패턴(톤, 정보 제공 순서, 클로징 방식)을 참고
```

---

## RAG 전략: 전체 대화 보존 + 맥락 요약 검색

Anthropic의 **Contextual Retrieval** (2024년 공식 블로그 발표)에서 영감을 받되, 상담 도메인에 맞게 변형 적용.

### Anthropic Contextual Retrieval vs 우리 방식

| 구분 | Anthropic 원본 | SyncBridge 방식 |
|------|---------------|----------------|
| 청크 분할 | 한다 (필수) | **안 한다** |
| 컨텍스트 | 각 청크 앞에 prepend | 별도 `contextual_summary` 필드 |
| 검색 대상 | enriched chunk | contextual_summary + tags |
| 반환 단위 | 관련 청크 N개 | **전체 대화 1-2개** |
| 적합 규모 | 수만 토큰 대규모 문서 | 2,000-4,000 토큰 상담 대화 |

**왜 청크를 자르지 않는가?** 상담 대화 1건이 2,000-4,000 토큰으로, 청크 분할 시 대화 흐름이 끊겨 맥락 손실이 큼. 상담 성공의 핵심은 "톤 → 정보제공 → 프로모션 안내 → 클로징"의 전체 흐름이므로, 통째로 주입하는 게 더 효과적.

### SyncBridge 적용 방식

```
[기존 RAG]
  상담 대화 → 청크 분할 → 임베딩 → 검색 → 일부 청크만 AI에 전달
  문제: 대화 흐름이 끊겨서 맥락 손실

[우리 방식: Contextual Retrieval]
  수술 전환 성공 상담 → 전체 대화 보존 + 맥락 요약 생성 → 색인화
  검색 시: 맥락 요약으로 유사 케이스 찾기 → 전체 대화를 통째로 AI에 주입
```

### 파이프라인

```
Phase A: 케이스 수집 (자동 + 수동)
  ┌─────────────────────────────────────┐
  │ zendesk_analyses.reservation_converted = true  │
  │ OR conversation_analyses.reservation_converted │
  │ OR 관리자가 수동으로 "성공 케이스" 마킹          │
  └──────────────────┬──────────────────┘
                     ▼
Phase B: 컨텍스트 요약 생성 (Gemini)
  ┌─────────────────────────────────────┐
  │ 전체 대화 + 메타데이터를 Gemini에 전달      │
  │ → contextual_summary 생성                │
  │ → tags 자동 추출                          │
  │ → procedure_category/name 자동 분류       │
  └──────────────────┬──────────────────┘
                     ▼
Phase C: 색인화
  ┌─────────────────────────────────────┐
  │ contextual_summary + tags → 텍스트 검색   │
  │ (Phase 1: GIN 인덱스 기반 태그 검색)       │
  │                                     │
  │ 향후: contextual_summary → pgvector 임베딩 │
  │ (Phase 2: 시맨틱 검색)                    │
  └──────────────────┬──────────────────┘
                     ▼
Phase D: 검색 + 주입
  ┌─────────────────────────────────────┐
  │ 현재 상담의 hospital_prefix + 관심 시술    │
  │ → 유사 성공 케이스 1-2개 검색             │
  │ → full_conversation 통째로 프롬프트에 주입  │
  └─────────────────────────────────────┘
```

### 검색 전략 (2단계)

**Phase 1 (즉시)**: 태그 + 카테고리 기반 검색
```sql
SELECT * FROM successful_cases
WHERE hospital_id = $1
  AND procedure_category = $2  -- 관심 시술 카테고리
  AND is_verified = true
ORDER BY quality_score DESC
LIMIT 2;
```

**Phase 2 (향후)**: pgvector 시맨틱 검색
```sql
-- contextual_summary를 임베딩하여 유사도 검색
SELECT *, 1 - (embedding <=> $query_embedding) as similarity
FROM successful_cases
WHERE hospital_id = $1
ORDER BY similarity DESC
LIMIT 2;
```

### 토큰 예산 관리

| 섹션 | 예상 토큰 |
|------|----------|
| 기존 (대화+고객+용어집) | ~1,500 |
| Hospital KB (info+doctors+procedures+promos) | ~800 |
| 성공 케이스 1개 (전체 대화) | ~2,000-4,000 |
| 성공 케이스 2개 | ~4,000-8,000 |
| **합계** | **~6,300-10,300** |

Gemini 2.5 Flash 입력 1M tokens → 충분. 비용도 입력 토큰 기준 미미.
단, 케이스가 매우 긴 경우(50+ 메시지) 최대 메시지 수 제한 필요 (예: 최근 40개).

---

## UI 구성

### 1. 관리 UI (bbg_admin용)

- 병원 선택 드롭다운 → 기본정보 / 의사 / 시술 / 프로모션 CRUD
- 시술 가격 일괄 수정 (테이블 형태)
- **CSV 일괄 import** — 시술명/가격 스프레드시트 업로드
- **자동번역 버튼** — `_ko` 입력 시 기존 번역 API로 `_th` 자동 생성
- 프로모션 기간 관리 (활성/만료 자동 표시)
- **데이터 완성도 대시보드** — 병원별 "12/15 시술에 가격 입력, 의사 2명, 프로모션 3개" 현황
- **성공 케이스 관리** — 자동 수집된 케이스 검증(is_verified) + 수동 추가
- 위치: 별도 `/admin/hospital-kb` 페이지

### 2. 워커 참조 UI (상담 중)

- 현재 대화의 `hospital_prefix`로 자동 매칭
- **AISuggestPanel 내 탭으로 통합**: `AI추천` | `병원정보` 탭 전환
  - 기존 3패널 레이아웃(TicketList | ChatPanel | AISuggestPanel) 유지
  - AISuggestPanel 상단에 탭 추가
- 병원정보 탭 내용: 기본정보 / 시술·가격 / 프로모션 (아코디언)
- 시술 검색 (클라이언트 사이드 필터)
- **가격 THB 환산 표시** — KRW 옆에 참고용 THB 표시
- 태국어 우선, 한국어 병기

### 3. AI 컨텍스트 주입

- **Zendesk 경로**: `lib/ai-suggest.ts` → `buildSuggestionContext()` + `buildPrompt()` 확장
- **Messaging 경로**: `/api/messaging/suggest-reply/route.ts` → 동일 KB 주입 로직 적용
- 두 경로 모두 공용 함수 `fetchHospitalKBContext(hospitalPrefix)` 호출

---

## 권한 모델

| 역할 | hospital_info | doctors | procedures | promotions | successful_cases |
|------|:---:|:---:|:---:|:---:|:---:|
| bbg_admin | CRUD 전체 | CRUD 전체 | CRUD 전체 | CRUD 전체 | CRUD + 검증 |
| client | 자기 병원 R/U | 자기 병원 R/U | 자기 병원 R/U | 자기 병원 R/U | 자기 병원 R |
| worker | R (전체) | R (전체) | R (전체) | R (active만) | R (verified만) |
| hospital | 자기 병원 R | 자기 병원 R | 자기 병원 R | 자기 병원 R | 자기 병원 R |

---

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/hospital-kb?hospital_prefix=thebb` | 병원 전체 정보 조회 (info + doctors + procedures + active promotions) |
| POST | `/api/hospital-kb` | 병원 정보 생성 (bbg_admin) |
| PUT | `/api/hospital-kb?id=xxx` | 병원 정보 수정 (bbg_admin, client) |
| POST | `/api/hospital-kb/import` | CSV 일괄 import (시술/가격) |
| GET/POST/PUT/DELETE | `/api/hospital-kb/doctors` | 의사 CRUD |
| GET/POST/PUT/DELETE | `/api/hospital-kb/procedures` | 시술 CRUD (카테고리별 그룹핑) |
| GET/POST/PUT/DELETE | `/api/hospital-kb/promotions` | 프로모션 CRUD |
| GET/POST/PUT/DELETE | `/api/hospital-kb/cases` | 성공 케이스 CRUD + 검증 |
| POST | `/api/hospital-kb/cases/generate-context` | 케이스 contextual_summary 자동 생성 |

---

## 운영 고려사항

### updated_at 자동 갱신 트리거

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- 모든 KB 테이블에 적용
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hospital_info FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hospital_doctors FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hospital_procedures FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hospital_promotions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON successful_cases FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 초기 시딩 전략

Phase 1 마이그레이션 시 `messaging_channels`의 16개 `hospital_prefix`에서 `hospital_info` 기본 레코드 자동 생성:

```sql
INSERT INTO hospital_info (hospital_prefix, display_name_ko)
SELECT DISTINCT hospital_prefix, hospital_prefix  -- display_name은 이후 수동 입력
FROM messaging_channels
WHERE hospital_prefix IS NOT NULL
ON CONFLICT (hospital_prefix) DO NOTHING;
```

기존 `HOSPITAL_NAMES` 매핑에서 `display_name_ko`를 업데이트하는 시딩 스크립트도 Phase 1에 포함.

### 가격 신선도 관리

`hospital_procedures`에 가격 갱신 시점 추적:
- `updated_at`으로 마지막 수정일 확인
- 관리 대시보드에 "가격 정보 90일 이상 미갱신" 경고 표시
- 분기별 가격 리뷰 알림 (Phase 2 관리 UI에 포함)

### 성공 케이스 quality_score 기준

**자동 채점 (AI, Phase 5):**
- 대화 길이 10턴 이상: +1점
- 예약 전환 확인: +2점
- 고객 만족 시그널 (감사 표현 등): +1점
- 시술 정보 정확히 안내: +1점
- 최대 5점

**검증 프로세스:**
1. 자동 수집 → AI가 quality_score 1차 채점
2. 관리자가 리뷰 → `is_verified` 토글
3. 최소 검증 기준: **전환 확인 + 10턴 이상 + AI 3점 이상**

### 성공 케이스 주입 전략

기본 OFF. 다음 조건에서만 활성화:
- `zendesk_analyses.interested_procedure` 또는 대화에서 시술 관련 키워드 감지 시
- 병원 KB에 해당 시술이 존재할 때
- 검증된 케이스(`is_verified = true`)가 1개 이상 있을 때

→ 불필요한 토큰 소비와 레이턴시 증가 방지.

---

## 구현 순서

| 단계 | 내용 | 산출물 |
|------|------|--------|
| **Phase 1** | SQL 마이그레이션 (5개 테이블 + 2개 조인 테이블 + RLS + 트리거) + `lib/hospital-utils.ts` 공용 유틸 + 초기 시딩 | 테이블 7개, 하드코딩 통합, 16개 병원 기본 레코드 |
| **Phase 2** | 관리 UI (bbg_admin) + CSV import + 자동번역 | `HospitalKBManager` 컴포넌트, `/admin/hospital-kb` 페이지 |
| **Phase 3** | 워커 참조 패널 (AISuggestPanel 탭 통합) | AISuggestPanel 확장 |
| **Phase 4a** | Zendesk AI 추천에 KB 주입 | `lib/ai-suggest.ts` 확장 |
| **Phase 4b** | Messaging AI 추천에 KB 주입 | `/api/messaging/suggest-reply` 확장 |
| **Phase 5** | 성공 케이스 자동 수집 + contextual_summary 생성 | 크론 또는 분석 후 자동 트리거 |
| **Phase 6** | 케이스 검색 + 프롬프트 주입 (태그 기반) | Contextual Retrieval Phase 1 |
| **Phase 7** | pgvector 임베딩 + 시맨틱 검색 | Contextual Retrieval Phase 2 |

---

## 기존 시스템과의 연결

- `hospital_info.hospital_prefix` → `messaging_channels.hospital_prefix` 연결로 대화 시 자동 KB 매칭
- `hospital_info.client_id` → `clients.id` 연결로 기존 client 체계 유지 (nullable)
- `hospital_procedures.name_ko/name_th` → `glossary` 테이블의 용어와 일관성 유지
- `HOSPITAL_NAMES` 하드코딩 4개 파일 → `lib/hospital-utils.ts`로 통합 후 점진적 DB 전환:
  - `client-web/app/api/zendesk/stats/route.ts`
  - `client-web/app/api/zendesk/hospital-stats/route.ts`
  - `client-web/app/api/zendesk/insights/route.ts`
  - `client-web/components/HospitalDashboard.tsx`
- `messaging_channels` 시드 데이터 (16개 hospital_prefix) → `hospital_info` 초기 시딩 소스로 활용
- `zendesk_analyses.reservation_converted` / `conversation_analyses.reservation_converted` → 성공 케이스 자동 수집 트리거

---

## 감사 체크리스트

이 설계에서 확인된 모든 이슈와 반영 상태:

| # | 이슈 | 심각도 | 반영 |
|---|------|--------|------|
| 1 | Facebook/LINE AI 추천 경로 누락 | 치명 | ✅ Phase 4b 추가 |
| 2 | RLS 정책 미정의 | 치명 | ✅ 모든 테이블에 RLS 추가 |
| 3 | `ends_at IS NULL` 무기한 프로모션 누락 | 높음 | ✅ or 필터 추가 |
| 4 | HOSPITAL_NAMES 4개 파일 중복 | 높음 | ✅ `lib/hospital-utils.ts` 통합 |
| 5 | doctors/procedures에 `is_active` 없음 | 높음 | ✅ 추가 |
| 6 | 추가 쿼리 latency | 높음 | ✅ Promise.all 병렬화 |
| 7 | CSV 일괄 import 없음 | 중간 | ✅ Phase 2에 포함 |
| 8 | 자동번역 버튼 없음 | 중간 | ✅ Phase 2에 포함 |
| 9 | 워커 KB 패널 위치 미정 | 중간 | ✅ AISuggestPanel 탭 통합 |
| 10 | 시술-의사 연결 없음 | 중간 | ✅ `doctor_ids uuid[]` 추가 |
| 11 | `price_currency` 없음 | 낮음 | ✅ 추가 |
| 12 | `updated_at` 일부 누락 | 낮음 | ✅ 전 테이블 추가 |
| 13 | Contextual Retrieval 용어 오용 | 높음 | ✅ 명칭 교정 + 비교표 추가 |
| 14 | client RLS UPDATE 정책 누락 | 높음 | ✅ 4개 테이블에 추가 |
| 15 | `uuid[]` 배열 → 조인 테이블 | 높음 | ✅ procedure_doctors + promotion_procedures |
| 16 | 성공 케이스 개인정보 마스킹 | 높음 | ✅ PDPA 준수 마스킹 파이프라인 |
| 17 | AI 프롬프트 THB 환산 누락 | 중간 | ✅ 가격에 THB 병기 |
| 18 | hospital_prefix 추출 코드 부재 | 중간 | ✅ 구체 쿼리 명시 |
| 19 | updated_at 자동 갱신 트리거 없음 | 중간 | ✅ 트리거 함수 추가 |
| 20 | 초기 시딩 스크립트 없음 | 중간 | ✅ Phase 1에 포함 |
| 21 | quality_score 채점 기준 미정의 | 중간 | ✅ AI 자동 채점 + 관리자 검증 |
| 22 | 성공 케이스 기본 OFF 전략 | 중간 | ✅ 조건부 활성화 |
| 23 | 가격 신선도 관리 | 낮음 | ✅ 90일 미갱신 경고 |

---

END OF DOCUMENT.
