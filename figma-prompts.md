# SyncBridge - Figma Make Design Prompts

## Product Context

SyncBridge is a B2B SaaS platform for Korean hospitals that outsource remote work to Thai workers. The platform bridges language and management gaps between Korean hospital managers and Thai remote workers.

**Brand Direction**: Professional, clean, modern SaaS dashboard. Think Linear, Notion, or Vercel's design language — minimal borders, generous whitespace, subtle shadows, clear visual hierarchy. Primary color: emerald/green (#059669). Accent colors for status indicators.

**Users**: Korean hospital managers (client), Thai remote workers (via Chrome Extension), BBG platform admins (super admin).

**Language**: All UI text is in Korean (한국어). Keep all Korean text exactly as provided.

---

## 1. Login Page (LoginPage)

**Prompt for Figma Make:**

> Design a modern SaaS login page for "SyncBridge" — a B2B remote work management platform.
>
> **Layout**: Centered card on a subtle gradient background (slate-50 to white, or a very light emerald tint). The card should have a max-width of ~420px with generous padding (32-40px).
>
> **Elements (top to bottom)**:
> 1. **Logo area**: "SyncBridge" wordmark in bold (20-24px), with a small bridge or sync icon to the left. Below it, subtitle text: "관리자 로그인" in muted gray (14px).
> 2. **Email field**: Label "이메일", full-width input with rounded corners, light border, placeholder text.
> 3. **Password field**: Label "비밀번호", full-width input, same style as email.
> 4. **Error message area**: Small red text below password field (hidden by default, shows "이메일 또는 비밀번호가 올바르지 않습니다." on error).
> 5. **Login button**: Full-width, emerald-600 (#059669) background, white text "로그인", rounded-lg, 48px height. Hover state slightly darker.
> 6. **Footer**: Very small muted text "© 2025 BBG Corp. All rights reserved."
>
> **Style**: Card should have a subtle box-shadow (not border). Background could have a very faint geometric pattern or be clean solid. Modern, trustworthy feel suitable for B2B healthcare.
>
> **States to show**: Default state, Loading state (button shows spinner + "로그인 중..."), Error state (red message visible).

---

## 2. Dashboard Layout (Dashboard)

**Prompt for Figma Make:**

> Design the main dashboard layout shell for a SaaS admin panel. This is the container/frame that holds all other components.
>
> **Layout**:
> 1. **Top header bar** (sticky, white background, bottom border):
>    - Left: "SyncBridge 관리자" logo text (18-20px, semibold)
>    - Right: User email "client@test.com" in muted text, role badge "client" (small pill/chip, slate background), "로그아웃" text button
>    - Height: ~64px
>
> 2. **Main content area** (max-width 1280px, centered, padding 24px, light gray background #f8fafc):
>    - Section 1: Worker Status cards (full width)
>    - Section 2: Two-column grid — Left: Task Assign form, Right: Task List
>    - Section 3: Task Preset Manager (full width, bbg_admin only)
>    - Section 4: Quick Reply Manager (full width)
>    - Section 5: Time Report (full width)
>    - Section 6: User Manager (full width, bbg_admin only)
>    - Vertical spacing between sections: 24px
>
> **Style**: Clean slate-50 (#f8fafc) background. Each section is a white card with subtle shadow (no visible border, or very light border). Generous padding inside cards (24px). Headers inside cards: 18px semibold.
>
> **Feel**: Like a Linear or Notion admin dashboard — spacious, organized, modern.

---

## 3. Worker Status (WorkerStatus)

**Prompt for Figma Make:**

> Design a "Real-time Worker Status" card component for a dashboard.
>
> **Card header**: "실시간 직원 상태" (18px semibold)
>
> **Content**: A responsive grid of worker cards (3 columns on desktop, 2 on tablet, 1 on mobile).
>
> **Each worker card contains**:
> 1. **Worker name**: "김태희" (14px, semibold, dark text)
> 2. **Hospital name**: "서울성모병원" (12px, muted gray, below name)
> 3. **Status badge** (pill shape):
>    - Online: Green dot + "온라인" (green background)
>    - Away: Yellow dot + "자리 비움" (amber background)
>    - Offline: Gray dot + "오프라인" (gray background)
> 4. **Rating**: "★ 4.2 (8)" in amber/gold text (small, next to status badge)
>
> **Worker card style**: Light border or subtle shadow, rounded-lg, padding 16px. Consider using a left border accent color matching the status (green/amber/gray).
>
> **Empty state**: "할당된 직원이 없습니다." centered muted text.
>
> **Design 3-4 sample worker cards** with different statuses to show variety.

---

## 4. Task Assign Form (TaskAssign)

**Prompt for Figma Make:**

> Design a "Task Assignment" form card for assigning work from a Korean hospital manager to a Thai remote worker.
>
> **Card header**: "업무 할당" (18px semibold)
>
> **Form fields (top to bottom)**:
> 1. **Assignee dropdown**: Label "담당자", full-width select with options like "김태희", "박수진". Placeholder: "선택하세요"
> 2. **Preset dropdown**: Label "프리셋 선택" with small muted text "(선택사항)". Options like "직접 입력", "SNS 게시글 업로드", "진료접수 처리". This auto-fills the textarea below.
> 3. **Task content textarea**: Label "업무 내용 (한국어)". 3-row textarea. Placeholder: "예: 오늘 오후 2시 페이스북 이벤트 게시글 업로드". Below the textarea, helper text: "한국어로 작성하면 직원에게는 태국어로 자동 번역되어 표시됩니다." in small muted text.
> 4. **Due date**: Label "마감일" with "(선택사항)". datetime-local input.
> 5. **Translation preview** (conditional): Amber/yellow tinted box with label "태국어 번역 미리보기" and Thai text below it.
> 6. **Submit button**: Full-width, emerald green, text "업무 할당". Loading state: "번역 및 할당 중..."
>
> **Style**: Clean form with consistent input styling. The translation preview box should feel distinct — warm yellow/amber tint to represent the Thai translation.
>
> **Show two states**: Default (empty form) and Filled (with preset selected, content filled, translation preview visible).

---

## 5. Task List (TaskList)

**Prompt for Figma Make:**

> Design a "Task List" card showing assigned tasks with status, chat, rating, and due dates.
>
> **Card header**: "업무 목록" (18px semibold)
>
> **Task list**: Scrollable area (max-height ~400px) with task cards stacked vertically.
>
> **Each task card contains**:
> 1. **First row**: Task content text (14px, dark) on the left. Right side: status badge + chat button.
>    - Status badge: "완료" (emerald green pill) or "대기" (amber pill)
>    - Chat button: "채팅" small button (blue pill, toggles to solid blue when active)
> 2. **Thai translation** (conditional): Small muted box with 🇹🇭 flag + Thai text
> 3. **Quality rating row** (for completed tasks): "품질:" label + star rating ★★★★☆ in amber
>    - If not rated: "평가하기" clickable text
>    - If rating in progress: 5 clickable stars + "취소" button
> 4. **Metadata row**: "담당: 김태희 · 2025. 2. 20. 오후 3:00 · 📅 마감 2월 21일 14:00"
>    - Overdue tasks: "⚠ 기한초과" in red text instead of 📅
>
> **Design 3-4 sample tasks**: One completed with rating, one pending with due date, one overdue, one with chat open.
>
> **Empty state**: "할당된 업무가 없습니다." centered muted text.
>
> **Style**: Task cards should have subtle borders, comfortable padding. The chat button should be visually prominent but not overwhelming.

---

## 6. Task Chat (TaskChat)

**Prompt for Figma Make:**

> Design a chat panel for task-specific messaging between a Korean hospital manager and a Thai worker.
>
> **Container**: White card, fixed height 480px, with 3 sections (header, messages, input).
>
> **Header** (top bar, border-bottom):
> - Left: "업무 채팅" title (14px semibold) + task description below in muted text ("페이스북 이벤트 게시글 업로드")
> - Right: "✕" close button
>
> **Messages area** (scrollable, light gray background #f8fafc):
> - **My messages** (right-aligned): Emerald green bubble, white text. Time stamp in light green below.
> - **Their messages** (left-aligned): White bubble with light border, dark text. Time stamp in light gray below.
> - Message text: 14px. Timestamp: 10px ("오후 3:24")
> - Design 4-5 sample messages alternating sides.
>
> **Input area** (bottom bar, border-top):
> - Text input: "한국어로 메시지 입력..." placeholder
> - Send button: "전송" emerald green button
>
> **Empty state**: "메시지가 없습니다" centered in message area.
>
> **Style**: Modern chat UI like Slack or iMessage. Bubbles with comfortable padding and rounded corners. Clear visual distinction between sent/received.

---

## 7. Quick Reply Manager (QuickReplyManager)

**Prompt for Figma Make:**

> Design a "Quick Reply Management" card for managing canned response templates. These are pre-written replies that Thai workers can use in their Chrome Extension.
>
> **Card header**: "자동답변 관리" (18px semibold)
> **Subtitle**: "직원용 퀵 리플라이를 등록하면 Extension에서 태국어로 보입니다." (12px muted)
>
> **Form section**:
> 1. **Hospital selector** (full width, only for admin): Label "적용 고객사", dropdown with "전체 공용" + hospital names
> 2. **Two-column grid** (equal width):
>    - Left: Label "제목 (한국어)", text input. Placeholder: "예: 병원 위치 안내"
>    - Right: Label "내용 (한국어)", textarea (3 rows). Placeholder: "예: 저희 병원은 서울시 강남구 ..."
> 3. **Action buttons**: "추가" emerald button (or "수정" when editing) + "취소" text link when editing
>
> **List section** (below form, separated):
> Each item in a list row:
> - Left side: Title in semibold (14px), content preview in muted text (12px, 1 line truncated), Thai translation "🇹🇭 โรงพยาบาล..." in amber text
> - Right side: "수정" blue link + "삭제" red link
>
> **Design 3-4 sample items** with Korean titles and Thai translations.
>
> **Style**: Clean form + list layout. Items should have subtle borders. The Thai translation text helps admin verify the auto-translation worked.

---

## 8. Task Preset Manager (TaskPresetManager)

**Prompt for Figma Make:**

> Design a "Task Preset Management" card for managing reusable task templates. Hospitals select these presets when assigning work to auto-fill the task content.
>
> **Card header**: "업무 프리셋 관리" (18px semibold)
> **Subtitle**: "자주 사용하는 업무 지시를 프리셋으로 등록하면, 병원이 업무 배정 시 선택만으로 바로 할당할 수 있습니다." (12px muted)
>
> **Form section**:
> 1. **Hospital selector** (full width): Label "적용 병원", dropdown: "전체 공용" + hospital names
> 2. **Two-column grid** (equal width):
>    - Left: Label "프리셋 이름 (한국어)", text input. Placeholder: "예: SNS 게시글 업로드"
>    - Right: Label "업무 내용 (한국어)", textarea (3 rows). Placeholder: "예: 오늘 오후 2시까지 페이스북 이벤트 게시글을 작성하여 업로드해 주세요."
> 3. **Action buttons**: "추가" emerald button + loading state "번역 및 저장 중..."
>
> **List section**:
> Each preset item:
> - Title (14px semibold) + hospital badge pill ("전체 공용" or hospital name)
> - Content preview (12px, 2 lines max, muted)
> - Thai translation: "🇹🇭 อัพโหลดโพสต์..." in amber (12px, 1 line)
> - Right: "수정" blue link + "삭제" red link
>
> **Design 3-4 sample presets**: "SNS 게시글 업로드", "진료접수 처리", "전화 예약 확인" etc.
>
> **Empty state**: "등록된 프리셋이 없습니다."
>
> **Style**: Nearly identical to Quick Reply Manager but with different content. Keep the layout consistent between the two.

---

## 9. Time Report (TimeReport)

**Prompt for Figma Make:**

> Design a "Daily Work Report" table card showing worker attendance/activity data.
>
> **Card header**: "오늘 근무 리포트" (18px semibold)
>
> **Table**:
> | Column | Alignment | Sample Data |
> |--------|-----------|-------------|
> | 직원 (Worker) | Left | 김태희 |
> | 총 기록 (Total Records) | Right | 24회 |
> | 출근 (Online) | Right | 18회 |
> | 자리 비움 (Away) | Right | 6회 |
>
> **Design 3-4 rows** with varying data. Table should have:
> - Header row with muted, uppercase-style text (but in Korean)
> - Alternating or hoverable rows
> - Clean borders between rows
> - Numbers right-aligned for readability
>
> **Consider adding**:
> - A subtle progress bar or visual indicator for online ratio
> - Color coding: high online ratio = green text, high away ratio = amber text
>
> **Empty state**: "할당된 직원이 없습니다."
>
> **Style**: Clean data table. Think Stripe dashboard or Linear's table styling.

---

## 10. User Manager (UserManager)

**Prompt for Figma Make:**

> Design an "Account Management" card for creating and managing user accounts. This is an admin-only feature.
>
> **Card header**: "계정 관리" (18px semibold)
> **Subtitle**: "병원(client) 또는 직원(worker) 계정을 생성하고 관리합니다." (12px muted)
>
> **Create Account Form**:
> 1. **Row 1** (2-column grid):
>    - 이메일: email input, placeholder "user@example.com"
>    - 비밀번호: text input, placeholder "6자 이상"
> 2. **Row 2** (3-column grid):
>    - 이름: text input, placeholder "표시 이름"
>    - 역할: dropdown with "직원 (Worker)" / "병원 (Client)"
>    - 소속 병원: dropdown with hospital names
> 3. **Error/Success messages**: Red or green text
> 4. **Create button**: "계정 생성" emerald button
>
> **User List** (below form, separated by border):
> - Header: "등록된 계정 (5)" with count
> - Table:
>   | 이메일 | 이름 | 역할 | 소속 병원 | Actions |
>   |--------|------|------|-----------|---------|
>   | admin@bbg.com | Admin | 관리자 (purple badge) | - | — |
>   | client@test.com | 테스트 | 병원 (blue badge) | 서울성모병원 | 삭제 |
>   | worker1@bbg.com | 김태희 | 직원 (green badge) | 서울성모병원 | 삭제 |
>
> - Role badges: 관리자 = purple, 병원 = blue, 직원 = green (small pills)
> - Admin row should NOT have delete button
> - Hoverable rows
>
> **Style**: Form on top, table below. Clean separation. Role badges add color variety to the table.

---

## Global Design System Notes for Figma Make

> **Colors**:
> - Primary: Emerald-600 (#059669) for buttons and active states
> - Text: Slate-800 (#1e293b) for headings, Slate-500 (#64748b) for body, Slate-400 (#94a3b8) for muted
> - Backgrounds: White (#ffffff) for cards, Slate-50 (#f8fafc) for page background
> - Status: Emerald for success/online, Amber for warning/away, Red for error/overdue, Blue for info/chat, Purple for admin
>
> **Typography**:
> - Font: Inter or Pretendard (Korean-optimized sans-serif)
> - Headings: 18px semibold
> - Body: 14px regular
> - Small/Meta: 12px regular
> - Tiny: 10px (timestamps)
>
> **Components**:
> - Buttons: Rounded-lg (8px), 40-48px height, semibold text
> - Inputs: Rounded-lg, light border (#e2e8f0), focus ring in emerald
> - Cards: White background, rounded-xl (12px), subtle shadow (0 1px 3px rgba(0,0,0,0.1)) or very light border
> - Badges/Pills: Rounded-full, small padding, colored backgrounds
> - Tables: Clean lines, hoverable rows, right-aligned numbers
>
> **Spacing**: 8px base grid. Card padding 24px. Section gap 24px. Form field gap 16px.
>
> **Responsive**: Desktop-first (1280px max), 2-column grid at lg, single column on mobile.
