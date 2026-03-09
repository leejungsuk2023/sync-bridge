# RAG 기반 세일즈 자동화를 위한 SyncBridge DB/코드베이스 분석 리포트

---

## 1. 현재 DB 스키마 전수 조사

### 1.1 `zendesk_tickets` — Zendesk 티켓 원본 데이터

| 컬럼 | 타입 | 용도 |
|------|------|------|
| `ticket_id` | bigint UNIQUE | Zendesk 티켓 고유 ID |
| `subject` | text | 티켓 제목 |
| `description` | text | 티켓 최초 설명 |
| `status` | text | open/pending/solved 등 |
| `priority` | text | 우선순위 |
| `assignee_email/name` | text | 담당 에이전트 |
| `requester_email/name` | text | 문의 고객 |
| `group_name` | text | 팀/그룹 |
| `tags` | text[] | 태그 배열 (병원 prefix 포함) |
| `comments` | **jsonb** | 전체 대화 히스토리 |
| `first_response_at` | timestamptz | 첫 응답 시각 |
| `solved_at` | timestamptz | 해결 시각 |
| `created_at_zd/updated_at_zd` | timestamptz | Zendesk 원본 시각 |
| `synced_at` | timestamptz | 동기화 시각 |

**현재 상태:** `comments` JSONB에 `[{author_id, body, created_at, public}]` 형태로 전체 대화가 저장됨. 질문-응답 순서는 시계열로 추적 가능하나, 개별 댓글이 "질문"인지 "응답"인지는 구분 필드가 없음 (author_id로 추론해야 함).

**문제점:** 댓글의 `author_id`가 숫자(Zendesk user ID)로만 저장되어, 누가 고객이고 누가 에이전트인지 빠르게 구분하기 어려움. `public` 필드로 내부/외부 구분은 가능.

### 1.2 `zendesk_analyses` — AI 분석 결과 + 팔로업 추적

| 컬럼 | 타입 | 용도 |
|------|------|------|
| `quality_score` | int (1-5) | 응대 품질 점수 |
| `reservation_converted` | boolean | 예약 전환 여부 |
| `needs_followup` | boolean | 팔로업 필요 여부 |
| `followup_reason` | text | 팔로업 사유 (한국어) |
| `summary` | text | 대화 요약 (한국어 2-3문장) |
| `issues` | text[] | 발견된 문제점 |
| `hospital_name` | text | 관련 병원명 |
| `customer_name` | text | 고객 이름 |
| `customer_phone` | text | 고객 전화번호 |
| `interested_procedure` | text | 관심 시술 (한국어) |
| `customer_age` | integer | 고객 나이 |
| `followup_status` | text | pending→contacted→scheduled→converted/lost |
| `followup_note` | text | 팔로업 메모 |
| `next_check_at` | timestamptz | 다음 체크 시각 |
| `lost_reason/lost_reason_detail` | text | 이탈 사유 |

**현재 상태:** AI(Gemini)가 대화를 분석하여 구조화된 결과를 생성. 품질 점수, 전환 여부, 고객 정보 추출까지 자동화되어 있음. 팔로업 퍼널(5단계)도 이미 구현됨.

**문제점:** `summary`가 2-3문장으로 압축되어 원본 맥락이 손실됨. 시술 종류가 자유 텍스트라 정규화 안 됨.

### 1.3 `messages` — 내부 채팅 메시지

| 컬럼 | 타입 | 용도 |
|------|------|------|
| `task_id` | uuid FK | 연결된 태스크/채팅방 |
| `sender_id` | uuid FK | 발신자 |
| `content` | text | 원본 메시지 |
| `content_ko` | text | 한국어 번역 |
| `content_th` | text | 태국어 번역 |
| `sender_lang` | text | 발신 언어 (ko/th) |
| `is_whisper` | boolean | 내부 귓속말 |
| `file_url/file_name/file_type` | text | 첨부 파일 |
| `mentions` | jsonb | @멘션 |
| `created_at` | timestamptz | 시계열 |

**현재 상태:** 한-태 이중 언어 메시지가 원본+번역 쌍으로 저장. Realtime 구독으로 즉시 반영. `task_id`로 대화 스레드 추적 가능.

**문제점:** 내부 팀 소통(한국 고객사↔태국 워커)이므로, 고객(환자) 응대 데이터와는 별도 시스템. RAG 학습 데이터로는 Zendesk이 더 직접적.

### 1.4 `tasks` — 업무 관리

| 주요 컬럼 | 용도 |
|-----------|------|
| `content/content_th` | 업무 제목 (한/태) |
| `description/description_th` | 상세 가이드 (한/태) |
| `status` | pending/done |
| `source` | client(고객사 지시) / worker_proposed(워커 제안) |
| `rating` (1-5) | 업무 완료 평가 |
| `due_date` | 마감일 |
| `created_by` | 생성자 |

**현재 상태:** 업무 지시-완료-평가 사이클이 추적됨. `rating`으로 업무 품질 평가 가능.

### 1.5 `quick_replies` — 응답 템플릿

| 주요 컬럼 | 용도 |
|-----------|------|
| `client_id` | 병원별 분류 (null=전사 공용) |
| `title_ko/title_th` | 제목 한/태 |
| `body_ko/body_th` | 본문 한/태 |
| `display_order` | 정렬 순서 |

**현재 상태:** 병원별 또는 전사 공용으로 분류된 응답 템플릿. RAG의 "골든 응답" 후보.

**문제점:** 어떤 상황/질문에 이 템플릿을 쓰는지에 대한 메타데이터(트리거 조건, 적용 시나리오)가 없음.

### 1.6 `followup_actions` — 팔로업 조치 이력 (Human-in-the-Loop 핵심)

워커 조치, AI 지시, 시스템 노트를 시간순으로 기록하는 이벤트 소싱 테이블. **자동 응답 시스템의 Human-in-the-Loop 패턴을 지탱하는 핵심 인프라.**

```sql
CREATE TABLE followup_actions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id BIGINT NOT NULL,
  action_type TEXT NOT NULL,  -- 'worker_action' | 'ai_instruction' | 'system_note' | 'auto_reply' | 'auto_reply_draft'
  content TEXT NOT NULL,       -- 한국어 (어드민용)
  content_th TEXT,             -- 태국어 (워커/고객용)
  status_before TEXT,
  status_after TEXT,
  zendesk_changes JSONB,       -- Zendesk 변화 감지 데이터
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ DEFAULT NULL
);
```

| action_type | 용도 | Human-in-the-Loop 역할 |
|-------------|------|----------------------|
| `worker_action` | 워커가 수행한 조치 기록 | 사람의 행동 로그 |
| `ai_instruction` | AI가 생성한 다음 행동 지시 | AI → 사람 지시 |
| `system_note` | 시스템 자동 메모 (revert, 실패 등) | 시스템 이벤트 |
| `auto_reply` | AI가 자동 전송한 응답 | AI 자율 행동 (추적용) |
| `auto_reply_draft` | AI 응답 초안 (워커 승인 대기) | AI → 사람 승인 요청 |

**RAG 자동 응답과의 연계:**
- 확신도 높음 → `auto_reply` 타입으로 기록, Zendesk에 자동 전송
- 확신도 낮음 → `auto_reply_draft` 타입으로 기록, 워커가 수정/승인 후 전송
- 워커 승인 시 → `worker_action` 타입으로 추가 기록 (피드백 루프 데이터)
- 모든 AI 행동이 이력에 남아 **감사 추적(audit trail)** 가능

### 1.7 `followup_notifications` — 알림 (워커 개입 트리거)

```sql
CREATE TABLE followup_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  action_id UUID NOT NULL REFERENCES followup_actions(id),
  ticket_id BIGINT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  channel TEXT DEFAULT 'in_app',  -- 'in_app' | 'line' | 'email'
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ DEFAULT NULL
);
```

**Human-in-the-Loop 트리거:** AI가 확신도 낮은 응답을 생성하거나, 고객이 부정적 반응을 보이면, 이 테이블을 통해 워커에게 즉시 알림이 발송됨. 워커가 개입해야 하는 시점을 시스템이 자동으로 판단.

### 1.8 `zendesk_analyses` — 팔로업 사이클 제어 컬럼 (추가됨)

```sql
-- 자동 체크 사이클 제어
ALTER TABLE zendesk_analyses
  ADD COLUMN next_check_at TIMESTAMPTZ DEFAULT NULL,      -- 다음 체크 예정 시각
  ADD COLUMN last_checked_at TIMESTAMPTZ DEFAULT NULL,     -- 마지막 체크 시각
  ADD COLUMN last_zendesk_comment_id TEXT DEFAULT NULL,     -- 변화 감지용
  ADD COLUMN check_count INTEGER DEFAULT 0;                -- 체크 횟수 (무한루프 방지, 최대 20)

-- Lost 사유 추적
ALTER TABLE zendesk_analyses
  ADD COLUMN lost_reason TEXT DEFAULT NULL,                 -- no_response|customer_rejected|competitor|price_issue|other
  ADD COLUMN lost_reason_detail TEXT DEFAULT NULL;           -- 기타 사유 상세
```

**RAG 학습 데이터 가치:**
- `lost_reason` — 이탈 패턴 분석 → 자동 응답 시 비슷한 패턴 감지하면 선제적 대응
- `check_count` — 체크 횟수가 많을수록 난이도 높은 케이스 → 자동 응답 제외 후보
- `last_zendesk_comment_id` — 새 댓글 감지로 자동 응답 트리거 판단

### 1.9 `profiles` / `clients`

- **profiles:** role(bbg_admin/client/worker/hospital), client_id, display_name, hospital_prefix
- **clients:** id, name만 존재. 병원 상세 정보(시술 목록, 가격대, 위치 등) 없음.

---

## 2. 데이터 흐름 추적

### 2.1 고객 문의 → 응답 → 예약 전환 데이터 경로

```
[고객] → Zendesk 티켓 생성
    ↓
[Zendesk Cron] 매일 09:00/16:00 KST
    ↓ Incremental Sync (최신 updated_at 이후)
    ↓ zendesk.fetchTicketsPage() + fetchTicketComments()
    ↓
[zendesk_tickets] ← upsert (subject, description, comments jsonb, tags...)
    ↓
[AI 분석] 댓글 4개 이상 & 미분석 티켓 → Gemini 2.5 Flash
    ↓
[zendesk_analyses] ← insert (quality_score, reservation_converted, summary, customer_*)
    ↓
[followup-check Cron] 매시간 정각
    ↓ contacted/scheduled 상태 & next_check_at 도래
    ↓ Zendesk 최신 댓글 확인 + AI 지시 생성
    ↓
[followup_actions] ← ai_instruction insert
[followup_notifications] ← 워커에게 알림
    ↓
[워커] WorkerFollowup에서 확인 → 상태 변경 (contacted→scheduled→converted/lost)
```

**핵심 발견:** 고객의 원본 대화(`comments` JSONB)부터 AI 분석(`zendesk_analyses`), 팔로업 액션(`followup_actions`), 최종 전환 결과(`followup_status`)까지 **전체 세일즈 퍼널이 이미 DB에 기록**되고 있음.

### 2.2 Zendesk 동기화 상세

- **동기화 주기:** 하루 2회 (09:00, 16:00 KST) + 수동 트리거 가능
- **방식:** Incremental — 마지막 `synced_at` 이후 변경된 티켓만
- **댓글:** 전체 대화 히스토리가 JSONB로 저장 (`author_id`, `body`, `created_at`, `public`)
- **AI 분석 조건:** `status IN ('open','pending','new')` & 댓글 4개 이상 & 미분석

### 2.3 AI 분석 프롬프트 (현재)

```
You are analyzing a customer support ticket from a medical tourism agency (BBG)
that connects Thai customers with Korean hospitals.

Analyze the following support ticket conversation and return a JSON response with:
- quality_score (1-5)
- reservation_converted (boolean)
- needs_followup (boolean)
- followup_reason (string or null)
- summary (string, 한국어 2-3문장)
- issues (string[])
- hospital_name (string or null)
- customer_name (string or null)
- customer_phone (string or null)
- interested_procedure (string or null, 한국어)
- customer_age (number or null)
```

### 2.4 채팅 메시지 생성-번역 흐름

```
[사용자 입력] → ChatPanel/TaskChat
    ↓ supabase.from('messages').insert({content, sender_lang})
    ↓ (비동기) POST /api/translate {text, targetLang}
    ↓ Gemini 2.5 Flash 번역
    ↓ supabase.from('messages').update({content_ko 또는 content_th})
    ↓ Realtime subscription으로 UI 즉시 반영
```

### 2.5 Webhook vs Cron 공존 전략

현재 Zendesk 연동은 **Pull 방식** (하루 2회 cron이 데이터를 당겨옴)이다. 자동 응답은 **Push 방식** (Zendesk webhook이 실시간으로 밀어줌)이 필요하다. 두 방식이 공존할 때 발생하는 동기화 문제와 해결책:

**문제:** Webhook으로 새 댓글을 실시간 수신했지만, cron이 아직 안 돌아서 `zendesk_tickets.comments` JSONB에는 이전 버전만 있는 상황.

**해결책:**
1. **Webhook은 자체 컨텍스트를 사용한다** — Webhook 수신 시 `zendesk_tickets.comments`를 참조하지 않고, Zendesk API로 직접 최신 댓글을 조회한다 (`GET /api/v2/tickets/{id}/comments`). 로컬 DB는 참조하지 않음.
2. **Cron은 기존대로 전체 동기화** — 하루 2회 전체 댓글 히스토리를 JSONB로 갱신. RAG 학습 데이터와 분석용.
3. **역할 분리:**
   - Cron = **학습/분석용** 데이터 수집 (배치, 정확성 중시)
   - Webhook = **실시간 응답용** 이벤트 처리 (실시간, 속도 중시)
4. **Webhook이 댓글을 처리한 후** `zendesk_analyses.last_zendesk_comment_id`를 갱신하여, 팔로업 check cron이 중복 처리하지 않도록 한다.

```
[Cron 패턴 — Pull, 배치]
매일 09:00/16:00 → Zendesk API 전체 조회 → zendesk_tickets 갱신 → AI 분석 → qa_pairs 생성

[Webhook 패턴 — Push, 실시간]
고객 댓글 → Zendesk Trigger → /api/rag/auto-reply → Zendesk API 직접 조회(최신) → AI 응답 → Zendesk 댓글 추가
```

---

## 3. RAG 자동화 관점 Gap 분석

### 3.1 데이터 품질

#### Q: 고객 문의-응답 1:1 매칭이 가능한가?

**현재 상태:** `zendesk_tickets.comments` JSONB에 시계열 순서로 `[{author_id, body, created_at, public}]`이 저장됨.

**결론: 부분적으로 가능.** `author_id`로 고객 vs 에이전트를 구분하면 질문-응답 쌍을 추출할 수 있으나:
- `author_id`는 Zendesk 숫자 ID라 `requester_id`와 비교해야 고객인지 판단 가능
- 다중 에이전트가 관여하면 복잡해짐
- 댓글 간 시간 간격으로 "하나의 대화 턴"을 정의해야 함

**Gap:** 댓글에 `role` (customer/agent) 태그가 없음. 전처리 파이프라인 필요.

#### Q: 예약 전환 성공/실패 구분 가능한가?

**현재 상태:** ✅ **가능.**
- `zendesk_analyses.reservation_converted` (boolean) — AI가 대화에서 판단
- `zendesk_analyses.followup_status` — `converted` vs `lost` (워커 수동 확인)
- `zendesk_analyses.lost_reason` / `lost_reason_detail` — 이탈 사유

이 조합으로 성공/실패 케이스를 명확히 구분 가능. 특히 `lost_reason`은 이탈 패턴 분석에 유용.

#### Q: 응답 품질 평가 데이터가 있는가?

**현재 상태:** ✅ **있음, 2개 레벨.**
- `zendesk_analyses.quality_score` (1-5) — AI가 평가한 에이전트 응대 품질
- `tasks.rating` (1-5) — 고객사가 평가한 워커 업무 품질

**Gap:** 고객(환자) 직접 만족도 피드백은 없음. CSAT 연동 미구현.

#### Q: 시술 종류, 국적, 예산대 세분화가 가능한가?

**현재 상태:**
- `interested_procedure` ✅ 있음 — 단, **자유 텍스트** (정규화 안 됨)
- `customer_age` ✅ 있음
- `hospital_name` ✅ 있음
- `customer_name` ✅ 있음
- **시술 카테고리** ❌ **없음** (눈성형/코성형 등 자유입력, AI가 Q&A 추출 시 정규화 가능)

### 3.2 검색/임베딩

#### Q: 벡터 검색을 위한 최적 텍스트 필드 조합?

**제안 — Q&A 쌍 임베딩:**

`qa_pairs` 테이블의 각 Q&A 쌍(고객 질문 + 에이전트 응답)을 하나의 문서로 결합하여 임베딩한다. 분석 요약이나 템플릿은 별도 임베딩 레이어 없이, 검색 결과에 메타데이터로 조인하여 LLM 컨텍스트에 포함시키면 충분하다.

#### Q: 한국어/태국어 이중 언어 임베딩?

**제안: 한국어 기준으로 임베딩.**
- `summary`, `issues`, `followup_reason`은 이미 한국어로 저장
- `interested_procedure`도 한국어
- 태국어 원문은 검색 후 표시용으로 활용
- 다국어 임베딩 모델(multilingual-e5-large 등)을 쓰면 태국어 쿼리도 한국어 문서에서 검색 가능

단, 실제 고객 응대는 태국어로 이루어지므로, **태국어 쿼리 → 한국어 임베딩 검색** 성능을 검증해야 함. 대안으로 두 언어 모두 임베딩하고 쿼리 언어에 따라 선택.

#### Q: Supabase pgvector 사용 가능 상태인가?

**현재 상태: ❌ 미설정.** 마이그레이션 파일에 pgvector 관련 설정 없음. Supabase는 pgvector 확장을 지원하므로 활성화만 하면 됨:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 3.3 누락 데이터

#### Q: RAG에 필수이지만 현재 없는 필드/테이블?

| 필요 항목 | 현재 상태 | 중요도 |
|-----------|-----------|--------|
| **Q&A 쌍 테이블** | comments가 JSONB 덩어리로 존재 | 🔴 필수 |
| **응답 성공 여부** (개별 턴 레벨) | 전체 티켓 레벨만 있음 | 🟡 높음 |
| **임베딩 벡터 컬럼** | 없음 | 🔴 필수 |
| **병원 상세 정보** (시술 목록, 가격표) | clients에 name만 | 🟡 높음 |
| **고객 만족도 (CSAT)** | 없음 | 🟢 나중 |
| **응답 시간 메트릭** (개별 턴) | first_response_at만 | 🟢 나중 |

#### Q: 세일즈 퍼널 추적 구조가 있는가?

**현재 상태: ✅ 부분적으로 있음.**

```
첫 문의 (zendesk_tickets 생성)
  → 상담 (comments 축적, quality_score 평가)
    → 팔로업 (needs_followup=true, followup_status)
      → 예약 확정 (reservation_converted=true, followup_status='converted')
      → 이탈 (followup_status='lost', lost_reason)
```

**Gap:** "견적 제공" 단계가 명시적으로 추적되지 않음. 가격 협의 과정은 comments 안에 묻혀 있음.

#### Q: 고객별 대화 세션을 하나의 "케이스"로 묶을 수 있는 키?

**현재 상태: ✅ `ticket_id`가 케이스 키.** Zendesk 티켓 1개 = 1 케이스. `zendesk_tickets.ticket_id` → `zendesk_analyses.ticket_id` → `followup_actions.ticket_id`로 전체 연결.

**Gap:** 같은 고객이 다른 시술/병원으로 재문의하면 별도 티켓이 됨. `requester_email` GROUP BY로 고객 레벨 통합 뷰를 쿼리할 수 있으며, 별도 `customers` 테이블은 실제 필요성 확인 후 추가.

---

## 4. 구체적 제안

### 4.1 지금 당장 추가해야 할 DB 변경

#### (A) pgvector 활성화 + 임베딩 테이블

```sql
-- 1. pgvector 확장 활성화
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Q&A 쌍 + 임베딩 테이블 (RAG의 핵심)
CREATE TABLE qa_pairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id bigint NOT NULL REFERENCES zendesk_tickets(ticket_id),
  turn_index integer NOT NULL,  -- 대화에서 몇 번째 턴인지
  
  -- 원본 데이터
  customer_message text NOT NULL,
  agent_response text NOT NULL,
  customer_author_id bigint,
  agent_author_id bigint,
  
  -- 메타데이터
  customer_message_at timestamptz,
  agent_response_at timestamptz,
  response_time_minutes integer,  -- 응답 소요 시간
  
  -- 분류 (AI가 Q&A 쌍 생성 시 자동 추출/정규화)
  hospital_name text,
  procedure_category text,  -- AI가 자유 텍스트에서 정규화 (e.g., '눈성형', '코성형')
  
  -- 품질 지표
  is_good_response boolean,  -- 이 턴이 좋은 응답이었는지
  led_to_conversion boolean, -- 이 턴 이후 전환으로 이어졌는지
  
  -- 임베딩
  embedding_ko vector(768),  -- 한국어 임베딩
  embedding_th vector(768),  -- 태국어 임베딩 (선택)
  
  created_at timestamptz DEFAULT now(),
  
  UNIQUE(ticket_id, turn_index)
);

CREATE INDEX idx_qa_pairs_ticket ON qa_pairs(ticket_id);
CREATE INDEX idx_qa_pairs_hospital ON qa_pairs(hospital_name);
CREATE INDEX idx_qa_pairs_procedure ON qa_pairs(procedure_category);
CREATE INDEX idx_qa_pairs_embedding_ko ON qa_pairs 
  USING ivfflat (embedding_ko vector_cosine_ops) WITH (lists = 100);
```

#### (B) 고객 통합 뷰

별도 `customers` 테이블은 만들지 않는다. 고객 통합 뷰는 쿼리 레벨에서 `requester_email` GROUP BY로 충분. 별도 테이블은 실제 필요성 확인 후 추가.

```sql
-- 예: 고객별 문의 통계 조회
SELECT
  zt.requester_email,
  zt.requester_name,
  COUNT(*) AS total_inquiries,
  COUNT(*) FILTER (WHERE za.reservation_converted = true) AS conversions
FROM zendesk_tickets zt
LEFT JOIN zendesk_analyses za ON za.ticket_id = zt.ticket_id
GROUP BY zt.requester_email, zt.requester_name;
```

#### (C) zendesk_analyses 보강 컬럼

```sql
ALTER TABLE zendesk_analyses
  ADD COLUMN IF NOT EXISTS procedure_category text,  -- 정규화된 카테고리
  ADD COLUMN IF NOT EXISTS total_turns integer;       -- 대화 턴 수
```

### 4.2 코드 수정 포인트

#### (A) Q&A 쌍 추출 파이프라인 추가

**수정 대상:** `/api/zendesk/cron/route.ts` (Step 2 이후에 Step 3 추가)

```typescript
// Step 3: Extract Q&A pairs from analyzed tickets
async function extractQAPairs(ticket: any, analysis: any) {
  const comments = ticket.comments || [];
  const requesterId = ticket.requester_id; // Zendesk 고객 ID
  const pairs = [];
  
  for (let i = 0; i < comments.length - 1; i++) {
    const current = comments[i];
    const next = comments[i + 1];
    
    // 고객 메시지 → 에이전트 응답 순서
    if (current.author_id === requesterId && next.author_id !== requesterId) {
      pairs.push({
        ticket_id: ticket.ticket_id,
        turn_index: pairs.length,
        customer_message: current.body,
        agent_response: next.body,
        customer_author_id: current.author_id,
        agent_author_id: next.author_id,
        customer_message_at: current.created_at,
        agent_response_at: next.created_at,
        hospital_name: analysis?.hospital_name,
        procedure_category: analysis?.procedure_category,
      });
    }
  }
  
  return pairs;
}
```

#### (B) AI 분석 프롬프트 확장

**수정 대상:** `/api/zendesk/analyze/route.ts`의 `buildAnalysisPrompt`

현재 추출하는 필드에 추가:
- `procedure_category` — 정규화된 시술 카테고리 (AI가 자유 텍스트에서 추출)
- `total_turns` — 대화 턴 수
- `best_response_turn` — 가장 효과적이었던 응답의 인덱스

#### (C) 임베딩 생성 API 신규

**신규 생성:** `/api/rag/embed/route.ts`

Q&A 쌍이 생성될 때 비동기로 임베딩 생성. Gemini의 `text-embedding-004` 또는 OpenAI의 `text-embedding-3-small` 사용.

#### (D) Quick Reply에 트리거 조건 추가

**수정 대상:** `quick_replies` 테이블 + `QuickReplyManager.tsx`

```sql
ALTER TABLE quick_replies 
  ADD COLUMN IF NOT EXISTS trigger_keywords text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS applicable_procedures text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS usage_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS success_rate numeric(3,2);  -- 이 템플릿 사용 후 전환율
```

### 4.3 RAG 파이프라인 초안 아키텍처

```
┌──────────────────────────────────────────────────┐
│                 데이터 수집 레이어                   │
├──────────────────────────────────────────────────┤
│                                                  │
│  [Zendesk Cron] → zendesk_tickets (comments)     │
│       ↓                                          │
│  [AI 분석] → zendesk_analyses (summary, meta)    │
│       ↓                                          │
│  [Q&A 추출] → qa_pairs (customer_msg + agent_rsp)│
│       ↓                                          │
│  [임베딩 생성] → qa_pairs.embedding_ko (vector)   │
│                                                  │
│  [Quick Reply] → quick_replies (body, trigger)   │
│       ↓                                          │
│  [임베딩 생성] → 별도 embedding 또는 quick_replies │
│                                                  │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│               RAG 검색 레이어                      │
├──────────────────────────────────────────────────┤
│                                                  │
│  [워커 쿼리] "고객이 코성형 가격을 물어봄"           │
│       ↓                                          │
│  1. 쿼리 임베딩 생성                               │
│  2. pgvector 유사도 검색 (cosine similarity)       │
│     - qa_pairs에서 Top-5 유사 Q&A                 │
│     - quick_replies에서 Top-3 관련 템플릿          │
│  3. 메타데이터 필터링                               │
│     - hospital_name = 현재 상담 병원               │
│     - procedure_category = 관련 시술               │
│     - is_good_response = true (품질 필터)          │
│     - led_to_conversion = true (성공 사례 우선)    │
│                                                  │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│               응답 생성 레이어                      │
├──────────────────────────────────────────────────┤
│                                                  │
│  [Gemini 2.5 Flash]                              │
│                                                  │
│  System Prompt:                                  │
│  "BBG 의료관광 에이전시의 세일즈 어시스턴트.          │
│   아래 과거 성공 사례와 템플릿을 참고하여             │
│   태국어로 자연스러운 응답 3개를 생성하라."           │
│                                                  │
│  Context:                                        │
│  - 유사 Q&A 성공 사례 5건                          │
│  - 관련 Quick Reply 템플릿 3건                     │
│  - 현재 고객 프로필 (국적, 관심 시술, 예산)          │
│  - 현재 대화 컨텍스트 (최근 3턴)                    │
│                                                  │
│  Output:                                         │
│  - 추천 응답 3개 (태국어)                           │
│  - 각 응답의 근거 (어떤 성공 사례 참조)              │
│  - 추가 질문 제안 (정보 부족 시)                     │
│                                                  │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│            자동 응답 레이어 (Zendesk 경유)            │
├──────────────────────────────────────────────────┤
│                                                  │
│  [Zendesk Webhook] 고객 새 댓글 도착               │
│       ↓                                          │
│  [/api/rag/auto-reply] 수신                       │
│       ↓                                          │
│  RAG 검색 + AI 응답 생성                            │
│       ↓                                          │
│  [확신도 체크]                                     │
│   ├─ Phase 5 초기: 전량 워커 승인 (auto_reply_draft)│
│   │    → 워커 승인/수정/거절 데이터 축적             │
│   │                                              │
│   └─ Phase 5 안정기: 데이터 기반 임계값 적용         │
│        ├─ 임계값 이상: Zendesk 자동 전송            │
│        └─ 임계값 미만: 워커 승인 후 전송             │
│                                                  │
└──────────────────────────────────────────────────┘
```

**SQL 검색 쿼리 예시:**

```sql
-- 유사 Q&A 검색 (pgvector)
SELECT 
  qp.customer_message,
  qp.agent_response,
  qp.hospital_name,
  qp.procedure_category,
  qp.led_to_conversion,
  za.quality_score,
  1 - (qp.embedding_ko <=> $1) AS similarity
FROM qa_pairs qp
LEFT JOIN zendesk_analyses za ON za.ticket_id = qp.ticket_id
WHERE 
  qp.is_good_response = true
  AND ($2::text IS NULL OR qp.hospital_name = $2)
  AND ($3::text IS NULL OR qp.procedure_category = $3)
ORDER BY qp.embedding_ko <=> $1
LIMIT 5;
```

### 4.4 예상 타임라인

| 단계 | 작업 | 예상 기간 | 의존성 |
|------|------|-----------|--------|
| **Phase 1: 데이터 기반** | | **1-2주** | |
| 1-1 | pgvector 활성화 + qa_pairs 테이블 생성 | 1일 | - |
| 1-2 | Q&A 쌍 추출 파이프라인 (cron 확장) | 2-3일 | 1-1 |
| 1-3 | 기존 댓글 backfill (과거 데이터 변환) | 1-2일 | 1-2 |
| 1-4 | AI 분석 프롬프트 확장 (procedure_category, total_turns) | 1일 | - |
| **Phase 2: 임베딩** | | **1주** | Phase 1 |
| 2-1 | 임베딩 모델 선정 및 테스트 (Gemini text-embedding-004 vs OpenAI) | 2일 | - |
| 2-2 | 임베딩 생성 파이프라인 구현 | 2일 | 2-1 |
| 2-3 | 기존 Q&A 쌍 임베딩 backfill | 1일 | 2-2 |
| 2-4 | pgvector 인덱스 튜닝 | 1일 | 2-3 |
| **Phase 3: RAG API** | | **1-2주** | Phase 2 |
| 3-1 | `/api/rag/search` — 유사 Q&A 검색 API | 2-3일 | - |
| 3-2 | `/api/rag/suggest` — 응답 생성 API (Gemini + 검색 결과) | 2-3일 | 3-1 |
| 3-3 | Quick Reply 임베딩 + 통합 검색 | 1-2일 | 3-1 |
| **Phase 4: UI 통합** | | **1주** | Phase 3 |
| 4-1 | WorkerFollowup에 "AI 추천 응답" 패널 추가 | 2-3일 | - |
| 4-2 | 추천 응답 선택 → Zendesk 전송 연동 | 2-3일 | 4-1 |
| 4-3 | 피드백 루프 (워커가 추천 채택/수정/거부 기록) | 1일 | 4-2 |
| **총 MVP** | | **4-6주** | |

> **Phase 5 (자동 응답):** Phase 1-4 MVP의 결과(검색 정확도, 워커 채택률)를 검증한 후 설계한다. 상세 기획은 섹션 6 참조. MVP 검증 없이 자동 응답을 구축하면 Phase 1-4의 품질 문제가 고객에게 직접 노출되는 리스크가 있다.

---

## 5. 핵심 요약

### 지금 가장 잘 되어 있는 것

1. **Zendesk 대화 전체가 JSONB로 보존됨** — RAG 학습 데이터의 원천
2. **AI 분석 파이프라인이 이미 가동 중** — quality_score, reservation_converted, summary 자동 생성
3. **팔로업 퍼널 5단계가 구현됨** — 전환 성공/실패 라벨링 데이터 축적 중
4. **이중 언어 번역 인프라 존재** — Gemini 번역 파이프라인 재활용 가능

### 가장 시급한 Gap

1. **Q&A 쌍 정규화 테이블 부재** — comments JSONB를 구조화된 학습 데이터로 변환하는 레이어 필요
2. **pgvector 미설정** — 벡터 검색 인프라가 아예 없음
3. **시술 카테고리 정규화 미흡** — 자유 텍스트로만 존재하여 필터링 불가 (AI가 Q&A 추출 시 정규화 가능)
4. **Quick Reply에 컨텍스트 메타 부재** — 어떤 상황에 쓰는 템플릿인지 정의 없음

### 가장 빠른 ROI

**Phase 1 + 2만 완료해도** (2-3주), 기존 데이터로 "이 고객과 비슷한 문의에서 전환에 성공한 응답 사례"를 검색할 수 있는 시스템 구축 가능. Gemini로 응답을 생성하는 Phase 3-4는 검색 기반 시스템이 안정된 후 추가하는 것이 리스크 적음.

**Phase 5 (자동 응답)은 Phase 1-4 MVP 결과를 보고 착수 여부를 결정한다.** MVP에서 RAG 검색 정확도 80% 이상, 워커 추천 응답 채택률 60% 이상이 확인되면 자동 응답으로 확장. 그 전까지는 워커 보조 도구에 집중한다.

---

## 6. 자동 응답 시스템 (Zendesk 경유)

**전제 조건:** 이 섹션의 모든 내용은 Phase 1-4 MVP가 정상 가동되고, RAG 검색 품질이 검증된 이후에 착수한다. Phase 1-4가 실패하면 이 섹션은 폐기한다.

기존 RAG 시스템(Phase 1-4)이 "워커에게 응답을 추천"하는 보조 도구라면, 이 섹션은 **AI가 직접 고객에게 응답하는 자동화 시스템**을 다룬다.

핵심 아이디어: 챗봇이 Facebook/LINE API를 직접 호출하는 대신, **Zendesk Ticket API에 공개 댓글(public comment)**을 작성한다. Zendesk의 기존 채널 통합(Channel Integration)이 해당 댓글을 고객이 사용한 원래 채널(Facebook, LINE, 웹 위젯, 이메일)로 자동 전달한다.

**이 방식의 장점:**
- **단일 통합 포인트** — Zendesk API 하나만 연동하면 모든 채널 커버
- **채널 자동 전달** — Zendesk가 Facebook/LINE/이메일/웹 전송을 자동 처리
- **대화 자동 기록** — 모든 자동 응답이 Zendesk 티켓에 자동 로깅
- **기존 워크플로우 유지** — 워커가 사용하는 Zendesk 인터페이스에서 자동 응답 이력 확인 가능

### 6.1 아키텍처

```
고객 메시지 (Facebook/LINE/웹/이메일)
    ↓
Zendesk Channel Integration (이미 연동됨)
    ↓
Zendesk 티켓에 고객 메시지 도착
    ↓
Zendesk Trigger/Webhook → SyncBridge API 호출
    ↓
RAG 검색 (qa_pairs + quick_replies + 병원 정보)
    ↓
AI 응답 생성 (Gemini)
    ↓
[확신도 체크]
  ├─ Phase 5 초기: 전량 워커 승인 (auto_reply_draft)
  │    → 워커 승인/수정/거절 데이터 축적
  │
  └─ Phase 5 안정기: 데이터 기반 임계값 적용
       ├─ 임계값 이상: Zendesk 자동 전송 (auto_reply)
       │    → followup_actions에 'auto_reply' 기록
       └─ 임계값 미만: 워커 승인 (auto_reply_draft)
            → 워커가 수정 후 승인 → Zendesk 댓글 추가
```

### 6.2 Zendesk Webhook 설정

Zendesk Admin Center에서 Trigger + Webhook을 설정하여, 고객이 새 댓글을 남길 때마다 SyncBridge API를 호출하도록 구성한다.

**Trigger 설정:**
- **위치:** Zendesk Admin > Objects and rules > Triggers
- **이름:** "New Customer Comment → SyncBridge Auto-Reply"
- **조건 (Conditions):**
  - `Comment is public`
  - `Current user is (end-user)` — 고객이 남긴 댓글만
  - `Ticket status is not Solved/Closed`
- **액션 (Action):**
  - Notify webhook → POST to `https://{our-domain}/api/rag/auto-reply`

**Webhook 페이로드:**

```json
{
  "ticket_id": "{{ticket.id}}",
  "ticket_subject": "{{ticket.title}}",
  "comment_body": "{{ticket.latest_comment}}",
  "requester_name": "{{ticket.requester.name}}",
  "requester_email": "{{ticket.requester.email}}",
  "ticket_tags": "{{ticket.tags}}",
  "ticket_status": "{{ticket.status}}"
}
```

### 6.3 자동 응답 API 설계

**신규 엔드포인트:** `POST /api/rag/auto-reply`

```typescript
// /api/rag/auto-reply/route.ts

export async function POST(request: Request) {
  // 1. Zendesk webhook payload parsing
  const { ticket_id, comment_body, requester_name, ticket_tags } = await request.json();

  // 2. Verify webhook authenticity (shared secret or IP whitelist)

  // 3. Fetch ticket context
  //    - Previous comments from zendesk_tickets.comments
  //    - Existing analysis from zendesk_analyses
  //    - Auto-reply count for this ticket (safety limit check)

  // 3b. Check if ticket is in followup tracking cycle
  //     If auto-reply is active, exclude from followup-check cron
  //     to prevent dual AI intervention

  // 4. Safety checks (blacklist keywords, reply count limit, etc.)
  //    → If blocked, create followup_action with type 'needs_human' and return

  // 5. RAG search
  //    - Generate embedding for customer message
  //    - Search qa_pairs for similar Q&A (top 5)
  //    - Search quick_replies for matching templates (top 3)
  //    - Filter by hospital (from ticket tags)

  // 6. AI response generation (Gemini)
  //    - System prompt: BBG sales assistant, respond in Thai
  //    - Context: similar Q&A + templates + ticket history
  //    - Output: response text + confidence score (0-1)

  // 7. Confidence check against hospital-specific threshold
  const threshold = hospitalSettings?.confidence_threshold ?? 1.0; // default: all need approval
  if (confidence >= threshold) {
    // 7a. Auto-reply: POST to Zendesk Ticket API
    await postZendeskComment(ticket_id, responseText, botAgentId);
    // Record in followup_actions with type 'auto_reply'
  } else {
    // 7b. Draft for worker review
    // Create followup_action with type 'auto_reply_draft'
    // Include generated response as draft
    // Send notification to assigned worker
  }
}
```

**처리 흐름 상세:**

1. Zendesk webhook에서 고객의 새 댓글 수신
2. 티켓 컨텍스트 로드 (이전 대화, 분석 결과)
3. RAG 검색으로 유사 Q&A + 관련 템플릿 확보
4. Gemini로 태국어 응답 생성 + 확신도 평가
5. 확신도 기준에 따라 자동 응답 또는 워커 이관

### 6.4 응답 가능 범위 (자동 vs 이관)

| 자동 응답 가능 | 워커 이관 필요 |
|--------------|--------------|
| FAQ (가격, 위치, 영업시간) | 의료 상담/부작용 질문 |
| 시술 기본 정보 | 가격 협상/할인 요청 |
| 예약 안내/절차 설명 | 클레임/불만 |
| 초기 인사 + 관심 시술 확인 | 복잡한 비교 상담 |
| 간단한 후속 안내 | 재방문/재시술 관련 |

### 6.5 안전장치

1. **초기 전략: 전량 워커 승인 모드 (Human-in-the-Loop 100%).** Phase 5 초기에는 자동 전송 없이 모든 AI 응답을 `auto_reply_draft`로 생성하여 워커 승인을 거친다. 워커가 승인/수정/거절한 데이터가 충분히 쌓이면(최소 200건+), 승인율과 수정 패턴을 분석하여 데이터 기반으로 자동 전송 임계값을 산출한다. 임계값은 병원별, 시술 카테고리별로 다를 수 있으며, `hospital_auto_reply_settings.confidence_threshold`에 개별 설정 가능.

2. **블랙리스트 키워드:** 의료 부작용, 법적 문제, 경쟁사 비교, 환불/취소 등의 키워드가 고객 메시지에 포함되면 무조건 워커 이관.

```typescript
const BLACKLIST_KEYWORDS_TH = [
  'ผลข้างเคียง',    // side effects
  'แพ้',            // allergic reaction
  'ฟ้องร้อง',        // lawsuit
  'คืนเงิน',        // refund
  'ไม่พอใจ',        // dissatisfied
  'เปรียบเทียบ',    // compare (competitors)
];
```

3. **응답 횟수 제한:** 같은 티켓에 연속 3회 자동 응답 시 워커 이관. 고객이 반복적으로 질문한다는 것은 자동 응답이 충분하지 않다는 신호.

4. **첫 응답만 자동:** 신규 티켓의 첫 응답만 자동 응답 허용. 이후 대화 턴은 워커 승인 모드로 전환 (워커가 자동 응답을 다시 활성화할 수 있음).

5. **워커 오버라이드:** 워커가 특정 티켓 또는 특정 고객에 대해 자동 응답을 끄고 직접 대응 가능. 병원별 설정에서도 자동 응답 ON/OFF 제어.

6. **팔로업 Cron 제외:** 자동 응답이 활성화된 티켓(`followup_actions`에 최근 `auto_reply` 레코드가 있는 티켓)은 팔로업 check cron(`/api/zendesk/followup-check`)에서 제외한다. 자동 응답 시스템과 팔로업 시스템이 같은 티켓에 동시에 개입하면 워커에게 이중 알림이 가고, AI 지시가 충돌한다. 자동 응답 모드에서 워커가 수동 개입하면 해당 티켓은 팔로업 시스템으로 전환된다.

### 6.6 Zendesk API 호출 예시

**자동 응답 댓글 추가:**

```
POST /api/v2/tickets/{ticket_id}.json
Authorization: Basic {base64(email/token:api_token)}
Content-Type: application/json

{
  "ticket": {
    "comment": {
      "body": "สวัสดีค่ะ ขอบคุณที่สนใจบริการของเรา...",
      "public": true,
      "author_id": {bot_agent_zendesk_id}
    }
  }
}
```

> **참고:** 전용 Zendesk 에이전트 계정(예: "BBG AI Assistant")을 생성하여 `author_id`로 사용. 이렇게 하면 자동 응답과 워커 수동 응답을 명확히 구분할 수 있고, Zendesk 리포트에서도 별도 추적 가능.

**티켓 최신 댓글 조회 (컨텍스트용):**

```
GET /api/v2/tickets/{ticket_id}/comments.json?sort_order=desc&per_page=10
Authorization: Basic {base64(email/token:api_token)}
```

### 6.7 데이터 피드백 루프

자동 응답의 품질을 지속적으로 개선하기 위한 피드백 루프:

```
자동 응답 전송
    ↓
고객 반응 추적 (다음 댓글 분석)
    ├─ 긍정적 반응 (대화 종료, 예약 진행, 감사 표현)
    │    → qa_pairs에 is_good_response=true 마킹
    │    → 해당 응답 패턴의 우선순위 상향
    │
    ├─ 부정적 반응 (재질문, 불만 표현)
    │    → 워커 이관
    │    → qa_pairs에 is_good_response=false 마킹
    │    → 해당 응답 패턴의 우선순위 하향
    │
    └─ 무응답 (24시간 이상)
         → 팔로업 큐에 추가
         → 응답 품질 중립 처리
```

이 피드백 데이터가 축적되면:
- RAG 검색에서 `is_good_response=true`인 응답의 가중치 증가
- 실패한 자동 응답 패턴을 학습하여 유사 상황에서 워커 이관으로 전환
- 병원별/시술별 자동 응답 성공률 통계 → 자동 응답 범위 조정에 활용

### 6.8 필요한 추가 인프라

| 항목 | 설명 |
|------|------|
| Zendesk Bot Agent 계정 | 전용 에이전트 계정 생성 (auto-reply 구분용) |
| Zendesk Webhook 설정 | Trigger → 우리 API 호출 |
| `/api/rag/auto-reply` | 신규 API (webhook 수신 + RAG + 응답 생성 + Zendesk 댓글) |
| `followup_actions.action_type` | `'auto_reply'` 타입 추가 |
| 병원별 설정 테이블 | 자동 응답 ON/OFF, 응답 톤, 제한 시술 등 |
| 환경 변수 | `ZENDESK_BOT_AGENT_ID`, `ZENDESK_WEBHOOK_SECRET` |

**병원별 설정 테이블 예시:**

```sql
CREATE TABLE hospital_auto_reply_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id),

  auto_reply_enabled boolean DEFAULT false,
  first_reply_only boolean DEFAULT true,      -- only auto-reply on first customer message
  max_consecutive_replies integer DEFAULT 3,   -- max auto-replies before escalation
  confidence_threshold numeric(3,2) DEFAULT 1.00,  -- 1.0 = all drafts need approval (initial)

  response_tone text DEFAULT 'polite_formal',  -- polite_formal / friendly / professional
  excluded_procedures text[] DEFAULT '{}',     -- procedures that always need human
  blacklist_keywords text[] DEFAULT '{}',       -- additional hospital-specific keywords

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
