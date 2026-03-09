# PRD: SyncBridge (BBG 원격 BPO 업무 동기화 플랫폼)

---

## 1. 프로젝트 개요

- **목적:** 한국 고객사(병원)와 태국 원격 근무자(마케터/CS) 간의 실시간 업무 지시 및 상태 동기화.
- **비즈니스 모델:** 태국 인력 원격 고용 대행 (월 150만 원 청구 / 현지 인건비 75만 원 지급 구조).
- **핵심 가치:** 고객사에게는 **'투명한 근태 및 업무 관리(안심)'**를, 태국 직원에게는 **'최소한의 컨텍스트 스위칭(효율)'**을 제공.

---

## 2. 시스템 아키텍처 및 기술 스택

| 구분 | 기술 | 역할 |
|------|------|------|
| **Client Web** | Next.js 14 (App Router), Tailwind CSS, lucide-react | 고객사·BBG 관리자·워커 통합 웹 앱. 업무 지시, 실시간 근태 대시보드, 관제 모니터링, 이미지 어노테이션. 워커는 웹 브라우저만으로 업무 수행 가능. |
| **Backend & DB** | Supabase (PostgreSQL, Auth, Realtime, RLS) | 데이터 저장, 인증/권한, 실시간 동기화, 행 수준 보안. |
| **번역/AI** | Google Gemini API (gemini-2.5-flash) | 한↔태 번역, AI 상담 어시스턴트 (의도 파악 + 추천 답변). |
| **Web 배포** | Vercel | Client Web 배포 (`vercel --prod`). |

---

## 3. 구현 완료 기능

### 3.1 Client Web — 클라이언트/어드민 대시보드

| 기능 | 상태 | 설명 |
|------|------|------|
| 인증 | ✅ | Supabase Auth (이메일/비밀번호), 역할 기반 접근 제어 |
| 역할 기반 라우팅 | ✅ | worker 로그인 → WorkerDashboard, client/bbg_admin → Dashboard 자동 분기 |
| 직원 상태 모니터링 | ✅ | 실시간 온라인/자리비움/오프라인, 좌측 액센트 보더, 평균 평점. 모바일에서 접기/펼치기 토글(기본 접힘), 요약 카운트 표시 |
| 전체 톡방 | ✅ | 클라이언트↔직원 그룹 채팅, 접기/펼치기, 발신자 이름, 실시간 수신 |
| 업무 할당 | ✅ | 업무 제목(content) + 상세 가이드(description) 분리 입력, 각각 한→태 자동 번역, 프리셋 자동 채우기, 마감일 설정(datetime-local), 할당자 표시. 모바일에서 세로 배치 |
| 업무 프리셋 | ✅ | bbg_admin이 자주 쓰는 업무 지시를 프리셋으로 등록, 병원별/전체 공용 |
| 업무 목록 | ✅ | 업무 제목(굵게) + 상세 가이드 접기/펼치기 표시, 태국어 제목(content_th)·가이드(description_th) 동시 표시, 내 업무/팀 전체 분리, 실시간 조회, 상태 배지, 인라인 채팅, 기한초과 경고 |
| 업무 완료/취소/되돌리기 | ✅ | client만 완료(초록 완료 버튼)/취소(X 취소)/되돌리기 처리 가능 |
| 마감일 인라인 수정 | ✅ | 기존 마감일 클릭 → 인라인 datetime-local 편집 |
| 업무 캘린더 | ✅ | 월별 업무 현황 달력, 날짜별 업무 수 표시 |
| 업무 품질 평가 | ✅ | 완료 업무에 1~5점 별점 평가 (Star 아이콘, 호버 인터랙션) |
| 채팅 | ✅ | 업무별 1:1 채팅, 즉시 전송 + 백그라운드 번역, 실시간 업데이트. TaskChat이 locale prop을 기반으로 sender_lang, targetLang, 표시 필드를 동적 결정 (한↔태 양방향) |
| 파일 첨부 | ✅ | 채팅 내 이미지/문서 업로드, Ctrl+V 클립보드 이미지 붙여넣기, 미리보기, 다운로드 (Supabase Storage, 10MB 제한) |
| 이미지 어노테이션 | ✅ | 다른 사람 이미지에 hover 시 "수정" 버튼 → ImageAnnotator 모달. 프리핸드 드로잉(빨간 선), 우클릭 텍스트 포스트잇, 합성 후 채팅 전송 |
| @멘션 | ✅ | 채팅에서 @이름으로 팀원 태그, 하이라이트 표시, mentions jsonb 컬럼 저장 |
| 자동답변 관리 | ✅ | 퀵 리플라이 CRUD, 한→태 자동 번역, 병원별/전체 공용 |
| 근무 리포트 | ✅ | 일간 근태 요약 테이블, 출근율 프로그레스 바, 색상 코딩 |
| 계정 관리 | ✅ | bbg_admin 전용, 병원/직원 계정 생성·삭제 (service_role API) |
| AI 어시스트 API | ✅ | 환자 메시지 → 한국어 번역 + 의도 파악 + 추천 답변 3개 |
| 섹션 색상 구분 | ✅ | 각 섹션별 그라데이션 배경 + 좌측 컬러 보더로 시각적 구분 |

### 3.1b Client Web — 워커 웹 대시보드 (Phase 1 완료)

| 기능 | 상태 | 설명 |
|------|------|------|
| 워커 대시보드 | ✅ | `WorkerDashboard.tsx` — 탭 네비게이션 (업무/채팅/도구), Desktop App 없이 웹으로 업무 수행 |
| 출퇴근 상태 토글 | ✅ | `WorkerStatusToggle.tsx` — 출근/자리비움/퇴근 버튼 + 경과 시간 표시, `profiles.status` PATCH |
| 업무 제안 | ✅ | `TaskPropose.tsx` — 워커가 태국어로 업무 입력 → 한국어 자동 번역, `source: 'worker'`로 저장 |
| 번역 도우미 | ✅ | `TranslationHelper.tsx` — 태국어↔한국어 즉석 번역 패널, `/api/translate` 활용 |
| 내 업무 / 팀 전체 분리 | ✅ | TaskList에서 본인 할당 업무와 팀 전체 업무를 탭으로 구분 |

### 3.1c Client Web — Sales 성과 분석 (`/sales`)

| 기능 | 상태 | 설명 |
|------|------|------|
| 권한 체크 | ✅ | bbg_admin 외 접근 시 `/app`으로 리다이렉트 |
| Zendesk 동기화 | ✅ | Zendesk 티켓 증분 동기화 (`zendesk_tickets` 테이블 upsert) |
| AI 분석 | ✅ | active tickets (open/pending/new) 중 4+ comments 티켓 개별 분석 버튼, bbg_admin + hospital 역할 가능 |
| 품질 평가 | ✅ | 티켓별 1~5점 품질 점수, 담당자별 평균 품질 통계 |
| 예약 전환율 | ✅ | AI 판단 기반 예약 전환 여부 + 전환율 통계 |
| 병원 필터 | ✅ | 티켓 목록 병원별 필터 드롭다운 |
| 팔로업 고객 탭 | ✅ | 어드민이 "팔로업" 버튼으로 수동 지정 → pending/contacted/scheduled/converted/lost 상태 워크플로 |
| 병원별 분석 탭 | ✅ | 병원별 통계 (총 문의, 의미 있는 문의, 예약 전환, 성장률, 일별 트렌드) |
| AI 인사이트 | ✅ | 병원별 3종 인사이트: 병원전략, Sales팀 개선방향, 본사관리방향 (Gemini, 한국어, /api/zendesk/insights) |
| 미분석 사유 표시 | ✅ | 분석 제외 사유 표시 (댓글 수 부족, 비활성 상태 등) |
| 더보기 페이지네이션 | ✅ | 티켓 목록 더보기 방식 페이지네이션 (`limit` 파라미터) |
| 자동 배치 실행 | ✅ | Vercel Cron — 매일 09:00 KST, 16:00 KST 자동 sync + analyze; 12:00 KST 팔로업 자동 체크 |
| 수동 배치 실행 | ✅ | 수동 동기화/분석 버튼 (API 직접 호출) |
| 3탭 구성 | ✅ | Sales 성과 / 병원별 분석 / 팔로업 고객 탭 |

### 3.1d Client Web — 병원 파트너 대시보드

| 기능 | 상태 | 설명 |
|------|------|------|
| 역할 기반 라우팅 | ✅ | `hospital` role 로그인 → Dashboard.tsx에서 HospitalDashboard 자동 분기 |
| 자사 데이터 필터 | ✅ | `profiles.hospital_prefix` 기반 — 해당 병원 데이터만 조회 |
| 통계 조회 | ✅ | `/api/zendesk/hospital-stats` — 문의 수, 예약 전환율, 성장률, 일별 트렌드 |
| AI 인사이트 | ✅ | `/api/zendesk/insights` — 병원전략 / Sales팀 개선방향 / 본사관리방향 3종 |
| 병원 계정 목록 | ✅ | 16개 병원 파트너 계정 (`{prefix}@hospital.com` / `1234`) |

**16개 병원 파트너 계정 (prefix@hospital.com / 비밀번호: 1234):**
thebb, delphic, will, mikclinicthai, jyclinicthai, du, koreandiet, ourpthai, everbreastthai, clyveps_th, mycell, nbclinici, dr.song, lacela, artline, kleam

### 3.1e Client Web — 팔로업 고객 추적

| 기능 | 상태 | 설명 |
|------|------|------|
| 팔로업 지정 | ✅ | 어드민이 분석된 티켓에 "팔로업" 버튼 클릭 → `followup_status = 'pending'` 저장 |
| 상태 워크플로 | ✅ | pending → contacted → scheduled → converted / lost. lost 처리에 lost_reason 필수 |
| 상태별 BI 요약 카드 | ✅ | SalesPerformance 팔로업 탭 — 대기/연락완료/예약됨/성공/Lost 건수 카드 |
| 상세 모달 | ✅ | 티켓 클릭 → 상세 모달 — 채팅 버블 타임라인(워커 액션/AI 지시/시스템노트), Push 지시 전송, Drop(Lost 처리) |
| Push (지시 전송) | ✅ | 어드민/클라이언트가 워커에게 재접근 지시 전송 → `followup_actions` + `followup_notifications` 생성 |
| AI 자동 체크 | ✅ | Vercel Cron (03:00 UTC, 12:00 KST) — `followup-check` — contacted/scheduled 상태 티켓 최대 10건, Zendesk 댓글 분석 + Gemini로 태국어 다음 행동 지시 자동 생성 |
| 워커 팔로업 탭 | ✅ | WorkerDashboard "ติดตาม" 탭 — `WorkerFollowup.tsx`. 카드 레이아웃, 코멘트 입력 전용 플로우 (PATCH `action_comment`). AI 지시는 황색 강조 카드로 표시 |
| 알림 뱃지 | ✅ | WorkerDashboard ติดตาม 탭 — 미읽은 알림 수 뱃지, 긴급(urgency:high) 시 헤더 배너 |
| 워커 코멘트 자동 번역 | ✅ | 워커 태국어 코멘트 → Gemini로 한국어 자동 번역, `followup_actions.content`에 저장 (어드민 확인용) |
| 알림 API | ✅ | `GET /api/zendesk/followup-notifications` (미읽은 알림 조회) / `PATCH` (mark_all_read) |
| 액션 이력 API | ✅ | `GET /api/zendesk/followup-actions?ticket_id=` / `POST` (어드민 Push) / `PATCH` (read 표시) |
| 고객 정보 | ✅ | customer_name, customer_phone, interested_procedure, customer_age 컬럼 (zendesk_analyses)
| 태국어 번역 컬럼 | ✅ | followup_reason_th, interested_procedure_th — GET 요청 시 누락분 Gemini로 자동 번역 후 DB 저장

### 3.2 Client Web — God Mode 관제 (`/admin/monitoring`)

| 기능 | 상태 | 설명 |
|------|------|------|
| 권한 체크 | ✅ | bbg_admin 외 접근 시 `/app`으로 리다이렉트 |
| 통계 바 | ✅ | 총 업무, 진행중, 완료, 완료율 실시간 표시 |
| 필터 바 | ✅ | 병원/담당자/상태/기간별 필터링 |
| 워커 그리드 | ✅ | 각 워커별 상태 배지 + 완료/대기 업무 카운트 |
| 이중 SLA | ✅ | 메시지 SLA(5분/15분) + 업무 나이 SLA(1시간/3시간) 신호등 |
| 마감일 표시 | ✅ | 업무별 마감일 + 기한초과 경고 |
| 2-패널 레이아웃 | ✅ | 좌측: 업무 리스트(긴급순 정렬) / 우측: 상세 + 실시간 채팅 |
| Whisper 메시지 | ✅ | 보라색 버블 + 잠금 라벨, RLS로 client에게 숨김 |
| Realtime | ✅ | tasks/messages/time_logs 변경 시 자동 갱신 (30초 주기) |

### 3.3 데이터베이스 (Supabase)

| 테이블 | 용도 |
|--------|------|
| `clients` | 고객사(병원) 정보 |
| `profiles` | 사용자 프로필 (role, client_id, display_name, **hospital_prefix**) — role: bbg_admin / client / worker / **hospital** |
| `time_logs` | 근태 기록 (worker_id, status, created_at) |
| `tasks` | 업무 (content, content_th, description, description_th, assignee_id, due_date, rating, source, status, created_by) |
| `messages` | 업무별 채팅 (content_ko, content_th, is_whisper, sender_lang, file_url, file_name, file_type, mentions) |
| `quick_replies` | 자동답변 템플릿 (title/body × ko/th, client_id) |
| `task_presets` | 업무 프리셋 (title/content × ko/th, client_id) |
| `zendesk_tickets` | Zendesk 티켓 동기화 (ticket_id, subject, status, tags, comments, created_at_zd, updated_at_zd) |
| `zendesk_analyses` | Zendesk 티켓 AI 분석 결과 (quality_score, reservation_converted, summary, hospital_name, needs_followup, followup_reason, followup_reason_th, **followup_status**, **followup_note**, **followup_updated_by**, **followup_updated_at**, **customer_name**, **customer_phone**, **interested_procedure**, interested_procedure_th, **customer_age**, next_check_at, last_checked_at, last_zendesk_comment_id, check_count, lost_reason, lost_reason_detail) |
| `followup_actions` | 팔로업 액션 이력 (ticket_id, action_type: worker_action\|ai_instruction\|system_note, content, content_th, status_before, status_after, zendesk_changes, created_by, read_at) |
| `followup_notifications` | 워커 인앱 알림 (user_id, action_id, ticket_id, title, body, channel, read_at) |
| `chat_read_status` | 채팅 읽음 상태 추적 (user_id, task_id, last_read_at) |
| `glossary` | 의료/비즈니스 용어 한↔태 번역 용어집 (korean, thai, category) |

**RLS 정책:**
- bbg_admin: 전체 CRUD
- client: 자사 데이터만 조회, Whisper 메시지 CASE 표현식으로 필터링
- worker: 본인 업무/채팅, 템플릿 읽기, time_logs 기록
- messages: 발신자만 UPDATE 가능 (번역 결과 저장)
- profiles: 같은 client_id 소속끼리 조회 가능 (그룹 채팅 발신자 이름)

### 3.4 번역 패턴

Client Web의 모든 채팅에서 동일한 패턴:

1. 메시지를 원본 텍스트로 즉시 DB에 저장 (content_ko, content_th 모두 원본)
2. 백그라운드에서 Gemini API로 번역 요청
3. 번역 완료 시 해당 메시지의 번역 컬럼만 UPDATE
4. Realtime 구독(`event: '*'`)으로 UPDATE 이벤트도 수신하여 UI 즉시 반영

### 3.5 전체 톡방 (General Chat)

- `messages.task_id`가 NOT NULL이므로, `content = '__GENERAL_CHAT__'`인 더미 task를 client_id별로 생성
- API: `GET /api/tasks?general_chat=true&client_id=xxx` → 조회/자동 생성
- 일반 업무 목록/캘린더에서 `.neq('content', '__GENERAL_CHAT__')` 필터로 숨김
- **필수 조건:** 워커의 `profiles.client_id`가 설정되어 있어야 함
- **에러 피드백:** `client_id` 미설정 시 UI에 안내 메시지 표시, 콘솔에 `[GeneralChat]` 로그

---

## 4. 디자인 시스템

Figma Make 기반 디자인 업그레이드 적용 (Linear/Notion 스타일).

- **카드:** rounded-xl, shadow-sm, border
- **아이콘:** lucide-react
- **배지:** rounded-full pill (purple=관리자, blue=병원, emerald=직원)
- **로그인:** 그라데이션 배경 (slate-50 → emerald-50), 센터 카드 shadow-lg
- **섹션 색상:** 각 섹션별 그라데이션 배경(`from-{color}-50/70 to-white`) + 좌측 컬러 보더(`border-l-4 border-l-{color}-400`)

---

## 5. 권한 체계

| role | 접근 범위 |
|------|-----------|
| `bbg_admin` | 모든 기능 + God Mode + 프리셋 관리 + 계정 관리 + Whisper 전송 + Sales 분석 전체 + Zendesk 전체 API |
| `client` | 자사 직원/업무/자동답변, 프리셋 사용(조회만), 업무 완료/취소/되돌리기, 전체 톡방 참여, Whisper 볼 수 없음 |
| `worker` | 워커 웹 대시보드, 본인 업무/채팅, 업무 제안, 전체 톡방 참여, 상태 토글, 번역 도우미, 템플릿 읽기, time_logs 기록, 팔로업 고객 조회/상태 업데이트 (`ติดตาม` 탭) |
| `hospital` | 병원 파트너 대시보드 전용 — 자사 hospital_prefix 기반 데이터만 조회, AI 인사이트 요청, hospital-stats 조회 |

---

## 6. API 엔드포인트

| 경로 | 메서드 | 역할 |
|------|--------|------|
| `/api/tasks` | GET | 업무 목록 조회, 전체 톡방 조회/생성 (`?general_chat=true`) |
| `/api/tasks` | POST | 업무 생성 (client, bbg_admin) — content, content_th, description, description_th, assignee_id, due_date, source |
| `/api/tasks` | PATCH | 업무 수정 — status, rating, due_date, content, content_th, description, description_th, assignee_id |
| `/api/tasks` | DELETE | 업무 삭제 + 연결 메시지 삭제 |
| `/api/translate` | POST | 한↔태 양방향 번역 (Gemini API) |
| `/api/ai-assist` | POST | AI 상담 어시스턴트 (의도 파악 + 추천 답변) |
| `/api/admin/users` | POST/DELETE | 계정 생성/삭제 (bbg_admin, service_role) |
| `/api/zendesk/sync` | POST | Zendesk 티켓 수동 동기화 (bbg_admin) |
| `/api/zendesk/stats` | GET | Zendesk 통계 조회 — period, limit 파라미터, comment_count/status 필드 포함 (bbg_admin + hospital) |
| `/api/zendesk/analyze` | GET/POST | active tickets AI 분석 (bbg_admin + hospital). GET: 미분석 티켓 목록; POST: 특정 ticket_id 분석 또는 일괄 분석 |
| `/api/zendesk/hospital-stats` | GET | 병원별 상세 통계 (문의 수, 예약 전환율, 성장률, 일별 트렌드) — ?hospital=prefix&period=week|month (bbg_admin + hospital) |
| `/api/zendesk/insights` | POST | 병원별 AI 인사이트 3종 생성 — hospital_strategy, sales_improvement, hq_management (bbg_admin + hospital) |
| `/api/zendesk/followup-customers` | GET | 팔로업 고객 목록 — ?status= 필터 가능 (bbg_admin + worker). 태국어 번역 자동 백필 |
| `/api/zendesk/followup-customers` | PATCH | 팔로업 상태 업데이트 — ticket_id, status, note, action_comment, lost_reason, lost_reason_detail (bbg_admin + worker). 워커 코멘트 태국어→한국어 자동 번역 |
| `/api/zendesk/followup-actions` | GET | 티켓별 액션 이력 조회 — ?ticket_id= (bbg_admin + worker) |
| `/api/zendesk/followup-actions` | POST | 어드민 Push 지시 전송 — ticket_id, content (bbg_admin 전용). followup_actions + followup_notifications 동시 생성 |
| `/api/zendesk/followup-actions` | PATCH | 액션 읽음 처리 — action_id (bbg_admin + worker) |
| `/api/zendesk/followup-notifications` | GET | 현재 사용자 미읽은 알림 목록 (bbg_admin + worker) |
| `/api/zendesk/followup-notifications` | PATCH | 알림 읽음 처리 — notification_ids 배열 또는 mark_all_read (bbg_admin + worker) |
| `/api/zendesk/followup-check` | POST | AI 자동 팔로업 체크 Cron — contacted/scheduled 티켓 분석 후 태국어 지시 생성 (CRON_SECRET 인증) |
| `/api/zendesk/cron` | GET | Vercel Cron endpoint — sync + analyze 자동 실행 (CRON_SECRET 인증) |

---

## 7. 리스크 및 방어 로직

| 리스크 | 방어 |
|--------|------|
| WebSocket 단절 | Supabase Realtime 자동 재연결 + Service Worker keep-alive |
| 근태 어뷰징 | Activity Ping (10분 무활동 → 자리비움), 향후 키보드/마우스 이벤트 감지 확장 가능 |
| service_role 키 노출 | 서버사이드 API Route에서만 사용, 클라이언트 코드에 미노출 |
| Cron 무단 실행 | `/api/zendesk/cron`은 `CRON_SECRET` Bearer 토큰 검증으로 보호 |
| Whisper 정보 유출 | RLS CASE 표현식으로 client 역할에게 is_whisper=true 메시지 필터링 |
| 번역 실패 | 즉시 전송 패턴으로 원본은 항상 표시, 번역은 백그라운드에서 재시도 |
| CORS 차단 | API Route에 CORS 헤더 + OPTIONS preflight 처리 (`withCors()` 패턴) |
| 전체 톡방 미노출 | `profiles.client_id` 미설정 감지 → UI 에러 메시지 + 콘솔 `[GeneralChat]` 로그 |

---

## 8. 향후 로드맵

| 우선순위 | 항목 | 설명 |
|----------|------|------|
| 완료 | 브랜드 에셋 (SVG) | 로고 모노그램, 워드마크, 파비콘 등 SVG BI 파일 7종 (`brand/`) |
| 완료 | 사용자 가이드 | 고객사 가이드(한국어), 직원 가이드(태국어), Extension 매뉴얼 |
| 완료 | 워커 웹 대시보드 (Phase 1) | WorkerDashboard, WorkerStatusToggle, TaskPropose, TranslationHelper 구현 완료 |
| 완료 | 모바일 반응형 (Phase 2) | Dashboard 헤더, WorkerStatus 접기/펼치기 토글, TaskAssign 세로 배치, TaskList 줄바꿈 적용 |
| 높음 | 회원가입/온보딩 플로우 | 자체 가입 → 관리자 승인 또는 초대 링크 |
| 높음 | 업무 가이드 PDF | 프리셋별 상세 작업 가이드를 PDF로 제공, 워커에게 전달 |
| 중간 | 주간/월간 리포트 | 일간 외 장기 근태/업무 통계 |
| 중간 | 알림 시스템 | 이메일/LINE 통합 알림 |
| 낮음 | 모바일 대응 | 반응형 대시보드 최적화 |
| 낮음 | 다국어 확장 | 베트남어 등 추가 언어 지원 |

---

## 9. 릴리즈 이력

### Client Web
| PRD 버전 | 내용 |
|----------|------|
| 1.0 | 초기 릴리즈 (업무 관리, 채팅, 번역, 근태 관제) |
| 2.0 | 채팅방 시스템 (4채널), 워커 웹 대시보드 Phase 1 |
| 3.0 | Zendesk AI 분석, Sales 성과 분석 (/sales), God Mode 관제 강화 |
| 4.0 | 병원 파트너 대시보드, 팔로업 고객 추적, AI 인사이트 시스템 |
| 5.0 | 모바일 반응형, TaskChat 번역 동적화 (locale prop), Ctrl+V 이미지 붙여넣기, 이미지 어노테이션 (ImageAnnotator), Desktop App·Extension 삭제 |
| 6.0 | 팔로업 시스템 개편: AI 자동 체크 Cron (followup-check), Push/Drop, 타임라인 모달, 워커 알림 뱃지/긴급 배너, 워커 코멘트 태국어→한국어 자동 번역, 신규 테이블(followup_actions, followup_notifications, chat_read_status, glossary), zendesk_analyses 신규 컬럼 |

---

**문서 버전:** 6.0 · 팔로업 시스템 전면 개편 반영 (AI 자동 체크 Cron, Push/Drop, 타임라인 모달, 워커 알림, 코멘트 자동번역, followup_actions/followup_notifications/chat_read_status/glossary 테이블, zendesk_analyses 체크 사이클·태국어 번역·lost 관리 컬럼 추가)
