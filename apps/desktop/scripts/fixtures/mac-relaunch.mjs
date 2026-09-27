import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

const userData = join(process.env.APPDATA, 'userData')
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
await import('../../out/main/main.js')

if (process.env.BUDGET_PROBE_PRIMARY === '1') {
  const timer = setTimeout(() => {
    console.error('Timed out waiting for macOS relaunch')
    app.exit(1)
  }, 30_000)

  app.whenReady().then(() => {
    const poll = setInterval(() => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) return
      clearInterval(poll)
      const close = () => {
        window.close()
        console.log('CLOSED')
      }
      if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', close)
      else close()
    }, 20)
  })

  app.on('second-instance', () => {
    const poll = setInterval(async () => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window || !window.isVisible() || window.webContents.isLoadingMainFrame()) return
      clearInterval(poll)
      clearTimeout(timer)
      try {
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
