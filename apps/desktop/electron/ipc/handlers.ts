import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { Envelope, MaintenanceAction, MaintenanceResult, WindowAction } from '../shared/contract.js'
import { CHANNELS } from '../shared/contract.js'
import { ok } from '../shared/envelope.js'
import { yahooProvider } from '../services/provider.js'
import { watchPortfolios } from '../services/portfolioStore.js'
import { isSafeExternalUrl } from '../services/urls.js'
import { registerServiceHandlers } from './serviceHandlers.js'

export function registerIpcHandlers(): () => void {
  const provider = yahooProvider
  registerServiceHandlers((channel, run) => {
    ipcMain.handle(channel, (_event, request) => run(request))
  })

  /**
   * The User Data buttons. The renderer has already confirmed the destructive ones, so
   * all that is left here is resolving a path — dismissing the dialog is a normal
   * outcome and comes back as `performed: false`, not an error.
   */
  ipcMain.handle(
    CHANNELS.maintenance,
    async (event, action: MaintenanceAction): Promise<Envelope<MaintenanceResult>> => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const cancelled = (message: string) =>
        ok({ action, performed: false, message, path: '' }, 'settings store')

      if (action === 'exportUserData') {
        const options = {
          title: 'Export User Data',
          defaultPath: `budget-terminal-backup-${new Date().toISOString().slice(0, 10)}.json`,
          filters: [{ name: 'JSON files', extensions: ['json'] }],
        }
        const result = window
          ? await dialog.showSaveDialog(window, options)
          : await dialog.showSaveDialog(options)
        if (result.canceled || !result.filePath) return cancelled('Export cancelled.')
        return provider.exportUserData(result.filePath)
      }

      if (action === 'importUserData') {
        const options = {
          title: 'Import User Data',
          properties: ['openFile' as const],
          filters: [{ name: 'JSON files', extensions: ['json'] }],
        }
        const result = window
          ? await dialog.showOpenDialog(window, options)
          : await dialog.showOpenDialog(options)
        const [selected] = result.filePaths
        if (result.canceled || !selected) return cancelled('Import cancelled.')
        return provider.importUserData(selected)
      }

      if (action === 'clearUserData') return provider.clearUserData()
      return provider.resetCache()
    },
  )

  ipcMain.handle(CHANNELS.openExternal, async (_event, url: string) => {
    if (!isSafeExternalUrl(url)) return
    await shell.openExternal(url)
  })

  ipcMain.handle(
    CHANNELS.saveText,
    async (event, suggestedName: string, contents: string): Promise<string | null> => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const result = window
        ? await dialog.showSaveDialog(window, { defaultPath: suggestedName })
        : await dialog.showSaveDialog({ defaultPath: suggestedName })
      if (result.canceled || !result.filePath) return null
      await writeFile(result.filePath, contents, 'utf8')
      return result.filePath
    },
  )

  ipcMain.handle(CHANNELS.writeClipboard, (_event, contents: string) => {
    clipboard.writeText(contents)
  })

  ipcMain.handle(CHANNELS.windowControl, (event, action: WindowAction) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (action === 'minimize') window.minimize()
    else if (action === 'close') window.close()
    else if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })

  const stopWatching = watchPortfolios(() => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(CHANNELS.portfolioChanged)
    }
  })

  return () => {
    stopWatching()
    for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel)
  }
}
