# SyncBridge 웹 통합 리팩토링 플랜

> 트래킹 없이 웹만으로 워커가 업무를 수행할 수 있도록 Client Web을 확장하고, 모바일 환경을 지원하는 계획

## 현재 구조

| 플랫폼 | 대상 | 핵심 기능 |
|--------|------|----------|
| Client Web (Next.js) | 병원(Client), BBG Admin | 업무 할당, 채팅, 모니터링, 관리 |
| Desktop App (Electron) | 워커(태국 직원) | 업무 확인/완료, 채팅, 상태 토글, idle 감지 |
| Chrome Extension | 워커(태국 직원) | 업무 확인/완료, AI 드래그 어시스트, 활동 감지 |

## 목표

- **워커도 웹 브라우저로 모든 업무 수행 가능** (Desktop/Extension 없이)
- **모바일(스마트폰) 접속 지원** — 터치 친화적 UI
- Desktop App/Extension은 **트래킹이 필요한 경우에만 선택적 사용**

---

## Phase 1: 워커 웹 대시보드 ✅ COMPLETED

> ~~예상 작업량: 3~5일~~ **완료 — 2026-03-05**

### 1-1. 워커 전용 대시보드 페이지✅

**파일:** `client-web/components/WorkerDashboard.tsx` ✅ 구현 완료

워커 role로 로그인 시 별도 대시보드 표시. 탭 네비게이션 (업무/채팅/도구).

**포함 컴포넌트:**
- 내 업무 목록 (TaskList 재사용, 본인 업무 / 팀 전체 탭 분리) ✅
- 업무별 채팅 (TaskChat 재사용) ✅
- 전체 톡방 (GeneralChat 재사용) ✅
- 상태 토글 (WorkerStatusToggle) ✅

### 1-2. 워커 상태 토글 컴포넌트 ✅

**파일:** `client-web/components/WorkerStatusToggle.tsx` ✅ 구현 완료

```
[ 출근 ✅ ] [ 자리비움 ] [ 퇴근 ]
```

- `profiles.status` 필드를 PATCH로 업데이트 ✅
- 현재 상태 경과 시간 표시 ✅
- `[WorkerStatusToggle]` 콘솔 로그 프리픽스 사용 ✅

### 1-3. 업무 제안(Propose) 기능 ✅

**파일:** `client-web/components/TaskPropose.tsx` ✅ 구현 완료

- 태국어 입력 → 한국어 자동 번역 `/api/translate` 활용 ✅
- `source: 'worker'`로 저장 ✅
- `[TaskPropose]` 콘솔 로그 프리픽스 사용 ✅

### 1-4. 번역 도우미 ✅

**파일:** `client-web/components/TranslationHelper.tsx` ✅ 구현 완료

- 태국어 ↔ 한국어 간편 번역 ✅
- 기존 `/api/translate` API 활용 ✅

### 1-5. 대시보드 라우팅 수정 ✅

**파일:** `client-web/components/Dashboard.tsx` ✅ 수정 완료

```tsx
if (profile.role === 'worker') return <WorkerDashboard ... />;
// 기존 client/bbg_admin 대시보드
```

### 추가 구현 (Phase 1과 함께 완료)

- **마감일 datetime-local** — 날짜+시간 지정 (`TaskAssign.tsx`) ✅
- **마감일 인라인 수정** — 기존 마감일 클릭 시 편집 가능 (`TaskList.tsx`) ✅
- **업무 완료 client 전용** — 초록 완료 버튼, client만 처리 가능 ✅
- **완료 업무 되돌리기** — client가 완료 → 대기 중으로 되돌리기 ✅
- **업무 취소** — client가 대기 중 업무 X 취소 처리 ✅
- **할당자 표시** — "할당: OOO" 표시, `created_by` 컬럼 추가 ✅

---

## Phase 2: 모바일 반응형 UI (앱 리빌드 불필요)

> 예상 작업량: 2~3일

### 2-1. 워커 대시보드 모바일 최적화

- 탭 네비게이션 (업무 | 채팅 | 설정)
- 터치 친화적 버튼 크기 (최소 44x44px)
- 카드 레이아웃을 단일 컬럼으로
- 채팅 입력 영역을 화면 하단 고정
- `viewport` meta 태그 확인

### 2-2. 기존 Client 대시보드 모바일 대응

현재 `max-w-[1440px]` 고정 레이아웃 → 반응형으로 변경:

```
데스크톱: 2~3 컬럼 그리드
태블릿: 2 컬럼
모바일: 1 컬럼 (스택)
```

수정 대상 컴포넌트:
- `Dashboard.tsx` — 그리드 레이아웃
- `WorkerStatus.tsx` — 워커 카드 배치
- `TaskList.tsx` — 업무 카드
- `GeneralChat.tsx` — 채팅 높이/패딩
- `TaskCalendar.tsx` — 캘린더 축소 표시

### 2-3. PWA 설정 (선택)

- `manifest.json` 추가 — 홈 화면에 앱 아이콘 추가 가능
- Service Worker — 오프라인 기본 페이지, 푸시 알림
- 모바일에서 "앱처럼" 사용 가능

---

## Phase 3: 웹 푸시 알림 (앱 리빌드 불필요)

> 예상 작업량: 1~2일

Desktop App의 네이티브 알림을 대체:

- Web Push API + Service Worker
- 새 업무 할당 시 알림
- 새 채팅 메시지 알림
- 브라우저 권한 요청 UI
- Supabase Realtime 이벤트와 연동

---

## Phase 4: Desktop/Extension 역할 재정의 (앱 리빌드 필요)

> 예상 작업량: 2~3일 (리빌드 + 릴리즈 포함)

트래킹이 필요한 경우에만 Desktop/Extension 사용:

### 4-1. Desktop App 경량화

- 핵심: idle 감지 + 시스템 트레이 상주
- 업무/채팅 UI → WebView로 Client Web 로드 (중복 코드 제거)
- 또는 Desktop App을 "트래킹 전용"으로 축소

### 4-2. Extension 역할 축소

- AI 드래그 어시스트만 유지 (이건 Extension만 가능)
- 업무/채팅 UI 제거 → 웹으로 유도
- 활동 감지 기능만 background.js에 유지

---

## 구현 우선순위

| 순서 | 항목 | 리빌드 | 영향도 | 상태 |
|------|------|--------|--------|------|
| 1 | Phase 1-1~1-5: 워커 웹 대시보드 | 불필요 | 높음 — 워커가 앱 없이 업무 가능 | ✅ **완료** |
| 2 | Phase 2-1: 워커 모바일 UI | 불필요 | 높음 — 스마트폰 접속 가능 | ⬜ 예정 |
| 3 | Phase 3: 웹 푸시 알림 | 불필요 | 중간 — 실시간 알림 | ⬜ 예정 |
| 4 | Phase 2-2: Client 모바일 대응 | 불필요 | 중간 — 병원 측 모바일 접속 | ⬜ 예정 |
| 5 | Phase 2-3: PWA | 불필요 | 낮음 — 앱 느낌 | ⬜ 예정 |
| 6 | Phase 4: Desktop/Extension 경량화 | 필요 | 낮음 — 코드 정리 | ⬜ 예정 |

---

## 기존 코드 재사용 가능 목록

| 기능 | 기존 컴포넌트 | 워커 대시보드에서 |
|------|-------------|-----------------|
| 업무 목록 | TaskList.tsx | 그대로 사용 (assignee_id 필터) |
| 업무별 채팅 | TaskChat.tsx | 그대로 사용 |
| 전체 톡방 | GeneralChat.tsx | 그대로 사용 |
| 파일 첨부 | TaskChat/GeneralChat 내장 | 그대로 사용 |
| @멘션 | TaskChat/GeneralChat 내장 | 그대로 사용 |
| 번역 API | /api/translate | 그대로 사용 |
| AI 어시스트 | /api/ai-assist | 웹 UI 래핑만 추가 |

---

## 리스크 및 고려사항

1. **보안**: 워커가 웹으로 접속 시 URL 공유만으로 접근 가능 → IP 제한 또는 2FA 고려
2. **브라우저 알림 권한**: 사용자가 알림을 거부하면 푸시 불가 → 인앱 알림 폴백 필요
3. **모바일 키보드**: 채팅 입력 시 키보드가 레이아웃을 밀어올림 → CSS 대응 필요
4. **오프라인**: 웹은 인터넷 필수 → PWA Service Worker로 최소한의 오프라인 지원
5. **Desktop App 사용자 혼란**: 기존 워커들이 웹으로 전환 시 안내 필요

---

## 결론

Phase 1~3까지는 **앱 리빌드 없이** Vercel 배포만으로 구현 가능.
워커가 Desktop App/Extension 없이도 웹 브라우저(PC/모바일)로 업무를 수행할 수 있게 됩니다.

기존 Desktop App은 트래킹(idle 감지)이 필요한 경우에만 유지하고,
Extension은 AI 드래그 어시스트 전용으로 축소하는 것을 권장합니다.
