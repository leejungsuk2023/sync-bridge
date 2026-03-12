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
| 역할 기반 라우팅 | ✅ | worker 로그인 → WorkerDashboard, hospital → HospitalDashboard, staff → StaffDashboard, client/bbg_admin → Dashboard 자동 분기 |
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

### 3.1b Client Web — Staff 계층 대시보드

| 기능 | 상태 | 설명 |
|------|------|------|
| staff role | ✅ | BBG 한국 직원 전용 role. 업무 지시 + 업무 수행 양방향 가능. DB 제약조건(`profiles_role_check`)에 추가 |
| hierarchy_level | ✅ | profiles 테이블 컬럼. 10=대표(bbg_admin), 20=임원, 30=팀장, 40=일반, 100=워커. 낮을수록 상위자 |
| team | ✅ | profiles 테이블 컬럼. 팀 단위 가시성 관리용 (예: 'operations', 'business_admin') |
| request_type | ✅ | tasks 테이블 컬럼. 'directive' (상하 지시) 또는 'cooperation' (동급 협조). 서버에서 hierarchy_level 비교 후 자동 결정 |
| tasks.client_id nullable | ✅ | staff 간 내부 업무 지시 시 client_id = NULL 허용. 태국 직원 지시 시에는 여전히 필수 |
| StaffDashboard | ✅ | `StaffDashboard.tsx` — 4탭: 내가 지시한 업무 / 나에게 온 업무 / 채팅 / 상담. `/api/assignable-users`로 지시 대상 조회. 한국 직원 지시 시 번역 스킵 |
| 격자형 홈 | ✅ | Dashboard.tsx — 아코디언 제거, 기능별 카드 그리드로 리팩토링. 14개 NavCard (직원현황/채팅/업무관리/직원별현황/근무리포트/지시현황/월간보고서/상담/Sales/모니터링/병원KB/프리셋/용어집/계정관리). client role은 일부 카드만 표시 |
| assignable-users API | ✅ | `GET /api/assignable-users` — hierarchy_level 기반 하위자 목록 조회. hierarchy_level 미설정 시(client) 기존 client_id 기반 worker 목록 반환 |
| change-password API | ✅ | `POST /api/auth/change-password` — 현재 비밀번호 검증 후 새 비밀번호로 변경 (Dashboard 비밀번호 변경 모달) |
| 10개 admin 라우트 페이지 | ✅ | `/admin/workers`, `/admin/chat`, `/admin/tasks`, `/admin/calendar`, `/admin/time-report`, `/admin/directives`, `/admin/reports`, `/admin/presets`, `/admin/glossary`, `/admin/users` |

### 3.1c Client Web — 워커 웹 대시보드 (Phase 1 완료)

| 기능 | 상태 | 설명 |
|------|------|------|
| 워커 대시보드 | ✅ | `WorkerDashboard.tsx` — 탭 네비게이션 (업무/채팅/도구), Desktop App 없이 웹으로 업무 수행 |
| 출퇴근 상태 토글 | ✅ | `WorkerStatusToggle.tsx` — 출근/자리비움/퇴근 버튼 + 경과 시간 표시, `profiles.status` PATCH |
| 업무 제안 | ✅ | `TaskPropose.tsx` — 워커가 태국어로 업무 입력 → 한국어 자동 번역, `source: 'worker'`로 저장 |
| 번역 도우미 | ✅ | `TranslationHelper.tsx` — 태국어↔한국어 즉석 번역 패널, `/api/translate` 활용 |
| 내 업무 / 팀 전체 분리 | ✅ | TaskList에서 본인 할당 업무와 팀 전체 업무를 탭으로 구분 |

### 3.1d Client Web — Sales 성과 분석 (`/sales`)

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

### 3.1e Client Web — 병원 파트너 대시보드

| 기능 | 상태 | 설명 |
|------|------|------|
| 역할 기반 라우팅 | ✅ | `hospital` role 로그인 → Dashboard.tsx에서 HospitalDashboard 자동 분기 |
| 자사 데이터 필터 | ✅ | `profiles.hospital_prefix` 기반 — 해당 병원 데이터만 조회 |
| 통계 조회 | ✅ | `/api/zendesk/hospital-stats` — 문의 수, 예약 전환율, 성장률, 일별 트렌드 |
| AI 인사이트 | ✅ | `/api/zendesk/insights` — 병원전략 / Sales팀 개선방향 / 본사관리방향 3종 |
| 병원 계정 목록 | ✅ | 16개 병원 파트너 계정 (`{prefix}@hospital.com` / `1234`) |

**16개 병원 파트너 계정 (prefix@hospital.com / 비밀번호: 1234):**
thebb, delphic, will, mikclinicthai, jyclinicthai, du, koreandiet, ourpthai, everbreastthai, clyveps_th, mycell, nbclinici, dr.song, lacela, artline, kleam

### 3.1f Client Web — Zendesk 채팅 상담 UI

| 기능 | 상태 | 설명 |
|------|------|------|
| 3패널 상담 레이아웃 | ✅ | `ZendeskChatLayout.tsx` — 좌측 티켓 목록(280px) + 중앙 채팅(flex-1) + 우측 AI 추천(320px). 워커 대시보드 `ให้คำปรึกษา` 탭 |
| 티켓 목록 | ✅ | `ZendeskTicketList.tsx` — 내 티켓/전체/대기 필터 탭, 병원 필터 드롭다운, 읽지 않은 표시(파란 점), 최신 고객 메시지 프리뷰 |
| 채팅 패널 | ✅ | `ZendeskChatPanel.tsx` — 대화 버블 (고객 좌측/상담원 우측), 인라인 이미지, Public/Internal Note 토글, 티켓 상태 변경 드롭다운 |
| 프론트엔드 폴링 | ✅ | 웹훅 미작동 환경 대비 — 프론트엔드에서 주기적으로 conversations API 호출하여 신규 메시지 감지 |
| 실시간 sync | ✅ | `/api/zendesk/tickets-live` 자동 증분 sync (60초 throttle) + `/api/zendesk/conversations` live-sync (10초 쿨다운) |
| Thai→Korean 번역 | ✅ | `conversations?locale=ko` — 미번역 메시지 Gemini 일괄 번역 후 body_ko 컬럼에 캐시 |
| 답변 전송 | ✅ | `/api/zendesk/reply` — 상담원별 개인 토큰 우선, 없으면 Admin 토큰 + author_id Fallback |
| 상담원 토큰 설정 | ✅ | `ZendeskSetup.tsx` — Zendesk 이메일+API 토큰 입력, AES-256 암호화 저장, 즉시 검증 |
| AI 답변 추천 | ✅ | `AISuggestPanel.tsx` — Gemini 기반 태국어 답변 2-3개 추천. Quick Reply 칩, 고객 정보 요약. 추천 선택 시 입력창 자동 채움 |
| 추천 피드백 | ✅ | 추천 선택/수정/무시 데이터 `ai_reply_suggestions` 저장 → 향후 프롬프트 튜닝용 |
| Webhook 수신 | ✅ | `/api/zendesk/webhook` — HMAC-SHA256 서명 검증, zendesk_conversations INSERT, Realtime Push |
| 병원별 필터링 | ✅ | 티켓의 tags 프리픽스로 병원 식별, 상담원이 담당 병원 티켓만 볼 수 있도록 필터 |
| Fallback Polling | ✅ | `/api/zendesk/poll` — Webhook 누락 보정, 일 4회 Vercel Cron 실행 |

### 3.1g Client Web — 다이렉트 메시징 (LINE/Facebook)

| 기능 | 상태 | 설명 |
|------|------|------|
| LINE/Facebook 채널 통합 | ✅ | `MessagingLayout.tsx` — LINE 전역 채널 + Facebook 22개 병원별 페이지 채널 통합 오케스트레이터 |
| 대화 목록 | ✅ | `ConversationList.tsx` — 채널별 대화 목록, 미읽음 표시, 최신 메시지 프리뷰 |
| 메시지 패널 | ✅ | `MessagePanel.tsx` — 채팅 버블 UI, 인라인 이미지, 답변 전송 |
| 리드 정보 패널 | ✅ | `LeadInfoPanel.tsx` — 고객 정보 (이름, 연락처, 관심 시술 등) 표시 및 편집 |
| AI 답변 추천 | ✅ | `/api/channels/suggest-reply` — Gemini 기반 답변 추천 (채널 유형별) |
| Sales 리드 추적 | ✅ | `sales_leads` 테이블 — 고객 상담 → 예약 전환 추적 (customer_name, procedures, booking_status 등) |
| 월간 보고서 | ✅ | `MonthlyReport.tsx` — 병원별 월간 보고서 생성 (광고 CSV 업로드 + AI 분석 + 컨텐츠 계획). 상태: draft→generating→review→published |
| 채널 설정 API | ✅ | `/api/messaging/config` — 채널 목록 조회 |
| 보고서 생성 API | ✅ | `/api/messaging/generate` — AI 기반 보고서 초안 생성 |
| CSV 업로드 API | ✅ | `/api/messaging/upload-csv` — 광고 성과 CSV 업로드 → 파싱 및 저장 |

### 3.1h Client Web — 팔로업 고객 추적

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
| `profiles` | 사용자 프로필 (role, client_id, display_name, **hospital_prefix**, **zendesk_connected**, **polite_particle**, **hierarchy_level**, **team**) — role: bbg_admin / client / worker / **hospital** / **staff** |
| `time_logs` | 근태 기록 (worker_id, status, created_at) |
| `tasks` | 업무 (content, content_th, description, description_th, assignee_id, due_date, rating, source, status, created_by, **request_type**, client_id nullable) |
| `messages` | 업무별 채팅 (content_ko, content_th, is_whisper, sender_lang, file_url, file_name, file_type, mentions) |
| `quick_replies` | 자동답변 템플릿 (title/body × ko/th, client_id) |
| `task_presets` | 업무 프리셋 (title/content × ko/th, client_id) |
| `zendesk_tickets` | Zendesk 티켓 동기화 (ticket_id, subject, status, tags, comments, created_at_zd, updated_at_zd, **last_customer_comment_at**, **last_agent_comment_at**, **last_message_at**, **assigned_agent_user_id**, **channel**, **is_read**, **last_webhook_at**) |
| `zendesk_analyses` | Zendesk 티켓 AI 분석 결과 (quality_score, reservation_converted, summary, hospital_name, needs_followup, followup_reason, followup_reason_th, **followup_status**, **followup_note**, **followup_updated_by**, **followup_updated_at**, **customer_name**, **customer_phone**, **interested_procedure**, interested_procedure_th, **customer_age**, next_check_at, last_checked_at, last_zendesk_comment_id, check_count, lost_reason, lost_reason_detail) |
| `zendesk_conversations` | Zendesk 개별 대화 메시지 — 실시간 채팅용 (ticket_id, comment_id, author_type: customer\|agent\|system, body, body_ko, body_html, is_public, channel, attachments, created_at_zd) |
| `zendesk_agent_tokens` | 상담원별 Zendesk 개인 API 토큰 (user_id, zendesk_email, zendesk_user_id, encrypted_token, is_active, verified_at) |
| `ai_reply_suggestions` | AI 답변 추천 이력 (ticket_id, trigger_comment_id, suggestions jsonb, selected_index, was_edited, final_text, response_time_ms) |
| `zendesk_webhook_log` | Zendesk Webhook 수신 로그 (ticket_id, comment_id, payload, processed, error) |
| `followup_actions` | 팔로업 액션 이력 (ticket_id, action_type: worker_action\|ai_instruction\|system_note, content, content_th, status_before, status_after, zendesk_changes, created_by, read_at) |
| `followup_notifications` | 워커 인앱 알림 (user_id, action_id, ticket_id, title, body, channel, read_at) |
| `chat_read_status` | 채팅 읽음 상태 추적 (user_id, task_id, last_read_at) |
| `glossary` | 의료/비즈니스 용어 한↔태 번역 용어집 (korean, thai, category) |
| `messaging_channels` | LINE/Facebook 채널 설정 (channel_type, channel_name, config jsonb, hospital_prefix) |
| `monthly_reports` | 병원별 월간 보고서 (hospital_tag, report_month, status: draft/generating/review/published, ad_csv_url, ad_parsed_data, content_plan, strategy) |
| `sales_leads` | Sales 리드 추적 (ticket_id, customer_name, procedures, booking_status, customer_phone, customer_line, customer_instagram) |
| `hospital_kb` | 병원 지식베이스 (hospital_prefix, title, content, category, created_at) |

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
| `bbg_admin` | 모든 기능 + God Mode + 프리셋 관리 + 계정 관리 + Whisper 전송 + Sales 분석 전체 + Zendesk 전체 API. hierarchy_level=10 (대표) |
| `staff` | BBG 한국 직원 전용 대시보드(StaffDashboard). 업무 지시/수행 양방향. hierarchy_level 기반 하위자에게 지시. `/api/assignable-users` API 사용. tasks INSERT/UPDATE/DELETE 가능 (자기 생성 업무만 DELETE) |
| `client` | 자사 직원/업무/자동답변, 프리셋 사용(조회만), 업무 완료/취소/되돌리기, 전체 톡방 참여, Whisper 볼 수 없음, Zendesk 채팅 상담 (tickets-live, conversations, reply, ticket-update, suggest-reply, suggest-feedback) |
| `worker` | 워커 웹 대시보드, 본인 업무/채팅, 업무 제안, 전체 톡방 참여, 상태 토글, 번역 도우미, 템플릿 읽기, time_logs 기록, 팔로업 고객 조회/상태 업데이트 (`ติดตาม` 탭), Zendesk 채팅 상담 (`ให้คำปรึกษา` 탭). hierarchy_level=100 |
| `hospital` | 병원 파트너 대시보드 전용 — 자사 hospital_prefix 기반 데이터만 조회, AI 인사이트 요청, hospital-stats 조회 |

---

## 6. API 엔드포인트

| 경로 | 메서드 | 역할 |
|------|--------|------|
| `/api/tasks` | GET | 업무 목록 조회, 전체 톡방 조회/생성 (`?general_chat=true`) |
| `/api/tasks` | POST | 업무 생성 (client, bbg_admin, staff) — content, content_th, description, description_th, assignee_id, due_date, source, request_type |
| `/api/tasks` | PATCH | 업무 수정 — status, rating, due_date, content, content_th, description, description_th, assignee_id |
| `/api/tasks` | DELETE | 업무 삭제 + 연결 메시지 삭제 (staff는 자기 생성 업무만) |
| `/api/assignable-users` | GET | 지시 가능 대상 목록 조회 — hierarchy_level 기반 하위자 (staff/bbg_admin). hierarchy_level 미설정 시 client_id 기반 worker 목록 반환 |
| `/api/auth/change-password` | POST | 현재 비밀번호 검증 후 새 비밀번호 변경 |
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
| `/api/zendesk/followup-summary` | POST | 팔로업 요약 알림 Cron — bbg_admin/worker에게 요약 알림 (Vercel Cron + CRON_SECRET, 일 4회) |
| `/api/zendesk/cron` | GET | Vercel Cron endpoint — sync + analyze 자동 실행 (CRON_SECRET 인증, 일 2회: 09:00 KST, 16:00 KST) |
| `/api/zendesk/tickets-live` | GET | 실시간 티켓 목록 — filter(mine\|all\|waiting), hospital 필터, 자동 증분 sync (bbg_admin + worker + client) |
| `/api/zendesk/conversations` | GET | 티켓 대화 조회 — live-sync + locale=ko 한국어 번역 캐시 (bbg_admin + worker + client) |
| `/api/zendesk/reply` | POST | 고객 답변 전송 — is_public/Internal Note 선택, 상담원별 개인 토큰 인증 (bbg_admin + worker + client) |
| `/api/zendesk/ticket-update` | PATCH | 티켓 상태/태그/is_read 업데이트 — Zendesk + Supabase 동시 반영 (bbg_admin + worker + client) |
| `/api/zendesk/agent-token` | GET/PUT/DELETE | 상담원 Zendesk 개인 토큰 관리 — AES-256 암호화 저장 (bbg_admin + worker) |
| `/api/zendesk/suggest-reply` | POST | AI 답변 추천 생성 — Gemini, 대화 히스토리+고객 정보+QR+Glossary 컨텍스트 (bbg_admin + worker + client) |
| `/api/zendesk/suggest-feedback` | POST | AI 추천 피드백 기록 — selected_index, was_edited, final_text (bbg_admin + worker + client) |
| `/api/zendesk/webhook` | POST | Zendesk Webhook 수신 — HMAC-SHA256 서명 검증, DB INSERT 후 Realtime Push |
| `/api/zendesk/poll` | GET | Webhook 누락 보정 Fallback Polling Cron — 최대 50 티켓, 2분 이상 Webhook 없는 티켓 체크 (CRON_SECRET, 일 4회) |
| `/api/zendesk/migrate-conversations` | POST | 기존 zendesk_tickets.comments JSONB → zendesk_conversations 테이블 마이그레이션 (일회성, bbg_admin) |
| `/api/channels/line` | GET/POST/PUT | LINE 채널 메시지 조회/전송/설정 |
| `/api/channels/facebook` | GET/POST/PUT | Facebook 채널 메시지 조회/전송/설정 |
| `/api/channels/conversations` | GET | 채널별 대화 목록 조회 |
| `/api/channels/messages` | GET | 대화별 메시지 조회 |
| `/api/channels/reply` | POST | 채널 메시지 답변 전송 |
| `/api/channels/suggest-reply` | POST | AI 답변 추천 (Gemini, 채널 유형별) |
| `/api/messaging/config` | GET | 사용 가능 채널 목록 조회 |
| `/api/messaging/generate` | POST | AI 기반 월간 보고서 초안 생성 (Gemini) |
| `/api/messaging/upload-csv` | POST | 광고 성과 CSV 파일 업로드 및 파싱 |
| `/api/monthly-report` | GET/POST/PATCH | 월간 보고서 CRUD |
| `/api/sales-leads` | GET/POST/PATCH | Sales 리드 조회/생성/업데이트 |
| `/api/hospital-kb` | GET/POST/PATCH/DELETE | 병원 지식베이스 CRUD (bbg_admin) |

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
| 완료 | Staff 계층 시스템 | staff role, hierarchy_level, StaffDashboard, assignable-users API, tasks.request_type |
| 완료 | LINE/Facebook 다이렉트 메시징 | MessagingLayout, ConversationList, MessagePanel, LeadInfoPanel, 채널 API |
| 완료 | 월간 보고서 | MonthlyReport.tsx — 병원별 보고서 AI 생성, CSV 업로드, 상태 워크플로 |
| 완료 | Sales 리드 추적 | sales_leads 테이블 + API — 고객 상담→예약 전환 추적 |
| 완료 | 병원 지식베이스 (Hospital KB) | HospitalKBManager.tsx, hospital_kb.sql, /admin/hospital-kb 페이지 |
| 높음 | 회원가입/온보딩 플로우 | 자체 가입 → 관리자 승인 또는 초대 링크 |
| 높음 | 업무 가이드 PDF | 프리셋별 상세 작업 가이드를 PDF로 제공, 워커에게 전달 |
| 중간 | 알림 시스템 | 이메일 통합 알림 |
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
| 7.0 | Zendesk 채팅 통합 UI: ZendeskChatLayout/TicketList/ChatPanel/AISuggestPanel/ZendeskSetup/QuickReplyChips. 상담원별 개인 토큰 인증(AES-256 암호화), Webhook 수신+HMAC 검증, Fallback Polling Cron(일 4회), followup-summary Cron(일 4회), Thai→Korean 번역 캐시(body_ko). 신규 테이블(zendesk_conversations, zendesk_agent_tokens, ai_reply_suggestions, zendesk_webhook_log). 신규 env vars(ZENDESK_WEBHOOK_SECRET, ZENDESK_TOKEN_ENCRYPTION_KEY). client role 추가(tickets-live/conversations/reply/ticket-update/suggest-reply/suggest-feedback) |

---

**문서 버전:** 7.0 · Zendesk 채팅 통합 UI + AI 답변 추천 시스템 반영
