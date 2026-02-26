# SyncBridge — Supabase 설정

## 1. 스키마 적용

1. [Supabase Dashboard](https://supabase.com/dashboard) → 프로젝트 선택
2. **SQL Editor** → **New query**
3. 아래 순서로 실행:

| 순서 | 파일 | 내용 |
|------|------|------|
| 1 | `schema.sql` | 핵심 테이블 (clients, profiles, time_logs, tasks) + RLS |
| 2 | 아래 messages SQL | 채팅 테이블 |
| 3 | 아래 content_th SQL | tasks 태국어 번역 컬럼 |
| 4 | 아래 due_date SQL | tasks 마감일 컬럼 |
| 5 | `quick_replies.sql` | 자동답변(퀵 리플라이) 테이블 |
| 6 | `task_presets.sql` | 업무 프리셋 테이블 + RLS |
| 7 | `task_rating.sql` | 업무 품질 평가 (1~5점) 컬럼 |
| 8 | `worker_propose_task.sql` | Worker 업무 제안 (`source` 컬럼 + Worker INSERT RLS) |
| 9 | `whisper_message.sql` | Whisper 본사 지시 (`is_whisper` 컬럼 + client 필터링 RLS) |
| 10 | `fix_rls_policies.sql` | messages UPDATE 정책 + profiles 동료 조회 정책 |

이미 테이블이 있으면 `IF NOT EXISTS` 덕분에 에러 없이 넘어갑니다.
정책만 다시 넣고 싶다면 기존 `CREATE POLICY`는 제거한 뒤 필요한 것만 실행하세요.

**messages 테이블 (채팅용):**
```sql
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id),
  content text NOT NULL,
  content_ko text,
  content_th text,
  sender_lang text NOT NULL DEFAULT 'th',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "messages_select_authenticated" ON public.messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "messages_insert_authenticated" ON public.messages FOR INSERT TO authenticated WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_messages_task_id ON public.messages(task_id);
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
```

**content_th 컬럼 (번역용):**
```sql
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS content_th text;
```

**due_date 컬럼 (마감일):**
```sql
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS due_date date;
```

## 2. Realtime

`schema.sql` 마지막에 `tasks` 테이블을 Realtime Publication에 추가하는 구문이 포함되어 있습니다.
`messages` 테이블도 채팅 실시간 동기화를 위해 Publication에 포함해야 합니다.

이미 추가된 테이블을 다시 추가하면 에러가 발생할 수 있으니, 해당 줄만 건너뛰면 됩니다.

## 3. 회원가입/로그인 (Authentication)

1. **Supabase Dashboard** → **Authentication** → **Providers**
2. **Email** 항목 → **Enable Email provider** 켬(ON)
3. (선택) 테스트 시 **Confirm email** 끄면 이메일 인증 없이 바로 로그인 가능

Anonymous(익명) 로그인은 SyncBridge에서 사용하지 않으므로 꺼 둬도 됩니다.

## 4. 테이블 요약

| 테이블 | 용도 | 주요 컬럼 |
|--------|------|-----------|
| `clients` | 고객사(병원) 정보 | name |
| `profiles` | 사용자 프로필 | role (bbg_admin / client / worker), client_id, display_name |
| `time_logs` | 출퇴근/근태 기록 | worker_id, status (online / away / offline) |
| `tasks` | 업무 지시 + Worker 제안 | content, content_th, due_date, source, rating, status |
| `messages` | 업무별 채팅 메시지 | content_ko, content_th, is_whisper, sender_lang |
| `quick_replies` | 자동답변 템플릿 | title_th, title_ko, body_th, body_ko |
| `task_presets` | 업무 프리셋 | title_ko, title_th, content_ko, content_th |

## 5. RLS 정책 요약

| 테이블 | 정책 | 설명 |
|--------|------|------|
| `profiles` | select_own | 본인 프로필 조회 |
| `profiles` | select_bbg | bbg_admin 전체 조회 |
| `profiles` | select_same_client | 같은 client_id 소속 조회 (그룹 채팅 발신자 이름) |
| `profiles` | insert_own, update_own | 본인만 생성/수정 |
| `tasks` | client_insert | client/bbg_admin 업무 생성 |
| `tasks` | select_assignee | 담당자 본인 조회 |
| `tasks` | select_client | 같은 client_id 또는 bbg_admin 조회 |
| `tasks` | update_assignee | 담당자 본인 수정 (완료 처리) |
| `tasks` | update_client | client/bbg_admin 수정 (평가 등) |
| `tasks` | worker_propose | Worker 본인을 assignee로 업무 제안 |
| `messages` | insert_authenticated | 인증된 사용자 메시지 전송 |
| `messages` | select_non_whisper | client에게 whisper 메시지 숨김 |
| `messages` | update_sender | 발신자만 메시지 UPDATE (번역 결과 저장) |
| `time_logs` | worker_own | Worker 본인 기록 |
| `time_logs` | client_select | client/bbg_admin 조회 |

## 6. 환경 변수

- URL/anon key는 프로젝트 루트 `.env.local`에 설정
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Client Web)
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (Desktop App / Extension)
- `SUPABASE_SERVICE_ROLE_KEY` (Client Web 서버사이드 API 전용)
