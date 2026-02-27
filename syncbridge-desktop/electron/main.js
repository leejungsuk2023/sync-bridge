const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, powerMonitor, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

// ── Store (replaces chrome.storage.local) ──
const store = new Store({
  name: 'syncbridge-config',
  defaults: {
    syncbridge_userId: null,
    syncbridge_accessToken: null,
    syncbridge_url: null,
    syncbridge_anonKey: null,
    syncbridge_lastStatus: null,
    syncbridge_statusStartedAt: null,
    syncbridge_webUrl: null,
  },
});

let mainWindow = null;
let tray = null;
let isQuitting = false;

// ── Single instance lock ──
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ── IPC Handlers ──
ipcMain.handle('storage:get', (_event, keys) => {
  if (Array.isArray(keys)) {
    const result = {};
    keys.forEach((k) => { result[k] = store.get(k, null); });
    return result;
  }
  return {};
});

ipcMain.handle('storage:set', (_event, items) => {
  if (items && typeof items === 'object') {
    Object.entries(items).forEach(([k, v]) => store.set(k, v));
  }
});

ipcMain.handle('storage:remove', (_event, keys) => {
  if (Array.isArray(keys)) {
    keys.forEach((k) => store.delete(k));
  }
});

ipcMain.handle('ipc:message', (_event, msg) => {
  if (msg?.type === 'task_updated') {
    updateBadge();
  }
  return { ok: true };
});

ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('show-notification', (_event, { title, body }) => {
  if (Notification.isSupported()) {
    const notif = new Notification({ title, body });
    notif.on('click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    notif.show();
  }
});

// ── Idle Detection (replaces content.js activity + background.js idle timer) ──
const IDLE_THRESHOLD_SECONDS = 600; // 10 minutes

function startIdleDetection() {
  setInterval(async () => {
    const idleSeconds = powerMonitor.getSystemIdleTime();
    const currentStatus = store.get('syncbridge_lastStatus');

    if (idleSeconds >= IDLE_THRESHOLD_SECONDS && currentStatus === 'online') {
      const userId = store.get('syncbridge_userId');
      const token = store.get('syncbridge_accessToken');
      const url = store.get('syncbridge_url');
      const anonKey = store.get('syncbridge_anonKey');

      if (userId && token && url && anonKey) {
        try {
          await fetch(`${url}/rest/v1/time_logs`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: anonKey,
              Authorization: `Bearer ${token}`,
              Prefer: 'return=minimal',
            },
            body: JSON.stringify({ worker_id: userId, status: 'away' }),
          });
          store.set('syncbridge_lastStatus', 'away');
          // Notify renderer about status change
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('status-changed', 'away');
          }
        } catch (_) {}
      }
    }
  }, 60000); // Check every 60 seconds
}

// ── Task Badge (replaces chrome.action.setBadgeText) ──
async function updateBadge() {
  const userId = store.get('syncbridge_userId');
  const url = store.get('syncbridge_url');
  const anonKey = store.get('syncbridge_anonKey');
  const token = store.get('syncbridge_accessToken');

  if (!userId || !url || !anonKey || !token) {
    if (tray) tray.setToolTip('SyncBridge');
    return;
  }

  try {
    const res = await fetch(
      `${url}/rest/v1/tasks?assignee_id=eq.${userId}&status=eq.pending&select=id`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } }
    );
    if (res.ok) {
      const data = await res.json();
      const count = data?.length || 0;
      if (tray) {
        tray.setToolTip(count > 0 ? `SyncBridge - ${count} pending tasks` : 'SyncBridge');
      }
      // Update window badge on macOS
      if (process.platform === 'darwin' && mainWindow) {
        app.setBadgeCount(count);
      }
    }
  } catch (_) {}
}

// ── Create Window ──
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 700,
    minWidth: 380,
    minHeight: 600,
    icon: path.join(__dirname, '../public/icons/icon128.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'default',
    show: false,
  });

  // Dev: Vite dev server, Prod: built files
  const distPath = path.join(__dirname, '../dist/index.html');
  const isDev = process.env.NODE_ENV === 'development' || (!app.isPackaged && !fs.existsSync(distPath));
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(distPath);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Minimize to tray on close (don't quit)
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ── Create Tray ──
function createTray() {
  const iconPath = path.join(__dirname, '../public/icons/icon16.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show SyncBridge',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('SyncBridge');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// ── Auto Update ──
function initAutoUpdater() {
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.checkForUpdatesAndNotify();
    setInterval(() => autoUpdater.checkForUpdatesAndNotify(), 4 * 60 * 60 * 1000);
  } catch (_) {
    // electron-updater not available in dev
  }
}

// ── App Lifecycle ──
app.whenReady().then(() => {
  createWindow();
  createTray();
  startIdleDetection();
  initAutoUpdater();

  // Badge polling every 30 seconds
  setInterval(updateBadge, 30000);
  updateBadge();

  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
