import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

const userData = join(process.env.APPDATA, 'userData')
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
const downloads = join(process.env.APPDATA, 'Downloads')
mkdirSync(downloads, { recursive: true })
app.setPath('downloads', downloads)
const updated = process.env.BUDGET_PROBE_MODE === 'updated'
const restarted = process.argv.includes('--budget-probe-restarted')
if (updated && process.env.BUDGET_PROBE_PRIMARY !== '1') {
  const requestLock = app.requestSingleInstanceLock.bind(app)
  app.requestSingleInstanceLock = data => requestLock({ ...data, buildFingerprint: `${data.buildFingerprint}-rebuilt` })
}
let restartRequested = false
if (updated && process.env.BUDGET_PROBE_PRIMARY === '1') {
  const relaunch = app.relaunch.bind(app)
  app.relaunch = () => {
    restartRequested = true
    relaunch({ args: process.argv.slice(1).concat('--budget-probe-restarted') })
  }
  app.on('will-quit', () => {
    if (restarted) return
    if (!restartRequested) throw new Error('Updated instance did not request relaunch')
    console.log('RESTART_REQUESTED')
  })
}
await import('../../out/main/main.js')

if (restarted) {
  const marker = join(process.env.APPDATA, 'restarted.json')
  const timer = setTimeout(() => {
    writeFileSync(marker, JSON.stringify({ error: 'Relaunched desktop timed out' }))
    app.exit(1)
  }, 30_000)
  app.whenReady().then(() => {
    const poll = setInterval(async () => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window || window.webContents.isLoadingMainFrame()) return
      clearInterval(poll)
      clearTimeout(timer)
      try {
        const status = await window.webContents.executeJavaScript('window.api.localSendStatus()')
        const settings = await window.webContents.executeJavaScript('window.api.settings()')
        if (status.errors.length || status.data.enabled || settings.data.time12h !== false) {
          throw new Error('Updated desktop did not load LocalSend handlers and persisted settings')
        }
        app.on('will-quit', () => writeFileSync(marker, JSON.stringify({ ok: true })))
        app.quit()
      } catch (error) {
        writeFileSync(marker, JSON.stringify({ error: String(error) }))
        app.exit(1)
      }
    }, 20)
  })
} else if (process.env.BUDGET_PROBE_PRIMARY === '1') {
  let originalWindow
  const timer = setTimeout(() => {
    console.error('Timed out waiting for desktop relaunch')
    app.exit(1)
  }, 30_000)

  app.whenReady().then(() => {
    const poll = setInterval(async () => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window || window.webContents.isLoadingMainFrame()) return
      clearInterval(poll)
      originalWindow = window
      try {
        const status = await window.webContents.executeJavaScript('window.api.localSendStatus()')
        if (status.errors.length || status.data.enabled) throw new Error('LocalSend IPC was not ready at startup')
        const disabled = await window.webContents.executeJavaScript('window.api.localSendAction({ type: "enable", enabled: false })')
        if (disabled.errors.length) throw new Error('LocalSend action IPC is missing')
      } catch (error) { console.error(error); app.exit(1); return }
      if (updated) {
        await window.webContents.executeJavaScript('window.api.mutateSettings({ type: "setTime12h", value: false })')
        window.hide()
        console.log('UPDATED')
      } else if (process.env.BUDGET_PROBE_MODE === 'hidden') {
        window.hide()
        console.log('HIDDEN')
      } else if (process.env.BUDGET_PROBE_MODE === 'minimized') {
        window.show()
        window.minimize()
        console.log('MINIMIZED')
      } else {
        window.close()
        console.log('CLOSED')
      }
    }, 20)
  })

  app.on('second-instance', () => {
    if (updated) { clearTimeout(timer); return }
    const poll = setInterval(async () => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window || !window.isVisible() || window.isMinimized() || window.webContents.isLoadingMainFrame()) return
      clearInterval(poll)
      clearTimeout(timer)
      try {
        if (process.env.BUDGET_PROBE_MODE !== 'closed' && window !== originalWindow) {
          throw new Error('Relaunch replaced the existing window')
        }
        const text = await window.webContents.executeJavaScript('document.getElementById("root")?.innerText')
        if (!text?.includes('BUDGET TERMINAL')) throw new Error('Relaunched window did not render')
        console.log('REOPENED')
        app.exit(0)
      } catch (error) {
        console.error(error)
        app.exit(1)
      }
    }, 20)
  })
}
