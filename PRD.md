# PRD: SyncBridge (BBG 원격 BPO 업무 동기화 플랫폼)

---

## 1. 프로젝트 개요

- **목적:** 한국 고객사(병원)와 태국 원격 근무자(마케터/CS) 간의 실시간 업무 지시 및 상태 동기화.
- **비즈니스 모델:** 태국 인력 원격 고용 대행 (월 150만 원 청구 / 현지 인건비 75만 원 지급 구조).
- **핵심 가치:** 고객사에게는 **'투명한 근태 및 업무 관리(안심)'**를, 태국 직원에게는 **'최소한의 컨텍스트 스위칭(효율)'**을 제공.

---

## 2. 시스템 아키텍처 및 기술 스택

| 구분 | 기술 | 역할 |
|------|------|------|
| **Client Web** | Next.js 14 (App Router), Tailwind CSS, lucide-react | 고객사·BBG 관리자·워커용. 업무 지시, 실시간 근태 대시보드, 관제 모니터링. 워커는 웹 브라우저만으로 업무 수행 가능 (Phase 1 완료). |
| **Desktop App** | Electron + React 18 (Vite), Tailwind CSS | 태국 직원용 데스크톱 앱. 업무 수신, 채팅, 전체 톡방, 번역. macOS/Windows. |
| **Worker Extension** | Chrome Extension V3 (React + Vite, Tailwind CSS) | 태국 직원용. 브라우저 팝업. 실시간 업무 수신, 채팅, 번역, AI 어시스트. |
| **Backend & DB** | Supabase (PostgreSQL, Auth, Realtime, RLS) | 데이터 저장, 인증/권한, 실시간 동기화, 행 수준 보안. |
| **번역/AI** | Google Gemini API (gemini-2.5-flash) | 한↔태 번역, AI 상담 어시스턴트 (의도 파악 + 추천 답변). |
| **CI/CD** | GitHub Actions + electron-builder | Desktop App 자동 빌드/릴리즈 (macOS + Windows). |
| **Web 배포** | Vercel | Client Web 배포 (`vercel --prod`). |

---

## 3. 구현 완료 기능

### 3.1 Client Web — 클라이언트/어드민 대시보드

| 기능 | 상태 | 설명 |
|------|------|------|
| 인증 | ✅ | Supabase Auth (이메일/비밀번호), 역할 기반 접근 제어 |
| 역할 기반 라우팅 | ✅ | worker 로그인 → WorkerDashboard, client/bbg_admin → Dashboard 자동 분기 |
| 직원 상태 모니터링 | ✅ | 실시간 온라인/자리비움/오프라인, 좌측 액센트 보더, 평균 평점 |
| 전체 톡방 | ✅ | 클라이언트↔직원 그룹 채팅, 접기/펼치기, 발신자 이름, 실시간 수신 |
| 업무 할당 | ✅ | 업무 제목(content) + 상세 가이드(description) 분리 입력, 각각 한→태 자동 번역, 프리셋 자동 채우기, 마감일 설정(datetime-local), 할당자 표시 |
| 업무 프리셋 | ✅ | bbg_admin이 자주 쓰는 업무 지시를 프리셋으로 등록, 병원별/전체 공용 |
| 업무 목록 | ✅ | 업무 제목(굵게) + 상세 가이드 접기/펼치기 표시, 태국어 제목(content_th)·가이드(description_th) 동시 표시, 내 업무/팀 전체 분리, 실시간 조회, 상태 배지, 인라인 채팅, 기한초과 경고 |
| 업무 완료/취소/되돌리기 | ✅ | client만 완료(초록 완료 버튼)/취소(X 취소)/되돌리기 처리 가능 |
| 마감일 인라인 수정 | ✅ | 기존 마감일 클릭 → 인라인 datetime-local 편집 |
| 업무 캘린더 | ✅ | 월별 업무 현황 달력, 날짜별 업무 수 표시 |
| 업무 품질 평가 | ✅ | 완료 업무에 1~5점 별점 평가 (Star 아이콘, 호버 인터랙션) |
| 채팅 | ✅ | 업무별 1:1 채팅, 즉시 전송 + 백그라운드 번역, 실시간 업데이트 |
| 파일 첨부 | ✅ | 채팅 내 이미지/문서 업로드, 미리보기, 다운로드 (Supabase Storage, 10MB 제한) |
| @멘션 | ✅ | 채팅에서 @이름으로 팀원 태그, 하이라이트 표시, mentions jsonb 컬럼 저장 |
| 자동답변 관리 | ✅ | 퀵 리플라이 CRUD, 한→태 자동 번역, 병원별/전체 공용 |
| 근무 리포트 | ✅ | 일간 근태 요약 테이블, 출근율 프로그레스 바, 색상 코딩 |
| 계정 관리 | ✅ | bbg_admin 전용, 병원/직원 계정 생성·삭제 (service_role API) |
| AI 어시스트 API | ✅ | 환자 메시지 → 한국어 번역 + 의도 파악 + 추천 답변 3개 |
| 섹션 색상 구분 | ✅ | 각 섹션별 그라데이션 배경 + 좌측 컬러 보더로 시각적 구분 |

### 3.1b Client Web — 워커 웹 대시보드 (Phase 1 완료)

| 기능 | 상태 | 설명 |
|------|------|------|
| 워커 대시보드 | ✅ | `WorkerDashboard.tsx` — 탭 네비게이션 (업무/채팅/도구), Desktop App 없이 웹으로 업무 수행 |
| 출퇴근 상태 토글 | ✅ | `WorkerStatusToggle.tsx` — 출근/자리비움/퇴근 버튼 + 경과 시간 표시, `profiles.status` PATCH |
| 업무 제안 | ✅ | `TaskPropose.tsx` — 워커가 태국어로 업무 입력 → 한국어 자동 번역, `source: 'worker'`로 저장 |
| 번역 도우미 | ✅ | `TranslationHelper.tsx` — 태국어↔한국어 즉석 번역 패널, `/api/translate` 활용 |
| 내 업무 / 팀 전체 분리 | ✅ | TaskList에서 본인 할당 업무와 팀 전체 업무를 탭으로 구분 |

### 3.2 Client Web — God Mode 관제 (`/admin/monitoring`)

| 기능 | 상태 | 설명 |
|------|------|------|
| 권한 체크 | ✅ | bbg_admin 외 접근 시 메인 페이지로 리다이렉트 |
| 통계 바 | ✅ | 총 업무, 진행중, 완료, 완료율 실시간 표시 |
| 필터 바 | ✅ | 병원/담당자/상태/기간별 필터링 |
| 워커 그리드 | ✅ | 각 워커별 상태 배지 + 완료/대기 업무 카운트 |
| 이중 SLA | ✅ | 메시지 SLA(5분/15분) + 업무 나이 SLA(1시간/3시간) 신호등 |
| 마감일 표시 | ✅ | 업무별 마감일 + 기한초과 경고 |
| 2-패널 레이아웃 | ✅ | 좌측: 업무 리스트(긴급순 정렬) / 우측: 상세 + 실시간 채팅 |
| Whisper 메시지 | ✅ | 보라색 버블 + 잠금 라벨, RLS로 client에게 숨김 |
| Realtime | ✅ | tasks/messages/time_logs 변경 시 자동 갱신 (30초 주기) |

### 3.3 Desktop App (태국 직원용)

| 기능 | 상태 | 설명 |
|------|------|------|
| 출퇴근 토글 | ✅ | 출근/자리비움/퇴근 상태 변경 → time_logs 기록 |
| 업무 수신 | ✅ | 담당 태스크 실시간 조회, 마감일 색상 코딩(빨강=초과, 회색=여유) |
| 업무 완료 처리 | ✅ | 완료 클릭 → Client Web 실시간 반영 |
| 업무 제안 | ✅ | Worker 직접 업무 등록 (태→한 번역), "자체 제안" 뱃지 |
| 전체 톡방 | ✅ | 클라이언트↔직원 그룹 채팅, 발신자 이름, 멤버 온라인 상태 표시 |
| 업무별 채팅 | ✅ | 태국어 입력 → 한국어 백그라운드 번역, 실시간 수신 |
| 파일 첨부 | ✅ | 채팅 내 이미지/문서 업로드, 미리보기, 다운로드 |
| @멘션 | ✅ | 팀원 태그 (@이름), 멘션 시 하이라이트 + 푸시 알림 |
| 푸시 알림 | ✅ | 새 메시지/멘션 수신 시 데스크톱 알림 (Electron Notification) |
| 번역 + AI | ✅ | 태→한 즉석 번역 + AI 상담 어시스트 (의도 파악 + 추천 답변) |
| 자동 빌드 | ✅ | GitHub Actions + electron-builder (macOS/Windows) |
| 자동 업데이트 | ⬜ | electron-updater 의존성 포함, 아직 미구현 (수동 다운로드 방식) |

### 3.4 Worker Extension (Chrome)

| 기능 | 상태 | 설명 |
|------|------|------|
| 출퇴근 토글 | ✅ | 출근/자리비움/퇴근 상태 변경 → time_logs 기록 |
| 업무 수신 | ✅ | 담당 태스크 실시간 조회, 마감일 색상 코딩(빨강/주황/회색) |
| 업무 완료 처리 | ✅ | 완료 클릭 → Client Web 실시간 반영 |
| 업무 제안 | ✅ | Worker 직접 업무 등록 (태→한 번역), "자체 제안" 뱃지 |
| 채팅 | ✅ | 업무별 채팅, 태→한 자동 번역 |
| 번역 헬퍼 | ✅ | 태국어 → 한국어 즉석 번역 |
| 퀵 리플라이 | ✅ | DB 템플릿 로드 → 클릭 복사 |
| AI 드래그 어시스트 | ✅ | 텍스트 드래그 → AI 분석 (번역 + 의도 + 추천 답변), Shadow DOM |
| Activity Ping | ✅ | 10분 무활동 시 자동 "자리 비움" |
| 알림 배지 | ✅ | 새 업무 수신 시 아이콘 배지 |

### 3.5 데이터베이스 (Supabase)

| 테이블 | 용도 |
|--------|------|
| `clients` | 고객사(병원) 정보 |
| `profiles` | 사용자 프로필 (role, client_id, display_name) |
| `time_logs` | 근태 기록 (worker_id, status, created_at) |
| `tasks` | 업무 (content, content_th, description, description_th, assignee_id, due_date, rating, source, status, created_by) |
| `messages` | 업무별 채팅 (content_ko, content_th, is_whisper, sender_lang, file_url, file_name, file_type, mentions) |
| `quick_replies` | 자동답변 템플릿 (title/body × ko/th, client_id) |
| `task_presets` | 업무 프리셋 (title/content × ko/th, client_id) |

**RLS 정책:**
- bbg_admin: 전체 CRUD
- client: 자사 데이터만 조회, Whisper 메시지 CASE 표현식으로 필터링
- worker: 본인 업무/채팅, 템플릿 읽기, time_logs 기록
- messages: 발신자만 UPDATE 가능 (번역 결과 저장)
- profiles: 같은 client_id 소속끼리 조회 가능 (그룹 채팅 발신자 이름)

### 3.6 번역 패턴

모든 채팅(Client Web, Desktop App, Extension)에서 동일한 패턴:

1. 메시지를 원본 텍스트로 즉시 DB에 저장 (content_ko, content_th 모두 원본)
2. 백그라운드에서 Gemini API로 번역 요청
3. 번역 완료 시 해당 메시지의 번역 컬럼만 UPDATE
4. Realtime 구독(`event: '*'`)으로 UPDATE 이벤트도 수신하여 UI 즉시 반영

### 3.7 전체 톡방 (General Chat)

- `messages.task_id`가 NOT NULL이므로, `content = '__GENERAL_CHAT__'`인 더미 task를 client_id별로 생성
- API: `GET /api/tasks?general_chat=true&client_id=xxx` → 조회/자동 생성
- 일반 업무 목록/캘린더에서 `.neq('content', '__GENERAL_CHAT__')` 필터로 숨김
- Client Web + Desktop App 모두 지원
- **필수 조건:** 워커의 `profiles.client_id`가 설정되어 있어야 함
- **에러 피드백:** `client_id` 미설정 시 Desktop UI에 안내 메시지 표시, 콘솔에 `[GeneralChat]` 로그
- **CORS:** Desktop App(Electron)에서 Vercel API 호출을 위해 cross-origin 허용

---

## 4. 디자인 시스템

Figma Make 기반 디자인 업그레이드 적용 (Linear/Notion 스타일).

- **카드:** rounded-xl, shadow-sm, border
- **아이콘:** lucide-react
- **배지:** rounded-full pill (purple=관리자, blue=병원, emerald=직원)
- **로그인:** 그라데이션 배경 (slate-50 → emerald-50), 센터 카드 shadow-lg
- **섹션 색상:** 각 섹션별 그라데이션 배경(`from-{color}-50/70 to-white`) + 좌측 컬러 보더(`border-l-4 border-l-{color}-400`)

---

## 5. 권한 체계

| role | 접근 범위 |
|------|-----------|
| `bbg_admin` | 모든 기능 + God Mode + 프리셋 관리 + 계정 관리 + Whisper 전송 |
| `client` | 자사 직원/업무/자동답변, 프리셋 사용(조회만), 업무 완료/취소/되돌리기, 전체 톡방 참여, Whisper 볼 수 없음 |
| `worker` | 워커 웹 대시보드, 본인 업무/채팅, 업무 제안, 전체 톡방 참여, 상태 토글, 번역 도우미, 템플릿 읽기, time_logs 기록 |

---

## 6. API 엔드포인트

| 경로 | 메서드 | 역할 |
|------|--------|------|
| `/api/tasks` | GET | 업무 목록 조회, 전체 톡방 조회/생성 (`?general_chat=true`) |
| `/api/tasks` | POST | 업무 생성 (client, bbg_admin) — content, content_th, description, description_th, assignee_id, due_date, source |
| `/api/tasks` | PATCH | 업무 수정 — status, rating, due_date, content, content_th, description, description_th, assignee_id |
| `/api/tasks` | DELETE | 업무 삭제 + 연결 메시지 삭제 |
| `/api/translate` | POST | 한↔태 양방향 번역 (Gemini API) |
| `/api/ai-assist` | POST | AI 상담 어시스턴트 (의도 파악 + 추천 답변) |
| `/api/admin/users` | POST/DELETE | 계정 생성/삭제 (bbg_admin, service_role) |

---

## 7. 리스크 및 방어 로직

| 리스크 | 방어 |
|--------|------|
| WebSocket 단절 | Supabase Realtime 자동 재연결 + Service Worker keep-alive |
| 근태 어뷰징 | Activity Ping (10분 무활동 → 자리비움), 향후 키보드/마우스 이벤트 감지 확장 가능 |
| service_role 키 노출 | 서버사이드 API Route에서만 사용, 클라이언트 코드에 미노출 |
| Whisper 정보 유출 | RLS CASE 표현식으로 client 역할에게 is_whisper=true 메시지 필터링 |
| 번역 실패 | 즉시 전송 패턴으로 원본은 항상 표시, 번역은 백그라운드에서 재시도 |
| CORS 차단 | API Route에 CORS 헤더 + OPTIONS preflight 처리 (Desktop/Extension cross-origin 허용) |
| 전체 톡방 미노출 | `profiles.client_id` 미설정 감지 → UI 에러 메시지 + 콘솔 `[GeneralChat]` 로그 |

---

## 8. 향후 로드맵

| 우선순위 | 항목 | 설명 |
|----------|------|------|
| 완료 | 브랜드 에셋 (SVG) | 로고 모노그램, 워드마크, 파비콘 등 SVG BI 파일 7종 (`brand/`) |
| 완료 | 사용자 가이드 | 고객사 가이드(한국어), 직원 가이드(태국어), Extension 매뉴얼 |
| 완료 | 워커 웹 대시보드 (Phase 1) | WorkerDashboard, WorkerStatusToggle, TaskPropose, TranslationHelper 구현 완료 |
| 높음 | 모바일 반응형 (Phase 2) | 워커 대시보드 모바일 최적화, 터치 친화적 UI |
| 높음 | 회원가입/온보딩 플로우 | 자체 가입 → 관리자 승인 또는 초대 링크 |
| 높음 | 업무 가이드 PDF | 프리셋별 상세 작업 가이드를 PDF로 제공, 워커에게 전달 |
| 중간 | 주간/월간 리포트 | 일간 외 장기 근태/업무 통계 |
| 중간 | 알림 시스템 | 이메일/LINE 통합 알림 |
| 낮음 | 모바일 대응 | 반응형 대시보드 최적화 |
| 낮음 | 다국어 확장 | 베트남어 등 추가 언어 지원 |

---

## 9. 릴리즈 이력

### Desktop App
| 버전 | 내용 |
|------|------|
| v1.0.0 | 초기 릴리즈 (업무, 채팅, 번역) |
| v1.1.0 | 마감일 날짜만 표시 (시간 제거) |
| v1.2.0 | 전체 톡방 추가 |
| v1.2.1 | 번역 수정 (즉시 전송 + 백그라운드 번역, Realtime UPDATE 수신) |
| v1.2.2 | 채팅 발신자 이름 표시 |
| v1.2.3 | 발신자 이름 데스크톱 릴리즈 |
| v1.2.4 | 전체 톡방 디버깅 강화, CORS 수정, 에러 피드백 UI 추가 |
| v1.3.0 | 파일 첨부, @멘션, 푸시 알림, 멤버 온라인 상태, NSIS 바로가기 수정 |

---

**문서 버전:** 3.5 · 업무 상세 설명 필드 분리 반영 (description/description_th 컬럼 추가, TaskAssign 제목+가이드 분리 입력, TaskList 접기/펼치기 표시, PATCH whitelist 업데이트)
