/**
 * Platform abstraction layer
 * Electron: window.electronAPI (via preload.js)
 * Chrome Extension: chrome.storage / chrome.runtime
 */

const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

export const storage = {
  async get(keys) {
    if (isElectron) {
      return window.electronAPI.storageGet(keys);
    }
    return new Promise((resolve) => {
      chrome.storage?.local?.get(keys, (data) => resolve(data || {}));
    });
  },

  async set(items) {
    if (isElectron) {
      return window.electronAPI.storageSet(items);
    }
    return chrome.storage?.local?.set(items);
  },

  async remove(keys) {
    if (isElectron) {
      return window.electronAPI.storageRemove(keys);
    }
    return chrome.storage?.local?.remove(keys);
  },
};

export function sendMessage(msg) {
  if (isElectron) {
    return window.electronAPI.sendMessage(msg);
  }
  return chrome.runtime?.sendMessage?.(msg);
}

export function showNotification({ title, body }) {
  if (isElectron) {
    return window.electronAPI.showNotification({ title, body });
  }
}
