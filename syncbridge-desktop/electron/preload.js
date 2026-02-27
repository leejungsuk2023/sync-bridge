const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  storageGet: (keys) => ipcRenderer.invoke('storage:get', keys),
  storageSet: (items) => ipcRenderer.invoke('storage:set', items),
  storageRemove: (keys) => ipcRenderer.invoke('storage:remove', keys),
  sendMessage: (msg) => ipcRenderer.invoke('ipc:message', msg),
  getVersion: () => ipcRenderer.invoke('app:version'),
  showNotification: (data) => ipcRenderer.invoke('show-notification', data),
});
