/**
 * SyncBridge Content Script
 * - Activity Ping
 * - AI Assist: 드래그 텍스트 → Shadow DOM 플로팅 UI
 */
(function () {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return;
  const proto = (location.protocol || '').toLowerCase();
  if (proto === 'chrome:' || proto === 'edge:' || proto === 'about:' || proto === 'chrome-extension:') return;

  // ─── Activity Ping ───
  const THROTTLE_MS = 2000;
  let lastPingSent = 0;
  function ping() {
    const now = Date.now();
    if (now - lastPingSent < THROTTLE_MS) return;
    lastPingSent = now;
    try { chrome.runtime.sendMessage({ type: 'activity' }).catch(() => {}); } catch (_) {}
  }
  document.addEventListener('keydown', ping, { passive: true });
  document.addEventListener('mousemove', ping, { passive: true });
  document.addEventListener('scroll', ping, { passive: true });

  // ─── AI Assist: Shadow DOM UI ───
  const MIN_TEXT_LENGTH = 5;
  let hostEl = null;
  let shadowRoot = null;
  let btnEl = null;
  let popupEl = null;
  let selectedText = '';
  let aiLoading = false;

  function ensureShadowHost() {
    if (hostEl && document.body.contains(hostEl)) return;
    hostEl = document.createElement('div');
    hostEl.id = 'syncbridge-ai-host';
    hostEl.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    document.body.appendChild(hostEl);
    shadowRoot = hostEl.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      * { margin:0; padding:0; box-sizing:border-box; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
      .sb-btn {
        position:fixed; pointer-events:auto; cursor:pointer;
        display:inline-flex; align-items:center; gap:4px;
        padding:6px 12px; border-radius:20px;
        background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff;
        font-size:13px; font-weight:600; border:none; outline:none;
        box-shadow:0 4px 14px rgba(99,102,241,0.4);
        transition:transform 0.15s,box-shadow 0.15s;
        z-index:2147483647;
      }
      .sb-btn:hover { transform:scale(1.05); box-shadow:0 6px 20px rgba(99,102,241,0.5); }
      .sb-loading {
        position:fixed; pointer-events:auto;
        display:flex; align-items:center; gap:6px;
        padding:8px 16px; border-radius:12px;
        background:#1e1b4b; color:#c7d2fe;
        font-size:12px; font-weight:500;
        box-shadow:0 4px 14px rgba(0,0,0,0.3);
        z-index:2147483647;
      }
      .sb-loading .dot { display:inline-block; width:6px; height:6px; border-radius:50%; background:#818cf8; animation:sb-bounce 1.4s infinite ease-in-out both; }
      .sb-loading .dot:nth-child(1) { animation-delay:-0.32s; }
      .sb-loading .dot:nth-child(2) { animation-delay:-0.16s; }
      @keyframes sb-bounce { 0%,80%,100%{transform:scale(0)} 40%{transform:scale(1)} }
      .sb-popup {
        position:fixed; pointer-events:auto;
        width:340px; max-height:420px; overflow-y:auto;
        background:#fff; border-radius:12px;
        box-shadow:0 10px 40px rgba(0,0,0,0.2),0 0 0 1px rgba(0,0,0,0.05);
        z-index:2147483647; padding:0;
      }
      .sb-popup-header {
        padding:14px 16px 10px; border-bottom:1px solid #f1f5f9;
        background:linear-gradient(135deg,#6366f1,#8b5cf6);
        border-radius:12px 12px 0 0; color:#fff;
      }
      .sb-popup-header h3 { font-size:13px; font-weight:700; margin-bottom:2px; }
      .sb-popup-header p { font-size:11px; opacity:0.85; }
      .sb-section { padding:12px 16px; }
      .sb-section-title { font-size:11px; font-weight:700; color:#6366f1; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px; }
      .sb-translation { font-size:13px; color:#1e293b; line-height:1.5; margin-bottom:4px; }
      .sb-intent { font-size:11px; color:#64748b; margin-bottom:0; }
      .sb-divider { height:1px; background:#f1f5f9; margin:0; }
      .sb-reply {
        pointer-events:auto; cursor:pointer; display:block; width:100%;
        text-align:left; padding:10px 16px; border:none; background:none;
        transition:background 0.15s; border-bottom:1px solid #f8fafc;
      }
      .sb-reply:hover { background:#f8fafc; }
      .sb-reply:last-child { border-bottom:none; border-radius:0 0 12px 12px; }
      .sb-reply-label { font-size:12px; font-weight:600; color:#1e293b; margin-bottom:2px; }
      .sb-reply-text { font-size:11px; color:#64748b; line-height:1.4; }
      .sb-reply-hint { font-size:10px; color:#a5b4fc; margin-top:2px; }
      .sb-copied {
        position:fixed; pointer-events:none;
        padding:6px 14px; border-radius:8px;
        background:#10b981; color:#fff;
        font-size:12px; font-weight:600;
        box-shadow:0 4px 14px rgba(16,185,129,0.3);
        z-index:2147483647;
        animation:sb-fade 1.5s ease-out forwards;
      }
      @keyframes sb-fade { 0%{opacity:1;transform:translateY(0)} 100%{opacity:0;transform:translateY(-10px)} }
    `;
    shadowRoot.appendChild(style);
  }

  function cleanup() {
    if (btnEl) { btnEl.remove(); btnEl = null; }
    if (popupEl) { popupEl.remove(); popupEl = null; }
    selectedText = '';
  }

  function clampPosition(x, y, elWidth, elHeight) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (x + elWidth > vw - 8) x = vw - elWidth - 8;
    if (y + elHeight > vh - 8) y = vh - elHeight - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    return { x, y };
  }

  function showButton(x, y) {
    ensureShadowHost();
    cleanup();
    btnEl = document.createElement('button');
    btnEl.className = 'sb-btn';
    btnEl.innerHTML = '✨ AI';
    const pos = clampPosition(x + 8, y + 8, 80, 32);
    btnEl.style.left = pos.x + 'px';
    btnEl.style.top = pos.y + 'px';
    btnEl.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); onAiClick(pos.x, pos.y); });
    shadowRoot.appendChild(btnEl);
  }

  function showLoading(x, y) {
    if (btnEl) { btnEl.remove(); btnEl = null; }
    const el = document.createElement('div');
    el.className = 'sb-loading';
    el.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>&nbsp;วิเคราะห์...';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    shadowRoot.appendChild(el);
    return el;
  }

  function showPopup(x, y, data) {
    ensureShadowHost();
    popupEl = document.createElement('div');
    popupEl.className = 'sb-popup';
    const pos = clampPosition(x, y, 340, 400);
    popupEl.style.left = pos.x + 'px';
    popupEl.style.top = pos.y + 'px';

    let html = `
      <div class="sb-popup-header">
        <h3>🤖 AI 상담 어시스턴트</h3>
        <p>환자 메시지 분석 결과</p>
      </div>
      <div class="sb-section">
        <div class="sb-section-title">🇰🇷 한국어 번역</div>
        <div class="sb-translation">${escHtml(data.translation_ko || '')}</div>
        <div class="sb-intent">💡 ${escHtml(data.intent || '')}</div>
      </div>
      <div class="sb-divider"></div>
      <div class="sb-section" style="padding-bottom:4px">
        <div class="sb-section-title">💬 추천 답변 (클릭 시 복사)</div>
      </div>
    `;

    popupEl.innerHTML = html;

    (data.replies || []).forEach((r) => {
      const btn = document.createElement('button');
      btn.className = 'sb-reply';
      btn.innerHTML = `<div class="sb-reply-label">${escHtml(r.label)}</div><div class="sb-reply-text">${escHtml(r.text)}</div><div class="sb-reply-hint">คลิกเพื่อคัดลอก</div>`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        copyAndClose(r.text, parseFloat(popupEl.style.left), parseFloat(popupEl.style.top) + 40);
      });
      popupEl.appendChild(btn);
    });

    shadowRoot.appendChild(popupEl);
  }

  function copyAndClose(text, x, y) {
    navigator.clipboard.writeText(text).catch(() => {});
    cleanup();
    const toast = document.createElement('div');
    toast.className = 'sb-copied';
    toast.textContent = 'คัดลอกแล้ว ✓';
    toast.style.left = x + 'px';
    toast.style.top = y + 'px';
    shadowRoot.appendChild(toast);
    setTimeout(() => toast.remove(), 1500);
  }

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  async function onAiClick(x, y) {
    if (!selectedText || aiLoading) return;
    aiLoading = true;
    const loadingEl = showLoading(x, y);
    try {
      const result = await chrome.runtime.sendMessage({ type: 'ai_assist', text: selectedText });
      loadingEl.remove();
      if (result?.translation_ko) {
        showPopup(x, y, result);
      } else {
        cleanup();
      }
    } catch (_) {
      loadingEl.remove();
      cleanup();
    } finally {
      aiLoading = false;
    }
  }

  // 드래그 감지
  document.addEventListener('mouseup', (e) => {
    setTimeout(() => {
      const sel = window.getSelection();
      const text = (sel?.toString() || '').trim();
      // 빈 텍스트나 공백만 있으면 무시
      if (text.length > MIN_TEXT_LENGTH && text.replace(/\s/g, '').length > 0) {
        selectedText = text;
        showButton(e.clientX, e.clientY);
      } else {
        // 선택이 없거나 너무 짧으면 버튼 숨김
        if (!sel || sel.toString().trim().length <= MIN_TEXT_LENGTH) {
          cleanup();
        }
      }
    }, 10);
  }, { passive: true });

  // 외부 클릭 시 닫기 (Shadow DOM 내부 클릭은 제외)
  document.addEventListener('mousedown', (e) => {
    if (!btnEl && !popupEl) return;
    // Shadow DOM 내부 클릭인지 확인 (composedPath 사용)
    const path = e.composedPath();
    if (path.some((el) => el === hostEl || el?.shadowRoot === shadowRoot)) return;
    cleanup();
  }, { passive: true });
})();
