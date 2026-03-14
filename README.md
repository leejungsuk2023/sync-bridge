# SyncBridge — 원격 BPO 업무 동기화 플랫폼

한국 고객사(병원)와 태국 원격 근무자(마케터/CS) 간의 실시간 업무 지시 및 상태 동기화를 위한 전체 시스템입니다.

---

## 시스템 개요

| 구분 | 용도 |
|------|------|
| **Client Web** | 고객사/BBG 관리자/워커 웹 대시보드. 업무 할당(프리셋 지원), 실시간 모니터링, 업무별 채팅, 전체 톡방, 캘린더, 자동답변 관리, 계정 관리, AI 어시스트 API, **God Mode 관제**, 이미지 어노테이션 |
| **Supabase** | Auth, PostgreSQL, Realtime (실시간 동기화), RLS 기반 권한 관리 |

---

## 프로젝트 구조

```
g sync/
├── README.md                # 이 문서
├── PRD.md                   # 제품 요구사항
├── CLAUDE.md                # 프로젝트 규칙 (Claude Code용)
├── DEBUGGING.md             # 디버깅 가이드
│
├── client-web/              # Next.js 14 대시보드 (클라이언트/어드민/워커 통합)
│   ├── app/
│   │   ├── app/page.tsx            # 메인 (로그인 + 대시보드)
│   │   ├── layout.tsx
│   │   ├── admin/monitoring/
│   │   │   └── page.tsx            # God Mode 통합 관제 대시보드 (bbg_admin 전용)
│   │   ├── admin/workers/page.tsx  # 직원 현황 페이지
│   │   ├── admin/chat/page.tsx     # 채팅 페이지
│   │   ├── admin/tasks/page.tsx    # 업무 관리 페이지 (할당 + 목록)
│   │   ├── admin/calendar/page.tsx # 직원별 업무 현황 페이지
│   │   ├── admin/time-report/page.tsx # 근무 리포트 페이지
│   │   ├── admin/directives/page.tsx  # 지시/협조 현황 페이지 (staff/bbg_admin)
│   │   ├── admin/reports/page.tsx  # 월간 보고서 페이지
│   │   ├── admin/presets/page.tsx  # 업무 프리셋 관리 페이지
│   │   ├── admin/glossary/page.tsx # 용어집 관리 페이지
│   │   ├── admin/users/page.tsx    # 계정 관리 페이지
│   │   ├── admin/hospital-kb/page.tsx # 병원 KB 관리 페이지
│   │   ├── sales/
│   │   │   └── page.tsx            # Sales 성과 분석 독립 페이지 (bbg_admin 전용)
│   │   ├── api/tasks/route.ts      # 업무 CRUD + 채팅방 API (service_role)
│   │   ├── api/translate/route.ts  # 한↔태 번역 API (Gemini)
│   │   ├── api/ai-assist/route.ts  # AI 상담 어시스턴트 API
│   │   ├── api/assignable-users/route.ts # 지시 가능 대상 조회 API (staff/bbg_admin)
│   │   ├── api/auth/change-password/route.ts # 비밀번호 변경 API
│   │   ├── api/admin/users/route.ts # 계정 생성/삭제 API (service_role)
│   │   ├── api/channels/line/route.ts  # LINE 채널 API
│   │   ├── api/channels/facebook/route.ts  # Facebook 채널 API
│   │   ├── api/channels/conversations/route.ts # 채널별 대화 조회 API
│   │   ├── api/channels/messages/route.ts  # 채널 메시지 조회 API
│   │   ├── api/channels/reply/route.ts     # 채널 답변 전송 API
│   │   ├── api/channels/suggest-reply/route.ts # AI 답변 추천 (채널용)
│   │   ├── api/messaging/config/route.ts   # 메시징 채널 설정 API
│   │   ├── api/messaging/generate/route.ts # 월간 보고서 AI 생성 API
│   │   ├── api/messaging/upload-csv/route.ts # 보고서 CSV 업로드 API
│   │   ├── api/messaging/prescription-notify/route.ts # Google Sheet 진단 결과 → LINE 처방 자동 안내 Cron (5분마다)
│   │   ├── api/monthly-report/route.ts     # 월간 보고서 CRUD API
│   │   ├── api/sales-leads/route.ts        # Sales 리드 추적 API
│   │   ├── api/zendesk/sync/route.ts   # Zendesk 티켓 수동 동기화 API
│   │   ├── api/zendesk/stats/route.ts  # Zendesk 통계 조회 API (bbg_admin + hospital)
│   │   ├── api/zendesk/analyze/route.ts # Zendesk 티켓 AI 분석 API (bbg_admin + hospital)
│   │   ├── api/zendesk/hospital-stats/route.ts # 병원별 상세 통계 API (bbg_admin + hospital)
│   │   ├── api/zendesk/insights/route.ts # 병원별 AI 인사이트 3종 (bbg_admin + hospital)
│   │   ├── api/zendesk/followup-customers/route.ts # 팔로업 고객 관리 API (GET/PATCH, bbg_admin + worker)
│   │   ├── api/zendesk/followup-actions/route.ts  # 팔로업 액션 이력 API (GET/POST/PATCH, bbg_admin + worker)
│   │   ├── api/zendesk/followup-notifications/route.ts # 워커 인앱 알림 API (GET/PATCH, bbg_admin + worker)
│   │   ├── api/zendesk/followup-check/route.ts    # AI 자동 팔로업 체크 Cron (POST, CRON_SECRET 인증)
│   │   ├── api/zendesk/followup-summary/route.ts  # 팔로업 요약 Cron (bbg_admin/worker 알림, 일 4회)
│   │   ├── api/zendesk/cron/route.ts   # Vercel Cron endpoint (자동 sync + analyze, 일 2회)
│   │   ├── api/zendesk/tickets-live/route.ts       # 실시간 티켓 목록 (bbg_admin + worker + client, 자동 증분 sync)
│   │   ├── api/zendesk/conversations/route.ts      # 티켓 대화 조회 — live-sync + locale=ko 번역 캐시 (bbg_admin + worker + client)
│   │   ├── api/zendesk/reply/route.ts              # 고객 답변 전송 (상담원별 토큰 인증, bbg_admin + worker + client)
│   │   ├── api/zendesk/ticket-update/route.ts      # 티켓 상태/태그/is_read 업데이트 (bbg_admin + worker + client)
│   │   ├── api/zendesk/agent-token/route.ts        # 상담원 Zendesk 개인 토큰 CRUD (GET/PUT/DELETE, bbg_admin + worker)
│   │   ├── api/zendesk/suggest-reply/route.ts      # AI 답변 추천 생성 (Gemini, bbg_admin + worker + client)
│   │   ├── api/zendesk/suggest-feedback/route.ts   # AI 추천 피드백 기록 (bbg_admin + worker + client)
│   │   ├── api/zendesk/webhook/route.ts            # Zendesk Webhook 수신 (HMAC 서명 검증)
│   │   ├── api/zendesk/poll/route.ts               # Webhook 누락 보정 Fallback Polling Cron (CRON_SECRET, 일 4회)
│   │   └── api/zendesk/migrate-conversations/route.ts # 기존 zendesk_tickets.comments → zendesk_conversations 마이그레이션 (일회성)
│   ├── components/
│   │   ├── LoginPage.tsx           # 로그인 페이지
│   │   ├── Dashboard.tsx           # 격자형 홈 대시보드 (카드 그리드). hospital role → HospitalDashboard, staff → StaffDashboard 분기. 비밀번호 변경 모달 내장
│   │   ├── StaffDashboard.tsx      # BBG 한국 직원 전용 대시보드 (4탭: 내가 지시한 업무/나에게 온 업무/채팅/상담)
│   │   ├── WorkerStatus.tsx        # 실시간 직원 상태 카드 (파란색), 모바일 접기/펼치기 토글
│   │   ├── TaskAssign.tsx          # 업무 할당 폼 (초록색), 모바일 세로 배치. staff 대상 지시 시 번역 스킵
│   │   ├── TaskList.tsx            # 업무 목록 + 별점 평가 (노란색), 모바일 줄바꿈
│   │   ├── TaskChat.tsx            # 업무별 채팅 — locale prop으로 한↔태 동적 결정
│   │   ├── ImageAnnotator.tsx      # 이미지 어노테이션 모달 — 프리핸드 드로잉(빨간 선), 우클릭 텍스트 포스트잇, 합성 후 채팅 전송
│   │   ├── ChatLayout.tsx          # 사이드바 + 패널 오케스트레이터 (반응형)
│   │   ├── ChatSidebar.tsx         # 좌측 사이드바 (방 4개 + 업무 목록)
│   │   ├── ChatPanel.tsx           # 방/업무 겸용 채팅 패널 — Ctrl+V 이미지 붙여넣기, ImageAnnotator 연동
│   │   ├── TaskCalendar.tsx        # 업무 캘린더 (보라색)
│   │   ├── TaskPresetManager.tsx   # 업무 프리셋 CRUD (분홍색, bbg_admin)
│   │   ├── TimeReport.tsx          # 근무 리포트 (청록색)
│   │   ├── UserManager.tsx         # 계정 관리 CRUD (회색, bbg_admin)
│   │   ├── QuickReplyManager.tsx   # 자동답변 CRUD
│   │   ├── HospitalDashboard.tsx   # 병원 파트너 전용 대시보드 (hospital role)
│   │   ├── HospitalKBManager.tsx   # 병원 지식베이스(KB) 관리 UI
│   │   ├── WorkerDashboard.tsx     # 워커 대시보드 (5탭: งาน/แชท/ให้คำปรึกษา/ติดตาม/เครื่องมือ)
│   │   ├── WorkerFollowup.tsx      # 팔로업 고객 관리 탭 (워커 대시보드 ติดตาม)
│   │   ├── SalesPerformance.tsx    # Zendesk Sales 성과 분석 (/sales, 3탭: Sales성과/병원별분석/팔로업고객)
│   │   ├── ZendeskChatLayout.tsx   # Zendesk 상담 3패널 오케스트레이터 (워커 대시보드 ให้คำปรึกษา 탭)
│   │   ├── ZendeskTicketList.tsx   # 좌측 티켓 목록 패널 — 내 티켓/전체/대기 필터, 병원 필터
│   │   ├── ZendeskChatPanel.tsx    # 중앙 채팅 패널 — 대화 히스토리, 인라인 이미지, Public/Internal 토글
│   │   ├── AISuggestPanel.tsx      # 우측 AI 추천 답변 패널 — Gemini 기반 2-3개 추천, Quick Reply 칩
│   │   ├── ZendeskSetup.tsx        # 상담원 Zendesk 개인 토큰 등록/관리 설정 UI
│   │   ├── QuickReplyChips.tsx     # Quick Reply 칩 컴포넌트
│   │   ├── MessagingLayout.tsx     # LINE/Facebook 다이렉트 메시징 오케스트레이터 (워커/스태프 상담 탭)
│   │   ├── ConversationList.tsx    # 다이렉트 메시징 대화 목록 패널
│   │   ├── MessagePanel.tsx        # 다이렉트 메시징 채팅 패널
│   │   ├── LeadInfoPanel.tsx       # 고객 리드 정보 패널 (다이렉트 메시징)
│   │   └── MonthlyReport.tsx       # 월간 보고서 생성 UI (병원별 데이터 입력 + AI 생성)
│   ├── lib/
│   │   ├── supabase.ts
│   │   ├── chat-rooms.ts           # 채팅방 상수, 센티넬 값, 타입 정의
│   │   ├── zendesk.ts              # ZendeskClient (티켓 조회, 댓글 조회/작성)
│   │   ├── zendesk-agent.ts        # AgentZendeskClient — 상담원별 토큰 인증 + Fallback to Admin
│   │   ├── ai-suggest.ts           # AI 답변 추천 로직 (Gemini, 컨텍스트 조합)
│   │   └── crypto.ts               # AES-256-GCM 암호화/복호화 (상담원 토큰 보관용)
│   └── vercel.json                 # Vercel Cron 스케줄 (zendesk/cron 일 2회, followup-summary 일 4회, poll 일 4회, prescription-notify 5분마다)
│
└── supabase/
    ├── schema.sql              # clients, profiles, time_logs, tasks + RLS
    ├── messages.sql            # 채팅 메시지 테이블 + RLS + Realtime
    ├── tasks_extra_columns.sql # tasks 추가 컬럼 (content_th, due_date)
    ├── quick_replies.sql       # 자동답변 테이블
    ├── task_presets.sql        # 업무 프리셋 테이블 + RLS
    ├── task_rating.sql         # 업무 품질 평가 (1~5점)
    ├── worker_propose_task.sql # Worker 업무 제안 (source 컬럼 + RLS)
    ├── whisper_message.sql     # Whisper 메시지 + client 역할 필터링 RLS
    ├── fix_rls_policies.sql    # messages UPDATE + profiles 동료 조회 정책
    ├── chat_file_attachment.sql # 채팅 파일 첨부 (file_url, file_name, file_type + Storage)
    ├── chat_mentions.sql       # @멘션 기능 (mentions jsonb 컬럼)
    ├── task_description.sql    # tasks 상세 설명 컬럼 (description, description_th)
    ├── zendesk_tables.sql      # Zendesk 연동 테이블 (zendesk_tickets, zendesk_analyses)
    ├── zendesk_customer_fields.sql # zendesk_analyses 고객 정보 컬럼 (customer_name, customer_phone, interested_procedure, customer_age)
    ├── hospital_role.sql       # profiles 테이블 hospital_prefix 컬럼 추가
    ├── followup_status.sql     # zendesk_analyses 팔로업 추적 컬럼 (followup_status, followup_note, followup_updated_by, followup_updated_at)
    ├── followup_tracking.sql   # followup_actions + followup_notifications 신규 테이블, zendesk_analyses 체크 사이클 컬럼
    ├── followup_thai_fields.sql # zendesk_analyses 태국어 번역 컬럼 (followup_reason_th, interested_procedure_th)
    ├── chat_read_status.sql    # 채팅 읽음 상태 추적 테이블 (chat_read_status)
    ├── glossary.sql            # 의료/비즈니스 용어 한↔태 번역 용어집 테이블
    ├── zendesk_chat_integration.sql # Zendesk 채팅 통합 (zendesk_agent_tokens, zendesk_conversations, ai_reply_suggestions, zendesk_webhook_log + zendesk_tickets/profiles 컬럼 추가)
    ├── zendesk_conversations_ko.sql # zendesk_conversations.body_ko 컬럼 추가 (한국어 번역 캐시)
    ├── staff_hierarchy.sql     # profiles hierarchy_level/team 컬럼 추가, role에 'staff' 추가, tasks.client_id nullable + request_type 컬럼, RLS 업데이트
    ├── hospital_kb.sql         # 병원 지식베이스(KB) 테이블
    ├── direct_messaging.sql    # LINE/Facebook 다이렉트 메시징 통합 (messaging_channels, conversations, messages, leads 테이블)
    ├── facebook_channels_config.sql # Facebook 22개 페이지 채널 설정 데이터
    ├── messaging_rls_fix.sql   # messaging 관련 테이블 RLS 정책 수정
    ├── monthly_reports.sql     # 병원별 월간 보고서 테이블
    ├── sales_leads.sql         # Sales 리드 추적 테이블 (sales_leads)
    ├── zendesk_conversations_rls.sql # zendesk_conversations RLS (authenticated users 읽기 허용)
    ├── survey_name.sql         # customers 테이블 survey_name 컬럼 추가 + 인덱스 (처방 알림 매칭용)
    ├── v1.4_improvements.sql   # 기타 개선사항
    ├── setup_test_client.sql   # 테스트 데이터 셋업
    └── README.md
│
├── brand/                  # SVG 브랜드 아이덴티티 에셋
│   ├── logo-icon.svg             # SG 모노그램 (아이콘)
│   ├── logo-full-color.svg       # SG + SyncBridge (밝은 배경용)
│   ├── logo-full-white.svg       # SG + SyncBridge (어두운 배경용)
│   ├── logo-text.svg             # SyncBridge 워드마크
│   ├── logo-icon-circle.svg      # 원형 아이콘 (프로필용)
│   ├── logo-icon-dark-bg.svg     # 어두운 배경용 아이콘
│   └── favicon.svg               # 브라우저 파비콘
│
├── guides/                 # 사용자 가이드
│   ├── SyncBridge-Client-Guide-KO.md   # 고객사(병원) 관리자 가이드
│   └── SyncBridge-Worker-Guide-TH.md   # 태국 직원 가이드 (Desktop + Extension)
│
├── SyncBridge-Worker-Manual-TH.md  # 태국 직원 Extension 매뉴얼
├── chrome-store-guide.md           # Chrome Web Store 심사 제출 가이드
```

---

## 전체 셋업 절차

### 1. Supabase 설정

1. [Supabase Dashboard](https://supabase.com/dashboard) → 프로젝트 생성
2. **SQL Editor**에서 아래 순서로 실행:
   1. `supabase/schema.sql` — 핵심 테이블 (clients, profiles, time_logs, tasks)
   2. `supabase/messages.sql` — 채팅 메시지 테이블
   3. `supabase/tasks_extra_columns.sql` — tasks 추가 컬럼 (content_th, due_date)
   4. `supabase/quick_replies.sql` — 자동답변
   5. `supabase/task_presets.sql` — 업무 프리셋
   6. `supabase/task_rating.sql` — 업무 품질 평가
   7. `supabase/worker_propose_task.sql` — Worker 업무 제안 기능
   8. `supabase/whisper_message.sql` — Whisper(본사 지시) 메시지
   9. `supabase/fix_rls_policies.sql` — messages UPDATE + profiles 동료 조회 정책
   10. `supabase/chat_file_attachment.sql` — 채팅 파일 첨부 (file_url, Storage RLS)
   11. `supabase/chat_mentions.sql` — @멘션 (mentions jsonb 컬럼)
   12. `supabase/task_description.sql` — 업무 상세 설명 컬럼 (description, description_th)
   13. `supabase/zendesk_tables.sql` — Zendesk 연동 테이블 (zendesk_tickets, zendesk_analyses)
   14. `supabase/zendesk_customer_fields.sql` — zendesk_analyses 고객 정보 컬럼
   15. `supabase/hospital_role.sql` — profiles hospital_prefix 컬럼
   16. `supabase/followup_status.sql` — zendesk_analyses 팔로업 추적 컬럼
   17. `supabase/followup_tracking.sql` — followup_actions + followup_notifications 테이블, zendesk_analyses 체크 사이클 컬럼
   18. `supabase/followup_thai_fields.sql` — zendesk_analyses 태국어 번역 컬럼 (followup_reason_th, interested_procedure_th)
   19. `supabase/chat_read_status.sql` — 채팅 읽음 상태 추적 테이블
   20. `supabase/glossary.sql` — 의료/비즈니스 용어 한↔태 번역 용어집 테이블
   21. `supabase/zendesk_chat_integration.sql` — Zendesk 채팅 통합 (zendesk_agent_tokens, zendesk_conversations, ai_reply_suggestions, zendesk_webhook_log + zendesk_tickets/profiles 컬럼)
   22. `supabase/zendesk_conversations_ko.sql` — zendesk_conversations.body_ko 컬럼 (한국어 번역 캐시)
   23. `supabase/staff_hierarchy.sql` — profiles hierarchy_level/team 컬럼, role에 'staff' 추가, tasks.client_id nullable + request_type 컬럼, RLS 업데이트
   24. `supabase/hospital_kb.sql` — 병원 지식베이스(KB) 테이블
   25. `supabase/direct_messaging.sql` — LINE/Facebook 다이렉트 메시징 통합 테이블
   26. `supabase/facebook_channels_config.sql` — Facebook 채널 설정 데이터 (22개 페이지)
   27. `supabase/messaging_rls_fix.sql` — messaging 테이블 RLS 정책 수정
   28. `supabase/monthly_reports.sql` — 월간 보고서 테이블
   29. `supabase/sales_leads.sql` — Sales 리드 추적 테이블
   30. `supabase/zendesk_conversations_rls.sql` — zendesk_conversations RLS (Realtime 지원용)
   31. `supabase/survey_name.sql` — customers 테이블 survey_name 컬럼 추가 (처방 알림 매칭용)
   32. `supabase/v1.4_improvements.sql` — 기타 개선사항
3. **Authentication** → Providers → **Email** 활성화

### 2. Client Web 실행

```bash
cd client-web
npm install
```

`.env.local` 생성:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # 업무 API + 계정 관리 (서버사이드 전용)
GEMINI_API_KEY=AIza...               # 번역 + AI 어시스트 (Google Gemini)
CRON_SECRET=...                      # Vercel Cron 인증 시크릿 (zendesk/cron 보호용)
ZENDESK_SUBDOMAIN=...                # Zendesk 서브도메인 (예: bbg)
ZENDESK_EMAIL=...                    # Zendesk API 인증 이메일 (Admin 계정)
ZENDESK_API_TOKEN=...                # Zendesk API 토큰 (Admin, Fallback용)
ZENDESK_WEBHOOK_SECRET=...           # Zendesk Webhook HMAC 서명 검증 시크릿
ZENDESK_TOKEN_ENCRYPTION_KEY=...     # 상담원 개인 토큰 AES-256 암호화 키 (64자 hex)
GOOGLE_SERVICE_ACCOUNT_BASE64=...    # Google Sheets 서비스 계정 JSON (Base64 인코딩) — 처방 알림용
GOOGLE_SHEET_ID=...                  # 처방 알림 대상 Google Sheet ID
```

```bash
npm run dev
```

- 메인 대시보드: `http://localhost:3000/app` (client 계정)
- Sales 분석: `http://localhost:3000/sales` (bbg_admin 전용)
- God Mode 관제: `http://localhost:3000/admin/monitoring` (bbg_admin 전용)

배포: `vercel --prod` (Vercel CLI)

---

## 주요 기능

### Client Web (한국어)

| 기능 | 설명 |
|------|------|
| 로그인 | Supabase Auth, 그라데이션 배경 디자인 |
| 직원 상태 | 온라인/자리 비움/오프라인 + 평균 품질평가 (Realtime) |
| 전체 톡방 | 클라이언트↔직원 간 그룹 채팅방 (접기/펼치기, 발신자 이름 표시) |
| 업무 할당 | 업무 제목(한국어 → 태국어 자동번역) + 상세 가이드(선택, 태국어 자동번역) 분리 입력, 프리셋 선택 → 자동 채우기, 마감일 설정 |
| 업무 목록 | 업무 제목(굵게) + 상세 가이드 접기/펼치기, 태국어 제목·가이드 번역 동시 표시, 실시간 조회, 인라인 채팅, 완료 시 별점 품질 평가(1~5점), 기한초과 경고 |
| 업무 캘린더 | 월별 업무 현황 달력, 날짜별 업무 수 표시 |
| 채팅 | 업무별 1:1 채팅, 즉시 전송 + 백그라운드 번역, 실시간 업데이트 |
| 파일 첨부 | 채팅 내 이미지/문서 업로드, Ctrl+V 클립보드 붙여넣기, 미리보기, 다운로드 (Supabase Storage) |
| 이미지 어노테이션 | 다른 사람 이미지에 hover 시 "수정" 버튼 표시 → 프리핸드 드로잉(빨간 선) + 우클릭 텍스트 포스트잇 → 합성 이미지 채팅 전송 |
| @멘션 | 채팅에서 @이름으로 팀원 태그, 하이라이트 표시 |
| 자동답변 관리 | 퀵 리플라이 CRUD (한국어 → 태국어 자동 번역) |
| 업무 프리셋 관리 | 자주 쓰는 업무 지시 프리셋 등록 (bbg_admin), 병원별 또는 전체 공용 |
| 근무 리포트 | 오늘 일간 근태 요약, 출근율 프로그레스 바 + 색상 코딩 |
| 계정 관리 | 병원/직원 계정 생성·삭제 (bbg_admin 전용, service_role API) |
| AI 어시스트 API | 환자 메시지 분석 → 한국어 번역 + 의도 파악 + 추천 답변 3개 |
| Sales 성과 분석 | `/sales` — Zendesk 티켓 기반 AI 분석, 담당자별 품질 평가, 예약 전환율, 팔로업 고객 관리 (3탭: Sales 성과 / 병원별 분석 / 팔로업 고객). 팔로업 탭: BI 요약 카드, 상세 모달(타임라인 + Push 지시 + Drop 처리) |
| 병원 파트너 대시보드 | hospital role 로그인 시 전용 대시보드 — 자사 병원 데이터만 조회, AI 인사이트(병원전략/Sales개선/본사관리) 확인 |
| Zendesk 채팅 상담 UI | 워커 대시보드 `ให้คำปรึกษา` 탭 — 3패널 레이아웃(티켓 목록/채팅/AI 추천). 프론트엔드 폴링으로 실시간 동기화. 인라인 이미지, Thai→Korean 번역 캐시, 티켓 상태 변경, 상담원별 개인 토큰 인증 |
| AI 답변 추천 | Zendesk 채팅 우측 패널 — Gemini 기반 태국어 답변 2-3개 추천. Quick Reply 칩, 고객 정보 요약. 추천 피드백 수집 (selected_index, was_edited) |
| Korean Diet 처방 알림 | `/api/messaging/prescription-notify` — Google Sheet 진단 결과 읽기 → LINE 자동 안내 발송 (5분마다 Cron, Vercel Pro). 환자 survey_name/display_name/이름으로 3단계 퍼지 매칭. 진단 단계(1/2단계) + 가격 + 계좌 안내 포함 태국어 메시지 발송 |
| 건강설문 성명 수집 | Korean Diet 챗봇 판매 플로우 3.5단계 — 고객이 설문 완료 후 챗봇이 성명 확인 요청 → `customers.survey_name` 저장 (처방 알림 매칭 정확도 향상) |

### 관리자/파트너 페이지 구조

| 경로 | 용도 |
|------|------|
| `/app` | 메인 홈 (격자형 카드 그리드). hospital role → HospitalDashboard, staff role → StaffDashboard 자동 분기 |
| `/admin/workers` | 직원 현황 (실시간 상태) |
| `/admin/chat` | 채팅 (업무 채팅방) |
| `/admin/tasks` | 업무 관리 (할당 + 목록) |
| `/admin/calendar` | 직원별 업무 현황 |
| `/admin/time-report` | 근무 리포트 |
| `/admin/directives` | 지시/협조 현황 (staff/bbg_admin) |
| `/admin/reports` | 월간 보고서 |
| `/admin/presets` | 업무 프리셋 관리 |
| `/admin/glossary` | 용어집 관리 |
| `/admin/users` | 계정 관리 (bbg_admin 전용) |
| `/admin/hospital-kb` | 병원 지식베이스(KB) 관리 |
| `/sales` | Sales 성과 분석 — Zendesk 티켓 AI 분석, 병원별 분석, 팔로업 고객 관리 (bbg_admin 전용) |
| `/admin/monitoring` | God Mode 통합 관제 (bbg_admin 전용) |
| `/consultation` | Zendesk 채팅 상담 (worker + client 접근 가능) |

### God Mode 통합 관제 (`/admin/monitoring`)

bbg_admin 전용 실시간 모니터링 대시보드입니다.

| 기능 | 설명 |
|------|------|
| 권한 체크 | bbg_admin이 아니면 `/app`으로 리다이렉트 |
| 통계 바 | 총 업무, 진행중, 완료, 완료율 실시간 표시 |
| 필터 바 | 병원/담당자/상태/기간별 필터링 |
| 워커 그리드 | 각 워커의 상태 배지 + 완료/대기 업무 통계 |
| 이중 SLA | 메시지 SLA(5분/15분) + 업무 나이 SLA(1시간/3시간) |
| 마감일 표시 | 각 업무의 마감일 + 기한초과 경고 |
| 2-패널 레이아웃 | 좌측: 전체 업무 리스트 / 우측: 상세 + 실시간 채팅 |
| SLA 신호등 | 정상(< 5분) / 주의(5~15분) / 지연(> 15분) — 30초 자동 갱신 |
| 긴급순 정렬 | 지연 → 주의 → 정상 → 완료 순으로 자동 정렬 |
| 일반 메시지 | 초록색 버블, 한→태 자동 번역 |
| Whisper (본사 지시) | 보라색 버블 + 잠금 라벨, 담당 직원에게만 표시 (client에게 RLS로 숨김) |
| Realtime | tasks/messages/time_logs 변경 시 자동 갱신 |

---

## 번역 패턴

Client Web의 모든 채팅에서 **즉시 전송 + 백그라운드 번역** 패턴을 사용합니다:

1. 메시지를 원본 텍스트로 즉시 DB에 저장 (content_ko, content_th 모두 원본)
2. 백그라운드에서 Gemini API로 번역 요청
3. 번역 완료 시 해당 메시지의 번역 컬럼만 업데이트
4. Realtime 구독(`event: '*'`)으로 UPDATE 이벤트도 수신하여 UI 즉시 반영

---

## 전체 톡방 (General Chat)

클라이언트↔직원 간 그룹 소통을 위한 전체 채팅방입니다.

- **구현 방식:** `messages.task_id`가 NOT NULL이므로, `content = '__GENERAL_CHAT__'`인 더미 task를 client_id별로 생성하여 채팅방으로 사용
- **API:** `GET /api/tasks?general_chat=true&client_id=xxx` → 채팅방 task 조회/자동 생성
- **일반 목록 숨김:** 업무 목록/캘린더 쿼리에서 `.neq('content', '__GENERAL_CHAT__')` 필터로 제외
- **UI:** 접기/펼치기, 발신자 이름 표시, 실시간 수신
- **필수 조건:** 워커의 `profiles.client_id`가 반드시 설정되어 있어야 함 (없으면 UI에 안내 메시지 표시)
- **에러 핸들링:** `[GeneralChat]` 프리픽스 로그로 초기화 실패 원인 추적 가능

---

## 디자인 시스템

Figma Make 기반 디자인 업그레이드 적용 (Linear/Notion 스타일).

| 요소 | 스타일 |
|------|--------|
| 카드 | `rounded-xl shadow-sm border` |
| 헤더 | sticky, shadow-sm |
| 아이콘 | lucide-react |
| 배지 | rounded-full pill 형태 |

**섹션별 색상 구분** (대시보드 각 섹션이 그라데이션 배경 + 좌측 컬러 보더로 구분됨):

| 섹션 | 색상 |
|------|------|
| 직원 상태 | 파란색 (blue) |
| 전체 톡방 | 인디고 (indigo) |
| 업무 할당 | 초록색 (emerald) |
| 업무 목록 | 노란색 (amber) |
| 업무 캘린더 | 보라색 (violet) |
| 업무 프리셋 | 분홍색 (rose) |
| 근무 리포트 | 청록색 (cyan) |
| 계정 관리 | 회색 (slate) |

---

## 권한 체계

| role | 권한 |
|------|------|
| `bbg_admin` | 전체 관리: 직원/고객사/업무/자동답변/프리셋/계정 관리, **God Mode 관제**, Whisper 전송, Sales 분석 전체 조회. hierarchy_level=10 (대표) |
| `staff` | BBG 한국 직원. 업무 지시(생성/수정/삭제) + 업무 수행 양방향 가능. hierarchy_level(20/30/40)로 계층 구분. `/api/assignable-users`로 하위자 조회. StaffDashboard 전용 UI |
| `client` | 자사 직원/업무/자동답변만 조회, 업무 할당(프리셋 사용), 전체 톡방 참여, Whisper 메시지 볼 수 없음 |
| `worker` | 본인 업무 조회/완료/제안, 채팅, 전체 톡방 참여, 템플릿 읽기, time_logs 기록, 팔로업 고객 조회/상태 업데이트. hierarchy_level=100 |
| `hospital` | 병원 파트너 전용 대시보드 — 자사 병원 데이터만 조회 (`hospital_prefix` 기반 필터), AI 인사이트 요청 가능 |

---

## 환경 변수 정리

| 파일 | 변수 |
|------|------|
| `client-web/.env.local` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `CRON_SECRET`, `ZENDESK_SUBDOMAIN`, `ZENDESK_EMAIL`, `ZENDESK_API_TOKEN`, `ZENDESK_WEBHOOK_SECRET`, `ZENDESK_TOKEN_ENCRYPTION_KEY`, `GOOGLE_SERVICE_ACCOUNT_BASE64`, `GOOGLE_SHEET_ID` |

---

## 배포

| 구분 | 방법 |
|------|------|
| **Client Web** | `vercel --prod` (Vercel CLI) |

---

## 트러블슈팅 (General Chat)

전체 톡방이 보이지 않는 경우 아래 순서로 확인:

1. **`profiles.client_id` 확인** — Supabase Dashboard에서 해당 워커의 `client_id`가 비어있으면 톡방 로드 불가
2. **Vercel 환경 변수** — `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`가 설정되어 있는지
3. **DevTools 콘솔** — `[GeneralChat]` 프리픽스 로그로 어떤 단계에서 실패하는지 확인

자세한 내용은 `DEBUGGING.md` 참고.

---

## 관련 문서

- `PRD.md` — 제품 요구사항 및 현재 구현 현황
- `DEBUGGING.md` — 디버깅 가이드 및 트러블슈팅
- `supabase/README.md` — DB 스키마/Auth 설정
- `client-web/README.md` — 대시보드 세부
- `guides/SyncBridge-Client-Guide-KO.md` — 고객사(병원) 관리자 사용 가이드
- `brand/` — SVG 브랜드 아이덴티티 에셋
