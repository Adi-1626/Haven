const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('capture', { sources: () => ipcRenderer.invoke('capture:sources'), select: (id, audio = false) => ipcRenderer.send('capture:select', { id, audio }) });
