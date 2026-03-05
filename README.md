# SyncBridge — 원격 BPO 업무 동기화 플랫폼

한국 고객사(병원)와 태국 원격 근무자(마케터/CS) 간의 실시간 업무 지시 및 상태 동기화를 위한 전체 시스템입니다.

---

## 시스템 개요

| 구분 | 용도 |
|------|------|
| **Client Web** | 고객사/BBG 관리자 대시보드. 업무 할당(프리셋 지원), 실시간 모니터링, 업무별 채팅, 전체 톡방, 캘린더, 자동답변 관리, 계정 관리, AI 어시스트 API, **God Mode 관제** |
| **Desktop App** | 태국 직원용 Electron 데스크톱 앱. 출퇴근, 업무 수신/완료, 업무별 채팅, 전체 톡방, 번역 (macOS/Windows) |
| **Worker Extension** | 태국 직원용 Chrome 확장프로그램. 출퇴근, 업무 수신/완료, 업무 제안, 번역, 채팅, AI 드래그 분석 |
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
├── client-web/              # Next.js 14 관리자 대시보드
│   ├── app/
│   │   ├── page.tsx                # 메인 (로그인 + 대시보드)
│   │   ├── layout.tsx
│   │   ├── admin/monitoring/
│   │   │   └── page.tsx            # God Mode 통합 관제 대시보드
│   │   ├── api/tasks/route.ts      # 업무 CRUD + 전체 톡방 API (service_role)
│   │   ├── api/translate/route.ts  # 한↔태 번역 API (Gemini)
│   │   ├── api/ai-assist/route.ts  # AI 상담 어시스턴트 API
│   │   └── api/admin/users/route.ts # 계정 생성/삭제 API (service_role)
│   ├── components/
│   │   ├── LoginPage.tsx           # 로그인 페이지
│   │   ├── Dashboard.tsx           # 메인 대시보드 레이아웃
│   │   ├── WorkerStatus.tsx        # 실시간 직원 상태 카드 (파란색)
│   │   ├── GeneralChat.tsx         # 전체 톡방 (인디고)
│   │   ├── TaskAssign.tsx          # 업무 할당 폼 (초록색)
│   │   ├── TaskList.tsx            # 업무 목록 + 별점 평가 (노란색)
│   │   ├── TaskChat.tsx            # 업무별 채팅
│   │   ├── TaskCalendar.tsx        # 업무 캘린더 (보라색)
│   │   ├── TaskPresetManager.tsx   # 업무 프리셋 CRUD (분홍색, bbg_admin)
│   │   ├── TimeReport.tsx          # 근무 리포트 (청록색)
│   │   ├── UserManager.tsx         # 계정 관리 CRUD (회색, bbg_admin)
│   │   └── QuickReplyManager.tsx   # 자동답변 CRUD
│   └── lib/supabase.ts
│
├── syncbridge-desktop/      # Electron 데스크톱 앱 (macOS/Windows)
│   ├── electron/
│   │   ├── main.js          # Electron 메인 프로세스
│   │   └── preload.js       # 프리로드 스크립트
│   ├── src/
│   │   ├── App.jsx          # 메인 UI (업무, 채팅, 전체 톡방, 번역, AI)
│   │   ├── main.jsx         # React 엔트리
│   │   └── lib/
│   │       ├── supabase.js  # Supabase 클라이언트
│   │       └── platform.js  # 플랫폼 추상화 (Electron/Chrome 분기)
│   └── package.json
│
├── syncbridge-extension/    # Chrome Extension (Manifest V3)
│   ├── public/manifest.json
│   ├── src/
│   │   ├── App.jsx          # 팝업 메인 UI (업무, 채팅, 번역, 템플릿, 업무 제안)
│   │   ├── content.js       # Activity Ping + AI 드래그 어시스트 (Shadow DOM)
│   │   ├── background.js    # 서비스 워커 (유휴 감지, 배지, AI 중계)
│   │   └── lib/supabase.js  # Supabase 클라이언트 + proposeTask 헬퍼
│   └── dist/                # 빌드 결과물 (Chrome에 로드)
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
```

```bash
npm run dev
```

- 메인 대시보드: `http://localhost:3000` (client 계정)
- God Mode 관제: `http://localhost:3000/admin/monitoring` (bbg_admin 전용)

배포: `vercel --prod` (Vercel CLI)

### 3. Desktop App 실행

```bash
cd syncbridge-desktop
npm install
```

`.env.local` 생성:
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_WEB_URL=https://your-deployed-url.vercel.app   # 번역 API URL
```

```bash
npm run dev       # 개발
npm run build:mac # macOS 빌드
npm run build:win # Windows 빌드
```

릴리즈: GitHub에 `v*` 태그 push → GitHub Actions에서 자동 빌드 + 릴리즈

### 4. Extension 설치

```bash
cd syncbridge-extension
npm install
npm run build
```

Chrome에서 `chrome://extensions` → 개발자 모드 → `syncbridge-extension/dist` 폴더 로드

`.env.local` 생성:
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_WEB_URL=http://localhost:3000   # 번역/AI API URL
```

---

## 주요 기능

### Client Web (한국어)

| 기능 | 설명 |
|------|------|
| 로그인 | Supabase Auth, 그라데이션 배경 디자인 |
| 직원 상태 | 온라인/자리 비움/오프라인 + 평균 품질평가 (Realtime) |
| 전체 톡방 | 클라이언트↔직원 간 그룹 채팅방 (접기/펼치기, 발신자 이름 표시) |
| 업무 할당 | 프리셋 선택 → 자동 채우기, 마감일 설정(날짜만), 한국어 입력 → 태국어 자동 번역 |
| 업무 목록 | 실시간 조회, 인라인 채팅, 완료 시 별점 품질 평가(1~5점), 기한초과 경고 |
| 업무 캘린더 | 월별 업무 현황 달력, 날짜별 업무 수 표시 |
| 채팅 | 업무별 1:1 채팅, 즉시 전송 + 백그라운드 번역, 실시간 업데이트 |
| 파일 첨부 | 채팅 내 이미지/문서 업로드, 미리보기, 다운로드 (Supabase Storage) |
| @멘션 | 채팅에서 @이름으로 팀원 태그, 하이라이트 표시 |
| 자동답변 관리 | 퀵 리플라이 CRUD (한국어 → 태국어 자동 번역) |
| 업무 프리셋 관리 | 자주 쓰는 업무 지시 프리셋 등록 (bbg_admin), 병원별 또는 전체 공용 |
| 근무 리포트 | 오늘 일간 근태 요약, 출근율 프로그레스 바 + 색상 코딩 |
| 계정 관리 | 병원/직원 계정 생성·삭제 (bbg_admin 전용, service_role API) |
| AI 어시스트 API | 환자 메시지 분석 → 한국어 번역 + 의도 파악 + 추천 답변 3개 |

### God Mode 통합 관제 (`/admin/monitoring`)

bbg_admin 전용 실시간 모니터링 대시보드입니다.

| 기능 | 설명 |
|------|------|
| 권한 체크 | bbg_admin이 아니면 메인 페이지로 리다이렉트 |
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

### Desktop App (태국어)

태국 직원용 Electron 기반 데스크톱 앱입니다. macOS와 Windows를 지원합니다.

| 탭 | 기능 |
|------|------|
| **업무** | 담당 태스크 목록, 마감일 표시(색상 코딩), 완료 처리, **업무 제안(Propose Task)** |
| **채팅** | 전체 톡방 + 업무별 채팅, 태국어 입력 → 한국어 백그라운드 번역, **파일 첨부**, **@멘션** |
| **번역/AI** | 태국어 → 한국어 즉석 번역 + AI 상담 어시스트 (의도 파악 + 추천 답변) |

- 즉시 전송 + 백그라운드 번역 (Gemini API)
- Realtime 구독으로 번역 결과 실시간 반영
- 전체 톡방: 그룹 채팅 (발신자 이름 표시, 멤버 온라인 상태)
- 파일 첨부: 이미지/문서 업로드, 미리보기
- @멘션: 팀원 태그, 멘션 시 푸시 알림
- 푸시 알림: 새 메시지/멘션 수신 시 데스크톱 알림
- GitHub Actions CI/CD로 자동 빌드/릴리즈

### Worker Extension (태국어/한국어 병기)

| 탭 | 기능 |
|------|------|
| **업무** | 담당 태스크 목록, 마감일 표시(색상 코딩), 완료 처리, **업무 제안(Propose Task)** |
| **채팅** | 업무별 채팅, 태국어 입력 → 한국어로 클라이언트 전달 |
| **번역** | 태국어 → 한국어 번역 헬퍼 |
| **템플릿** | DB에서 로드한 퀵 리플라이 복사 |

**업무 제안 (Propose Task)**
- Worker가 직접 업무를 제안하여 등록 (태국어 입력 → 한국어 자동 번역)
- 미완료 클라이언트 지시가 있으면 경고 메시지 표시 (등록 자체는 가능)
- 리스트에서 "자체 제안" 뱃지로 구분

**AI 드래그 어시스트**
- 웹페이지에서 텍스트 드래그 → "AI" 버튼 표시
- 클릭 시 환자 메시지 분석: 한국어 번역 + 의도 파악 + 태국어 추천 답변 3개
- 추천 답변 클릭 → 클립보드 복사
- Shadow DOM으로 호스트 페이지 CSS 충돌 방지

**기타**
- 출퇴근 토글 → `time_logs` 기록
- 품질 평균 표시 (클라이언트가 평가한 완료 업무의 평균)
- Activity Ping: 10분 무활동 시 자동 "자리 비움"

---

## 번역 패턴

모든 채팅에서 **즉시 전송 + 백그라운드 번역** 패턴을 사용합니다:

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
- **에러 핸들링:** Desktop App에서 `[GeneralChat]` 프리픽스 로그로 초기화 실패 원인 추적 가능

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
| `bbg_admin` | 전체 관리: 직원/고객사/업무/자동답변/프리셋/계정 관리, **God Mode 관제**, Whisper 전송 |
| `client` | 자사 직원/업무/자동답변만 조회, 업무 할당(프리셋 사용), 전체 톡방 참여, Whisper 메시지 볼 수 없음 |
| `worker` | 본인 업무 조회/완료/제안, 채팅, 전체 톡방 참여, 템플릿 읽기, time_logs 기록 |

---

## 환경 변수 정리

| 파일 | 변수 |
|------|------|
| `client-web/.env.local` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` |
| `syncbridge-desktop/.env.local` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WEB_URL` |
| `syncbridge-extension/.env.local` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WEB_URL` |

---

## 배포

| 구분 | 방법 |
|------|------|
| **Client Web** | `vercel --prod` (Vercel CLI) |
| **Desktop App** | GitHub에 `v*` 태그 push → GitHub Actions 자동 빌드 (macOS/Windows) |
| **Extension** | `npm run build` → Chrome 웹 스토어 등록 또는 수동 로드 |

---

## 릴리즈 이력 (Desktop App)

| 버전 | 내용 |
|------|------|
| v1.0.0 | 초기 릴리즈 |
| v1.1.0 | 마감일 날짜만 표시 (시간 제거) |
| v1.2.0 | 전체 톡방 추가 |
| v1.2.1 | 번역 수정 (즉시 전송 + 백그라운드 번역, Realtime UPDATE 수신) |
| v1.2.2 | 채팅 발신자 이름 표시 |
| v1.2.3 | 발신자 이름 데스크톱 릴리즈 |
| v1.2.4 | 전체 톡방 디버깅 강화, CORS 수정, 에러 피드백 UI 추가 |
| v1.3.0 | 파일 첨부, @멘션, 푸시 알림, 멤버 온라인 상태, NSIS 바로가기 수정 |

---

## CORS 설정

Desktop App(Electron)과 Extension은 Vercel에 배포된 Client Web API를 cross-origin으로 호출합니다.
`/api/tasks`, `/api/translate`에 CORS 헤더가 설정되어 있습니다. (`/api/ai-assist`, `/api/admin/users`는 미적용 — 필요 시 동일 패턴 추가)

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization`
- `OPTIONS` preflight 요청 처리 포함

---

## 트러블슈팅 (General Chat)

데스크톱에서 전체 톡방이 보이지 않는 경우 아래 순서로 확인:

1. **`profiles.client_id` 확인** — Supabase Dashboard에서 해당 워커의 `client_id`가 비어있으면 톡방 로드 불가
2. **`VITE_WEB_URL` 확인** — `syncbridge-desktop/.env`의 URL이 실제 배포된 client-web 주소와 일치하는지
3. **Vercel 환경 변수** — `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`가 설정되어 있는지
4. **DevTools 콘솔** — `[GeneralChat]` 프리픽스 로그로 어떤 단계에서 실패하는지 확인

자세한 내용은 `DEBUGGING.md` 참고.

---

## 관련 문서

- `PRD.md` — 제품 요구사항 및 현재 구현 현황
- `DEBUGGING.md` — 디버깅 가이드 및 트러블슈팅
- `supabase/README.md` — DB 스키마/Auth 설정
- `client-web/README.md` — 대시보드 세부
- `syncbridge-extension/README.md` — 확장프로그램 세부
- `guides/SyncBridge-Client-Guide-KO.md` — 고객사(병원) 관리자 사용 가이드
- `guides/SyncBridge-Worker-Guide-TH.md` — 태국 직원 사용 가이드 (Desktop + Extension)
- `SyncBridge-Worker-Manual-TH.md` — 태국 직원 Extension 전용 매뉴얼
- `chrome-store-guide.md` — Chrome Web Store 등록 가이드
- `brand/` — SVG 브랜드 아이덴티티 에셋
