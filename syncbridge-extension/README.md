# SyncBridge Chrome Extension

원격 근무자(태국 직원)용 CS 업무/근태 지원 크롬 확장 프로그램입니다.

> **참고:** 데스크톱 앱(`syncbridge-desktop/`)이 별도로 존재합니다. 이 확장프로그램은 Chrome 브라우저 내에서 동작하는 버전입니다.

## 기술 스택

- React 18 (Vite)
- Tailwind CSS
- Chrome Extension Manifest V3
- Supabase (Auth, DB, Realtime)

## 로컬 빌드 및 로드

```bash
npm install
npm run build
```

1. Chrome에서 `chrome://extensions` 열기
2. **개발자 모드** 켜기
3. **압축 해제된 확장 프로그램을 로드합니다** 클릭
4. `syncbridge-extension/dist` 폴더 선택

개발 중에는 `npm run dev`로 watch 빌드 후, 확장 프로그램 페이지에서 **새로고침** 하면 변경 사항이 반영됩니다.

## 환경 변수

`.env.local`에 다음 설정:

```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_WEB_URL=http://localhost:3000   # Client Web URL (번역/AI API)
```

## 팝업 UI (400x600px)

| 영역 | 기능 |
|------|------|
| 로그인 | 이메일/비밀번호 로그인/회원가입. 로그인 후 Worker 프로필 자동 생성 |
| 헤더 | 출근/자리비움/퇴근 상태 토글 → `time_logs`에 즉시 기록 |
| 타이머 | 현재 상태 지속 시간 (1초 단위). 팝업 재오픈 시 DB 기반 복원 |
| 품질 평균 | 클라이언트가 평가한 완료 업무의 평균 점수 표시 |

### 탭 구성

| 탭 | 기능 |
|------|------|
| **업무** | 담당 태스크 목록, 마감일 표시(색상 코딩), 완료 처리, **업무 제안(Propose Task)** |
| **채팅** | 업무별 채팅. 태국어 입력 → 한국어 자동 번역 후 클라이언트에 전달 |
| **번역** | 태국어 → 한국어 번역 헬퍼 |
| **템플릿** | DB에서 로드한 퀵 리플라이 복사 |

### 업무 제안 (Propose Task)

태국 직원이 주도적으로 업무를 기획/등록할 수 있는 기능입니다.

- 업무 탭 상단의 **"+ เสนองาน (제안)"** 버튼 클릭 → 인라인 폼 표시
- 태국어로 업무 내용 입력 → 자동 한국어 번역 → Supabase `tasks` 테이블에 `source: 'worker_proposed'`로 INSERT
- 미완료 클라이언트 지시가 남아있으면 경고 메시지 표시 (등록 자체는 차단하지 않음)
- 리스트에서 "เสนอเอง (자체 제안)" 뱃지로 구분
- DB 요구사항: `supabase/worker_propose_task.sql` 실행 필요

## AI 드래그 어시스트 (Content Script)

웹페이지에서 텍스트를 드래그하면 AI 기반 상담 어시스턴트가 동작합니다.

1. 5자 이상 텍스트 드래그 → "AI" 플로팅 버튼 표시
2. 버튼 클릭 → Client Web의 `/api/ai-assist` API 호출
3. 결과 팝업: 한국어 번역 + 의도 분석 + 태국어 추천 답변 3개
4. 추천 답변 클릭 → 클립보드 복사 + 토스트 알림

기술 상세:
- Shadow DOM으로 호스트 페이지 CSS 충돌 방지
- 중복 클릭 방지 (`aiLoading` 플래그)
- API 실패 시 mock 응답 fallback
- XSS 방지 (`escHtml` 처리)

## Activity Ping (자리 비움 자동 전환)

- **content script**: 모든 탭에서 키보드/마우스/스크롤 이벤트 감지 (2초 throttle) → background에 전달
- **background (Service Worker)**: 활동이 오면 10분 타이머 리셋. 10분간 활동 없으면 Supabase `time_logs`에 `status: 'away'` 자동 insert
- 출근(online) 상태일 때만 자동 전환. 이미 자리비움/퇴근이면 동작 안 함

## 파일 구조

| 파일 | 역할 |
|------|------|
| `src/App.jsx` | 팝업 메인 UI (로그인, 상태, 업무, 채팅, 번역, 템플릿, 업무 제안) |
| `src/content.js` | Activity Ping + AI 드래그 어시스트 |
| `src/background.js` | 서비스 워커 (유휴 감지, 배지, AI 중계) |
| `src/lib/supabase.js` | Supabase 클라이언트 + `proposeTask` 헬퍼 |
