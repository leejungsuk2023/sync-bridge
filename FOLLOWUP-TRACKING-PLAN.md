# 팔로우업 추적 관리 시스템 기획서

---

## 1. 시스템 흐름도

```
[Phase A: 트리거]
Admin이 티켓에 "팔로우업" 지정
  → followup_status = 'pending'
  → 워커 "ติดตาม" 탭에 표시

[Phase B: 워커 초기 조치]
워커가 고객에게 연락 후 코멘트 작성
  → followup_actions 테이블에 action 레코드 INSERT
  → followup_status = 'contacted'
  → next_check_at = NOW() + 6시간 으로 설정

[Phase C: 자동 체크 사이클]
Cron (매시 정각 실행) → next_check_at <= NOW() 인 건 조회
  → 각 건별로:
    1) Zendesk API로 해당 티켓 최신 comments/status 조회
    2) 이전 체크 대비 변화 감지 (새 댓글, 상태 변경)
    3) Gemini API로 다음 행동 지시 생성
    4) followup_actions 테이블에 ai_instruction 레코드 INSERT
    5) next_check_at = NOW() + 6시간 으로 갱신
    6) 워커에게 알림 발송

[Phase D: 워커 후속 조치]
워커가 AI 지시 확인 → 조치 수행 → 코멘트 작성
  → followup_actions에 새 action 레코드 INSERT
  → next_check_at = NOW() + 6시간 으로 재설정
  → Phase C 반복

[Phase E: 종료]
워커가 상태를 converted 또는 lost로 변경
  → next_check_at = NULL
  → 사이클 종료
  → converted: 완료 처리
  → lost: 사유 필수 입력 (드롭다운)
```

**사이클 요약:**
```
워커 조치 → 6h 대기 → Zendesk 체크 → AI 지시 생성 → 워커 알림
    ↑                                                      |
    └──────────── 워커 조치 후 코멘트 ←────────────────────┘
                    (converted/lost 시 종료)
```

---

## 2. DB 스키마 변경

### 2-1. zendesk_analyses 테이블 컬럼 추가

```sql
-- 자동 체크 사이클 제어용
ALTER TABLE zendesk_analyses
  ADD COLUMN next_check_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN last_checked_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN last_zendesk_comment_id TEXT DEFAULT NULL,
  ADD COLUMN check_count INTEGER DEFAULT 0;

-- Lost 사유
ALTER TABLE zendesk_analyses
  ADD COLUMN lost_reason TEXT DEFAULT NULL
    CHECK (lost_reason IN ('no_response', 'customer_rejected', 'competitor', 'price_issue', 'other')),
  ADD COLUMN lost_reason_detail TEXT DEFAULT NULL;
```

| 컬럼 | 타입 | 용도 |
|------|------|------|
| `next_check_at` | timestamptz | 다음 Zendesk 체크 예정 시각. NULL이면 체크 대상 아님 |
| `last_checked_at` | timestamptz | 마지막 Zendesk 체크 시각 |
| `last_zendesk_comment_id` | text | 마지막으로 확인한 Zendesk comment ID (변화 감지용) |
| `check_count` | integer | 총 체크 횟수 (무한루프 방지용, 최대 20회) |
| `lost_reason` | text (enum 제약) | lost 처리 사유. followup_status='lost'일 때 필수 |
| `lost_reason_detail` | text | lost_reason='other'일 때 직접 입력한 상세 사유 |

### 2-2. 신규 테이블: followup_actions

워커 조치와 AI 지시를 시간순으로 기록하는 이력 테이블.

```sql
CREATE TABLE followup_actions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id BIGINT NOT NULL,
  action_type TEXT NOT NULL,              -- 'worker_action' | 'ai_instruction' | 'system_note'
  content TEXT NOT NULL,
  content_th TEXT,
  status_before TEXT,
  status_after TEXT,
  zendesk_changes JSONB,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX idx_followup_actions_ticket ON followup_actions(ticket_id);
CREATE INDEX idx_followup_actions_unread ON followup_actions(created_by, read_at)
  WHERE action_type = 'ai_instruction' AND read_at IS NULL;
```

### 2-3. 신규 테이블: followup_notifications

```sql
CREATE TABLE followup_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  action_id UUID NOT NULL REFERENCES followup_actions(id),
  ticket_id BIGINT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  channel TEXT DEFAULT 'in_app',          -- 'in_app' | 'line' | 'email'
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_followup_notif_user ON followup_notifications(user_id, read_at)
  WHERE read_at IS NULL;
```

### 2-4. 전체 ERD 관계

```
zendesk_tickets (1) ←── (1) zendesk_analyses
                              |
                              ├── next_check_at (사이클 제어)
                              ├── followup_status (상태)
                              ├── lost_reason (포기 사유)
                              └── ticket_id
                                    |
                            followup_actions (N)
                              ├── worker_action 레코드들
                              ├── ai_instruction 레코드들
                              └── action_id
                                    |
                            followup_notifications (N)
                              └── user_id → 워커
```

---

## 3. API 설계

### 3-1. 기존 수정: PATCH /api/zendesk/followup-customers

```
Request:
{
  ticket_id: number,
  status: string,
  note: string,
  action_comment: string,        // followup_actions에 INSERT
  lost_reason?: string,          // status='lost'일 때 필수
  lost_reason_detail?: string    // lost_reason='other'일 때 필수
}
```

**검증:**
- status='lost' + lost_reason 없음 → 400
- lost_reason='other' + lost_reason_detail 없음 → 400
- lost → contacted 되돌리기는 bbg_admin만 가능 (worker → 403)

**처리:**
- status='contacted'/'scheduled' → next_check_at = NOW() + 6h
- status='lost' → next_check_at = NULL, lost_reason/detail 저장
- status='converted' → next_check_at = NULL
- lost → contacted 되돌리기 → lost_reason=NULL, next_check_at = NOW() + 6h, system_note 생성

### 3-2. 신규: GET /api/zendesk/followup-actions?ticket_id=123

특정 티켓의 팔로우업 이력 조회. 권한: bbg_admin + worker.

### 3-3. 신규: POST /api/zendesk/followup-check

Cron에서 호출. next_check_at <= NOW() 인 건을 체크하고 AI 지시 생성.

### 3-4. 신규: GET /api/zendesk/followup-notifications

워커의 미읽은 알림 조회.

### 3-5. 신규: PATCH /api/zendesk/followup-notifications

알림 읽음 처리.

### API 전체 요약

| 엔드포인트 | 메서드 | 유형 | 용도 |
|-----------|--------|------|------|
| `/api/zendesk/followup-customers` | PATCH | 수정 | 상태 변경 + action 기록 + next_check_at + lost 사유 |
| `/api/zendesk/followup-actions` | GET | 신규 | 티켓별 조치 이력 조회 |
| `/api/zendesk/followup-check` | POST | 신규 | Cron용 자동 체크 + AI 지시 생성 |
| `/api/zendesk/followup-notifications` | GET | 신규 | 미읽은 알림 조회 |
| `/api/zendesk/followup-notifications` | PATCH | 신규 | 알림 읽음 처리 |

---

## 4. Cron Job 설계

### 스케줄

```json
// vercel.json 추가
{
  "crons": [
    {
      "path": "/api/zendesk/followup-check",
      "schedule": "0 * * * *"
    }
  ]
}
```

매시 정각 실행, next_check_at <= NOW() 대상만 필터링.

### 실행 로직

```
1. DB 조회:
   SELECT * FROM zendesk_analyses
   WHERE followup_status IN ('contacted', 'scheduled')
     AND next_check_at IS NOT NULL
     AND next_check_at <= NOW()
     AND check_count < 20

2. 각 건별 처리 (병렬, 최대 10건):
   a) Zendesk API: GET /api/v2/tickets/{id}/comments
   b) last_zendesk_comment_id 이후 새 댓글 필터링
   c) 변화 판단
   d) followup_actions에서 최근 이력 5건 조회
   e) Gemini API로 다음 행동 지시 생성
   f) followup_actions에 ai_instruction INSERT
   g) followup_notifications에 알림 INSERT
   h) zendesk_analyses 업데이트:
      - last_checked_at = NOW()
      - last_zendesk_comment_id = 최신 ID
      - next_check_at = NOW() + 6h
      - check_count += 1
```

---

## 5. AI 행동 지시 생성

### Gemini 프롬프트

```
당신은 태국 CS/마케팅 직원의 업무 코치입니다.

## 상황
- 병원: {hospitalName}
- 고객: {customerName} ({customerPhone})
- 관심 시술: {interestedProcedure}
- 원래 문의 내용: {ticketSubject}
- 현재 팔로우업 상태: {currentFollowupStatus}
- 체크 횟수: {checkCount}회차

## Zendesk 티켓 최신 상태
- 티켓 상태: {ticketStatus}
- 최근 댓글:
{recentComments를 시간순 나열}

## 지난 체크 이후 변화
- 새 댓글: {new_comments_count}건
- 새 댓글 내용 요약: {new_comments_summary}
- 상태 변경: {status_changed ? '있음' : '없음'}

## 워커 이전 조치 이력
{workerActions를 시간순 나열}

## 지시사항
위 정보를 분석하여 워커가 지금 해야 할 구체적인 다음 행동 1가지를 태국어로 작성하세요.

규칙:
1. 구체적으로 (예: "LINE으로 시술 가격표를 보내고 3월 15일 예약 확인")
2. 고객 반응에 맞춰 대응, 무반응이면 다른 채널/접근법 제안
3. checkCount 10 이상이면 escalation/종료 고려 제안
4. 태국어 작성, 고유명사 원어 유지

응답 형식 (JSON):
{
  "instruction_th": "태국어 행동 지시",
  "instruction_ko": "한국어 번역 (어드민 확인용)",
  "urgency": "high" | "medium" | "low",
  "suggested_status": "contacted" | "scheduled" | "converted" | "lost" | null
}
```

---

## 6. 워커 UI 변경 (WorkerFollowup.tsx)

### 알림 배너 (상단)
- 미읽은 AI 지시 개수 + "모두 읽음" 버튼
- urgency=high → 빨간 배경

### 고객 카드 확장
- AI 지시 하이라이트 (노란 배경, 미읽은 건 파란 점)
- suggested_status 추천 버튼
- 조치 이력 타임라인 (접기/펼치기)
- 코멘트 입력란 (전송 시 next_check_at 재설정)

### Lost 처리 모달 (FollowupLostModal.tsx)
- lost 선택 시 사유 필수 모달 표시
- 드롭다운: 연락 안 됨 / 고객 거절 / 경쟁사 선택 / 가격 문제 / 기타
- 기타 선택 시 상세 입력 필수
- 사유 미선택 → 확인 버튼 disabled

**태국어 라벨:**

| lost_reason | 한국어 | 태국어 |
|------------|--------|--------|
| `no_response` | 연락 안 됨 | ติดต่อไม่ได้ |
| `customer_rejected` | 고객 거절 | ลูกค้าปฏิเสธ |
| `competitor` | 경쟁사 선택 | เลือกคู่แข่ง |
| `price_issue` | 가격 문제 | ปัญหาเรื่องราคา |
| `other` | 기타 | อื่นๆ |

### Lost 상태 카드
- 목록 하단, 흐린 스타일 (opacity-60)
- 사유 표시, 코멘트 입력 비활성화

### 컴포넌트 구조

```
WorkerFollowup.tsx
  ├── FollowupNotificationBanner.tsx (신규)
  ├── FollowupCustomerCard.tsx (기존 확장)
  │     ├── FollowupAIInstruction.tsx (신규)
  │     ├── FollowupTimeline.tsx (신규)
  │     └── FollowupActionInput.tsx (신규)
  ├── FollowupLostModal.tsx (신규)
  └── useFollowupPolling.ts (신규 hook)
```

---

## 7. 어드민 UI (SalesPerformance.tsx)

### 팔로업고객 탭 — Lost 관리
- lost 필터 + lost_reason 하위 필터
- Lost 사유 통계 (수평 막대/배지)
- "되돌리기" 버튼 (admin 전용) → contacted로 재시작

---

## 8. 알림 방식

### Phase 1: In-App 알림
- Supabase Realtime으로 followup_notifications 구독
- 토스트 알림 + 헤더 벨 아이콘 배지
- Browser Notification API (탭 비활성 시)

### Phase 2: LINE Notify
- 태국 워커 LINE 사용 → 가장 현실적
- profiles에 line_notify_token 컬럼 추가
- Cron에서 알림 생성 시 LINE Notify API 동시 호출
- 워커 대시보드에 "LINE 알림 연결" 버튼

### Phase 3: Email (선택)
- 일일 요약 리포트용 (미처리 건수 + AI 지시 요약)

---

## 9. 엣지 케이스

### 9-1. 워커가 코멘트를 안 남기는 경우
- next_check_at은 워커 코멘트 유무와 무관하게 +6h 유지
- 3회 연속 미응답 → urgency=high + 어드민 알림
- check_count 20 도달 → 사이클 자동 중단 + 어드민 알림

### 9-2. 티켓이 Zendesk에서 closed된 경우
- AI가 최종 확인 지시 생성
- 워커가 1회 더 미응답 시 사이클 자동 중단

### 9-3. 6시간 체크에서 변화가 없는 경우
- "변화 없음"도 AI에 전달 → 다른 접근법 제안
- 연속 3회 무변화 → 체크 간격 12h로 확장

### 9-4. 워커가 lost 사유를 잘못 선택한 경우
- lost 처리 후 사유 수정 불가
- 어드민이 되돌리기 → 워커가 재처리

### 9-5. Lost 건이 Zendesk에서 재활성화된 경우
- lost 상태는 Cron 체크 대상 아님
- Phase 2: Zendesk sync Cron에서 감지 → 어드민 알림

### 9-6. Gemini API 실패
- system_note: "AI 지시 생성 실패"
- next_check_at = +1h (재시도)
- 3회 연속 실패 → 어드민 알림

---

## 10. 구현 우선순위

| 순서 | 범위 | 작업량 |
|------|------|--------|
| 1 | DB 스키마 (followup_actions, 컬럼 추가, RLS) | 소 |
| 2 | PATCH followup-customers 수정 (action 기록 + lost 사유 검증) | 소 |
| 3 | GET followup-actions API | 소 |
| 4 | WorkerFollowup UI 확장 (타임라인 + 코멘트 + Lost 모달) | 중 |
| 5 | POST followup-check (Cron 로직 + Zendesk 체크) | 중 |
| 6 | AI 지시 생성 (Gemini 프롬프트 + 파싱) | 중 |
| 7 | followup_notifications + In-App 알림 | 중 |
| 8 | 어드민 UI (lost 필터 + 되돌리기 + 통계) | 중 |
| 9 | Vercel Cron 설정 + 통합 테스트 | 소 |
| 10 | (Phase 2) LINE Notify 연동 | 소 |
