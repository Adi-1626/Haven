const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('haven', {
  connectServer: address => ipcRenderer.invoke('server:connect', address),
  getConnection: () => ipcRenderer.invoke('server:current'),
  openBrowserClient: () => ipcRenderer.invoke('client:browser'),
  openTestClient: () => ipcRenderer.invoke('client:test'),
  getDesktopSettings: () => ipcRenderer.invoke('desktop:settings'),
  updateDesktopSettings: patch => ipcRenderer.invoke('desktop:update-settings', patch),
  setShortcutRecording: active => ipcRenderer.invoke('desktop:shortcut-recording', active),
  onDesktopState: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('desktop:state', listener); return () => ipcRenderer.removeListener('desktop:state', listener); },
  onDesktopShortcut: callback => { const listener = (_event, shortcut) => callback(shortcut); ipcRenderer.on('desktop:shortcut', listener); return () => ipcRenderer.removeListener('desktop:shortcut', listener); },
  setVoiceState: state => ipcRenderer.send('desktop:voice-state', state),
  readClientSetting: key => ipcRenderer.sendSync('desktop:client-setting-read', key),
  writeClientSetting: (key, value) => ipcRenderer.send('desktop:client-setting-write', key, value)
});
