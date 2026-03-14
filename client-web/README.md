# SyncBridge Client Web (통합 웹 대시보드)

한국 고객사(병원), BBG 관리자, 태국 워커용 Next.js 대시보드입니다.
워커는 Desktop App/Extension 없이 웹 브라우저만으로 업무를 수행할 수 있습니다 (Phase 1 완료).

## 기술 스택

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- Supabase (Auth, DB, Realtime)
- Google Gemini API (번역 + AI 어시스트)

## 설치 및 실행

```bash
npm install
npm run dev
```

- 메인 대시보드: `http://localhost:3000`
- God Mode 관제: `http://localhost:3000/admin/monitoring` (bbg_admin 전용)

배포: `vercel --prod` (Vercel CLI)

## 라우트 구조

| 경로 | 역할 |
|------|------|
| `/` | 메인 페이지 (로그인 + 대시보드) |
| `/admin/monitoring` | God Mode 통합 관제 (bbg_admin 전용) |

### 역할 기반 라우팅

로그인 후 role에 따라 자동 분기:

| role | 렌더링 컴포넌트 | 설명 |
|------|----------------|------|
| `worker` | `WorkerDashboard.tsx` | 워커 전용 대시보드 (업무/채팅/상담/팔로업/도구 5탭) |
| `staff` | `StaffDashboard.tsx` | BBG 한국 직원 전용 대시보드 (지시한 업무/나에게 온 업무/채팅/상담 4탭) |
| `hospital` | `HospitalDashboard.tsx` | 병원 파트너 대시보드 (hospital_prefix 기반 자사 데이터만) |
| `client` | `Dashboard.tsx` | 클라이언트 대시보드 |
| `bbg_admin` | `Dashboard.tsx` | 어드민 대시보드 (전체 기능 접근) |

## API 엔드포인트 (주요)

| 경로 | 메서드 | 역할 |
|------|--------|------|
| `/api/tasks` | GET/POST/PATCH/DELETE | 업무 CRUD, 채팅방 조회/생성 (`?general_chat=true`, `?chat_room=WORK`) |
| `/api/translate` | POST | 한↔태 양방향 번역 (Gemini API) |
| `/api/ai-assist` | POST | AI 상담 어시스턴트 (환자 메시지 분석 + 추천 답변) |
| `/api/admin/users` | POST/DELETE | 계정 생성/삭제 (bbg_admin, service_role) |
| `/api/assignable-users` | GET | hierarchy_level 기반 지시 가능 대상 조회 (staff/bbg_admin) |
| `/api/auth/change-password` | POST | 비밀번호 변경 |
| `/api/zendesk/*` | 다수 | Zendesk 통합 (sync/analyze/cron/채팅 상담/팔로업 등) |
| `/api/channels/*` | 다수 | LINE/Facebook 채널 메시징 (chatbot-toggle 포함) |
| `/api/messaging/*` | 다수 | 다이렉트 메시징 (auto-reply/suggest-reply/generate/upload-csv 포함) |
| `/api/rag/*` | 다수 | RAG 케이스 검색 (index/index-koreandiet/search) |
| `/api/hospital-kb` | GET/POST/PATCH/DELETE | 병원 지식베이스 CRUD |
| `/api/monthly-report` | GET/POST/PATCH | 월간 보고서 CRUD |
| `/api/sales-leads` | GET/POST/PATCH | Sales 리드 추적 |

전체 API 목록 및 상세 파라미터는 `PRD.md` 섹션 6 참조.

## 컴포넌트

### 워커 대시보드 (신규 — Phase 1)

| 컴포넌트 | 기능 |
|----------|------|
| `WorkerDashboard.tsx` | 워커 전용 대시보드. 탭 네비게이션 (업무/채팅/도구). role === 'worker' 시 렌더링 |
| `WorkerStatusToggle.tsx` | 출근/자리비움/퇴근 상태 토글 + 경과 시간 표시. `profiles.status` PATCH 업데이트 |
| `TaskPropose.tsx` | 워커의 업무 제안 폼. 태국어 입력 → 한국어 자동 번역, `source: 'worker'`로 저장 |
| `TranslationHelper.tsx` | 태국어↔한국어 간편 번역 도우미. 기존 `/api/translate` 활용 |

### 클라이언트/어드민 대시보드

| 컴포넌트 | 기능 | 섹션 색상 |
|----------|------|-----------|
| `LoginPage.tsx` | 이메일/비밀번호 로그인 | - |
| `Dashboard.tsx` | 메인 대시보드 레이아웃. role 기반 분기 (worker → WorkerDashboard) | - |
| `WorkerStatus.tsx` | 실시간 직원 상태 카드 | 파란색 (blue) |
| `GeneralChat.tsx` | 전체 톡방 (그룹 채팅) | 인디고 (indigo) |
| `TaskAssign.tsx` | 업무 할당 폼 (프리셋 + 마감일 datetime-local, 담당자 표시) | 초록색 (emerald) |
| `TaskList.tsx` | 업무 목록 (내 업무/팀 전체 분리) + 별점 평가 + 인라인 채팅 | 노란색 (amber) |
| `TaskChat.tsx` | 업무별 1:1 채팅 | - |
| `TaskCalendar.tsx` | 월별 업무 캘린더 | 보라색 (violet) |
| `TaskPresetManager.tsx` | 업무 프리셋 CRUD (bbg_admin) | 분홍색 (rose) |
| `TimeReport.tsx` | 일간 근무 리포트 | 청록색 (cyan) |
| `UserManager.tsx` | 계정 관리 CRUD (bbg_admin) | 회색 (slate) |
| `QuickReplyManager.tsx` | 자동답변 CRUD | - |

### 워커 대시보드 탭 구성

| 탭 | 내용 |
|----|------|
| งาน (업무) | 내 업무 목록 (본인 할당 업무) / 팀 전체 업무 (소속 병원 전체) |
| แชท (채팅) | 업무별 채팅 + 채팅방 4개 (WORK/CS/GRAPHIC/KOL) |
| ให้คำปรึกษา (상담) | Zendesk 채팅 상담 (ZendeskChatLayout) / 다이렉트 메시징 (MessagingLayout) |
| ติดตาม (팔로업) | WorkerFollowup — 팔로업 고객 카드, 코멘트 입력, AI 지시 황색 카드 |
| เครื่องมือ (도구) | WorkerStatusToggle (출퇴근), TaskPropose (업무 제안), TranslationHelper (번역) |

### 어드민 페이지 구조

| 경로 | 설명 |
|------|------|
| `/app` | 메인 대시보드 (로그인 + role별 분기) |
| `/sales` | Sales 성과 분석 (bbg_admin 전용, 3탭) |
| `/admin/monitoring` | God Mode 관제 (bbg_admin 전용) |
| `/admin/workers` | 직원 현황 |
| `/admin/chat` | 채팅 |
| `/admin/tasks` | 업무 관리 |
| `/admin/calendar` | 직원별 업무 캘린더 |
| `/admin/time-report` | 근무 리포트 |
| `/admin/directives` | 지시/협조 현황 (staff/bbg_admin) |
| `/admin/reports` | 월간 보고서 |
| `/admin/presets` | 업무 프리셋 관리 |
| `/admin/glossary` | 용어집 관리 |
| `/admin/users` | 계정 관리 (bbg_admin 전용) |
| `/admin/hospital-kb` | 병원 지식베이스 관리 |

## 기능 상세

### 워커 웹 대시보드 (Phase 1 — 신규)

- 워커가 Desktop App/Extension 없이 웹 브라우저만으로 업무 수행 가능
- 탭 네비게이션: 업무 탭(내 업무 / 팀 전체 업무 분리), 채팅 탭, 도구 탭
- **출퇴근 상태 토글** — 출근/자리비움/퇴근 버튼, 상태 유지 경과 시간 표시
- **업무 제안** — 워커가 직접 태국어로 업무 입력 → 한국어 자동 번역 후 저장 (`source: 'worker'`)
- **번역 도우미** — 태국어↔한국어 즉석 번역 패널

### 업무 기능 개선 (신규)

- **마감일 시간 포함** — `datetime-local` 입력으로 날짜+시간 지정 가능
- **마감일 인라인 수정** — 기존 마감일 클릭 시 인라인 편집 가능
- **업무 완료 처리** — client만 완료(초록 완료 버튼) 처리 가능, worker 직접 완료 불가
- **완료 업무 되돌리기** — client가 완료된 업무를 대기 중으로 되돌릴 수 있음
- **업무 취소** — client가 대기 중 업무를 X 취소로 취소 처리 가능
- **할당자 표시** — 업무 카드에 "할당: OOO" 표시 (`created_by` 컬럼 활용)
- **내 업무 / 팀 전체 분리** — TaskList에서 본인 업무와 팀 전체 업무를 탭으로 구분

### 전체 톡방 (GeneralChat)
- 클라이언트↔직원 간 그룹 채팅방
- `content = '__GENERAL_CHAT__'`인 더미 task를 client_id별로 생성하여 사용
- 접기/펼치기, 발신자 이름 표시, 실시간 Realtime 수신

### 채팅 번역 패턴
모든 채팅에서 **즉시 전송 + 백그라운드 번역** 패턴:
1. 원본 텍스트로 즉시 DB 저장 (content_ko, content_th 모두 원본)
2. 백그라운드에서 Gemini API 번역
3. 번역 완료 시 해당 메시지 UPDATE
4. Realtime(`event: '*'`)으로 UPDATE 이벤트도 수신

### God Mode 통합 관제 (`/admin/monitoring`)

bbg_admin 전용 실시간 모니터링 대시보드입니다.

| 기능 | 설명 |
|------|------|
| 권한 체크 | bbg_admin이 아니면 `/app`으로 리다이렉트 |
| 2-패널 레이아웃 | 좌측: 전체 업무 리스트 / 우측: 상세 + 실시간 채팅 |
| SLA 신호등 | 정상(< 5분) / 주의(5~15분) / 지연(> 15분) |
| SLA 자동 갱신 | 30초 간격으로 뱃지 색상 자동 업데이트 |
| 긴급순 정렬 | 지연 → 주의 → 정상 → 완료 순 자동 정렬 |
| 일반 메시지 | 초록색 버블, 한→태 자동 번역 |
| Whisper (본사 지시) | 보라색 버블 + 잠금 라벨, `is_whisper: true`로 저장, RLS로 client에게 숨김 |
| Realtime | tasks/messages 변경 시 자동 갱신 |

## 권한

| role | 접근 범위 |
|------|-----------|
| `bbg_admin` | 전체 기능 — God Mode 관제, 프리셋/계정/KB 관리, Whisper 전송, Sales 분석, Zendesk 전체 API, 챗봇 토글 관리. hierarchy_level=10 |
| `staff` | BBG 한국 직원 전용 대시보드(StaffDashboard). 업무 지시+수행 양방향. hierarchy_level 기반 하위자에게 지시. 챗봇 토글 관리. tasks INSERT/UPDATE/DELETE 권한 |
| `client` | 자사 직원/업무, 업무 할당/완료/취소/되돌리기, 전체 톡방, Zendesk 채팅 상담 (tickets-live/conversations/reply 등) |
| `worker` | 워커 대시보드 (5탭: 업무/채팅/상담/팔로업/도구), 본인 업무, 업무 제안, 상태 토글, 번역 도우미, 팔로업 고객 관리, Zendesk 상담. hierarchy_level=100 |
| `hospital` | 병원 파트너 대시보드 전용 — 자사 hospital_prefix 기반 데이터만. AI 인사이트 조회 |

## 환경 변수

`.env.local`에 다음 설정:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...            # 업무 API + 계정 관리 (서버사이드 전용)
GEMINI_API_KEY=AIza...                       # 번역 + AI 어시스트 (Google Gemini)

# Zendesk 기능
CRON_SECRET=...                              # Vercel Cron 인증 토큰
ZENDESK_SUBDOMAIN=...                        # Zendesk 서브도메인
ZENDESK_EMAIL=...                            # Zendesk 관리자 이메일
ZENDESK_API_TOKEN=...                        # Zendesk API 토큰
ZENDESK_WEBHOOK_SECRET=...                   # Webhook HMAC-SHA256 검증 시크릿
ZENDESK_TOKEN_ENCRYPTION_KEY=...            # 상담원 토큰 AES-256 암호화 키 (64자 hex)
```
