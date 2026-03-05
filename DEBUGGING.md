# SyncBridge 디버깅 가이드

이 문서는 SyncBridge 시스템의 주요 이슈 트러블슈팅을 위한 가이드입니다.

---

## 1. 채팅방 시스템 (멀티 채팅방 + 사이드바) 문제

### 증상 유형

- 채팅 사이드바가 표시되지 않음
- WORK/CS/GRAPHIC/KOL 방 중 일부가 로드되지 않음
- 방 선택 시 채팅 패널이 비어 있음
- 구 `general_chat=true` 방식으로 생성된 태스크가 WORK 방에 표시되지 않음

### 원인 분석 흐름

`ChatLayout.tsx`의 초기화 흐름:

```
1. profiles.client_id 조회
2. client_id 유효성 체크 → null이면 사이드바 비활성화
3. GET /api/tasks?list_chat_rooms=true&client_id=xxx 호출
4. 4개 방(WORK/CS/GRAPHIC/KOL) 태스크 일괄 생성/조회
5. ChatSidebar에 방 목록 렌더링
6. 방 또는 업무 선택 → ChatPanel에 해당 채팅 표시
```

### 체크리스트 (가능성 높은 순서)

| 순위 | 원인 | 확인 방법 |
|------|------|-----------|
| 1 | `profiles.client_id`가 null | Supabase Dashboard → `profiles` 테이블에서 해당 워커의 `client_id` 확인 |
| 2 | CORS 차단 | DevTools (`Cmd+Opt+I`) → Network 탭에서 `/api/tasks?list_chat_rooms=true` 요청 확인 |
| 3 | `VITE_WEB_URL` 불일치 | `syncbridge-desktop/.env`의 `VITE_WEB_URL`이 실제 배포된 URL과 일치하는지 |
| 4 | Vercel 환경 변수 미설정 | Vercel Dashboard → Settings → Environment Variables에서 `SUPABASE_SERVICE_ROLE_KEY` 확인 |
| 5 | 세션 토큰 만료 | 재로그인 후 재시도 |

### 콘솔 로그 확인

브라우저/Desktop DevTools 콘솔에서 `[ChatPanel]`, `[ChatSidebar]` 프리픽스를 검색:

```
[ChatSidebar] client_id 없음              → profiles.client_id 미설정 (가장 흔함)
[ChatSidebar] 채팅방 목록 로드 실패: ...  → API 호출 실패 (CORS 또는 네트워크)
[ChatPanel] 메시지 로드 실패: ...         → 특정 방 채팅 조회 실패
[ChatPanel] 전송 실패: ...                → 메시지 INSERT 실패
```

### 해결 방법

**`profiles.client_id`가 null인 경우:**

```sql
-- Supabase SQL Editor에서 실행
UPDATE profiles SET client_id = '해당-병원-uuid' WHERE id = '워커-uuid';
```

**CORS 에러인 경우:**

`client-web/app/api/tasks/route.ts`에 CORS 헤더가 설정되어 있는지 확인.
Vercel에 재배포: `cd client-web && vercel --prod`

**구 `general_chat=true` 태스크가 WORK 방에 안 보이는 경우:**

API는 `general_chat=true` 요청을 `__CHAT_WORK__` 센티넬로 자동 마이그레이션함.
단, 기존 DB에 `content = '__GENERAL_CHAT__'`으로 저장된 레코드는 수동 마이그레이션 필요:

```sql
-- 구 센티넬 값을 새 값으로 마이그레이션
UPDATE tasks SET content = '__CHAT_WORK__' WHERE content = '__GENERAL_CHAT__';
```

**특정 방 태스크가 일반 업무 목록에 노출되는 경우:**

`client-web/lib/chat-rooms.ts`의 `CHAT_SENTINEL_VALUES` 배열에 해당 센티넬 값이 포함되어 있는지 확인.
API의 일반 업무 목록 쿼리에서 모든 센티넬 값을 필터링하는 조건이 있어야 함.

---

## 2. 워커 자동 프로필 생성 시 client_id 누락

### 원인

`App.jsx`의 `ensureProfile`에서 신규 워커 프로필 생성 시 `client_id`를 포함하지 않음:

```javascript
await supabase.from('profiles').insert({
  id: user.id, role: 'worker', email: user.email,
  display_name: user.email.split('@')[0],
  // client_id 없음!
});
```

### 영향

- 전체 톡방 접근 불가
- 업무 할당 시 병원 필터 작동 안 함

### 현재 해결 방법

관리자(bbg_admin)가 UserManager에서 워커 생성 시 병원을 지정하거나, SQL로 직접 할당.

---

## 3. 번역이 안 되는 경우

### 체크리스트

| 확인 항목 | 방법 |
|-----------|------|
| `GEMINI_API_KEY` 설정 | Vercel Dashboard → Environment Variables |
| API 응답 확인 | DevTools Network → `/api/translate` 요청의 응답 코드 |
| 502 에러 | Gemini API 할당량 초과 또는 키 무효 |
| CORS 에러 | Desktop/Extension에서 Vercel API 호출 차단 |

### 번역 흐름

```
메시지 입력 → 즉시 DB 저장 (원본) → /api/translate 호출 →
번역 결과로 messages UPDATE → Realtime 구독으로 UI 반영
```

번역 실패해도 원본 메시지는 항상 표시됨 (즉시 전송 패턴).

### 번역 에러 로그 확인 (v1.3.0+)

v1.3.0부터 모든 채팅 컴포넌트에 번역 에러 로깅이 추가되었습니다.

**Client Web (브라우저 DevTools):**

```
[ChatPanel] translate API error: 502       → Gemini API 에러 (할당량 초과 등)
[ChatPanel] update error: ...              → Supabase messages UPDATE 실패
[ChatPanel] translate fetch error: ...     → 네트워크 에러 (CORS 등)
[TaskChat] translate API error: 502        → 업무별 채팅 번역 실패
[TaskChat] update error: ...               → 업무별 채팅 UPDATE 실패
```

**Desktop App (DevTools):**

동일한 패턴이지만, Desktop에서는 `VITE_WEB_URL`로 번역 API를 호출하므로:
- `VITE_WEB_URL`이 잘못되면 fetch 자체가 실패
- Vercel 배포가 안 됐으면 404/500 에러

**자주 발생하는 원인:**
1. `VITE_WEB_URL`이 실제 배포 URL과 불일치 (GitHub Secrets 확인)
2. `GEMINI_API_KEY` 미설정 또는 만료
3. Supabase RLS가 messages UPDATE를 차단 (발신자만 UPDATE 가능)

---

## 3.5 파일 업로드 실패

### 체크리스트

| 확인 항목 | 방법 |
|-----------|------|
| Storage 버킷 존재 | Supabase Dashboard → Storage → `chat-files` 버킷 확인 |
| 버킷 공개 설정 | `chat-files` 버킷이 `public: true`인지 확인 |
| RLS 정책 | `chat_files_upload` (INSERT), `chat_files_read` (SELECT) 정책 존재 확인 |
| 파일 크기 | 10MB 이하인지 확인 (클라이언트에서 체크) |
| MIME 타입 | 이미지, PDF, 문서, ZIP만 허용 |

### 해결 방법

**버킷이 없는 경우:**
```sql
-- supabase/chat_file_attachment.sql 실행
INSERT INTO storage.buckets (id, name, public) VALUES ('chat-files', 'chat-files', true) ON CONFLICT (id) DO NOTHING;
```

**RLS 정책이 없는 경우:**
```sql
CREATE POLICY "chat_files_upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'chat-files');
CREATE POLICY "chat_files_read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'chat-files');
CREATE POLICY "chat_files_public_read" ON storage.objects FOR SELECT TO anon USING (bucket_id = 'chat-files');
```

---

## 4. Desktop App DevTools 열기

- **macOS:** `Cmd + Option + I`
- **Windows:** `Ctrl + Shift + I`
- 또는 `electron/main.js`에서 `mainWindow.webContents.openDevTools()` 추가

---

## 5. 환경 변수 체크리스트

### Client Web (Vercel)

| 변수 | 필수 | 용도 |
|------|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Y | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Y | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Y | 서버사이드 API (tasks, users) |
| `GEMINI_API_KEY` | Y | 번역 + AI 어시스트 |

### Desktop App

| 변수 | 필수 | 용도 |
|------|------|------|
| `VITE_SUPABASE_URL` | Y | Supabase 프로젝트 URL |
| `VITE_SUPABASE_ANON_KEY` | Y | Supabase anon key |
| `VITE_WEB_URL` | Y | Client Web 배포 URL (번역 API + 전체 톡방) |

### Extension

| 변수 | 필수 | 용도 |
|------|------|------|
| `VITE_SUPABASE_URL` | Y | Supabase 프로젝트 URL |
| `VITE_SUPABASE_ANON_KEY` | Y | Supabase anon key |
| `VITE_WEB_URL` | Y | Client Web URL (번역 API) |

---

## 6. CORS 관련 문제

Desktop App(Electron)과 Extension은 Vercel의 API를 cross-origin으로 호출합니다.

### 적용된 API Route

- `/api/tasks` — 업무 CRUD + 전체 톡방
- `/api/translate` — 번역

### CORS 헤더 구성

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

각 API Route에 `OPTIONS` preflight 핸들러와 `withCors()` 래퍼가 적용되어 있음.

### CORS 에러 발생 시

1. Vercel에 최신 코드 배포 확인
2. API Route 파일에 `OPTIONS` export와 `withCors()` 적용 확인
3. DevTools Network 탭에서 preflight (`OPTIONS`) 요청 상태 확인

---

## 7. Supabase RLS 관련 문제

### profiles 테이블 순환 참조

`profiles` 테이블의 RLS 정책이 자기 자신을 참조하면 무한 루프 발생.
`fix_rls_policies.sql`로 해결됨.

### messages UPDATE 권한

발신자만 메시지를 UPDATE할 수 있어야 함 (번역 결과 저장).
`fix_rls_policies.sql`에 포함.

---

## 8. 워커 웹 대시보드 디버깅

### 상태 토글 (WorkerStatusToggle) 문제

**증상:** 출근/자리비움/퇴근 버튼 클릭 후 상태가 변경되지 않음.

**체크리스트:**

| 순위 | 원인 | 확인 방법 |
|------|------|-----------|
| 1 | `profiles.status` PATCH 권한 부족 | Supabase Dashboard → RLS 정책에서 worker의 own profiles UPDATE 허용 여부 확인 |
| 2 | `profiles.id` 불일치 | Supabase Auth 로그인 user.id와 profiles.id 일치 여부 확인 |
| 3 | `NEXT_PUBLIC_SUPABASE_URL` 미설정 | `.env.local` 확인 |

**콘솔 로그:**

```
[WorkerStatusToggle] status update error: ...   → Supabase PATCH 실패
[WorkerStatusToggle] status updated: 출근       → 정상
```

### 업무 제안 (TaskPropose) 번역 문제

**증상:** 태국어 입력 후 한국어 번역이 비어 있거나 저장이 안 됨.

**체크리스트:**

| 확인 항목 | 방법 |
|-----------|------|
| `GEMINI_API_KEY` 설정 | Vercel Dashboard → Environment Variables |
| `/api/tasks` POST 권한 | 워커 role의 tasks INSERT RLS 정책 확인 |
| `source: 'worker'` 컬럼 | `tasks` 테이블에 source 컬럼 존재 여부 확인 |

**콘솔 로그:**

```
[TaskPropose] translate error: ...              → 번역 API 실패
[TaskPropose] insert error: ...                 → tasks 저장 실패
[TaskPropose] propose submitted: {id}           → 정상 완료
```

### 역할 기반 라우팅 문제

**증상:** 워커 로그인 후 클라이언트 대시보드가 표시되거나 빈 화면이 표시됨.

**체크리스트:**

| 확인 항목 | 방법 |
|-----------|------|
| `profiles.role` 값 | Supabase → profiles 테이블에서 해당 계정의 role 컬럼이 `'worker'`인지 확인 |
| Dashboard.tsx 분기 조건 | `if (profile.role === 'worker') return <WorkerDashboard ...>` 코드 확인 |
| 프로필 로딩 타이밍 | 네트워크 느린 환경에서 profile이 null인 상태로 분기될 수 있음 — 로딩 스피너 확인 |

---

## 9. 공통 디버깅 패턴

### 콘솔 로그 프리픽스

| 프리픽스 | 위치 |
|----------|------|
| `[ChatPanel]` | ChatPanel.tsx — 방/업무 채팅 메시지 로드 + 전송 + 번역 에러 |
| `[ChatSidebar]` | ChatSidebar.tsx — 채팅방 목록 로드 에러 |
| `[TaskChat]` | TaskChat.tsx — 업무별 채팅 번역 에러 |
| `[Propose]` | Desktop App — 업무 제안 번역 |
| `[WorkerStatusToggle]` | WorkerStatusToggle.tsx — 출퇴근 상태 변경 에러 |
| `[TaskPropose]` | TaskPropose.tsx — 워커 업무 제안 번역 + 저장 에러 |

### Supabase Dashboard 활용

1. **Table Editor** → `profiles`, `tasks`, `messages` 테이블 직접 확인
2. **Logs** → API 호출 로그 확인
3. **Auth** → 사용자 세션 상태 확인
4. **Realtime Inspector** → 구독 채널 상태 확인

### 워커 대시보드 관련 DB 확인 쿼리

```sql
-- 워커 role 확인
SELECT id, email, role, client_id, status FROM profiles WHERE role = 'worker';

-- 워커 업무 제안 확인 (source = 'worker')
SELECT id, content, content_th, source, created_by, created_at FROM tasks WHERE source = 'worker' ORDER BY created_at DESC;

-- 특정 워커의 상태 이력
SELECT worker_id, status, created_at FROM time_logs WHERE worker_id = '워커-uuid' ORDER BY created_at DESC LIMIT 10;
```
