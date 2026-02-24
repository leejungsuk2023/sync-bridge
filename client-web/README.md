# SyncBridge Client Web (관리자 대시보드)

한국 고객사(병원) 및 BBG 관리자용 Next.js 대시보드입니다.

## 기술 스택

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- Supabase (Auth, DB, Realtime)
- OpenAI API (번역 + AI 어시스트)

## 설치 및 실행

```bash
npm install
npm run dev
```

- 메인 대시보드: `http://localhost:3000`
- God Mode 관제: `http://localhost:3000/admin/monitoring` (bbg_admin 전용)

## 라우트 구조

| 경로 | 역할 |
|------|------|
| `/` | 메인 페이지 (로그인 + 대시보드) |
| `/admin/monitoring` | God Mode 통합 관제 (bbg_admin 전용) |
| `POST /api/translate` | 한↔태 양방향 번역 (OpenAI) |
| `POST /api/ai-assist` | AI 상담 어시스턴트 (환자 메시지 분석 + 추천 답변) |

## 기능

### 메인 대시보드 (`/`)

| 기능 | 설명 |
|------|------|
| 로그인 | Supabase Auth (이메일/비밀번호) |
| 실시간 직원 상태 | 온라인/자리 비움/오프라인 + 평균 품질평가 (Realtime) |
| 업무 할당 | 담당자 선택, 한국어 입력 → 자동 태국어 번역 저장 |
| 업무 목록 | 실시간 조회, 채팅 버튼, 완료 시 품질 평가(1~5점) |
| 채팅 | 업무별 한국어 ↔ 태국어 실시간 채팅 |
| 자동답변 관리 | 퀵 리플라이 등록/수정 (한국어 → 태국어 자동 번역) |
| 근무 리포트 | 오늘 일간 근무 시간 요약 |

### God Mode 통합 관제 (`/admin/monitoring`)

bbg_admin 전용 실시간 모니터링 대시보드입니다. 모든 병원의 업무/채팅 상황을 한눈에 파악하고, 태국 직원에게 은밀한 지시를 내릴 수 있습니다.

| 기능 | 설명 |
|------|------|
| 권한 체크 | bbg_admin이 아니면 `/`로 리다이렉트 |
| 2-패널 레이아웃 | 좌측: 전체 업무 리스트 / 우측: 상세 + 실시간 채팅 |
| SLA 신호등 | 🟢 정상(< 5분) / 🟡 주의(5~15분) / 🔴 지연(> 15분) |
| SLA 자동 갱신 | 30초 간격으로 뱃지 색상 자동 업데이트 |
| 긴급순 정렬 | 🔴 → 🟡 → 🟢 → 완료 순 자동 정렬 |
| 일반 메시지 | 초록색 버블, 한→태 자동 번역 |
| Whisper (본사 지시) | 보라색 버블 + 🔒 라벨, `is_whisper: true`로 저장 |
| Realtime | tasks/messages 변경 시 자동 갱신 |

### API 엔드포인트

| 경로 | 역할 |
|------|------|
| `POST /api/translate` | 한↔태 양방향 번역 (OpenAI). 채팅/업무 할당 시 자동 호출 |
| `POST /api/ai-assist` | AI 상담 어시스턴트. 환자 메시지 → 한국어 번역 + 의도 분석 + 추천 답변 3개. OpenAI 키 없으면 mock 응답 반환 |

AI 어시스트 API는 GPT 응답의 `translation_ko`, `intent`, `replies` 필드 구조를 검증하여, 유효하지 않으면 mock 응답으로 fallback합니다.

## 권한

- **BBG 관리자** (`role: 'bbg_admin'`): 전체 직원 조회, God Mode 관제, Whisper 전송
- **병원 담당자** (`role: 'client'`): 자사 할당 직원만 조회

## 환경 변수

`.env.local`에 다음 설정:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
OPENAI_API_KEY=sk-...   # 번역 + AI 어시스트 (없으면 mock 응답)
```
