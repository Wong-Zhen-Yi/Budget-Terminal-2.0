import { contextBridge, ipcRenderer } from 'electron'
import { createApi } from './shared/createApi.js'

const api = createApi(
  (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  <Payload>(channel: string, listener: (payload?: Payload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload?: Payload) => listener(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  process.platform,
)

contextBridge.exposeInMainWorld('api', api)
