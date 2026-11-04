import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { diagnosticDirectory, readDiagnosticLogs } from './services/diagnosticLog.js'

// Independent Electron entry: no app services, provider requests, data-session lock or main-window imports.
// This text-only window does not need GPU rendering or the GPU's shared disk caches.
app.disableHardwareAcceleration()
app.setName('Budget Terminal Logs')
const profile = join(app.getPath('appData'), 'BudgetTerminalLogViewer')
app.setPath('userData', profile)
app.setPath('sessionData', profile)
const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) app.quit()
let viewer: BrowserWindow | null = null
function revealViewer(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (viewer.isMinimized()) viewer.restore()
  viewer.show()
  viewer.focus()
}
if (ownsInstance) app.on('second-instance', revealViewer)
const directory = diagnosticDirectory()
const dirname = fileURLToPath(new URL('.', import.meta.url))
const html = join(dirname, '../../resources/log-viewer.html')
if (ownsInstance) app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1250, height: 820, minWidth: 580, minHeight: 460,
    show: false,
    title: 'Budget Terminal — Diagnostic Logs', backgroundColor: '#0b111b', autoHideMenuBar: true,
    webPreferences: { preload: join(dirname, '../preload/logViewer.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } })
  viewer = window
  window.once('ready-to-show', revealViewer)
  window.once('closed', () => { viewer = null })
  const trusted = (event: Electron.IpcMainInvokeEvent) => event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame && pathToFileURL(fileURLToPath(event.senderFrame.url)).href === pathToFileURL(html).href
  const handle = (channel: string, run: () => unknown) => ipcMain.handle(channel, event => {
    if (!trusted(event)) throw new Error('Untrusted log viewer request')
    return run()
  })
  handle('logs:read', () => {
    try { return { ...readDiagnosticLogs(directory), error: '' } }
    catch { return { entries: [], files: 0, bytes: 0, error: 'Cannot read log storage. Check folder permissions.' } }
  })
  handle('logs:folder', async () => {
    const error = await shell.openPath(directory)
    return { error: error ? 'Log folder is unavailable. Start the main app to create it.' : '' }
  })
  handle('logs:export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(window, { title: 'Export diagnostic snapshot',
      defaultPath: `BudgetTerminal-diagnostics-${new Date().toISOString().slice(0, 10)}.jsonl`,
      filters: [{ name: 'Diagnostic JSON Lines', extensions: ['jsonl'] }] })
    if (canceled || !filePath) return { message: 'Export cancelled.' }
    try {
      const { entries } = readDiagnosticLogs(directory)
      await writeFile(filePath, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n', { mode: 0o600 })
      return { message: `Exported ${entries.length} records from the retained snapshot.` }
    } catch { return { message: 'Export failed. Check disk space and file permissions.' } }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  await window.loadFile(html)
  revealViewer()
}).catch(() => { dialog.showErrorBox('Log viewer could not open', 'Rebuild the app and try opening Diagnostic Logs again.'); app.quit() })
app.on('window-all-closed', () => app.quit())
