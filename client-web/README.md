# SyncBridge Client Web (관리자 대시보드)

한국 고객사(병원) 및 BBG 관리자용 Next.js 대시보드입니다.

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

## API 엔드포인트

| 경로 | 메서드 | 역할 |
|------|--------|------|
| `/api/tasks` | GET | 업무 목록 조회, 전체 톡방 조회/생성 (`?general_chat=true`) |
| `/api/tasks` | POST | 업무 생성 (client, bbg_admin) |
| `/api/tasks` | PATCH | 업무 수정 (상태 변경, 평가 등) |
| `/api/tasks` | DELETE | 업무 삭제 + 연결 메시지 삭제 |
| `/api/translate` | POST | 한↔태 양방향 번역 (Gemini API) |
| `/api/ai-assist` | POST | AI 상담 어시스턴트 (환자 메시지 분석 + 추천 답변) |
| `/api/admin/users` | POST/DELETE | 계정 생성/삭제 (bbg_admin, service_role) |

## 컴포넌트

| 컴포넌트 | 기능 | 섹션 색상 |
|----------|------|-----------|
| `LoginPage.tsx` | 이메일/비밀번호 로그인 | - |
| `Dashboard.tsx` | 메인 대시보드 레이아웃 | - |
| `WorkerStatus.tsx` | 실시간 직원 상태 카드 | 파란색 (blue) |
| `GeneralChat.tsx` | 전체 톡방 (그룹 채팅) | 인디고 (indigo) |
| `TaskAssign.tsx` | 업무 할당 폼 (프리셋 + 마감일) | 초록색 (emerald) |
| `TaskList.tsx` | 업무 목록 + 별점 평가 + 인라인 채팅 | 노란색 (amber) |
| `TaskChat.tsx` | 업무별 1:1 채팅 | - |
| `TaskCalendar.tsx` | 월별 업무 캘린더 | 보라색 (violet) |
| `TaskPresetManager.tsx` | 업무 프리셋 CRUD (bbg_admin) | 분홍색 (rose) |
| `TimeReport.tsx` | 일간 근무 리포트 | 청록색 (cyan) |
| `UserManager.tsx` | 계정 관리 CRUD (bbg_admin) | 회색 (slate) |
| `QuickReplyManager.tsx` | 자동답변 CRUD | - |

### 대시보드 섹션 배치 순서

1. WorkerStatus (직원 상태)
2. GeneralChat (전체 톡방)
3. TaskAssign (업무 할당)
4. TaskList (업무 목록)
5. TaskPresetManager (업무 프리셋, bbg_admin만)
6. TaskCalendar (업무 캘린더)
7. TimeReport (근무 리포트)
8. UserManager (계정 관리, bbg_admin만)

## 기능 상세

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
| 권한 체크 | bbg_admin이 아니면 `/`로 리다이렉트 |
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
| `bbg_admin` | 전체 직원 조회, God Mode 관제, 프리셋/계정 관리, Whisper 전송 |
| `client` | 자사 할당 직원만 조회, 업무 할당, 전체 톡방 참여 |
| `worker` | 본인 업무/채팅, 전체 톡방 참여 |

## 환경 변수

`.env.local`에 다음 설정:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # 업무 API + 계정 관리 (서버사이드 전용)
GEMINI_API_KEY=AIza...               # 번역 + AI 어시스트 (Google Gemini)
```
