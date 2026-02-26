# SyncBridge Desktop App

태국 원격 근무자(마케터/CS)용 Electron 데스크톱 앱입니다. macOS와 Windows를 지원합니다.

## 기술 스택

- Electron 28
- React 18 (Vite)
- Tailwind CSS
- Supabase (Auth, DB, Realtime)
- electron-builder (빌드/패키징)
- electron-updater (자동 업데이트)

## 설치 및 실행

```bash
npm install
```

`.env.local` 생성:
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_WEB_URL=https://your-deployed-url.vercel.app   # 번역 API URL
```

```bash
npm run dev       # 개발 (Vite + Electron 동시 실행)
npm run build:mac # macOS 빌드
npm run build:win # Windows 빌드
```

## 빌드 및 릴리즈

GitHub에 `v*` 태그를 push하면 GitHub Actions에서 자동으로 빌드 + 릴리즈합니다.

```bash
git tag v1.2.1
git push origin v1.2.1
```

macOS(.dmg)와 Windows(.exe) 빌드가 동시에 생성됩니다.

## 기능

| 탭 | 기능 |
|------|------|
| **업무** | 담당 태스크 목록, 마감일 표시(색상 코딩: 빨강=초과, 회색=여유), 완료 처리 |
| **채팅** | 전체 톡방 + 업무별 채팅, 태국어 입력 → 한국어 백그라운드 번역 |
| **번역** | 태국어 → 한국어 즉석 번역 헬퍼 |

### 출퇴근
- 헤더에서 출근/자리비움/퇴근 상태 토글
- `time_logs` 테이블에 즉시 기록
- 타이머로 현재 상태 지속 시간 표시

### 전체 톡방 (General Chat)
- 채팅 탭 상단의 "전체 톡방" 버튼으로 진입
- 클라이언트↔직원 간 그룹 채팅
- 발신자 이름 표시 (profiles 조회)
- 인디고 테마 UI

### 채팅 번역 패턴
1. 메시지를 원본 텍스트로 즉시 DB에 저장
2. 백그라운드에서 Gemini API로 번역
3. 번역 완료 시 해당 메시지 UPDATE
4. Realtime(`event: '*'`)으로 UPDATE 이벤트도 수신하여 UI 즉시 반영

## 파일 구조

| 파일 | 역할 |
|------|------|
| `electron/main.js` | Electron 메인 프로세스 (창 관리, 자동 업데이트) |
| `electron/preload.js` | 프리로드 스크립트 |
| `src/App.jsx` | 메인 UI (로그인, 상태, 업무, 채팅, 전체 톡방, 번역) |
| `src/main.jsx` | React 엔트리 포인트 |
| `src/lib/supabase.js` | Supabase 클라이언트 |

## 릴리즈 이력

| 버전 | 내용 |
|------|------|
| v1.0.0 | 초기 릴리즈 (업무, 채팅, 번역) |
| v1.1.0 | 마감일 날짜만 표시 (시간 제거) |
| v1.2.0 | 전체 톡방 추가 |
| v1.2.1 | 번역 수정 (즉시 전송 + 백그라운드 번역, Realtime UPDATE 수신) |
