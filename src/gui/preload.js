'use strict';

/**
 * 预加载脚本：通过 contextBridge 安全地向渲染进程暴露受限的 IPC API。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 游戏
  getStatus: () => ipcRenderer.invoke('game:state'),
  startGame: () => ipcRenderer.invoke('game:start'),
  ask: (question) => ipcRenderer.invoke('game:ask', question),
  hint: () => ipcRenderer.invoke('game:hint'),
  finish: (reason) => ipcRenderer.invoke('game:finish', reason),
  // 配置
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (values) => ipcRenderer.invoke('config:save', values),
  testConnection: (values) => ipcRenderer.invoke('config:test', values),
  getProviders: () => ipcRenderer.invoke('config:providers'),
});
