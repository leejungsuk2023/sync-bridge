# CLAUDE.md — SyncBridge 프로젝트 규칙

## 프로젝트 개요

한국 고객사(병원)와 태국 원격 근무자 간의 실시간 업무 동기화 플랫폼.
구성: `client-web` (Next.js 웹 앱), `supabase` (SQL 마이그레이션). Desktop App 및 Chrome Extension은 삭제됨.

---

## 과거 실수에서 배운 규칙

### 1. 파일 수정 전 반드시 전체 파일을 Read하라

- **실수:** `route.ts`를 부분만 읽고 Write로 전체 덮어씀. 의도치 않은 변경이 발생할 위험이 있었음.
- **규칙:** 파일을 수정할 때는 반드시 전체 파일을 Read한 뒤, Edit(부분 수정)을 사용한다. Write(전체 덮어쓰기)는 신규 파일이거나 전체 구조가 바뀌는 경우에만 사용한다.

### 2. 동일 패턴은 프로젝트 전체에서 검색하라

- **실수:** `catch {}` 빈 에러 삼킴을 한 파일에서만 고치고, 같은 패턴이 있는 다른 파일들을 놓쳤다.
- **규칙:** 버그 패턴이나 코드 스타일 수정 시, 반드시 `Grep`으로 프로젝트 전체(`/`)를 검색하여 동일 패턴이 있는 모든 파일을 수정한다.

### 3. cross-cutting 변경은 누락 없이 모든 대상에 적용하라

- **실수:** CORS 헤더를 `/api/tasks`와 `/api/translate`에만 추가하고, `/api/ai-assist`와 `/api/admin/users`에는 빠뜨렸다.
- **규칙:** API 전체에 영향을 주는 변경(CORS, 인증, 로깅 등)을 적용할 때는 먼저 `Glob`으로 모든 route 파일 목록을 확보하고, 빠짐없이 전부 적용한다.

### 4. 기존 unstaged 변경을 확인하고 사용자에게 알려라

- **실수:** 작업 시작 시 `figma-prompts.md`에 321줄 삭제된 unstaged 변경이 있었으나, 이를 사용자에게 알리지 않았다. 나중에 git diff에서 내 변경과 섞여 혼란을 줄 수 있음.
- **규칙:** 작업 시작 전 `git status`에 이미 수정된 파일이 있으면, 내 작업 범위와 겹치지 않더라도 사용자에게 기존 변경 사항을 알린다.

### 5. 코드 수정 후 빌드/타입체크를 실행하라

- **실수:** TypeScript 파일(`route.ts`)을 수정했으나 `npm run build`나 타입체크를 돌리지 않았다. 컴파일 에러가 있어도 모르고 넘어갈 수 있음.
- **규칙:** TypeScript 또는 빌드 대상 파일 수정 후, 해당 프로젝트의 빌드/타입체크를 실행하여 에러가 없는지 확인한다.
  - `client-web`: `cd client-web && npx tsc --noEmit`

### 6. 에러 핸들링 수정 시 UI 피드백도 함께 고려하라

- **실수 아닌 교훈:** `catch {}`를 로그로 바꾸는 것만으로는 사용자에게 도움이 안 됨. `generalChatError` 상태를 추가하여 UI에 안내 메시지를 표시한 것이 올바른 접근.
- **규칙:** 에러 로깅을 추가할 때, 사용자에게 보여야 하는 에러라면 UI 피드백(알림, 메시지)도 함께 구현한다.

---

## 프로젝트 컨벤션

### API Route CORS

모든 `/api/*` route에는 CORS 헤더 + OPTIONS preflight가 필요함.
새 API route 추가 시 `withCors()` 패턴을 반드시 적용할 것.

### 콘솔 로그 프리픽스

디버깅 로그에는 `[기능명]` 프리픽스를 사용:
- `[ChatPanel]` — 채팅 패널 (방 채팅 + 업무 채팅 공통)
- `[ChatSidebar]` — 사이드바 채팅방 목록
- `[TaskChat]` — 업무별 채팅
- `[Propose]` — 업무 제안

### 역할(role) 체계

| role | 설명 |
|------|------|
| `bbg_admin` | BBG 전체 관리자 |
| `client` | 고객사(병원) 담당자 |
| `worker` | 태국 직원 |
| `hospital` | 병원 파트너 대시보드 전용 계정 (`hospital_prefix` 필수) |

`hospital` 역할 사용자는 `profiles.hospital_prefix`에 병원 태그 프리픽스(예: `thebb`)가 설정되어야 함.
Dashboard.tsx에서 `hospital` role 감지 → `HospitalDashboard` 컴포넌트로 자동 분기.

### 환경 변수

- Vercel에 `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` 필수 설정
- Zendesk 기능 사용 시 추가 필요: `CRON_SECRET`, `ZENDESK_SUBDOMAIN`, `ZENDESK_EMAIL`, `ZENDESK_API_TOKEN`

### 채팅방 시스템

워커의 `profiles.client_id`가 설정되어 있어야 채팅방 시스템이 작동함.
미설정 시 UI에 안내 메시지를 표시하고 콘솔에 경고 로그를 남김.

**채팅방 종류 (4개 고정 방):**

| 방 이름 | 센티넬 값 | 용도 |
|---------|----------|------|
| WORK | `__CHAT_WORK__` | 업무 전반 소통 |
| CS | `__CHAT_CS__` | 고객 서비스 |
| GRAPHIC | `__CHAT_GRAPHIC__` | 디자인/그래픽 |
| KOL | `__CHAT_KOL__` | KOL 마케팅 |

채팅방 상수 및 타입 정의: `client-web/lib/chat-rooms.ts`

**API 파라미터:**
- `GET /api/tasks?chat_room=WORK&client_id=xxx` — 단일 채팅방 조회/생성
- `GET /api/tasks?list_chat_rooms=true&client_id=xxx` — 4개 방 일괄 조회/생성
- `GET /api/tasks?general_chat=true` — 하위호환 유지 (`__CHAT_WORK__`로 자동 마이그레이션)
- 일반 업무 목록에서 모든 센티넬 값(`__CHAT_*__`)은 자동 필터링됨

**UI 레이아웃:**
- 데스크톱: 사이드바(w-64) + 채팅 패널(flex-1) 동시 표시
- 모바일: 사이드바 ↔ 패널 전환 (뒤로가기 버튼)

---

## 파일 구조 참고

```
client-web/app/api/              # 모든 API route (CORS 필수)
client-web/app/app/page.tsx      # 메인 앱 (로그인 + 대시보드)
client-web/app/sales/page.tsx    # Sales 성과 분석 (bbg_admin 전용, /sales)
client-web/app/admin/monitoring/ # God Mode 관제 (bbg_admin 전용)
client-web/app/api/zendesk/      # Zendesk 연동 API (sync, stats, analyze, cron, hospital-stats, insights, followup-customers, followup-actions, followup-notifications, followup-check)
client-web/vercel.json           # Vercel Cron 스케줄 (09:00 KST, 16:00 KST, 12:00 KST)
client-web/lib/chat-rooms.ts     # 채팅방 상수, 센티넬 값, 타입 정의
client-web/components/
  ChatLayout.tsx                 # 사이드바 + 패널 오케스트레이터 (반응형)
  ChatSidebar.tsx                # 좌측 사이드바 (방 4개 + 업무 목록)
  ChatPanel.tsx                  # 방/업무 겸용 채팅 패널 (GeneralChat 대체)
  TaskAssign.tsx                 # 업무 할당 폼 — 제목(content) + 상세 가이드(description) 분리 입력, 각각 한→태 자동번역
  TaskList.tsx                   # 업무 목록 — 제목 굵게 표시, description 접기/펼치기, description_th 번역 동시 표시
  TaskChat.tsx                   # 업무별 채팅 — locale prop으로 한↔태 동적 결정
  ImageAnnotator.tsx             # 이미지 어노테이션 모달 — 프리핸드 드로잉(빨간 선), 우클릭 텍스트 포스트잇, 합성 후 채팅 전송
  Dashboard.tsx                  # 클라이언트 대시보드 (ChatLayout 사용, hospital role → HospitalDashboard 분기)
  WorkerDashboard.tsx            # 워커 대시보드 (ChatLayout 사용, "ติดตาม" 탭 WorkerFollowup 포함)
  HospitalDashboard.tsx          # 병원 파트너 전용 대시보드 (hospital role, hospital_prefix 기반 데이터 필터)
  WorkerFollowup.tsx             # 워커 팔로업 고객 관리 탭 (ติดตาม) — 카드 레이아웃, 코멘트 전용 플로우, AI 지시 황색 카드, 타임라인 토글
  SalesPerformance.tsx           # Zendesk Sales 분석 UI (/sales 페이지 전용, 3탭: Sales성과/병원별분석/팔로업고객). 팔로업 탭: BI 요약 카드, 상세 모달, Push/Drop
supabase/                        # SQL 마이그레이션
supabase/task_description.sql    # tasks 테이블 description, description_th 컬럼 추가
supabase/hospital_role.sql       # profiles 테이블 hospital_prefix 컬럼 추가
supabase/followup_status.sql     # zendesk_analyses 팔로업 추적 컬럼 추가
supabase/zendesk_customer_fields.sql  # zendesk_analyses 고객 정보 컬럼 추가 (customer_name, customer_phone 등)
supabase/followup_tracking.sql   # followup_actions + followup_notifications 테이블, zendesk_analyses 체크 사이클 컬럼
supabase/followup_thai_fields.sql # zendesk_analyses 태국어 번역 컬럼 (followup_reason_th, interested_procedure_th)
supabase/chat_read_status.sql    # 채팅 읽음 상태 추적 테이블
supabase/glossary.sql            # 의료/비즈니스 용어 한↔태 번역 용어집 테이블
```

관련 문서: `README.md`, `PRD.md`, `DEBUGGING.md`
