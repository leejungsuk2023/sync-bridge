# RAG 기반 세일즈 상담 자동화 기획

## 1. 개요

### 무엇을 만드는가

태국 고객의 의료관광 상담 대화에서 **과거 성공 사례를 실시간으로 검색**해 워커에게 추천 응답을 제시하는 시스템.

모델을 학습시키는 게 아니다. 성공한 상담 사례를 색인해두고, 비슷한 상황이 오면 그 사례의 핵심 흐름을 AI 컨텍스트로 넣어주는 구조다.

### 핵심 원칙

- **청킹 없음** — 대화를 쪼개지 않는다. 케이스 단위로 통째로 다룬다
- **태국어 구조화 요약으로 검색, 핵심 턴으로 생성** — 색인은 search_summary 임베딩, AI에 넘기는 건 key_turns (전체 대화 아님)
- **자동 누적** — 성공 케이스가 생기면 자동으로 색인에 추가된다. 사람이 개입할 필요 없다
- **임계값 미달 시 RAG 비활성** — 데이터 30건 미만이면 RAG 없이 기존 방식으로 운영
- **AI 호출 최소화** — 색인 시 단일 프롬프트로 search_summary + key_turns를 동시 추출

---

## 2. 선행 작업 (RAG 구축 전에 먼저 해야 할 것)

RAG보다 즉시 효과적인 작업이 있다. 아래 3가지가 충족되면 RAG 파이프라인 구축을 시작한다.

| 순서 | 작업 | 근거 |
|------|------|------|
| 1 | 병원별 시술 정보/가격 KB 구축 (`hospital_kb` 테이블 활용) | KB가 없으면 RAG가 답해도 가격/시술 정보가 틀림 |
| 2 | Quick Reply 템플릿 상황별 분류 고도화 | 자주 쓰는 응답 패턴은 RAG보다 템플릿이 빠르고 정확 |
| 3 | `converted` 케이스 30건 이상 확보 | 30건 미만이면 검색 품질이 랜덤에 가까움 |

---

## 3. 데이터 흐름

### 현재 (이미 구현됨)

```
고객 메시지 (Meta/Line Webhook)
  → conversations 테이블 저장
  → AI 분석 (Gemini)
  → zendesk_analyses 저장
    - reservation_converted (boolean)
    - followup_status (converted / lost)
    - summary (한국어 2-3문장)
    - hospital_name, interested_procedure
```

### 추가할 것

```
zendesk_analyses.reservation_converted = true
  → 아직 색인 안 된 케이스 감지
  → AI 호출 1회: search_summary(태국어) + key_turns + customer_concern을 단일 JSON으로 추출
  → Gemini text-embedding-004로 search_summary 임베딩 (taskType: RETRIEVAL_DOCUMENT)
  → case_index 테이블에 저장
```

### 검색 흐름

```
워커가 고객 메시지 수신
  → case_index 데이터 30건 이상 확인 (미달 시 RAG 스킵)
  → 현재 대화 컨텍스트를 임베딩 (taskType: RETRIEVAL_QUERY)
  → ① hospital_name 필터로 유사 케이스 Top 3 검색 (cosine similarity)
  → ② 결과 부족(1건 미만) 시 필터 해제 후 전체 검색
  → similarity < 0.5 (환경변수 RAG_SIMILARITY_THRESHOLD로 조정 가능)인 결과 제거
  → 해당 케이스의 key_turns + search_summary 꺼냄 (conversation_full 아님)
  → Gemini에 현재 상황 + 성공 사례 핵심 턴 전달
  → 태국어 추천 응답 3개 생성
  → AISuggestPanel에 표시 (RAG 기반 추천에는 출처 배지)
```

---

## 4. DB 변경사항

### 4-1. pgvector 활성화

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 4-2. 테이블 신규 생성

```sql
-- 색인 원본 대화 보관 (검색 테이블과 분리하여 벡터 스캔 성능 확보)
CREATE TABLE case_conversations (
  ticket_id bigint PRIMARY KEY REFERENCES zendesk_tickets(ticket_id),
  conversation_full jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- RAG 검색 핵심 테이블 (경량화)
CREATE TABLE case_index (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id bigint NOT NULL UNIQUE REFERENCES zendesk_tickets(ticket_id),

  -- 검색용 (색인 시 AI가 태국어로 생성)
  search_summary text NOT NULL,        -- 태국어 구조화 요약 (한국어 시술명 병기)
  embedding vector(768),               -- search_summary의 임베딩 (Gemini text-embedding-004)

  -- AI 컨텍스트용
  key_turns jsonb NOT NULL,            -- 전환에 결정적이었던 3-5턴 (각 메시지 100자 이내)

  -- 필터용 메타데이터
  hospital_name text,
  procedure_category text,
  customer_concern text[],             -- 고객 주요 우려사항 태그

  -- 성공 지표
  quality_score integer,

  -- 색인 관리
  status text NOT NULL DEFAULT 'indexed',  -- 'indexed' | 'failed' | 'invalidated'
  embedding_model text NOT NULL DEFAULT 'text-embedding-004',

  created_at timestamptz DEFAULT now()
);

-- 초기에는 벡터 인덱스 생략 (1,000건 미만에서는 순차 스캔이 더 빠름)
-- 1,000건 이상 시:
-- CREATE INDEX idx_case_index_embedding
--   ON case_index USING ivfflat (embedding vector_cosine_ops)
--   WITH (lists = {sqrt(n)});

CREATE INDEX idx_case_index_hospital ON case_index(hospital_name);
CREATE INDEX idx_case_index_procedure ON case_index(procedure_category);
CREATE INDEX idx_case_index_status ON case_index(status);

-- RLS: 클라이언트 직접 접근 차단, API route(service_role_key)만 접근
ALTER TABLE case_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_conversations ENABLE ROW LEVEL SECURITY;
```

---

## 5. 코드 변경사항

### 5-1. 색인 파이프라인 신규 추가

**파일:** `/api/rag/index/route.ts` (신규)

역할: 성공 케이스를 감지하고 case_index에 저장

```typescript
// 처리 흐름:
// 1. zendesk_analyses에서 성공 케이스 조회
//    WHERE reservation_converted = true
//    AND ticket_id NOT IN (SELECT ticket_id FROM case_index WHERE status != 'failed')
//    LIMIT 5  -- 배치 크기 5건 제한

// 2. 각 케이스에 대해 AI 호출 1회 (통합 프롬프트):
//    responseMimeType: 'application/json' + responseSchema 명시
//
//    프롬프트:
//    "아래 의료관광 상담 대화를 분석하여 다음 JSON을 생성하세요.
//
//    {
//      "search_summary": "태국어로 작성. 한국어 시술명 병기. 형식:
//        หัตถการ: {시술명 태국어} ({한국어})
//        ลูกค้า: {연령대, 성별, 거주지}
//        สถานการณ์: {상담 흐름 한 줄, 화살표(→) 연결}
//        จุดเปลี่ยน: {예약 결정에 결정적이었던 포인트}
//        ข้อกังวล: {고객 우려사항 키워드 3-5개}",
//      "key_turns": [
//        {"role": "customer"|"agent", "message": "100자 이내 핵심만", "turn": 번호(optional)}
//      ],
//      "customer_concern": ["가격", "다운타임", ...],
//      "procedure_category": "코성형"
//    }
//
//    key_turns는 전환에 결정적이었던 3-5턴만. 단순 인사/확인 제외.
//    각 message는 100자 이내로 핵심만 추출."

// 3. search_summary를 Gemini text-embedding-004로 임베딩
//    taskType: 'RETRIEVAL_DOCUMENT' 명시

// 4. 트랜잭션 원자성:
//    search_summary + key_turns + embedding 3개 모두 성공해야 case_index INSERT
//    하나라도 실패하면 전부 버리고 다음 Cron에서 재시도
//    3회 연속 실패 시 status = 'failed'로 마킹

// 5. 무효화 체크:
//    case_index에 있지만 zendesk_analyses에서 더 이상 converted가 아닌 건
//    → status = 'invalidated'로 마킹 (예약 취소 케이스가 성공 사례로 추천되는 것 방지)
```

`key_turns` 저장 예시:
```json
[
  {"role": "customer", "message": "คอโรไพลาสตี้ราคาเท่าไหร่คะ", "turn": 3},
  {"role": "agent", "message": "โรไพลาสตี้แบบไม่ผ่าตัดเริ่มต้น XX บาท รวมดูแลหลังผ่าตัด 3 ครั้ง", "turn": 4},
  {"role": "customer", "message": "ที่อื่นถูกกว่านี้ค่ะ", "turn": 8},
  {"role": "agent", "message": "ของเรารวมนัดติดตามผลฟรี 3 ครั้ง ไม่มีค่าใช้จ่ายเพิ่มค่ะ", "turn": 9},
  {"role": "customer", "message": "งั้นขอนัดเลยค่ะ", "turn": 11}
]
```

### 5-2. 색인 Cron 별도 등록

**파일:** `vercel.json` (수정) + `/api/rag/index/route.ts` (신규 endpoint)

기존 zendesk/cron에 추가하지 않고 **별도 Cron endpoint `/api/rag/index`를 신규 등록 (하루 1회)**한다.

이유:
1. 기존 zendesk/cron 300초 타임아웃 위험 제거
2. 색인 실패가 sync/analyze에 영향 안 줌
3. 독립 재실행 가능

```json
// vercel.json 추가
{ "path": "/api/rag/index", "schedule": "0 2 * * *" }
```

### 5-3. 검색 API 신규 추가

**파일:** `/api/rag/search/route.ts` (신규)

```typescript
// 입력
// - query: string (현재 고객 메시지 또는 대화 컨텍스트)
// - hospital_name?: string (선택 필터)
// - limit?: number (기본값 3)

// 처리
// 1. case_index 데이터 건수 확인 → 30건 미만이면 빈 배열 반환
// 2. query를 Gemini text-embedding-004로 임베딩
//    taskType: 'RETRIEVAL_QUERY' 명시
// 3. ① hospital_name 필터로 pgvector cosine similarity 검색
//    ② 결과 부족(1건 미만) 시 필터 해제 후 전체 검색
// 4. similarity < RAG_SIMILARITY_THRESHOLD(기본값 0.5)인 결과 제거
// 5. key_turns + search_summary 반환 (conversation_full 제외)

// SQL (Supabase RPC function으로 래핑 권장):
// SELECT id, search_summary, hospital_name, procedure_category, key_turns,
//        1 - (embedding <=> $1) AS similarity
// FROM case_index
// WHERE status = 'indexed'
//   AND (hospital_name = $2 OR $2 IS NULL)
//   AND 1 - (embedding <=> $1) >= $4  -- RAG_SIMILARITY_THRESHOLD
// ORDER BY embedding <=> $1
// LIMIT $3
```

### 5-4. AI 추천 응답 생성 수정

**파일:** `/api/zendesk/suggest-reply/route.ts` (수정)

기존 Gemini 호출 컨텍스트에 RAG 검색 결과 추가:

```typescript
// 기존 컨텍스트
// - 현재 대화 히스토리
// - Quick Reply 템플릿
// - 고객 정보

// 추가할 컨텍스트
// - /api/rag/search 결과 (유사 성공 사례 최대 3건의 key_turns + search_summary)
// - conversation_full은 넘기지 않음
// - 개별 케이스 key_turns는 최대 3턴으로 제한
// - 전체 key_turns 합계 2,000 토큰 초과 시 2건으로 축소
//   (태국어는 토큰 효율이 한국어 대비 1.5-2배 낮으므로 보수적으로 설정)
// - 다른 병원 사례 포함 시 가드레일 추가:
//   "참고: 다른 병원 사례이므로 가격/서비스 조건은 현재 병원 정보 기준으로 조정하세요"
// - RAG 검색 결과가 있는 추천에는 source: 'rag' 태그 포함

// 프롬프트 추가 내용 예시:
// "ด้านล่างนี้คือตัวอย่างเคสที่ประสบความสำเร็จในสถานการณ์ที่คล้ายกัน
//  โปรดใช้เป็นข้อมูลอ้างอิงในการสร้างคำตอบที่เหมาะสมสำหรับลูกค้าปัจจุบัน
//
//  [เคสสำเร็จที่ 1]
//  สรุป: {search_summary}
//  บทสนทนาสำคัญ:
//  {key_turns ในรูปแบบ role: message}
//
//  [เคสสำเร็จที่ 2] ..."
```

---

## 6. 채널 적용 전략

### v1: LINE (Korean Diet) 우선 적용

현재 다이렉트 메시징은 LINE만 통합 완료 상태다. RAG는 **LINE(Korean Diet) 채널에 먼저 적용**한다.

- **대상 채널:** LINE — Korean Diet (messaging_channels에 등록된 LINE 채널)
- **Meta(Facebook) 통합은 진행 중**이며, 완료 시 동일한 RAG 파이프라인을 Meta 채널에도 확장. 검색 API와 색인 파이프라인은 채널에 무관하게 동작하므로 코드 변경 없이 확장 가능.

### RAG 트리거: staff/admin 수동 버튼

RAG 추천은 자동으로 항상 뜨는 게 아니라, **staff 또는 bbg_admin이 버튼을 눌러야 동작**한다.

**이유:**
1. 초기 단계에서는 품질 검증이 필요. 자동 노출하면 품질 낮은 추천이 워커 신뢰를 떨어뜨림
2. staff/admin이 "이 대화에 RAG가 도움될 것 같다"고 판단할 때만 트리거
3. API 호출(임베딩 + 검색 + 생성)이 매 메시지마다 발생하면 비용/latency 부담

**UI 설계:**

```
MessagePanel (다이렉트 메시징 채팅 패널)
  └─ 상단 또는 우측에 "RAG 추천" 버튼 (staff/bbg_admin에게만 표시)
     └─ 클릭 시:
        1. 현재 대화 컨텍스트(최근 5턴)를 /api/rag/search에 전송
        2. 검색 결과 + 현재 대화를 /api/zendesk/suggest-reply에 전송 (source: 'rag')
        3. 결과를 패널에 표시 (성공 사례 배지 + 추천 응답 3개)
        4. 워커가 추천 선택 시 메시지 입력창에 자동 삽입
     └─ 결과 없음 시: "유사한 성공 사례가 없습니다" 안내
```

**버튼 표시 조건:**
- role이 `staff` 또는 `bbg_admin`
- case_index에 indexed 건수가 30건 이상 (미달 시 버튼 비활성 + 툴팁: "성공 사례 N건/30건 — 30건 이상 시 활성화")
- 현재 대화가 LINE 채널 (v1). Meta 통합 완료 시 조건 해제

**향후 전환:**
- v1: 수동 버튼 (staff/admin만)
- v2: 워커에게도 버튼 노출 (품질 검증 완료 후)
- v3: 새 고객 메시지 수신 시 자동 트리거 (채택률 60% 이상 달성 시)

---

## 7. 구현 순서

선행 작업(2절) 완료 후 아래 순서로 진행:

| 순서 | 작업 | 파일 |
|------|------|------|
| 1 | pgvector 활성화 | Supabase SQL |
| 2 | case_conversations + case_index 테이블 생성 | Supabase SQL |
| 3 | 색인 API 구현 | `/api/rag/index/route.ts` |
| 4 | 색인 Cron 등록 (별도 endpoint, 하루 1회) | `vercel.json` |
| 5 | 검색 API 구현 (+ RPC function) | `/api/rag/search/route.ts` |
| 6 | suggest-reply에 RAG 연결 + source 태그 | `/api/zendesk/suggest-reply/route.ts` |
| 7 | MessagePanel에 RAG 추천 버튼 추가 (staff/admin 전용) | `MessagePanel.tsx` |
| 8 | AISuggestPanel에 RAG 출처 배지 표시 | `AISuggestPanel.tsx` |
| 9 | suggest-feedback에 source 필드 추가 | `/api/zendesk/suggest-feedback/route.ts` |
| 10 | 관리자 대시보드 RAG 현황 카드 | `Dashboard.tsx` |

---

## 8. 주의사항

### 청킹하지 않는다
대화를 문단이나 턴으로 쪼개지 않는다. 케이스(티켓) 단위가 최소 단위다. 쪼개면 "이 대화가 어떻게 흘러가서 어떻게 클로징됐는지"라는 핵심 정보가 날아간다.

### search_summary는 태국어로 생성한다
기존 `zendesk_analyses.summary`(한국어 2-3문장)는 사람이 읽기 위한 요약이라 (1) 변별력이 없고 (2) 태국어 query와 언어 불일치로 매칭 정확도가 낮다. 색인 시 별도 구조화 요약(태국어)을 생성한다. query가 태국어 대화 컨텍스트이므로 index도 태국어가 매칭 정확도가 높다. 시술명 등 핵심 키워드는 한국어를 병기한다. 한국어 요약은 zendesk_analyses.summary에 이미 있으므로 중복이 아니다.

### key_turns로 토큰 비용을 통제한다
30턴 대화 중 핵심은 3-5턴이다. conversation_full을 Gemini에 통째로 넘기면 노이즈가 많고 토큰 비용이 3배다. key_turns만 넘긴다. conversation_full은 case_conversations 테이블에 별도 보관하며 디버깅/감사용으로만 사용한다.

### 콜드 스타트 대응
converted 케이스 30건 미만이면 RAG 검색을 활성화하지 않는다. 그 전까지는 기존 suggest-reply(Quick Reply 템플릿 + 대화 컨텍스트)로 운영한다. 대시보드에서 case_index 누적 건수를 표시하여 현황을 모니터링한다.

### similarity threshold
기본값 0.5, 환경변수 `RAG_SIMILARITY_THRESHOLD`로 조정. 억지로 갖다 붙이는 쓰레기 컨텍스트가 오히려 응답 품질을 낮춘다. 유사한 케이스가 없으면 RAG 없이 생성하는 게 낫다. 데이터 100건 이상 축적 후 실제 similarity 분포 분석하여 최적값 설정.

### 토큰 예산
개별 케이스 key_turns는 최대 3턴, 각 메시지 100자 이내. 전체 합계 2,000 토큰 초과 시 2건으로 축소. 태국어는 토큰 효율이 한국어 대비 1.5-2배 낮으므로 보수적으로 설정.

### 벡터 인덱스 시점
1,000건 미만에서는 ivfflat보다 순차 스캔(pgvector 기본)이 빠르다. 초기에는 인덱스 없이 운영하고, 1,000건 넘으면 `WITH (lists = sqrt(n))` 기준으로 ivfflat 생성한다.

### 성공 케이스만 색인한다
`reservation_converted = true` 조건만 사용. `followup_status`는 워커 수동 입력 필드라 AI 판정 기준으로 적합하지 않다. 실패 케이스는 색인하지 않는다. "실패 패턴 경고" 기능이 필요하면 그때 별도 테이블로 추가한다. converted → lost 역전(예약 취소) 시 case_index에서 status = 'invalidated'로 마킹. 취소된 케이스가 성공 사례로 추천되는 것을 방지.

### 임베딩 taskType 필수
색인 시 `RETRIEVAL_DOCUMENT`, 검색 시 `RETRIEVAL_QUERY`. 이것만으로 검색 정확도가 유의미하게 향상된다.

### JSON 안정성
Gemini 호출 시 `responseMimeType: 'application/json'` + `responseSchema` 사용하여 structured output 강제. key_turns 파싱 실패 시 해당 케이스 스킵, 다음 Cron에서 재시도.

### 트랜잭션 원자성
search_summary + key_turns + embedding 3개 모두 성공해야 case_index INSERT. 부분 실패 시 전부 폐기. 3회 연속 실패 시 status = 'failed'로 마킹.

### conversation_full 분리
case_index에 포함하지 않음. 별도 case_conversations 테이블에 저장. 디버깅/감사용. 벡터 스캔 시 대용량 JSONB를 읽지 않아 성능 확보. 향후 case_conversations 없이 ticket_id FK 참조만으로 전환 가능.

### RLS
case_index, case_conversations 모두 ENABLE ROW LEVEL SECURITY. 정책 없이 기본 차단. API route(service_role_key)만 접근.

### 임베딩 모델 교체 대비
`embedding_model` 컬럼에 사용 모델 기록. 모델 변경 시 search_summary는 보존되므로 임베딩만 재생성 (AI 호출 없이 가능).

### customer_concern 활용
v1에서는 UI 디스플레이/필터 전용. v2에서 re-ranking 부스팅 도입 검토 (벡터 검색 Top 5 후 concern 매칭도로 re-rank하여 Top 3 선정).

### 세션 경계
Meta/Line 직접 연결로 전환했으므로 대화 세션 경계를 직접 정의해야 한다. Zendesk 티켓 라이프사이클(open → pending → solved)을 그대로 모방한다. 마지막 메시지 이후 일정 시간 침묵 = 세션 종료로 간주하는 로직을 `conversations` 테이블 상태머신으로 구현한다.

---

## 9. 모니터링 및 피드백

### 관리자 대시보드 RAG 현황 카드
- case_index 누적 건수 (전체 / 병원별)
- RAG 활성 상태 (30건 이상 여부)
- 최근 7일 RAG 검색 횟수 vs. 결과 0건(threshold 미달) 비율 (hit rate)
- RAG 추천 채택률 (suggest-feedback에서 source='rag'인 추천이 선택된 비율)

### 암묵적 피드백 수집
워커에게 명시적 피드백 버튼은 추가하지 않는다 (상담 중 추가 클릭은 부담).
대신 암묵적 피드백을 수집한다:
- 추천을 수정 없이 사용 = 긍정
- 추천을 수정 후 사용 = 부분 긍정
- 추천 무시하고 직접 작성 = 부정
- 해당 상담이 최종 converted = 최종 피드백

이 데이터를 축적하여 threshold 조정, search_summary 프롬프트 개선 시점을 판단한다.

### AISuggestPanel UI 변경
- RAG 기반 추천 카드에 출처 배지 표시: "จากเคสสำเร็จ" (성공 사례 기반)
- reasoning 필드에 key_turns에서 추출한 핵심 전략 한 줄 포함
  예: "สิ่งสำคัญ: เน้นการดูแลหลังผ่าตัดฟรี 3 ครั้ง" (핵심: 무료 사후관리 3회 강조)
- RAG 결과가 비었을 때: 기존 일반 추천만 표시 (별도 안내 없이 자연스럽게)

---

## 10. 기대 효과

색인이 쌓일수록 검색 품질이 올라간다. 모델을 재학습하거나 파인튜닝할 필요 없이, 성공 케이스가 INSERT 될 때마다 시스템이 더 똑똑해지는 효과가 있다. 딥러닝이 아니라 RAG의 특성상 데이터 누적이 곧 성능 향상이다.
