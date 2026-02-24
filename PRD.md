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
| **Client Web** | Next.js 14 (App Router), Tailwind CSS, lucide-react | 고객사·BBG 관리자용. 업무 지시, 실시간 근태 대시보드, 관제 모니터링. |
| **Worker Extension** | Chrome Extension V3 (React + Vite, Tailwind CSS) | 태국 직원용. 브라우저 팝업. 실시간 업무 수신, 채팅, 번역, AI 어시스트. |
| **Backend & DB** | Supabase (PostgreSQL, Auth, Realtime, RLS) | 데이터 저장, 인증/권한, 실시간 동기화, 행 수준 보안. |
| **번역/AI** | Google Gemini API (gemini-2.5-flash) | 한↔태 번역, AI 상담 어시스턴트 (의도 파악 + 추천 답변). |

---

## 3. 구현 완료 기능

### 3.1 Client Web — 대시보드

| 기능 | 상태 | 설명 |
|------|------|------|
| 인증 | ✅ | Supabase Auth (이메일/비밀번호), 역할 기반 접근 제어 |
| bbg_admin 자동 리다이렉트 | ✅ | admin 로그인 시 `/admin/monitoring`으로 자동 이동 |
| 직원 상태 모니터링 | ✅ | 실시간 온라인/자리비움/오프라인, 좌측 액센트 보더, 평균 평점 |
| 업무 할당 | ✅ | 담당자 선택, 프리셋 자동 채우기, 마감일 설정, 한→태 자동 번역 |
| 업무 프리셋 | ✅ | bbg_admin이 자주 쓰는 업무 지시를 프리셋으로 등록, 병원별/전체 공용 |
| 업무 목록 | ✅ | 실시간 조회, 상태 배지, 인라인 채팅, 기한초과 경고 |
| 업무 품질 평가 | ✅ | 완료 업무에 1~5점 별점 평가 (Star 아이콘, 호버 인터랙션) |
| 채팅 | ✅ | 업무별 1:1 채팅, 버블 UI, 한→태 자동 번역 |
| 자동답변 관리 | ✅ | 퀵 리플라이 CRUD, 한→태 자동 번역, 병원별/전체 공용 |
| 근무 리포트 | ✅ | 일간 근태 요약 테이블, 출근율 프로그레스 바, 색상 코딩 |
| 계정 관리 | ✅ | bbg_admin 전용, 병원/직원 계정 생성·삭제 (service_role API) |
| AI 어시스트 API | ✅ | 환자 메시지 → 한국어 번역 + 의도 파악 + 추천 답변 3개 |

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
| Whisper 메시지 | ✅ | 보라색 버블 + 🔒 라벨, RLS로 client에게 숨김 |
| Realtime | ✅ | tasks/messages/time_logs 변경 시 자동 갱신 (30초 주기) |

### 3.3 Worker Extension

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

### 3.4 데이터베이스 (Supabase)

| 테이블 | 용도 |
|--------|------|
| `clients` | 고객사(병원) 정보 |
| `profiles` | 사용자 프로필 (role, client_id, display_name) |
| `time_logs` | 근태 기록 (worker_id, status, created_at) |
| `tasks` | 업무 (content, content_th, assignee_id, due_date, rating, status) |
| `messages` | 업무별 채팅 (content_ko, content_th, is_whisper, sender_lang) |
| `quick_replies` | 자동답변 템플릿 (title/body × ko/th, client_id) |
| `task_presets` | 업무 프리셋 (title/content × ko/th, client_id) |

**RLS 정책:**
- bbg_admin: 전체 CRUD
- client: 자사 데이터만 조회, Whisper 메시지 CASE 표현식으로 필터링
- worker: 본인 업무/채팅, 템플릿 읽기, time_logs 기록

---

## 4. 디자인 시스템

Figma Make 기반 디자인 업그레이드 적용 (Linear/Notion 스타일).

- **Primary:** emerald-600 (#059669)
- **카드:** rounded-xl, shadow-sm, border-slate-100
- **아이콘:** lucide-react (Star, MessageCircle, Send, X, Pencil, Trash2, Link, Loader2)
- **배지:** rounded-full pill (purple=관리자, blue=병원, emerald=직원)
- **테이블:** 호버 효과, 프로그레스 바, 색상 코딩
- **로그인:** 그라데이션 배경 (slate-50 → emerald-50), 센터 카드 shadow-lg

---

## 5. 권한 체계

| role | 접근 범위 |
|------|-----------|
| `bbg_admin` | 모든 기능 + God Mode + 프리셋 관리 + 계정 관리 + Whisper 전송 |
| `client` | 자사 직원/업무/자동답변, 프리셋 사용(조회만), Whisper 볼 수 없음 |
| `worker` | 본인 업무/채팅, 업무 제안, 템플릿 읽기, time_logs 기록 |

---

## 6. 리스크 및 방어 로직

| 리스크 | 방어 |
|--------|------|
| WebSocket 단절 | Supabase Realtime 자동 재연결 + Service Worker keep-alive |
| 근태 어뷰징 | Activity Ping (10분 무활동 → 자리비움), 향후 키보드/마우스 이벤트 감지 확장 가능 |
| service_role 키 노출 | 서버사이드 API Route에서만 사용, 클라이언트 코드에 미노출 |
| Whisper 정보 유출 | RLS CASE 표현식으로 client 역할에게 is_whisper=true 메시지 필터링 |

---

## 7. 향후 로드맵

| 우선순위 | 항목 | 설명 |
|----------|------|------|
| 높음 | 회원가입/온보딩 플로우 | 자체 가입 → 관리자 승인 또는 초대 링크 |
| 높음 | 업무 가이드 PDF | 프리셋별 상세 작업 가이드를 PDF로 제공, 워커에게 전달 |
| 중간 | 주간/월간 리포트 | 일간 외 장기 근태/업무 통계 |
| 중간 | 알림 시스템 | 이메일/LINE 통합 알림 |
| 낮음 | 모바일 대응 | 반응형 대시보드 최적화 |
| 낮음 | 다국어 확장 | 베트남어 등 추가 언어 지원 |

---

**문서 버전:** 2.1 · Gemini API 전환 반영
