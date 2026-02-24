# Chrome Web Store 심사 제출 가이드

SyncBridge Worker Extension을 Chrome Web Store에 등록하기 위한 단계별 가이드.

---

## 1. 심사 전 manifest.json 수정 필요

현재 문제점:

| 항목 | 현재 | 문제 |
|------|------|------|
| `host_permissions` | `http://localhost:3000/*` 포함 | localhost는 심사 거절 사유 |
| `icons` | 없음 | 스토어 등록 시 필수 (16/48/128px) |
| `version` | `0.1.0` | 출시용이면 `1.0.0` 권장 |
| `description` | 한국어만 | 영문 병기하면 심사에 유리 |

---

## 2. 아이콘 준비

| 이미지 | 크기 | 용도 |
|--------|------|------|
| **Extension 아이콘** | 16x16, 48x48, 128x128 px (PNG) | manifest.json `icons` 필드 |
| **스토어 아이콘** | 128x128 px (PNG) | 스토어 목록 메인 아이콘 |
| **프로모션 타일 (선택)** | 440x280 px | 스토어 검색 결과에 표시 |
| **스크린샷** | 1280x800 또는 640x400 px (최소 1장, 최대 5장) | 스토어 상세 페이지 |

스크린샷은 실제 익스텐션 동작 화면을 캡처.

---

## 3. 개발자 계정 등록

1. https://chrome.google.com/webstore/devconsole 접속
2. Google 계정으로 로그인
3. **개발자 등록비 $5 (일회성)** 결제
4. 개발자 프로필 작성 (이름, 이메일, 웹사이트)

---

## 4. Client Web 배포 (심사 전 필수)

현재 `localhost:3000`으로 되어 있는 번역/AI API를 실제 URL로 교체해야 함.

**배포 옵션:**
- **Vercel** (추천, Next.js 공식): `vercel deploy` → `https://your-app.vercel.app`
- Netlify, Railway 등도 가능

배포 후 변경할 것:
- 익스텐션 `host_permissions`에 배포 URL 추가
- `.env.local`의 `VITE_WEB_URL`을 배포 URL로 변경
- 다시 `npm run build`

---

## 5. manifest.json 최종 수정 (배포용)

```json
{
  "manifest_version": 3,
  "name": "SyncBridge",
  "version": "1.0.0",
  "description": "BPO remote work assistant - Translation, templates, and AI-powered CS support for Thai remote workers",
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "action": {
    "default_popup": "index.html",
    "default_title": "SyncBridge",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png"
    }
  },
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": [
        "*://*.facebook.com/*",
        "*://*.messenger.com/*",
        "*://*.line.me/*",
        "*://*.instagram.com/*"
      ],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "permissions": [
    "storage",
    "notifications"
  ],
  "host_permissions": [
    "https://ucpmfmwaavwrqtvrwaic.supabase.co/*",
    "https://your-deployed-app.vercel.app/*"
  ]
}
```

---

## 6. ZIP 패키징

```bash
cd syncbridge-extension
npm run build
cd dist
zip -r ../syncbridge-v1.0.0.zip .
```

`dist/` 폴더 내용물만 ZIP으로 패키징 (소스코드 X, 빌드 결과물만).

---

## 7. 스토어에 업로드

1. https://chrome.google.com/webstore/devconsole 접속
2. **"새 항목"** 클릭
3. ZIP 파일 업로드
4. 스토어 등록 정보 작성:

| 필드 | 입력 내용 |
|------|-----------|
| **언어** | 한국어 (또는 영어) |
| **카테고리** | Productivity (생산성) |
| **상세 설명** | 기능 요약 (번역, 업무 관리, AI 어시스트 등) |
| **스크린샷** | 팝업 화면, AI 드래그 어시스트 화면 등 캡처 |
| **아이콘** | 128x128 PNG |
| **공개 범위** | 아래 참고 |

---

## 8. 공개 범위 설정

BBG 내부용이면 전체 공개할 필요 없음:

| 옵션 | 설명 | 추천 |
|------|------|------|
| **공개** | 누구나 검색/설치 가능 | X |
| **비공개** | 링크 있는 사람만 설치 | O (소규모 팀) |
| **그룹 게시** | Google Workspace 그룹 멤버만 | 회사 계정 있을 때 |

**"비공개"로 하면 심사가 훨씬 빠르고 간단함.** 스토어 URL을 태국 직원들에게 공유하면 됨.

---

## 9. 심사 제출

1. 모든 정보 입력 후 **"심사를 위해 제출"** 클릭
2. 심사 소요 시간: **보통 1~3일** (비공개는 더 빠를 수 있음)
3. 거절 시 사유 메일 발송 → 수정 후 재제출

---

## 10. 심사 거절 주요 사유 (미리 체크)

| 사유 | 대응 |
|------|------|
| `localhost` in host_permissions | 배포 URL로 교체 |
| 아이콘 없음 | 16/48/128 PNG 추가 |
| content_scripts가 광범위한 도메인 접근 | facebook/messenger/line/instagram만이면 OK, 사유 설명 필요할 수 있음 |
| 개인정보 처리방침 미제공 | 스토어 등록 시 Privacy Policy URL 필요 |
| 권한 과다 요청 | 현재는 `storage`, `notifications`만이라 OK |

---

## 체크리스트

- [x] 아이콘 만들기 → `syncbridge-extension/public/icons/` (16/48/128 PNG)
- [x] Client Web 배포 → https://client-web-zeta.vercel.app
- [x] manifest.json 수정 → localhost 제거, 아이콘 추가, 배포 URL, version 1.0.0, 영문 description
- [x] 개인정보 처리방침 페이지 → https://client-web-zeta.vercel.app/privacy
- [ ] 개발자 계정 등록 ($5) — https://chrome.google.com/webstore/devconsole
- [ ] 빌드 → ZIP → 업로드 (`cd syncbridge-extension && npm run build && cd dist && zip -r ../syncbridge-v1.0.0.zip .`)
- [ ] 스토어 정보 입력 + 스크린샷
- [ ] 심사 제출
