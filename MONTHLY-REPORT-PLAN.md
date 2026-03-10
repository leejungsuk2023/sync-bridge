# SyncBridge 월간 보고서 자동화 기획서

---

## 1. 개요

### 1.1 목적

한국 병원 고객사(client role)에게 매월 제공하는 마케팅/세일즈 성과 보고서를 자동화한다.
현재 수동으로 작성 중인 보고서를 시스템이 데이터 수집 + AI 분석으로 자동 생성하여,
BBG 관리자의 반복 작업을 줄이고 보고서 품질과 일관성을 높인다.

### 1.2 사용자 및 역할

| 역할 | 할 수 있는 것 |
|------|---------------|
| `bbg_admin` | 보고서 생성/편집/확정, 광고 CSV 업로드, 콘텐츠 수량 입력, 전략 수동 편집, 모든 병원 보고서 조회 |
| `client` | 자사 병원의 확정된 보고서 조회만 가능 (읽기 전용) |
| `hospital` | 자사 병원의 확정된 보고서 조회만 가능 (읽기 전용) |

### 1.3 보고서 구조

보고서는 2장으로 구성된다.

- **1장: 성과 요약 (Performance Summary)** -- 광고, 상담, 콘텐츠 데이터 기반
- **2장: 전략 (Strategy)** -- AI가 데이터를 종합 분석하여 생성

### 1.4 UI 배치

Dashboard.tsx의 `<main>` 영역 최하단에 `<MonthlyReport />` 컴포넌트 블록을 추가한다.
기존 섹션 색상 패턴을 따라 `from-amber-50/70 to-white` 그라데이션 + `border-l-amber-400` 좌측 보더를 사용한다.

---

## 2. 데이터 모델

### 2.1 신규 테이블: `monthly_reports`

보고서 메타데이터 및 AI 생성 결과를 저장하는 메인 테이블.

```sql
CREATE TABLE IF NOT EXISTS monthly_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- 식별
  client_id UUID NOT NULL REFERENCES clients(id),
  hospital_tag TEXT NOT NULL,                    -- 병원 tag prefix (e.g. 'thebb')
  report_month TEXT NOT NULL,                    -- 'YYYY-MM' 형식 (e.g. '2026-03')

  -- 상태
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'generating', 'review', 'published')),
  -- draft: 초안 생성 전/데이터 입력 중
  -- generating: AI가 보고서 생성 중
  -- review: AI 생성 완료, 관리자 검토 중
  -- published: 확정, 클라이언트 조회 가능

  -- 1장: 광고 성과 요약
  ad_csv_url TEXT,                               -- 업로드된 CSV 파일 Storage URL
  ad_csv_filename TEXT,                          -- 원본 파일명
  ad_parsed_data JSONB,                          -- CSV 파싱 결과 (구조화된 광고 데이터)
  ad_summary TEXT,                               -- AI 생성 광고 성과 요약 (한국어)

  -- 1장: 상담 내용 요약
  consultation_data JSONB,                       -- Zendesk에서 추출한 상담 통계
  consultation_summary TEXT,                     -- AI 생성 상담 요약 (한국어)

  -- 1장: 콘텐츠 업로드 현황
  content_plan JSONB NOT NULL DEFAULT '{
    "photo": {"promised": 12, "actual": null, "next_month": null},
    "reels": {"promised": 3, "actual": null, "next_month": null},
    "reviewer": {"promised": 2, "actual": null, "next_month": null}
  }'::jsonb,

  -- 2장: 전략 (모두 AI 생성, 관리자 편집 가능)
  strategy_current TEXT,                         -- 이번달 광고 전략
  strategy_next TEXT,                            -- 다음달 광고 전략
  hospital_requests TEXT,                        -- 병원 요청사항
  sales_focus TEXT,                              -- 세일즈팀 집중 포인트

  -- 메타
  generated_by UUID REFERENCES auth.users(id),   -- AI 생성 트리거한 관리자
  published_by UUID REFERENCES auth.users(id),   -- 확정한 관리자
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- 같은 병원+월에 보고서 1개만
  UNIQUE(hospital_tag, report_month)
);

CREATE INDEX IF NOT EXISTS idx_mr_client ON monthly_reports(client_id);
CREATE INDEX IF NOT EXISTS idx_mr_hospital_month ON monthly_reports(hospital_tag, report_month DESC);
CREATE INDEX IF NOT EXISTS idx_mr_status ON monthly_reports(status);

ALTER TABLE monthly_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on monthly_reports"
  ON monthly_reports FOR ALL USING (true) WITH CHECK (true);
```

### 2.2 신규 테이블: `hospital_content_config`

병원별 콘텐츠 약속 수량 설정. 기본값 오버라이드용.

```sql
CREATE TABLE IF NOT EXISTS hospital_content_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_tag TEXT NOT NULL UNIQUE,
  photo_promised INTEGER NOT NULL DEFAULT 12,
  reels_promised INTEGER NOT NULL DEFAULT 3,
  reviewer_promised INTEGER NOT NULL DEFAULT 2,
  -- 추가 콘텐츠 유형 확장 가능
  custom_items JSONB DEFAULT '[]'::jsonb,        -- [{name: "라이브방송", promised: 1}]
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE hospital_content_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on hospital_content_config"
  ON hospital_content_config FOR ALL USING (true) WITH CHECK (true);
```

### 2.3 기존 테이블 활용 (변경 없음)

| 테이블 | 활용 내용 |
|--------|-----------|
| `zendesk_tickets` | 해당 월+병원의 상담 건수, 상태별 분포 |
| `zendesk_analyses` | 주요 문의 시술(`interested_procedure`), 예약 전환(`reservation_converted`), 품질 점수 |
| `sales_leads` | 리드 수집/전환 현황 |
| `clients` | client_id -> 병원 매핑 |
| `profiles` | 사용자 인증, hospital_prefix |

---

## 3. CSV 파싱 설계

### 3.1 지원 CSV 형식

Facebook/Instagram Ads Manager에서 내보낸 CSV를 지원한다.
컬럼명이 다양할 수 있으므로 유연한 매핑을 사용한다.

### 3.2 실제 Meta Ads Manager CSV 컬럼 (한국어 내보내기)

실제 CSV 헤더 (확인됨):
```
"보고 시작","보고 종료","캠페인 이름","캠페인 게재","결과","결과 표시 도구","결과당 비용","광고 세트 예산","광고 세트 예산 유형","지출 금액 (KRW)","노출","도달","종료","기여 설정"
```

### 3.3 컬럼 매핑 테이블

```typescript
const AD_COLUMN_MAP: Record<string, string[]> = {
  // 내부 키: [가능한 CSV 컬럼명들 — 한국어 + 영어 둘 다 지원]
  report_start:        ['보고 시작', 'Reporting starts'],
  report_end:          ['보고 종료', 'Reporting ends'],
  campaign_name:       ['캠페인 이름', 'Campaign name', 'Campaign Name'],
  campaign_status:     ['캠페인 게재', 'Delivery', 'Campaign delivery'],
  results:             ['결과', 'Results'],
  result_type:         ['결과 표시 도구', 'Result indicator', 'Result Type'],
  cost_per_result:     ['결과당 비용', 'Cost per result'],
  ad_set_budget:       ['광고 세트 예산', 'Ad set budget'],
  ad_set_budget_type:  ['광고 세트 예산 유형', 'Ad set budget type'],
  spend:               ['지출 금액 (KRW)', '지출 금액', 'Amount spent (KRW)', 'Amount spent'],
  impressions:         ['노출', 'Impressions'],
  reach:               ['도달', 'Reach'],
  end_date:            ['종료', 'Ends'],
  attribution:         ['기여 설정', 'Attribution setting'],
};
```

**참고:** `결과 표시 도구` 값으로 결과 유형을 파악 가능:
- `actions:post_engagement` → 게시물 참여
- `actions:onsite_conversion.messaging_conversation_started_7d` → 메시지 대화 시작
- `actions:link_click` → 링크 클릭

이를 통해 캠페인별 목적(참여/메시지/트래픽)을 자동 분류할 수 있음.

### 3.3 파싱 플로우

```
1. 프론트엔드: CSV 파일 선택 → FileReader로 텍스트 읽기
2. 프론트엔드: Papa Parse (CSV 파서 라이브러리)로 파싱
3. 프론트엔드: 컬럼명 자동 매핑 (AD_COLUMN_MAP 기반)
4. 미매핑 컬럼이 있으면 → 매핑 확인 UI 표시 (수동 선택)
5. 파싱 결과를 구조화된 JSON으로 변환
6. API 호출 → CSV 원본은 Supabase Storage에 업로드, 파싱 결과는 ad_parsed_data에 저장
```

### 3.5 파싱 결과 구조 (ad_parsed_data)

```typescript
interface AdCampaign {
  name: string;               // 캠페인 이름
  status: string;             // 캠페인 게재 상태 (active, archived 등)
  result_type: string;        // 결과 유형 (post_engagement, messaging, link_click)
  result_type_label: string;  // 자동 분류 라벨 ("참여", "메시지", "트래픽")
  results: number;            // 결과 수
  cost_per_result: number;    // 결과당 비용 (KRW)
  spend: number;              // 지출 금액 (KRW)
  impressions: number;        // 노출
  reach: number;              // 도달
  ad_set_budget: number;      // 광고 세트 예산
  report_start: string;       // 보고 시작일
  report_end: string;         // 보고 종료일
}

interface AdParsedData {
  // 캠페인별 raw 데이터
  campaigns: AdCampaign[];

  // 자동 계산 집계
  totals: {
    total_spend: number;          // 총 지출 (KRW)
    total_impressions: number;
    total_reach: number;
    total_results: number;
    avg_cost_per_result: number;
  };

  // 캠페인 목적별 소계
  by_objective: Record<string, {  // key: "참여" | "메시지" | "트래픽"
    campaigns: number;
    results: number;
    spend: number;
    impressions: number;
    avg_cost_per_result: number;
  }>;

  // 메타
  csv_row_count: number;
  parsed_at: string;      // ISO timestamp
  currency: string;       // 'THB' (기본)
}
```

---

## 4. API 설계

### 4.1 `GET /api/monthly-report`

보고서 조회.

**Query Parameters:**
| 파라미터 | 필수 | 설명 |
|----------|------|------|
| `hospital_tag` | Y | 병원 tag prefix |
| `month` | N | 'YYYY-MM' (기본: 현재 월) |
| `list` | N | `true`이면 해당 병원의 전체 보고서 목록 반환 (최근 12개월) |

**권한:**
- `bbg_admin`: 모든 병원 조회 가능
- `client`: 자사 client_id에 연결된 병원만, status='published'인 것만
- `hospital`: 자사 hospital_prefix만, status='published'인 것만

**응답:**
```typescript
// 단건 조회
{ report: MonthlyReport }

// 목록 조회 (list=true)
{ reports: { id, report_month, status, updated_at }[] }
```

### 4.2 `POST /api/monthly-report`

보고서 생성 또는 업데이트.

**Request Body:**
```typescript
{
  hospital_tag: string;       // 필수
  month: string;              // 필수, 'YYYY-MM'
  action: 'create' | 'update_content' | 'generate' | 'publish';

  // action='create': 빈 보고서 생성 (또는 기존 draft 반환)
  // action='update_content': 콘텐츠 수량 수동 입력
  content_plan?: {
    photo: { actual: number; next_month: number };
    reels: { actual: number; next_month: number };
    reviewer: { actual: number; next_month: number };
  };

  // action='generate': AI로 전체 보고서 생성
  // (ad_parsed_data, consultation_data가 이미 저장되어 있어야 함)

  // action='publish': 보고서 확정

  // 전략 섹션 수동 편집 (action='update_content'와 함께)
  strategy_current?: string;
  strategy_next?: string;
  hospital_requests?: string;
  sales_focus?: string;
}
```

**권한:** `bbg_admin`만 가능

### 4.3 `POST /api/monthly-report/upload-csv`

광고 CSV 업로드 및 파싱.

**Request:** `multipart/form-data`
| 필드 | 설명 |
|------|------|
| `file` | CSV 파일 (max 5MB) |
| `hospital_tag` | 병원 tag prefix |
| `month` | 'YYYY-MM' |

**처리 플로우:**
1. CSV 파일을 Supabase Storage `monthly-reports/{hospital_tag}/{month}/` 에 업로드
2. CSV 파싱 + 컬럼 매핑
3. `monthly_reports.ad_csv_url`, `ad_csv_filename`, `ad_parsed_data` 업데이트

**응답:**
```typescript
{
  ad_parsed_data: AdParsedData;
  unmapped_columns: string[];    // 자동 매핑 실패한 컬럼명
}
```

### 4.4 `POST /api/monthly-report/generate`

AI 보고서 생성. Zendesk 데이터 수집 + Gemini AI 분석을 한 번에 수행한다.

**Request Body:**
```typescript
{
  hospital_tag: string;
  month: string;       // 'YYYY-MM'
}
```

**처리 플로우:**
1. Zendesk 상담 데이터 수집 (해당 월 + 해당 병원)
2. 광고 데이터 확인 (ad_parsed_data 존재 여부)
3. Gemini AI로 6개 섹션 동시 생성
4. 결과를 monthly_reports에 저장, status를 `review`로 변경

**권한:** `bbg_admin`만

### 4.5 `GET /api/monthly-report/config`

병원별 콘텐츠 약속 수량 조회.

### 4.6 `PUT /api/monthly-report/config`

병원별 콘텐츠 약속 수량 설정.

```typescript
{
  hospital_tag: string;
  photo_promised: number;
  reels_promised: number;
  reviewer_promised: number;
  custom_items?: { name: string; promised: number }[];
}
```

---

## 5. AI 프롬프트 설계

### 5.1 보고서 생성 통합 프롬프트

하나의 Gemini 호출로 6개 섹션을 생성한다. `responseMimeType: 'application/json'`을 사용하여 구조화된 응답을 받는다.

```
You are a marketing analyst for BBG, a medical tourism agency.
Generate a monthly performance report for hospital "{hospital_name}" for {month}.

All output MUST be in Korean (한국어).

=== INPUT DATA ===

[1] 광고 성과 데이터:
{ad_parsed_data가 있으면 JSON으로 삽입, 없으면 "광고 데이터 없음"}

[2] 상담 데이터:
- 이번달 총 상담 건수: {totalInquiries}건
- 의미 있는 상담 (4건 이상 대화): {meaningfulInquiries}건
- 예약 전환: {conversions}건 (전환율 {conversionRate}%)
- 주요 문의 시술 TOP 5: {interested_procedures_ranked}
- 전월 대비: 문의 {growth.totalInquiries}%, 전환 {growth.conversions}%
- 최근 상담 요약 (최대 30건): {ticket_summaries}

[3] 콘텐츠 현황:
- 사진: 약속 {photo_promised}개 / 실제 {photo_actual}개 / 다음달 계획 {photo_next}개
- 릴스: 약속 {reels_promised}개 / 실제 {reels_actual}개 / 다음달 계획 {reels_next}개
- 체험단: 약속 {reviewer_promised}명 / 실제 {reviewer_actual}명 / 다음달 계획 {reviewer_next}명

[4] 리드 데이터 (있는 경우):
- 수집된 리드: {total_leads}건
- 상태별: collecting {n}, cs_requested {n}, quote_sent {n}, reserved {n}, completed {n}

=== OUTPUT FORMAT (JSON) ===

{
  "ad_summary": "광고 성과를 3-5문장으로 요약. 총 노출, 클릭, 비용, 전환, CPC, ROAS 등 핵심 지표 언급. 전월 대비 변화 포함.",
  "consultation_summary": "상담 성과를 3-5문장으로 요약. 총 건수, 주요 시술, 전환율, 특이사항 언급.",
  "strategy_current": "이번달 광고 전략 요약. 3-5문장. 현재 진행 중인 캠페인 방향, 타겟팅, 예산 배분 등.",
  "strategy_next": "다음달 광고 전략 제안. 3-5문장. 데이터 기반 개선 방향, 신규 캠페인 아이디어, 시즈널 트렌드 반영.",
  "hospital_requests": "병원에 요청할 사항 목록. 번호 매기기. 예: 1. 의사 프로필 사진 업데이트 2. 신규 시술 가격표 제공 등.",
  "sales_focus": "세일즈팀 집중 포인트 목록. 번호 매기기. 예: 1. 리프팅 시술 문의 고객 적극 팔로업 2. 재방문 고객 프로모션 안내 등."
}

IMPORTANT:
- 모든 내용은 반드시 한국어로 작성
- 구체적인 숫자와 비율을 포함하여 설득력 있게 작성
- 병원 관계자가 읽는 공식 보고서이므로 전문적이고 정중한 어조 사용
- 광고 데이터가 없는 경우 상담 데이터만으로 요약 작성 (광고 미집행 언급)
- Respond ONLY with valid JSON, no markdown
```

### 5.2 AI 모델 설정

```typescript
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: {
    responseMimeType: 'application/json',
    maxOutputTokens: 8192,
    temperature: 0.7,     // 창의성과 정확성 균형
  },
});
```

---

## 6. 컴포넌트 설계

### 6.1 신규 컴포넌트

#### `MonthlyReport.tsx` (메인 컨테이너)

Dashboard.tsx 하단에 삽입되는 메인 블록.

**Props:**
```typescript
interface MonthlyReportProps {
  userId: string;
  clientId: string | null;
  role: 'bbg_admin' | 'client' | 'hospital';
  hospitalPrefix?: string;     // hospital role일 때
}
```

**UI 구성:**

```
+-------------------------------------------------------------------+
| [amber 그라데이션 배경 + 좌측 amber 보더]                            |
|                                                                     |
| 월간 보고서           [병원 선택 드롭다운]  [월 선택]  [접기/펴기]      |
|                                                                     |
| (접힘 상태일 때: 위 헤더만 표시)                                      |
|                                                                     |
| === 펼침 상태 ===                                                    |
|                                                                     |
| [상태 배지: 작성중/검토중/발행됨]                                     |
|                                                                     |
| --- 1장: 성과 요약 ---                                               |
|                                                                     |
| 1-1. 광고 성과                                                       |
| +-----------------------------+  +-----------------------------+     |
| | 총 노출    | 1,234,567     |  | 총 클릭    | 45,678        |     |
| | 총 비용    | 150,000 THB   |  | 전환 수    | 234           |     |
| | 평균 CPC   | 3.28 THB      |  | 평균 CTR   | 3.7%          |     |
| +-----------------------------+  +-----------------------------+     |
| [CSV 업로드 버튼] (bbg_admin만)                                      |
| AI 요약: "이번달 Facebook 광고는 전월 대비 노출 15% 증가..."          |
|                                                                     |
| 1-2. 상담 내용 요약                                                  |
| +-----------------------------+  +-----------------------------+     |
| | 총 상담 건수 | 89건         |  | 예약 전환율 | 23.5%         |     |
| | 주요 시술    | 리프팅, 코   |  | 전월 대비   | +12%          |     |
| +-----------------------------+  +-----------------------------+     |
| AI 요약: "이번달 총 89건의 상담 중 리프팅 관련 문의가 35%로..."       |
|                                                                     |
| 1-3. 콘텐츠 업로드 현황                                              |
| +------------------+--------+--------+-----------+                   |
| | 항목             | 약속   | 실제   | 다음달    |                   |
| +------------------+--------+--------+-----------+                   |
| | 사진             | 12     | [  10] | [  12]    |    input(admin)   |
| | 릴스(Reels)      | 3      | [   3] | [   4]    |                   |
| | 체험단(리뷰어)    | 2      | [   1] | [   2]    |                   |
| +------------------+--------+--------+-----------+                   |
|                                                                     |
| --- 2장: 전략 ---                                                    |
|                                                                     |
| 2-1. 이번달 광고 전략                                                |
| [편집 가능 텍스트 영역] (bbg_admin만 편집)                            |
|                                                                     |
| 2-2. 다음달 광고 전략                                                |
| [편집 가능 텍스트 영역]                                               |
|                                                                     |
| 2-3. 병원 요청사항                                                   |
| [편집 가능 텍스트 영역]                                               |
|                                                                     |
| 2-4. 세일즈팀 집중 포인트                                            |
| [편집 가능 텍스트 영역]                                               |
|                                                                     |
| [AI 생성 버튼]  [저장 버튼]  [발행 버튼]  (bbg_admin만)               |
+-------------------------------------------------------------------+
```

**상태 관리:**
- `report`: 현재 보고서 데이터 (`MonthlyReport | null`)
- `loading`: 로딩 상태
- `selectedMonth`: 선택된 월 (`YYYY-MM`)
- `selectedHospital`: 선택된 병원 tag prefix (bbg_admin만 변경 가능)
- `collapsed`: 접기/펼치기 상태 (기본: 접힘)
- `editing`: 편집 중인 필드들
- `generating`: AI 생성 중 상태

#### `AdPerformanceCard.tsx` (광고 성과 카드)

광고 데이터 시각화 + CSV 업로드 UI.

**기능:**
- 핵심 지표 6개를 2x3 그리드 카드로 표시
- CSV 업로드 드래그앤드롭 영역
- 업로드 후 파싱 결과 프리뷰 (캠페인 테이블)
- 매핑 안 된 컬럼이 있으면 수동 매핑 드롭다운

#### `ContentStatusTable.tsx` (콘텐츠 현황 테이블)

약속/실제/다음달 비교 테이블.

**기능:**
- 약속 수량은 `hospital_content_config`에서 자동 로드
- 실제/다음달은 `bbg_admin`만 숫자 input으로 입력 가능
- `client`/`hospital`에게는 읽기 전용 테이블로 표시
- 달성률 프로그레스 바 (실제/약속 비율)
- 미달성 항목은 빨간색 하이라이트

#### `StrategyEditor.tsx` (전략 편집기)

2장 전략 섹션 4개를 표시/편집하는 컴포넌트.

**기능:**
- AI 생성 텍스트를 표시
- `bbg_admin`: textarea로 편집 가능 (자동 저장 debounce 1초)
- `client`/`hospital`: 읽기 전용 텍스트 표시
- 각 섹션에 "AI 재생성" 버튼 (개별 섹션만 재생성)

### 6.2 수정 컴포넌트

#### `Dashboard.tsx` 수정

```tsx
// 기존 코드 최하단 (UserManager 아래)에 추가:
{(profile?.role === 'bbg_admin' || profile?.role === 'client') && (
  <MonthlyReport
    userId={user.id}
    clientId={profile?.client_id}
    role={profile?.role}
  />
)}
```

#### `HospitalDashboard.tsx` 수정

병원 파트너 대시보드에도 보고서 조회 블록 추가.

```tsx
<MonthlyReport
  userId={user.id}
  clientId={null}
  role="hospital"
  hospitalPrefix={profile.hospital_prefix}
/>
```

---

## 7. 기능 상세 설계: 데이터 흐름

### 7.1 보고서 생성 전체 플로우

```
[bbg_admin]
    |
    v
(1) 병원/월 선택 → "새 보고서" 클릭
    |
    v
(2) monthly_reports INSERT (status: 'draft')
    |
    v
(3-a) CSV 업로드 (선택)
    |   → /api/monthly-report/upload-csv
    |   → Storage 저장 + CSV 파싱
    |   → ad_parsed_data 업데이트
    |
(3-b) 콘텐츠 수량 입력 (선택)
    |   → /api/monthly-report (action: 'update_content')
    |   → content_plan 업데이트
    |
    v
(4) "AI 보고서 생성" 클릭
    |   → /api/monthly-report/generate
    |   → Zendesk 데이터 자동 수집
    |   → Gemini AI 분석
    |   → 6개 섹션 자동 생성
    |   → status: 'review'
    |
    v
(5) 관리자 검토 & 수동 편집
    |   → 전략 텍스트 수정 가능
    |   → 개별 섹션 AI 재생성 가능
    |
    v
(6) "발행" 클릭
    |   → status: 'published'
    |   → client/hospital 역할에 노출
```

### 7.2 상담 데이터 수집 로직

`/api/monthly-report/generate` 내부에서 수행:

```typescript
async function collectConsultationData(hospitalTag: string, month: string) {
  // month = 'YYYY-MM', 해당 월 1일 ~ 말일
  const startDate = `${month}-01T00:00:00Z`;
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + 1);

  // 1. 해당 월의 해당 병원 티켓 조회
  const tickets = await supabaseAdmin
    .from('zendesk_tickets')
    .select('ticket_id, tags, comments, status, created_at_zd')
    .gte('created_at_zd', startDate)
    .lt('created_at_zd', endDate.toISOString());

  // 2. 병원 태그 필터링
  const hospitalTickets = tickets.filter(t => ticketMatchesHospital(t.tags, hospitalTag));

  // 3. 분석 데이터 조회
  const analyses = await supabaseAdmin
    .from('zendesk_analyses')
    .select('ticket_id, summary, interested_procedure, reservation_converted, quality_score')
    .in('ticket_id', hospitalTickets.map(t => t.ticket_id));

  // 4. 집계
  const totalInquiries = hospitalTickets.length;
  const meaningfulInquiries = hospitalTickets.filter(t => t.comments?.length >= 4).length;
  const conversions = analyses.filter(a => a.reservation_converted).length;
  const conversionRate = meaningfulInquiries > 0
    ? Math.round((conversions / meaningfulInquiries) * 1000) / 10
    : 0;

  // 5. 시술 TOP 5 집계
  const procedureCounts = {};
  analyses.forEach(a => {
    if (a.interested_procedure) {
      procedureCounts[a.interested_procedure] = (procedureCounts[a.interested_procedure] || 0) + 1;
    }
  });
  const topProcedures = Object.entries(procedureCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // 6. 전월 데이터도 수집 (성장률 계산용)
  // ... (hospital-stats API와 동일한 로직)

  return {
    totalInquiries,
    meaningfulInquiries,
    conversions,
    conversionRate,
    topProcedures,
    growth: { ... },
    summaries: analyses.map(a => a.summary).filter(Boolean),
  };
}
```

### 7.3 리드 데이터 수집

```typescript
async function collectLeadData(hospitalTag: string, month: string) {
  const startDate = `${month}-01T00:00:00Z`;
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + 1);

  const { data: leads } = await supabaseAdmin
    .from('sales_leads')
    .select('status, procedures, collected_at')
    .eq('hospital_tag', hospitalTag)
    .gte('collected_at', startDate)
    .lt('collected_at', endDate.toISOString());

  // 상태별 집계
  const statusCounts = {};
  (leads || []).forEach(l => {
    statusCounts[l.status] = (statusCounts[l.status] || 0) + 1;
  });

  return {
    total: (leads || []).length,
    byStatus: statusCounts,
  };
}
```

---

## 8. 클라이언트 보고서 조회 UI

### 8.1 client/hospital 역할 뷰

발행된 보고서를 읽기 전용으로 표시한다.

**디자인 원칙:**
- 모든 input/textarea를 읽기 전용 텍스트로 대체
- CSV 업로드 영역 미표시
- AI 생성/저장/발행 버튼 미표시
- 월 선택 드롭다운으로 과거 보고서 탐색 가능
- 보고서가 없는 달은 "보고서 준비 중입니다" 표시

### 8.2 보고서 인쇄/PDF 내보내기

향후 구현 (MVP 이후). `window.print()` 기반 인쇄 스타일시트 적용.
`@media print` 에서 네비게이션, 버튼 숨기고 보고서 콘텐츠만 출력.

---

## 9. 병원별 커스터마이징

### 9.1 콘텐츠 약속 수량 설정

bbg_admin이 `/api/monthly-report/config` API로 병원별 약속 수량을 설정한다.
MonthlyReport.tsx에서 보고서 생성 시 자동으로 해당 병원의 설정을 로드한다.

**기본값:**
| 항목 | 기본 약속 수량 |
|------|---------------|
| 사진 | 12개 |
| 릴스(Reels) | 3개 |
| 체험단(리뷰어) | 2명 |

**커스터마이징 UI:**
MonthlyReport.tsx 헤더 영역에 설정 아이콘(기어) 버튼 추가.
클릭 시 모달로 약속 수량 편집 가능 (bbg_admin만).
`custom_items`로 병원별 추가 콘텐츠 유형도 설정 가능 (예: "라이브방송 1회").

### 9.2 병원-클라이언트 매핑

`clients` 테이블의 `id`와 `profiles.hospital_prefix`를 사용하여 병원을 식별한다.
bbg_admin은 병원 선택 드롭다운에서 HOSPITAL_NAMES 맵의 모든 병원을 선택할 수 있다.
client role은 자신의 `client_id`에 연결된 병원만 보인다.

---

## 10. 반응형 전략

### 10.1 데스크톱 (1024px+)

- 지표 카드: 2x3 그리드 (3열)
- 콘텐츠 테이블: 전체 폭
- 전략 섹션: 1열 전체 폭

### 10.2 태블릿 (768px-1023px)

- 지표 카드: 2x3 그리드 (2열)
- 나머지 동일

### 10.3 모바일 (< 768px)

- 지표 카드: 1열 세로 스택
- 콘텐츠 테이블: 가로 스크롤 또는 카드 형태로 변환
- 전략 섹션: 아코디언으로 접기/펼치기
- CSV 업로드: 파일 선택 버튼만 표시 (드래그앤드롭 비활성화)

---

## 11. 기술 고려사항

### 11.1 의존성 추가

```bash
npm install papaparse
npm install -D @types/papaparse
```

CSV 파싱에 `papaparse` 사용. 프론트엔드에서 파싱하여 서버 부하를 줄인다.

### 11.2 Supabase Storage 버킷

```
버킷명: monthly-reports
경로 패턴: {hospital_tag}/{month}/{filename}
예시: thebb/2026-03/facebook-ads-march.csv
접근 정책: authenticated users만 (bbg_admin 역할 체크는 API에서)
```

### 11.3 성능

- AI 생성은 10-15초 소요 예상. 프론트엔드에서 로딩 스피너 + 진행 메시지 표시.
- Zendesk 데이터 수집 시 해당 월 데이터만 쿼리하여 범위 제한.
- 보고서 목록은 최근 12개월만 반환하여 페이로드 제한.

### 11.4 에러 처리

| 상황 | 처리 |
|------|------|
| CSV 파싱 실패 | 에러 메시지 + 원인 표시 (인코딩, 형식 등) |
| AI 생성 실패 | 재시도 버튼 + 에러 로그. 최대 2회 자동 재시도. |
| Zendesk 데이터 없음 | "해당 월 상담 데이터가 없습니다" 안내 |
| 이미 발행된 보고서 수정 시도 | status를 'review'로 되돌린 후 편집 가능 (bbg_admin) |

### 11.5 SEO / 접근성

- 보고서는 인증 후 접근하는 내부 도구이므로 SEO 불필요.
- 접근성: 테이블에 적절한 `<thead>`, `<th>` 사용. 카드에 `aria-label`. 색상 대비 4.5:1 이상.

---

## 12. 구현 우선순위

### Phase 1: MVP (1주)

핵심 데이터 입력 + AI 보고서 생성 + 조회 기능.

| 순서 | 작업 | 예상 시간 |
|------|------|-----------|
| 1 | DB 마이그레이션 (`monthly_reports`, `hospital_content_config`) | 0.5h |
| 2 | `GET /api/monthly-report` (조회 + 목록) | 1h |
| 3 | `POST /api/monthly-report` (생성/업데이트/발행) | 1h |
| 4 | `POST /api/monthly-report/upload-csv` (CSV 업로드 + 파싱) | 2h |
| 5 | `POST /api/monthly-report/generate` (AI 보고서 생성) | 2h |
| 6 | `MonthlyReport.tsx` 기본 UI | 3h |
| 7 | `ContentStatusTable.tsx` | 1h |
| 8 | Dashboard.tsx / HospitalDashboard.tsx 통합 | 0.5h |

### Phase 2: 품질 개선 (추가 1주)

| 순서 | 작업 |
|------|------|
| 1 | `AdPerformanceCard.tsx` 차트/시각화 (지표 카드 그리드) |
| 2 | `StrategyEditor.tsx` 개별 섹션 재생성 기능 |
| 3 | 병원별 콘텐츠 설정 API + 모달 UI |
| 4 | CSV 컬럼 수동 매핑 UI |
| 5 | 모바일 반응형 최적화 |
| 6 | 보고서 인쇄 스타일시트 |

### Phase 3: 고급 기능 (향후)

| 작업 |
|------|
| 월별 트렌드 차트 (최근 6개월 비교) |
| PDF 내보내기 (서버사이드 렌더링) |
| 보고서 자동 생성 Cron (매월 1일) |
| 보고서 발행 시 이메일/LINE 알림 |
| 전월 보고서 데이터 자동 이월 (다음달 계획 → 이번달 약속) |

---

## 13. 파일 구조 요약

```
client-web/
  components/
    MonthlyReport.tsx          # 메인 컨테이너 (신규)
    AdPerformanceCard.tsx      # 광고 성과 카드 (신규, Phase 2)
    ContentStatusTable.tsx     # 콘텐츠 현황 테이블 (신규)
    StrategyEditor.tsx         # 전략 편집기 (신규, Phase 2)
  app/api/
    monthly-report/
      route.ts                 # GET (조회) + POST (생성/업데이트/발행)
      upload-csv/route.ts      # POST (CSV 업로드 + 파싱)
      generate/route.ts        # POST (AI 보고서 생성)
      config/route.ts          # GET + PUT (병원별 콘텐츠 설정)
  lib/
    ad-csv-parser.ts           # CSV 컬럼 매핑 + 파싱 유틸 (신규)

supabase/
  monthly_reports.sql          # 테이블 생성 마이그레이션 (신규)
```

---

## 14. API CORS 패턴

기존 프로젝트 컨벤션에 따라 모든 신규 API route에 CORS 헤더 + OPTIONS preflight를 적용한다.

```typescript
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function withCors(response: NextResponse) {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}
```

인증은 기존 `verifyUser()` 패턴을 재사용한다 (Bearer 토큰 → supabaseAdmin.auth.getUser → profiles 조회).

---

## 15. 보고서 예시 (발행 후 client가 보는 화면)

```
====================================================
       TheBB 병원 월간 마케팅 보고서 - 2026년 3월
====================================================

━━ 1장: 성과 요약 ━━

■ 광고 성과
  총 노출: 1,234,567회  |  총 클릭: 45,678회  |  CTR: 3.7%
  총 비용: 150,000 THB   |  CPC: 3.28 THB     |  전환: 234건

  요약: 이번달 Facebook/Instagram 광고는 전월 대비 노출 15%
  증가, 클릭률 0.3%p 상승하였습니다. 리프팅 관련 캠페인이
  전체 전환의 42%를 차지하며 가장 높은 효율을 보였습니다.
  CPC는 전월 3.52 THB에서 3.28 THB로 개선되었습니다.

■ 상담 내용 요약
  총 상담: 89건  |  의미 있는 상담: 67건  |  예약 전환: 16건 (23.9%)
  주요 시술: 1.리프팅 2.코성형 3.눈성형 4.보톡스 5.필러

  요약: 이번달 총 89건의 상담 중 리프팅 관련 문의가 35%로
  가장 많았으며, 예약 전환율은 전월 대비 3.2%p 상승했습니다.
  코성형 문의가 전월 대비 20% 증가하여 주목할 만합니다.

■ 콘텐츠 업로드 현황
  +-----------+------+------+---------+--------+
  | 항목      | 약속 | 실제 | 달성률  | 다음달 |
  +-----------+------+------+---------+--------+
  | 사진      | 12   | 10   |  83%    | 12     |
  | 릴스      | 3    | 3    | 100%    | 4      |
  | 체험단    | 2    | 1    |  50%    | 2      |
  +-----------+------+------+---------+--------+

━━ 2장: 전략 ━━

■ 이번달 광고 전략
  리프팅 시술에 예산의 45%를 집중 배분하여 높은 전환율을
  유지하고 있습니다. 코성형 캠페인은 비포/애프터 이미지를
  활용한 카루셀 광고로 전환하여 클릭률이 개선되었습니다.

■ 다음달 광고 전략
  1. 코성형 캠페인 예산 20% 증액 (문의 증가 트렌드 반영)
  2. 여름 시즌 맞춤 보톡스/필러 프로모션 런칭
  3. 리마케팅 캠페인 강화 (장바구니 이탈 고객 타겟)

■ 병원 요청사항
  1. 코성형 전문의 프로필 사진 업데이트 필요
  2. 리프팅 시술 전후 사진 추가 제공 (최근 3개월 내 케이스)
  3. 여름 프로모션 가격표 확정 요청 (4월 10일까지)

■ 세일즈팀 집중 포인트
  1. 코성형 문의 고객 적극 팔로업 (전환율 향상 기대)
  2. 리프팅 상담 시 패키지 할인 적극 안내
  3. 예약 미전환 고객 재연락 (2주 이내 미응답 건)
====================================================
```

---

*기획서 버전: 1.0*
*작성일: 2026-03-10*
*작성자: BBG 개발팀*
