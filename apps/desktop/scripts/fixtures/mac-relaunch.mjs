import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

const userData = join(process.env.APPDATA, 'userData')
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
await import('../../out/main/main.js')

if (process.env.BUDGET_PROBE_PRIMARY === '1') {
  let originalWindow
  const timer = setTimeout(() => {
    console.error('Timed out waiting for desktop relaunch')
    app.exit(1)
  }, 30_000)

  app.whenReady().then(() => {
    const poll = setInterval(() => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window || window.webContents.isLoadingMainFrame()) return
      clearInterval(poll)
      originalWindow = window
      if (process.env.BUDGET_PROBE_MODE === 'hidden') {
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
