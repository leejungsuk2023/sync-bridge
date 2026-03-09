# Sales Lead 자동 수집 및 CS 연동 기획서

## 1. 개요

### 1.1 배경

현재 태국 워커가 Zendesk를 통해 고객(태국 환자/인플루언서)과 상담하면서 예약/견적 문의가 들어오면, 워커가 수동으로 대화 내용을 읽고, 정보를 정리하고, CS 채팅방에 한국어로 타이핑하여 병원 담당자에게 전달한다. 이 과정에서 정보 누락, 번역 오류, 시간 지연이 발생한다.

### 1.2 목표

- 워커가 Zendesk 상담 중 **1클릭으로 AI 기반 정보 추출** 시작
- 추출된 정보를 **구조화된 폼**에서 확인/보완
- 완성된 정보를 **CS 채팅방에 한국어 자동 포스팅**
- 전체 과정을 **세일즈 리드로 등록/추적**

### 1.3 대상 사용자

| 사용자 | 역할 | 주요 액션 |
|--------|------|-----------|
| 태국 워커 (worker) | 정보 수집 시작, 폼 보완, CS방 전달 | Zendesk 상담 중 "정보수집" 버튼 클릭 |
| 한국 병원 담당자 (client) | 견적 발송, 예약 확정 | CS방에서 리드 카드 확인, 상태 업데이트 |
| BBG 관리자 (bbg_admin) | 리드 현황 모니터링, 전환율 분석 | Sales 대시보드에서 파이프라인 조회 |

---

## 2. 사용자 흐름 (User Flow)

```
워커: Zendesk 상담 중 고객이 시술 문의
  │
  ▼
[Step 1] "정보수집" 버튼 클릭 (ZendeskChatPanel 헤더)
  │
  ▼
AI(Gemini)가 대화 분석 → 구조화된 정보 추출
  │
  ▼
[Step 2] LeadInfoPanel 슬라이드 오픈 (AI 패널 위치 대체 or 오버레이)
  │  ├─ 자동 추출 결과 표시 (이름, 시술, 사진 등)
  │  ├─ 누락 정보 빨간색 표시 + AI 추천 질문
  │  └─ 워커가 직접 수정/추가 가능
  │
  ▼
[Step 3] "CS방에 문의" 버튼 클릭
  │  ├─ 정보를 한국어로 번역
  │  ├─ CS 채팅방(__CHAT_CS__)에 구조화된 카드 포스팅
  │  └─ sales_leads 테이블에 리드 등록 (status: cs_requested)
  │
  ▼
[Step 4] 병원 담당자가 CS방에서 리드 카드 확인
  │  ├─ 견적 발송 → status: quote_sent
  │  ├─ 예약 확정 → status: reserved
  │  └─ 시술 완료 → status: completed
```

---

## 3. 기능 상세 설계

### 3.1 Step 1: 정보 수집 시작

**위치:** `ZendeskChatPanel.tsx` 헤더 영역

**UI 변경:**
- 티켓 상태 드롭다운 왼쪽에 "정보수집" 버튼 추가
- 아이콘: `ClipboardList` (lucide-react)
- 태국어: `"รวบรวมข้อมูล"` / 한국어: `"정보수집"`
- 버튼 색상: `bg-emerald-500 text-white` (기존 indigo 톤과 구분)

**동작:**
1. 버튼 클릭 시 현재 ticket_id로 `/api/zendesk/extract-lead` POST 요청
2. API가 대화 전문(zendesk_conversations)을 가져와 Gemini에 정보 추출 요청
3. 추출 결과를 `LeadInfoPanel`에 전달

**이미 리드가 존재하는 경우:**
- sales_leads 테이블에 해당 ticket_id로 기존 리드가 있으면 버튼 텍스트를 "정보 수정"으로 변경
- 기존 데이터를 프리필한 상태로 LeadInfoPanel 오픈

### 3.2 Step 2: 정보 확인 및 보완 (LeadInfoPanel)

**위치:** 3패널 레이아웃의 우측 패널 (AISuggestPanel과 토글)

**레이아웃:**
- ZendeskChatLayout에서 우측 패널을 조건부 렌더링: 리드 수집 모드이면 `LeadInfoPanel`, 아니면 `AISuggestPanel`
- 패널 너비: `w-80` (기존 AI 패널 w-72보다 약간 넓게)

**폼 구성:**

```
┌──────────────────────────────────────┐
│ 고객 정보 수집         [닫기 X]       │
│ ─────────────────────────────────── │
│                                      │
│ [고객 기본정보]                        │
│  이름: [Apisara W.     ] ✅ 자동추출  │
│  나이: [28              ] ✅           │
│  성별: (●여 ○남 ○기타)  ✅            │
│  연락처: [LINE: @apisa ] ✅           │
│  SNS: [IG: @apisa_bkk ] ⚠️ 수동입력  │
│                                      │
│ [시술 관련]                            │
│  원하는 시술: [눈매교정, 코성형] ✅     │
│  시술 부위: [눈, 코       ] ✅         │
│  참고 사진: [2장 첨부됨    ] ✅         │
│    📷 IMG_001.jpg  📷 IMG_002.jpg    │
│                                      │
│ [의료 정보]                            │
│  과거 병력: [없음        ] ⚠️ 미확인   │
│  알레르기: [            ] ❌ 누락      │
│  복용 약물: [            ] ❌ 누락      │
│                                      │
│ [기타]                                │
│  예산: [200,000 THB    ] ✅           │
│  희망 일정: [2026년 4월  ] ✅          │
│  특이사항: [인플루언서... ] ✅          │
│                                      │
│ ─────────────────────────────────── │
│ 💡 AI 추천 질문:                       │
│  "알레르기 있으시나요?"                  │
│  "현재 복용 중인 약물이 있나요?"          │
│  [질문 전송] ← 클릭 시 채팅 입력창에 삽입│
│                                      │
│ ─────────────────────────────────── │
│ 필수정보 5/7 완료                      │
│                                      │
│ [    CS방에 문의    ] ← emerald 버튼  │
│ (필수정보 미완료 시 비활성)              │
└──────────────────────────────────────┘
```

**필드별 상태 표시:**
- ✅ 자동 추출됨 (녹색)
- ⚠️ 수동 입력 필요 (황색) — AI가 추출 시도했으나 확신도 낮음
- ❌ 누락 (적색) — 대화에서 해당 정보 없음

**필수 정보 (7항목):**
1. 고객 이름
2. 연락처 (전화번호 or SNS)
3. 원하는 시술
4. 시술 부위
5. 과거 병력 (없음도 확인 필요)
6. 알레르기
7. 복용 약물

**사진 처리:**
- Zendesk 대화에서 공유된 이미지 URL을 자동 수집
- 첨부 이미지 썸네일 표시, 클릭 시 확대
- 추가 사진 업로드 기능 (Supabase Storage `lead-photos/` 버킷)

**AI 추천 질문:**
- 누락된 필드에 대해 태국어 질문 자동 생성
- "질문 전송" 클릭 시 ZendeskChatPanel의 입력창에 텍스트 주입 (기존 `injectedReply` 패턴 재활용)

### 3.3 Step 3: CS방에 견적 문의

**동작:**
1. "CS방에 문의" 클릭
2. 수집된 정보를 한국어로 번역 (`/api/translate` 활용)
3. CS 채팅방 (`__CHAT_CS__`)에 구조화된 메시지 포스팅

**CS방 포스팅 메시지 포맷:**

```
📋 [견적 문의] 새 고객 — Apisara W. (#12345)

■ 고객 정보
  이름: Apisara Wongyai
  나이/성별: 28세 / 여성
  연락처: LINE @apisa_bkk
  SNS: Instagram @apisa_bkk (팔로워 15K)

■ 시술 정보
  원하는 시술: 눈매교정, 코성형
  시술 부위: 눈, 코
  참고 사진: 2장 (아래 첨부)

■ 의료 정보
  과거 병력: 없음
  알레르기: 확인 완료 - 없음
  복용 약물: 확인 완료 - 없음

■ 기타
  예산: 200,000 THB (약 750만원)
  희망 일정: 2026년 4월
  특이사항: 태국 뷰티 인플루언서, 시술 후기 콘텐츠 제작 가능

📷 사진 2장 첨부됨
[사진 1] [사진 2]

─────────────────
담당 워커: Apisara (워커)
Zendesk 티켓: #12345
수집일시: 2026-03-10 14:30 KST
```

**기술적 구현:**
- CS 채팅방의 task_id를 resolve: `GET /api/tasks?chat_room=CS&client_id=xxx`
- `messages` 테이블에 INSERT (sender_id = 워커, content = 위 포맷)
- 사진은 file_url로 별도 메시지 전송 (기존 ChatPanel의 파일 전송 패턴)
- `sales_leads` 테이블에 리드 등록

### 3.4 Step 4: 세일즈 리드 관리

**리드 상태 워크플로:**

```
collecting → cs_requested → quote_sent → reserved → completed
                 │                          │
                 └──→ cancelled             └──→ no_show
```

| 상태 | 한국어 | 태국어 | 트리거 |
|------|--------|--------|--------|
| collecting | 정보수집중 | กำลังรวบรวม | Step 1 시작 시 |
| cs_requested | CS문의완료 | ส่งคำขอแล้ว | Step 3 완료 시 |
| quote_sent | 견적발송 | ส่งใบเสนอราคาแล้ว | 병원 담당자가 수동 변경 |
| reserved | 예약확정 | จองแล้ว | 병원 담당자가 수동 변경 |
| completed | 시술완료 | เสร็จสิ้น | 병원 담당자가 수동 변경 |
| cancelled | 취소 | ยกเลิก | 어느 시점에서든 |
| no_show | 노쇼 | ไม่มา | 예약 후 미방문 |

**리드 대시보드 위치:**
- `SalesPerformance.tsx`에 4번째 탭 "리드 파이프라인" 추가 (bbg_admin 전용)
- `WorkerFollowup.tsx` 상단에 "내 리드" 섹션 추가 (워커 본인 리드만)

---

## 4. 데이터 모델

### 4.1 신규 테이블: `sales_leads`

```sql
CREATE TABLE IF NOT EXISTS sales_leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Zendesk 연결
  ticket_id BIGINT NOT NULL,

  -- 고객 기본정보
  customer_name TEXT NOT NULL,
  customer_name_ko TEXT,               -- 한국어 표기
  customer_age INTEGER,
  customer_gender TEXT CHECK (customer_gender IN ('male', 'female', 'other')),
  customer_phone TEXT,
  customer_line TEXT,                   -- LINE ID
  customer_instagram TEXT,              -- Instagram handle
  customer_sns_other JSONB,             -- 기타 SNS { platform: handle }

  -- 시술 관련
  procedures TEXT[] NOT NULL DEFAULT '{}',       -- 원하는 시술 목록
  procedures_ko TEXT[],                          -- 한국어 번역
  body_parts TEXT[] DEFAULT '{}',                -- 시술 부위
  body_parts_ko TEXT[],                          -- 한국어 번역
  reference_photos TEXT[] DEFAULT '{}',          -- Supabase Storage URLs

  -- 의료 정보
  medical_history TEXT,                -- 과거 병력
  medical_history_ko TEXT,
  allergies TEXT,                       -- 알레르기
  allergies_ko TEXT,
  current_medications TEXT,             -- 복용 약물
  current_medications_ko TEXT,
  medical_confirmed BOOLEAN DEFAULT false,  -- 의료정보 확인 완료 여부

  -- 기타
  budget_thb NUMERIC,                  -- 예산 (THB)
  budget_krw NUMERIC,                  -- 예산 (KRW, 자동 환산)
  preferred_date TEXT,                 -- 희망 일정 (자유 텍스트)
  preferred_date_ko TEXT,
  special_notes TEXT,                  -- 특이사항
  special_notes_ko TEXT,

  -- 워크플로
  status TEXT NOT NULL DEFAULT 'collecting'
    CHECK (status IN ('collecting', 'cs_requested', 'quote_sent', 'reserved', 'completed', 'cancelled', 'no_show')),

  -- 추적
  collected_by UUID NOT NULL REFERENCES auth.users(id),      -- 수집 워커
  hospital_tag TEXT,                                          -- 병원 태그 (zendesk_tickets.tags에서 추출)
  cs_message_id UUID REFERENCES messages(id),                 -- CS방 포스팅 메시지 ID

  -- AI 추출 메타
  ai_extraction JSONB,                 -- 원본 AI 추출 결과 (디버깅용)
  ai_confidence NUMERIC,               -- 전체 추출 신뢰도 (0-1)
  extraction_model TEXT DEFAULT 'gemini-2.5-flash',

  -- 타임스탬프
  collected_at TIMESTAMPTZ DEFAULT NOW(),     -- 정보수집 시작
  cs_requested_at TIMESTAMPTZ,                -- CS방 전달 시점
  quote_sent_at TIMESTAMPTZ,                  -- 견적 발송 시점
  reserved_at TIMESTAMPTZ,                    -- 예약 확정 시점
  completed_at TIMESTAMPTZ,                   -- 시술 완료 시점
  cancelled_at TIMESTAMPTZ,                   -- 취소 시점

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_sl_ticket ON sales_leads(ticket_id);
CREATE INDEX IF NOT EXISTS idx_sl_status ON sales_leads(status);
CREATE INDEX IF NOT EXISTS idx_sl_collected_by ON sales_leads(collected_by);
CREATE INDEX IF NOT EXISTS idx_sl_hospital ON sales_leads(hospital_tag);
CREATE INDEX IF NOT EXISTS idx_sl_created ON sales_leads(created_at DESC);

-- RLS
ALTER TABLE sales_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on sales_leads"
  ON sales_leads FOR ALL USING (true) WITH CHECK (true);

-- Realtime (상태 변경 알림용)
ALTER PUBLICATION supabase_realtime ADD TABLE sales_leads;
```

### 4.2 신규 테이블: `sales_lead_timeline`

```sql
CREATE TABLE IF NOT EXISTS sales_lead_timeline (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,

  event_type TEXT NOT NULL,       -- 'created', 'info_updated', 'cs_requested', 'quote_sent', 'status_changed', 'note_added'
  event_data JSONB,               -- 이벤트별 추가 데이터
  status_before TEXT,
  status_after TEXT,

  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slt_lead ON sales_lead_timeline(lead_id, created_at);

ALTER TABLE sales_lead_timeline ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on sales_lead_timeline"
  ON sales_lead_timeline FOR ALL USING (true) WITH CHECK (true);
```

### 4.3 기존 테이블 연계

**zendesk_analyses와의 관계:**
- `zendesk_analyses`에는 이미 `customer_name`, `customer_phone`, `interested_procedure` 필드가 존재
- `sales_leads`는 이를 확장한 상위 엔티티: 추가 의료 정보, 사진, 구조화된 시술 목록 포함
- `zendesk_analyses.ticket_id`와 `sales_leads.ticket_id`로 JOIN 가능
- 기존 팔로업 시스템(`followup_actions`, `followup_notifications`)은 독립적으로 유지

**messages 테이블과의 관계:**
- CS방 포스팅 시 `messages` 테이블에 INSERT
- `sales_leads.cs_message_id`로 해당 메시지 참조

---

## 5. AI 활용 방안

### 5.1 정보 추출 프롬프트

```
System: You are a medical tourism information extraction AI for a Korean plastic surgery clinic.
Your task is to extract structured patient information from a Thai-language Zendesk support conversation.

Instructions:
- Extract ALL available information from the conversation
- For each field, provide a confidence score (0.0-1.0)
- If information is not explicitly mentioned, set confidence to 0.0 and value to null
- Detect images shared in the conversation (attachment URLs)
- Convert Thai names to a readable format
- Identify the specific procedures mentioned (use medical terminology when possible)
- Flag any medical concerns (allergies, medications, pre-existing conditions)

Output JSON format:
{
  "customer": {
    "name": { "value": "string", "confidence": 0.0-1.0 },
    "age": { "value": number|null, "confidence": 0.0-1.0 },
    "gender": { "value": "male"|"female"|"other"|null, "confidence": 0.0-1.0 },
    "phone": { "value": "string|null", "confidence": 0.0-1.0 },
    "line_id": { "value": "string|null", "confidence": 0.0-1.0 },
    "instagram": { "value": "string|null", "confidence": 0.0-1.0 }
  },
  "procedures": {
    "requested": { "value": ["string"], "confidence": 0.0-1.0 },
    "body_parts": { "value": ["string"], "confidence": 0.0-1.0 }
  },
  "medical": {
    "history": { "value": "string|null", "confidence": 0.0-1.0, "confirmed": boolean },
    "allergies": { "value": "string|null", "confidence": 0.0-1.0, "confirmed": boolean },
    "medications": { "value": "string|null", "confidence": 0.0-1.0, "confirmed": boolean }
  },
  "photos": ["url1", "url2"],
  "budget": { "value": number|null, "currency": "THB", "confidence": 0.0-1.0 },
  "preferred_date": { "value": "string|null", "confidence": 0.0-1.0 },
  "special_notes": { "value": "string|null", "confidence": 0.0-1.0 },
  "missing_fields": ["field1", "field2"],
  "suggested_questions": [
    { "field": "allergies", "question_th": "คุณมีอาการแพ้ยาหรืออาหารหรือไม่คะ?", "question_ko": "약물이나 음식 알레르기가 있으신가요?" }
  ]
}

Conversation:
{conversations}

Previous analysis (if available):
{analysis}
```

### 5.2 한국어 번역 프롬프트 (CS방 포스팅용)

기존 `/api/translate` 엔드포인트를 활용하되, 구조화된 데이터의 번역은 별도 Gemini 호출로 처리:

```
System: Translate the following medical tourism patient information from Thai to Korean.
Maintain medical terminology accuracy. Use formal business Korean (합니다체).
Preserve the structured format.

Input: {structured_lead_data}
Output: {translated_lead_data}
```

### 5.3 AI 호출 최적화

- **모델:** `gemini-2.5-flash` (기존과 동일)
- **컨텍스트 제한:** 최근 20개 대화만 전달 (토큰 절약)
- **캐싱:** 동일 ticket_id에 대한 재추출 시 이전 결과를 base로 delta만 추출
- **타임아웃:** 30초 (기존 suggest-reply의 maxDuration=60과 동일 범위)

---

## 6. API 설계

### 6.1 신규 API 엔드포인트

#### `POST /api/zendesk/extract-lead`

**목적:** Zendesk 대화에서 리드 정보를 AI로 추출

**Request:**
```json
{
  "ticket_id": 12345
}
```

**Response:**
```json
{
  "lead_id": "uuid",
  "extraction": { ... },
  "is_existing": false,
  "missing_required": ["allergies", "current_medications"],
  "suggested_questions": [...]
}
```

**인증:** Bearer token (worker, bbg_admin, client)
**CORS:** withCors() 패턴

---

#### `PATCH /api/zendesk/extract-lead`

**목적:** 추출된 리드 정보를 수정/보완

**Request:**
```json
{
  "lead_id": "uuid",
  "updates": {
    "allergies": "없음",
    "current_medications": "없음",
    "medical_confirmed": true
  }
}
```

**Response:**
```json
{
  "lead_id": "uuid",
  "updated_fields": ["allergies", "current_medications", "medical_confirmed"],
  "missing_required": []
}
```

---

#### `POST /api/zendesk/submit-lead`

**목적:** 완성된 리드를 CS방에 포스팅하고 리드 등록

**Request:**
```json
{
  "lead_id": "uuid",
  "client_id": "hospital-client-uuid"
}
```

**Response:**
```json
{
  "lead_id": "uuid",
  "status": "cs_requested",
  "cs_message_id": "uuid",
  "cs_room_task_id": "uuid"
}
```

**내부 동작:**
1. sales_leads 데이터를 한국어 번역
2. CS 채팅방 task_id resolve (`GET /api/tasks?chat_room=CS&client_id=xxx`)
3. messages 테이블에 구조화된 메시지 INSERT
4. 사진이 있으면 별도 file 메시지 INSERT
5. sales_leads.status를 'cs_requested'로 업데이트
6. sales_lead_timeline에 이벤트 기록

---

#### `GET /api/sales-leads`

**목적:** 리드 목록 조회 (대시보드용)

**Query params:**
- `status`: 상태 필터 (comma-separated)
- `hospital`: 병원 태그 필터
- `worker_id`: 특정 워커 리드만
- `period`: week | month | all
- `page`: 페이지 번호

**Response:**
```json
{
  "leads": [...],
  "stats": {
    "total": 45,
    "by_status": { "collecting": 3, "cs_requested": 8, "quote_sent": 12, ... },
    "conversion_rate": 0.42,
    "avg_collection_time_min": 12
  },
  "total_count": 45
}
```

---

#### `PATCH /api/sales-leads`

**목적:** 리드 상태 변경 (병원 담당자/어드민)

**Request:**
```json
{
  "lead_id": "uuid",
  "status": "quote_sent",
  "note": "견적서 이메일 발송 완료"
}
```

---

### 6.2 기존 API 변경 없음

- `/api/tasks`: 채팅방 resolve에 기존 로직 그대로 사용
- `/api/translate`: 개별 필드 번역에 기존 엔드포인트 사용
- `/api/zendesk/conversations`: 대화 내용 조회에 기존 API 사용

---

## 7. 컴포넌트 설계

### 7.1 신규 컴포넌트

#### `LeadInfoPanel.tsx`

**위치:** `client-web/components/LeadInfoPanel.tsx`

**Props:**
```typescript
interface LeadInfoPanelProps {
  ticketId: number;
  user: any;
  profile: any;
  locale?: 'ko' | 'th';
  onClose: () => void;
  onQuestionInject: (text: string) => void;  // 질문을 채팅 입력창에 주입
  onSubmitted: () => void;                    // CS방 전달 완료 콜백
}
```

**내부 상태:**
- `leadData`: 추출/편집된 리드 정보
- `loading`: AI 추출 진행 중
- `missingFields`: 누락 필수 항목 목록
- `suggestedQuestions`: AI 추천 질문
- `submitting`: CS방 전달 진행 중

**크기:** 약 300-400줄 예상

---

#### `LeadCard.tsx`

**위치:** `client-web/components/LeadCard.tsx`

**용도:** CS 채팅방에 표시되는 리드 요약 카드, SalesPerformance 리드 목록 카드

**Props:**
```typescript
interface LeadCardProps {
  lead: SalesLead;
  variant: 'chat' | 'dashboard' | 'compact';
  onStatusChange?: (leadId: string, newStatus: string) => void;
  locale?: 'ko' | 'th';
}
```

---

#### `LeadPipeline.tsx`

**위치:** `client-web/components/LeadPipeline.tsx`

**용도:** SalesPerformance의 4번째 탭 "리드 파이프라인"

**Props:**
```typescript
interface LeadPipelineProps {
  locale?: 'ko' | 'th';
}
```

**UI:** 칸반 스타일 파이프라인 (수평 스크롤)
```
┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
│수집중 (3)│  │CS문의 (8)│  │견적 (12)│  │예약 (5) │  │완료 (17)│
│         │  │         │  │         │  │         │  │         │
│ [카드]  │  │ [카드]  │  │ [카드]  │  │ [카드]  │  │ [카드]  │
│ [카드]  │  │ [카드]  │  │ [카드]  │  │ [카드]  │  │ [카드]  │
│         │  │         │  │         │  │         │  │         │
└─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘
```

---

### 7.2 기존 컴포넌트 수정

#### `ZendeskChatPanel.tsx` 수정

**추가:**
- 헤더에 "정보수집" 버튼 (리드 수집 시작 트리거)
- `onCollectLead` prop 추가 (ZendeskChatLayout으로 이벤트 전달)

```typescript
interface ZendeskChatPanelProps {
  // ... 기존 props
  onCollectLead?: (ticketId: number) => void;  // 신규
  hasActiveLead?: boolean;                      // 신규: 이미 리드 있으면 버튼 텍스트 변경
}
```

#### `ZendeskChatLayout.tsx` 수정

**추가:**
- `collectingLead` 상태: 현재 리드 수집 중인 ticket_id
- 우측 패널 조건부 렌더링: collectingLead ? LeadInfoPanel : AISuggestPanel

```typescript
// 기존 코드 수정
<div className="hidden lg:block w-80 shrink-0 border-l border-slate-200 overflow-y-auto bg-slate-50">
  {collectingLead ? (
    <LeadInfoPanel
      ticketId={collectingLead}
      user={user}
      profile={profile}
      locale={locale}
      onClose={() => setCollectingLead(null)}
      onQuestionInject={(text) => setInjectedReply(text)}
      onSubmitted={() => { setCollectingLead(null); /* refresh */ }}
    />
  ) : (
    <AISuggestPanel
      ticketId={selectedTicketId}
      onUseReply={(text) => setInjectedReply(text)}
      user={user}
      locale={locale}
    />
  )}
</div>
```

#### `SalesPerformance.tsx` 수정

**추가:**
- 4번째 탭: "리드" (LeadPipeline 컴포넌트)
- 기존 3탭 → 4탭으로 확장

#### `WorkerDashboard.tsx` 수정

**변경 없음.** 워커의 리드 관리는 Zendesk 상담 화면(ให้คำปรึกษา 탭) 내에서 처리되므로 별도 탭 불필요.

---

## 8. 기존 시스템 연동

### 8.1 CS 채팅방 연동

**메시지 포스팅 방식:**
- `messages` 테이블에 직접 INSERT (server-side, service role key 사용)
- `sender_id`는 워커의 user_id
- `task_id`는 CS방의 task_id (API로 resolve)
- `content`에 구조화된 한국어 텍스트
- `content_ko`에 동일 텍스트 (한국어 원문)
- `content_th`에 태국어 요약 (워커 확인용)
- `sender_lang: 'ko'` (한국어 메시지)

**CS방 알림:**
- Supabase Realtime으로 `messages` INSERT 이벤트가 자동 전파
- 병원 담당자의 ChatPanel에 즉시 표시
- 브라우저 알림(Notification API)도 기존 로직으로 자동 작동

### 8.2 팔로업 시스템 연계

**독립 운영, 데이터 연결:**
- `sales_leads.ticket_id`와 `zendesk_analyses.ticket_id`로 JOIN 가능
- 리드가 `reserved` 상태가 되면 해당 ticket을 자동으로 팔로업 대상에서 제외 (또는 `converted`로 변경)
- 향후 확장: 리드 상태 변경 시 `followup_actions`에도 자동 기록

### 8.3 SalesPerformance 연계

**기존 전환율과 리드 데이터 통합:**
- 현재 `zendesk_analyses.reservation_converted`로 추적하던 전환율을 `sales_leads.status`와 교차 검증
- 리드 파이프라인 탭에서 병원별/워커별/기간별 전환율 시각화
- 기존 통계에 "리드 기반 전환율" 지표 추가

---

## 9. 구현 우선순위 (MVP부터 단계적)

### Phase 1: MVP (1주)

**핵심 가치: AI 정보 추출 + CS방 포스팅**

1. **DB 마이그레이션**
   - `sales_leads` 테이블 생성
   - `sales_lead_timeline` 테이블 생성

2. **API 개발**
   - `POST /api/zendesk/extract-lead` — AI 추출
   - `PATCH /api/zendesk/extract-lead` — 정보 수정
   - `POST /api/zendesk/submit-lead` — CS방 전달

3. **프론트엔드**
   - `ZendeskChatPanel.tsx`에 "정보수집" 버튼 추가
   - `LeadInfoPanel.tsx` 기본 폼 (표시/수정)
   - `ZendeskChatLayout.tsx` 패널 토글 로직
   - CS방 메시지 포스팅 (text only, 사진 제외)

**MVP 산출물:**
- 워커가 상담 중 버튼 클릭 → AI 추출 → 폼 확인 → CS방 전달
- 최소 동작 가능한 end-to-end 플로우

---

### Phase 2: 정보 보완 (1주)

**핵심 가치: 누락 정보 보완 UX + 사진 처리**

1. **AI 추천 질문**
   - 누락 필드별 태국어 질문 생성
   - 질문을 채팅 입력창에 주입하는 injectedReply 연동

2. **사진 처리**
   - Zendesk 대화 내 이미지 URL 자동 수집
   - LeadInfoPanel에 사진 썸네일 표시
   - CS방 포스팅 시 사진 메시지 동시 전송

3. **기존 리드 편집**
   - ticket_id로 기존 리드 조회
   - "정보 수정" 모드에서 프리필

---

### Phase 3: 리드 관리 (1주)

**핵심 가치: 파이프라인 관리 + 상태 추적**

1. **API 개발**
   - `GET /api/sales-leads` — 리드 목록/통계
   - `PATCH /api/sales-leads` — 상태 변경

2. **프론트엔드**
   - `LeadPipeline.tsx` — 칸반 파이프라인 (SalesPerformance 4번째 탭)
   - `LeadCard.tsx` — 리드 카드 (대시보드용)
   - 상태 변경 드롭다운
   - 타임라인 표시

3. **CS방 리드 카드**
   - CS 채팅방에 포스팅된 리드 메시지를 rich card로 렌더링
   - 카드에서 직접 상태 변경 가능

---

### Phase 4: 분석 및 자동화 (향후)

1. **전환율 분석 대시보드**
   - 병원별/워커별/시술별 전환율
   - 평균 리드 처리 시간
   - 퍼널 분석 (수집 → CS → 견적 → 예약 → 시술)

2. **자동화**
   - Zendesk 대화에서 예약/견적 키워드 감지 시 자동 "정보수집" 팝업
   - 견적 발송 후 자동 팔로업 스케줄링
   - 팔로업 시스템과 자동 연동

3. **알림 시스템**
   - 새 리드 알림 (병원 담당자에게)
   - 견적 미응답 알림 (워커에게)
   - 일별 리드 서머리 (bbg_admin에게)

---

## 10. 기술 고려사항

### 10.1 성능

- AI 추출 API는 Gemini 호출 포함 5-15초 소요 예상 → UI에 로딩 스켈레톤 필수
- `maxDuration = 60` 설정 (Vercel serverless 제한)
- LeadInfoPanel은 낙관적 업데이트(optimistic update)로 UX 개선

### 10.2 에러 처리

- AI 추출 실패 시: "수동 입력 모드"로 전환 (빈 폼 제공)
- CS방 전달 실패 시: 로컬에 저장 후 재시도 버튼 제공
- 번역 실패 시: 원문(태국어) 그대로 포스팅 + 번역 실패 안내 표시

### 10.3 보안

- 모든 API에 CORS + Bearer token 인증 (기존 패턴)
- 환자 의료 정보가 포함되므로 RLS 정책 적용
- 사진은 Supabase Storage private 버킷 사용 고려

### 10.4 반응형

- LeadInfoPanel: 데스크톱에서는 우측 패널, 모바일에서는 전체 화면 모달
- LeadPipeline: 데스크톱은 칸반 수평 스크롤, 모바일은 탭 전환
- 리드 카드: 모바일에서 세로 스택

---

## 11. 필요 에셋 및 의존성

### 11.1 아이콘 (lucide-react, 이미 설치됨)

- `ClipboardList` — 정보수집 버튼
- `FileCheck` — 정보 완료 상태
- `Send` — CS방 전달 버튼
- `Camera` — 사진 관련
- `AlertCircle` — 누락 필드 경고
- `CheckCircle2` — 완료 필드
- `ArrowRight` — 파이프라인 흐름

### 11.2 추가 패키지 없음

- 기존 기술 스택(Next.js, Tailwind, Supabase, Gemini API)으로 전부 구현 가능
- 칸반 보드도 Tailwind + flex로 직접 구현 (외부 라이브러리 불필요)

### 11.3 환경 변수 변경 없음

- 기존 `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` 등으로 충분
- THB → KRW 환율은 하드코딩 또는 간단한 API 호출 (선택)

---

## 12. 파일 생성/수정 요약

### 신규 파일

| 파일 | 용도 |
|------|------|
| `supabase/sales_leads.sql` | DB 마이그레이션 |
| `client-web/app/api/zendesk/extract-lead/route.ts` | AI 정보 추출 API |
| `client-web/app/api/zendesk/submit-lead/route.ts` | CS방 전달 API |
| `client-web/app/api/sales-leads/route.ts` | 리드 조회/상태변경 API |
| `client-web/lib/lead-extraction.ts` | AI 추출 로직 (ai-suggest.ts 패턴 참고) |
| `client-web/components/LeadInfoPanel.tsx` | 정보 수집/편집 패널 |
| `client-web/components/LeadCard.tsx` | 리드 요약 카드 |
| `client-web/components/LeadPipeline.tsx` | 파이프라인 대시보드 |

### 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `client-web/components/ZendeskChatPanel.tsx` | 헤더에 "정보수집" 버튼 추가 |
| `client-web/components/ZendeskChatLayout.tsx` | 우측 패널 LeadInfoPanel 토글 |
| `client-web/components/SalesPerformance.tsx` | 4번째 탭 "리드" 추가 |
