/**
 * SyncBridge Background Service Worker
 * - Activity Ping (10분 미활동 → 자리비움)
 * - Task Badge 업데이트
 * - AI Assist (드래그 텍스트 분석)
 */

const IDLE_MS = 10 * 60 * 1000;
let idleTimer = null;

function clearIdleTimer() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}

function scheduleIdleCheck() {
  clearIdleTimer();
  idleTimer = setTimeout(async () => {
    const data = await chrome.storage.local.get([
      'syncbridge_userId', 'syncbridge_accessToken',
      'syncbridge_url', 'syncbridge_anonKey', 'syncbridge_lastStatus',
    ]);
    const { syncbridge_userId, syncbridge_accessToken, syncbridge_url, syncbridge_anonKey, syncbridge_lastStatus } = data;
    if (!syncbridge_userId || !syncbridge_accessToken || !syncbridge_url || !syncbridge_anonKey || syncbridge_lastStatus !== 'online') return;
    try {
      const res = await fetch(`${syncbridge_url}/rest/v1/time_logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: syncbridge_anonKey, Authorization: `Bearer ${syncbridge_accessToken}`, Prefer: 'return=minimal' },
        body: JSON.stringify({ worker_id: syncbridge_userId, status: 'away' }),
      });
      if (res.ok) await chrome.storage.local.set({ syncbridge_lastStatus: 'away' });
    } catch (_) {}
  }, IDLE_MS);
}

chrome.storage.local.get(['syncbridge_lastStatus'], (data) => {
  if (data.syncbridge_lastStatus === 'online') scheduleIdleCheck();
});

async function updateBadge() {
  const { syncbridge_userId, syncbridge_url, syncbridge_anonKey, syncbridge_accessToken } = await chrome.storage.local.get([
    'syncbridge_userId', 'syncbridge_url', 'syncbridge_anonKey', 'syncbridge_accessToken',
  ]);
  if (!syncbridge_userId || !syncbridge_url || !syncbridge_anonKey) { chrome.action.setBadgeText({ text: '' }); return; }
  try {
    const res = await fetch(`${syncbridge_url}/rest/v1/tasks?assignee_id=eq.${syncbridge_userId}&status=eq.pending&select=id`, {
      headers: { apikey: syncbridge_anonKey, Authorization: `Bearer ${syncbridge_accessToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      chrome.action.setBadgeText({ text: data?.length > 0 ? String(data.length) : '' });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    }
  } catch (_) {}
}

setInterval(updateBadge, 30000);
updateBadge();

// AI Assist: content.js → background → Next.js API
async function handleAiAssist(text) {
  const { syncbridge_webUrl } = await chrome.storage.local.get('syncbridge_webUrl');
  const webUrl = syncbridge_webUrl || 'http://localhost:3000';

  try {
    const res = await fetch(`${webUrl}/api/ai-assist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (res.ok) return await res.json();
    return mockAiResponse(text);
  } catch (_) {
    return mockAiResponse(text);
  }
}

function mockAiResponse(text) {
  return {
    translation_ko: `[번역] ${text.slice(0, 80)}`,
    intent: '환자 문의 (오프라인 모드)',
    replies: [
      { label: 'ขอบคุณครับ', text: 'ขอบคุณที่ติดต่อมาครับ ทางเราจะตรวจสอบและแจ้งกลับโดยเร็วที่สุดครับ' },
      { label: 'รอสักครู่', text: 'กรุณารอสักครู่นะครับ ทางเราจะตรวจสอบข้อมูลให้ครับ' },
      { label: 'สอบถามเพิ่มเติม', text: 'สามารถให้ข้อมูลเพิ่มเติมได้ไหมครับ เพื่อให้ทางเราช่วยเหลือได้ดียิ่งขึ้นครับ' },
    ],
  };
}

// Unified message listener
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'activity') {
    scheduleIdleCheck();
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === 'task_updated') {
    updateBadge();
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === 'ai_assist') {
    handleAiAssist(msg.text).then((result) => sendResponse(result)).catch(() => sendResponse(mockAiResponse(msg.text)));
    return true; // keep channel open for async
  }
  return false;
});
