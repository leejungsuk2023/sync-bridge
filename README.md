# SyncBridge — 원격 BPO 업무 동기화 플랫폼

한국 고객사(병원)와 태국 원격 근무자(마케터/CS) 간의 실시간 업무 지시 및 상태 동기화를 위한 전체 시스템입니다.

---

## 시스템 개요

| 구분 | 용도 |
|------|------|
| **Client Web** | 고객사/BBG 관리자 대시보드. 업무 할당(프리셋 지원), 실시간 모니터링, 채팅, 자동답변 관리, 계정 관리, AI 어시스트 API, **God Mode 관제** |
| **Worker Extension** | 태국 직원용 Chrome 확장프로그램. 출퇴근, 업무 수신/완료(마감일 표시), 업무 제안, 번역, 채팅, AI 드래그 분석 |
| **Supabase** | Auth, PostgreSQL, Realtime (실시간 동기화), RLS 기반 권한 관리 |

---

## 프로젝트 구조

```
g sync/
├── README.md                # 이 문서
├── PRD.md                   # 제품 요구사항
├── figma-prompts.md         # Figma Make 디자인 프롬프트
│
├── client-web/              # Next.js 14 관리자 대시보드
│   ├── app/
│   │   ├── page.tsx                # 메인 (로그인 + 대시보드, bbg_admin 자동 리다이렉트)
│   │   ├── layout.tsx
│   │   ├── admin/monitoring/
│   │   │   └── page.tsx            # God Mode 통합 관제 대시보드
│   │   ├── api/translate/route.ts  # 한↔태 번역 API (OpenAI)
│   │   ├── api/ai-assist/route.ts  # AI 상담 어시스턴트 API
│   │   └── api/admin/users/route.ts # 계정 생성/삭제 API (service_role)
│   ├── components/
│   │   ├── LoginPage.tsx           # 로그인 페이지
│   │   ├── Dashboard.tsx           # 메인 대시보드 레이아웃
│   │   ├── WorkerStatus.tsx        # 실시간 직원 상태 카드
│   │   ├── TaskAssign.tsx          # 업무 할당 폼 (프리셋 + 마감일)
│   │   ├── TaskList.tsx            # 업무 목록 + 별점 평가
│   │   ├── TaskChat.tsx            # 업무별 채팅
│   │   ├── QuickReplyManager.tsx   # 자동답변 CRUD
│   │   ├── TaskPresetManager.tsx   # 업무 프리셋 CRUD (bbg_admin)
│   │   ├── TimeReport.tsx          # 근무 리포트 (출근율 프로그레스 바)
│   │   └── UserManager.tsx         # 계정 관리 CRUD (bbg_admin)
│   └── lib/supabase.ts
│
├── syncbridge-extension/    # Chrome Extension (Manifest V3)
│   ├── public/manifest.json
│   ├── src/
│   │   ├── App.jsx          # 팝업 메인 UI (업무+마감일, 채팅, 번역, 템플릿, 업무 제안)
│   │   ├── content.js       # Activity Ping + AI 드래그 어시스트 (Shadow DOM)
│   │   ├── background.js    # 서비스 워커 (유휴 감지, 배지, AI 중계)
│   │   └── lib/supabase.js  # Supabase 클라이언트 + proposeTask 헬퍼
│   └── dist/                # 빌드 결과물 (Chrome에 로드)
│
└── supabase/
    ├── schema.sql              # clients, profiles, time_logs, tasks, messages + RLS
    ├── quick_replies.sql       # 자동답변 테이블
    ├── task_presets.sql        # 업무 프리셋 테이블 + RLS
    ├── task_rating.sql         # 업무 품질 평가 (1~5점)
    ├── worker_propose_task.sql # Worker 업무 제안 (source 컬럼 + RLS)
    ├── whisper_message.sql     # Whisper 메시지 + client 역할 필터링 RLS
    ├── setup_test_client.sql
    └── README.md
```

---

## 전체 셋업 절차

### 1. Supabase 설정

1. [Supabase Dashboard](https://supabase.com/dashboard) → 프로젝트 생성
2. **SQL Editor**에서 아래 순서로 실행:
   - `supabase/schema.sql` — 핵심 테이블 (clients, profiles, time_logs, tasks, messages)
   - `supabase/quick_replies.sql` — 자동답변
   - `supabase/task_presets.sql` — 업무 프리셋
   - `supabase/task_rating.sql` — 업무 품질 평가
   - `supabase/worker_propose_task.sql` — Worker 업무 제안 기능
   - `supabase/whisper_message.sql` — Whisper(본사 지시) 메시지 + client 필터링
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
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # 계정 관리 API용 (서버사이드 전용)
GEMINI_API_KEY=AIza...               # 번역 + AI 어시스트 API (Google Gemini)
```

```bash
npm run dev
```

- 메인 대시보드: `http://localhost:3000` (client 계정)
- bbg_admin 로그인 시: 자동으로 `/admin/monitoring`으로 리다이렉트
- God Mode 관제: `http://localhost:3000/admin/monitoring` (bbg_admin 전용)

### 3. Extension 설치

```bash
cd syncbridge-extension
npm install
```

`.env.local` 생성:
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_WEB_URL=http://localhost:3000   # 번역/AI API URL
```

```bash
npm run build
```

Chrome에서 `chrome://extensions` → 개발자 모드 → `syncbridge-extension/dist` 폴더 로드

---

## 주요 기능

### Client Web (한국어)

| 기능 | 설명 |
|------|------|
| 로그인 | Supabase Auth, 그라데이션 배경 디자인 |
| 직원 상태 | 좌측 액센트 보더 카드, 온라인/자리 비움/오프라인 + 평균 품질평가 (Realtime) |
| 업무 할당 | 프리셋 선택 → 자동 채우기, 마감일 설정, 한국어 입력 → 태국어 자동 번역 |
| 업무 목록 | 실시간 조회, 인라인 채팅, 완료 시 별점 품질 평가(1~5점), 기한초과 경고 |
| 채팅 | 한국어 입력 → 태국어로 직원에게 전달 (버블 UI) |
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
| SLA 신호등 | 🟢 정상(< 5분) / 🟡 주의(5~15분) / 🔴 지연(> 15분) — 30초 자동 갱신 |
| 긴급순 정렬 | 🔴 → 🟡 → 🟢 → 완료 순으로 자동 정렬 |
| 일반 메시지 | 초록색 버블, 한→태 자동 번역 |
| Whisper (본사 지시) | 보라색 버블 + 🔒 라벨, 담당 직원에게만 표시 (client에게 RLS로 숨김) |
| Realtime | tasks/messages/time_logs 변경 시 자동 갱신 |

### Worker Extension (태국어/한국어 병기)

| 탭 | 기능 |
|------|------|
| **งาน** (업무) | 담당 태스크 목록, 마감일 표시(색상 코딩: 빨강=초과, 주황=임박, 회색=여유), 완료 처리, **업무 제안(Propose Task)** |
| **แชท** (채팅) | 업무별 채팅, 태국어 입력 → 한국어로 클라이언트 전달 |
| **แปล** (번역) | 태국어 → 한국어 번역 헬퍼 |
| **เทมเพลต** (템플릿) | DB에서 로드한 퀵 리플라이 복사 |

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
- 팝업 재오픈 시 타이머 유지 (DB/time_logs 기반 복원)
- Activity Ping: 10분 무활동 시 자동 "자리 비움"

---

## 디자인 시스템

Figma Make 기반 디자인 업그레이드 적용 완료 (Linear/Notion 스타일).

| 요소 | 스타일 |
|------|--------|
| 카드 | `rounded-xl shadow-sm border-slate-100` |
| 헤더 | sticky, shadow-sm, Link 아이콘 |
| 아이콘 | lucide-react (Star, MessageCircle, Send, Pencil, Trash2 등) |
| 색상 | Primary: emerald-600, Status: emerald/amber/slate, Admin: purple |
| 배지 | rounded-full pill 형태 |
| 테이블 | 호버 효과, 프로그레스 바, 색상 코딩 |

---

## 권한 체계

| role | 권한 |
|------|------|
| `bbg_admin` | 전체 관리: 직원/고객사/업무/자동답변/프리셋/계정 관리, **God Mode 관제**, Whisper 전송 |
| `client` | 자사 직원/업무/자동답변만 조회, 업무 할당(프리셋 사용), Whisper 메시지 볼 수 없음 |
| `worker` | 본인 업무 조회/완료/제안, 채팅, 템플릿 읽기, time_logs 기록 |

---

## 환경 변수 정리

| 파일 | 변수 |
|------|------|
| `client-web/.env.local` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` |
| `syncbridge-extension/.env.local` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WEB_URL` |

---

## 배포 시 참고

- **Extension**: `manifest.json`의 `content_scripts.matches`에 허용 도메인 설정 (스토어 심사용)
- **번역/AI API**: Client Web 배포 URL을 Extension의 `host_permissions`에 추가 필요
- **Supabase**: Realtime용 `tasks`, `messages`, `time_logs`, `task_presets` 테이블 Publication에 포함 확인
- **service_role key**: `SUPABASE_SERVICE_ROLE_KEY`는 서버사이드(API Route)에서만 사용, 클라이언트에 노출 금지

---

## 관련 문서

- `PRD.md` — 제품 요구사항 및 현재 구현 현황
- `figma-prompts.md` — Figma Make 디자인 프롬프트
- `supabase/README.md` — DB 스키마/Auth 설정
- `client-web/README.md` — 대시보드 세부
- `syncbridge-extension/README.md` — 확장프로그램 세부
