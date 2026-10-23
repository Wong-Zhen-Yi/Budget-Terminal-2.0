import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AUTOMATIC_BACKUP_FILENAME } from '../services/automaticBackup.js'
import type { Envelope, MaintenanceAction, MaintenanceResult, StoredDataVerification, WindowAction } from '../shared/contract.js'
import { CHANNELS } from '../shared/contract.js'
import { ok } from '../shared/envelope.js'
import { yahooProvider } from '../services/provider.js'
import { verifyStoredData, watchPortfolios } from '../services/portfolioStore.js'
import { isSafeExternalUrl } from '../services/urls.js'
import { registerServiceHandlers } from './serviceHandlers.js'
import { cancelMcpCall, configureMcp, getMcpStatus, testMcpConnection } from '../mcp/host.js'
import { publishSavedDataChanged, subscribeSavedDataChanged } from '../services/savedDataEvents.js'
import { articleFilename } from '../shared/articles.js'
import { articlePdfRequestSchema, writeArticlePdfs } from '../services/articlePdf.js'
import { agentsCommand, agentsImage, agentsStatus, closeAgents } from '../services/agentsHost.js'
import type { AgentsCommand } from '../shared/agents.js'
import { rendererCacheFlushed } from '../services/rendererCacheShutdown.js'
import { notificationsStatus, notificationsCommand, onNotificationClick } from '../services/notificationsHost.js'
import type { NotificationCommand } from '../shared/notifications.js'

export function registerIpcHandlers(isTrustedSender: (event: IpcMainInvokeEvent) => boolean): () => void {
  const handle: typeof ipcMain.handle = (channel, listener) => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender')
      return listener(event, ...args)
    })
  }
  const provider = yahooProvider
  handle(CHANNELS.browserControl, async (_event, request) => (await import('../services/browser.js')).browserControl(request))
  handle(CHANNELS.browserViewport, async (_event, viewport) => (await import('../services/browser.js')).setBrowserViewport(viewport))
  handle(CHANNELS.agentsStatus, () => agentsStatus())
  handle(CHANNELS.notificationsStatus, () => notificationsStatus())
  handle(CHANNELS.notificationsCommand, (_event, command: NotificationCommand) => notificationsCommand(command))
  onNotificationClick(() => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(CHANNELS.notificationClicked)
  })
  handle(CHANNELS.agentsCommand, (_event, command: AgentsCommand) => agentsCommand(command))
  handle(CHANNELS.agentsImage, (_event, id: string) => agentsImage(id))
  handle(CHANNELS.mcpStatus, () => getMcpStatus())
  handle(CHANNELS.configureMcp, (_event, policy: unknown) => configureMcp(policy))
  handle(CHANNELS.testMcpConnection, () => testMcpConnection())
  handle(CHANNELS.cancelMcpCall, (_event, id: number) => cancelMcpCall(id))
  registerServiceHandlers((channel, run) => {
    handle(channel, (_event, request) => run(request))
  })

  handle(CHANNELS.verifyStoredData, async (_event, request: StoredDataVerification): Promise<Envelope<boolean>> =>
    ok(await verifyStoredData(request), 'portfolio store'),
  )

  /**
   * The User Data buttons. The renderer has already confirmed the destructive ones, so
   * all that is left here is resolving a path — dismissing the dialog is a normal
   * outcome and comes back as `performed: false`, not an error.
   */
  handle(
    CHANNELS.maintenance,
    async (event, action: MaintenanceAction): Promise<Envelope<MaintenanceResult>> => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const notify = async (pending: Promise<Envelope<MaintenanceResult>>) => {
        const result = await pending
        if (result.data.performed) publishSavedDataChanged(
          action === 'importUserData' || action === 'clearUserData'
            ? ['articles', 'portfolio', 'cards', 'personalFinance', 'settings'] : ['settings'],
        )
        return result
      }
      const cancelled = (message: string) =>
        ok({ action, performed: false, message, path: '' }, 'settings store')

      if (action === 'exportUserData') {
        const options = {
          title: 'Export User Data',
          defaultPath: join(app.getPath('downloads'), AUTOMATIC_BACKUP_FILENAME),
          filters: [{ name: 'JSON files', extensions: ['json'] }],
        }
        const result = window
          ? await dialog.showSaveDialog(window, options)
          : await dialog.showSaveDialog(options)
        if (result.canceled || !result.filePath) return cancelled('Export cancelled.')
        return notify(provider.exportUserData(result.filePath))
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
        return notify(provider.importUserData(selected))
      }

      if (action === 'clearUserData') return notify(provider.clearUserData())
      if (action === 'resetCache') return notify(provider.resetCache())
      throw new Error('Unknown maintenance action')
    },
  )

  handle(CHANNELS.openExternal, async (_event, url: string) => {
    if (!isSafeExternalUrl(url)) return
    await shell.openExternal(url)
  })

  handle(
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

  handle(CHANNELS.writeClipboard, (_event, contents: string) => {
    clipboard.writeText(contents)
  })

  handle(CHANNELS.exportArticlesPdf, async (event, value: unknown) => {
    const request = articlePdfRequestSchema.parse(value)
    const window = BrowserWindow.fromWebContents(event.sender)
    let destination: string | undefined
    if (request.all) {
      const options = { title: 'Export all Articles as individual PDFs', properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
      if (!result.canceled) destination = result.filePaths[0]
    } else {
      const options = { title: 'Export article as PDF', defaultPath: articleFilename(request.articles[0].title), filters: [{ name: 'PDF document', extensions: ['pdf'] }] }
      const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
      if (!result.canceled) destination = result.filePath
    }
    if (!destination) return ok({ cancelled: true, paths: [], failures: [] }, 'article PDF export')
    return ok(await writeArticlePdfs(request, destination), 'article PDF export')
  })

  handle(CHANNELS.rendererCacheFlushed, event => rendererCacheFlushed(event.sender))

  handle(CHANNELS.windowControl, (event, action: WindowAction) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (action === 'minimize') window.minimize()
    else if (action === 'close') window.close()
    else if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })

  const stopWatching = watchPortfolios(() => {
    publishSavedDataChanged(['portfolio', 'personalFinance'])
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(CHANNELS.portfolioChanged)
    }
  })

  const stopSavedData = subscribeSavedDataChanged((payload) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(CHANNELS.savedDataChanged, payload)
  })

  return () => {
    onNotificationClick(null)
    closeAgents()
    stopWatching()
    stopSavedData()
    for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel)
  }
}
