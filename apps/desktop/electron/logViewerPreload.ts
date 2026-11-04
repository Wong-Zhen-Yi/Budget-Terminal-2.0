import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('logs', {
  read: () => ipcRenderer.invoke('logs:read'),
  export: () => ipcRenderer.invoke('logs:export'),
  folder: () => ipcRenderer.invoke('logs:folder'),
})
