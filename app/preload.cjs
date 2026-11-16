const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadConfig: () => ipcRenderer.invoke('cfg:load'),
  saveConfig: (cfg) => ipcRenderer.invoke('cfg:save', cfg),
  status: () => ipcRenderer.invoke('acc:status'),
  openWindow: (id) => ipcRenderer.invoke('acc:open', id),
  closeWindow: (id) => ipcRenderer.invoke('acc:close', id),
  openAll: () => ipcRenderer.invoke('acc:openAll'),
  closeAll: () => ipcRenderer.invoke('acc:closeAll'),
  todayPlan: () => ipcRenderer.invoke('plan:today'),
  runOnce: (id) => ipcRenderer.invoke('run:once', id),
  stopRun: (id) => ipcRenderer.invoke('run:stop', id),
  getState: () => ipcRenderer.invoke('state:get'),
  setAuto: (on) => ipcRenderer.invoke('auto:set', on),
  onLog: (cb) => ipcRenderer.on('log', (_e, msg) => cb(msg)),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, data) => cb(data))
});
