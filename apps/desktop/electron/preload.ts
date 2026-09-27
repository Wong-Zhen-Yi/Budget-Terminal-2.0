import { contextBridge, ipcRenderer } from 'electron'
import { createApi } from './shared/createApi.js'

const api = createApi(
  (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  (channel, listener) => {
    const handler = () => listener()
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  process.platform,
)

contextBridge.exposeInMainWorld('api', api)
