# CLAUDE.md — SyncBridge 프로젝트 규칙

## 프로젝트 개요

한국 고객사(병원)와 태국 원격 근무자 간의 실시간 업무 동기화 플랫폼.
모노레포 구조: `client-web` (Next.js), `syncbridge-desktop` (Electron), `syncbridge-extension` (Chrome), `supabase` (SQL).

---

## 과거 실수에서 배운 규칙

### 1. 파일 수정 전 반드시 전체 파일을 Read하라

- **실수:** `route.ts`를 부분만 읽고 Write로 전체 덮어씀. 의도치 않은 변경이 발생할 위험이 있었음.
- **규칙:** 파일을 수정할 때는 반드시 전체 파일을 Read한 뒤, Edit(부분 수정)을 사용한다. Write(전체 덮어쓰기)는 신규 파일이거나 전체 구조가 바뀌는 경우에만 사용한다.

### 2. 동일 패턴은 프로젝트 전체에서 검색하라

- **실수:** `catch {}` 빈 에러 삼킴을 Desktop `App.jsx`에서만 고쳤고, Extension의 `content.js`, `background.js`에도 같은 패턴이 있는 걸 놓쳤다.
- **규칙:** 버그 패턴이나 코드 스타일 수정 시, 반드시 `Grep`으로 프로젝트 전체(`/`)를 검색하여 동일 패턴이 있는 모든 파일을 수정한다.

### 3. cross-cutting 변경은 누락 없이 모든 대상에 적용하라

- **실수:** CORS 헤더를 `/api/tasks`와 `/api/translate`에만 추가하고, `/api/ai-assist`와 `/api/admin/users`에는 빠뜨렸다. Desktop/Extension에서 이 API를 호출하면 동일한 CORS 에러 발생 가능.
- **규칙:** API 전체에 영향을 주는 변경(CORS, 인증, 로깅 등)을 적용할 때는 먼저 `Glob`으로 모든 route 파일 목록을 확보하고, 빠짐없이 전부 적용한다.

### 4. 기존 unstaged 변경을 확인하고 사용자에게 알려라

- **실수:** 작업 시작 시 `figma-prompts.md`에 321줄 삭제된 unstaged 변경이 있었으나, 이를 사용자에게 알리지 않았다. 나중에 git diff에서 내 변경과 섞여 혼란을 줄 수 있음.
- **규칙:** 작업 시작 전 `git status`에 이미 수정된 파일이 있으면, 내 작업 범위와 겹치지 않더라도 사용자에게 기존 변경 사항을 알린다.

### 5. 코드 수정 후 빌드/타입체크를 실행하라

- **실수:** TypeScript 파일(`route.ts`)을 수정했으나 `npm run build`나 타입체크를 돌리지 않았다. 컴파일 에러가 있어도 모르고 넘어갈 수 있음.
- **규칙:** TypeScript 또는 빌드 대상 파일 수정 후, 해당 프로젝트의 빌드/타입체크를 실행하여 에러가 없는지 확인한다.
  - `client-web`: `cd client-web && npx tsc --noEmit`
  - `syncbridge-desktop`: `cd syncbridge-desktop && npx vite build`

### 6. 에러 핸들링 수정 시 UI 피드백도 함께 고려하라

- **실수 아닌 교훈:** `catch {}`를 로그로 바꾸는 것만으로는 사용자에게 도움이 안 됨. `generalChatError` 상태를 추가하여 UI에 안내 메시지를 표시한 것이 올바른 접근.
- **규칙:** 에러 로깅을 추가할 때, 사용자에게 보여야 하는 에러라면 UI 피드백(알림, 메시지)도 함께 구현한다.

---

## 프로젝트 컨벤션

### API Route CORS

모든 `/api/*` route에는 CORS 헤더 + OPTIONS preflight가 필요함 (Desktop/Extension cross-origin 호출).
새 API route 추가 시 `withCors()` 패턴을 반드시 적용할 것.

### 콘솔 로그 프리픽스

디버깅 로그에는 `[기능명]` 프리픽스를 사용:
- `[ChatPanel]` — 채팅 패널 (방 채팅 + 업무 채팅 공통)
- `[ChatSidebar]` — 사이드바 채팅방 목록
- `[TaskChat]` — 업무별 채팅
- `[Propose]` — 업무 제안

### 환경 변수

- Desktop/Extension의 `VITE_WEB_URL`은 실제 배포된 client-web URL과 일치해야 함
- Vercel에 `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` 필수 설정

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
client-web/lib/chat-rooms.ts     # 채팅방 상수, 센티넬 값, 타입 정의
client-web/components/
  ChatLayout.tsx                 # 사이드바 + 패널 오케스트레이터 (반응형)
  ChatSidebar.tsx                # 좌측 사이드바 (방 4개 + 업무 목록)
  ChatPanel.tsx                  # 방/업무 겸용 채팅 패널 (GeneralChat 대체)
  TaskChat.tsx                   # 업무별 채팅 (기존 유지)
  Dashboard.tsx                  # 클라이언트 대시보드 (ChatLayout 사용)
  WorkerDashboard.tsx            # 워커 대시보드 (ChatLayout 사용)
syncbridge-desktop/src/          # Electron 앱 (Vite + React)
syncbridge-extension/src/        # Chrome Extension
supabase/                        # SQL 마이그레이션
```

관련 문서: `README.md`, `PRD.md`, `DEBUGGING.md`
