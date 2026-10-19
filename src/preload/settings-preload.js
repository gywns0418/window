/**
 * 설정 창 preload. 렌더러에는 필요한 IPC 호출만 노출한다(Node API 노출 없음).
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snipApi', {
  getState: () => ipcRenderer.invoke('settings:get'),
  setShortcut: (accelerator) => ipcRenderer.invoke('settings:set-shortcut', accelerator),
  resetShortcut: () => ipcRenderer.invoke('settings:reset-shortcut'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('settings:set-auto-launch', !!enabled),
  setLaunchTarget: (value) => ipcRenderer.invoke('settings:set-launch-target', String(value)),
  setNotifications: (enabled) => ipcRenderer.invoke('settings:set-notifications', !!enabled),
  setAutoNewCapture: (enabled) => ipcRenderer.invoke('settings:set-auto-new-capture', !!enabled),
  suspendShortcut: () => ipcRenderer.invoke('shortcut:suspend'),
  resumeShortcut: () => ipcRenderer.invoke('shortcut:resume'),
  openSnip: () => ipcRenderer.invoke('snip:open'),
  openSettingsFolder: () => ipcRenderer.invoke('app:open-settings-folder'),
  onStateChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state:changed', listener);
    return () => ipcRenderer.removeListener('state:changed', listener);
  }
});
