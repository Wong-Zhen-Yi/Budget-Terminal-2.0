import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

// Deliberately sends one real desktop notification. Records use an isolated profile;
// Windows registration points to the real app so its shortcut remains usable.
const require = createRequire(import.meta.url)
const directory = await mkdtemp(join(tmpdir(), 'budget-notifications-native-'))
try {
  await build({ entryPoints: [resolve(import.meta.dirname, '../electron/services/notificationsHost.ts')], bundle: true,
    platform: 'node', format: 'cjs', external: ['electron'], outfile: join(directory, 'host.cjs'), logLevel: 'silent' })
  await writeFile(join(directory, 'main.cjs'), `
    const { app, shell } = require('electron')
    const path = require('node:path')
    app.setName('Budget Terminal')
    app.setAppPath(${JSON.stringify(resolve(import.meta.dirname, '..'))})
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    ${process.env.APPDATA ? `app.setPath('appData', ${JSON.stringify(process.env.APPDATA)})` : ''}
    app.whenReady().then(async () => {
      const host = require('./host.cjs')
      try {
        host.configureDesktopNotifications()
        if (host.notificationCenter.setupError) throw Error(host.notificationCenter.setupError)
        if (process.platform === 'win32') {
          const link = shell.readShortcutLink(path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Budget Terminal.lnk'))
          if (link.appUserModelId !== host.NOTIFICATION_APP_ID || !link.args.includes(app.getAppPath())) throw Error('Incorrect Windows notification registration')
        }
        const result = await host.notificationsCommand({ type: 'test' })
        if (result.errors.length) throw Error(result.errors[0].reason)
        const test = result.data.notifications[0]
        console.log('Native delivery: ' + test.desktopStatus + (test.deliveryError ? ' · ' + test.deliveryError : ''))
        if (test.desktopStatus !== 'shown') throw Error('Native delivery was not confirmed')
        console.log('PASS: real Electron notification show event, Windows identity and usable Start Menu shortcut, isolated saved inbox')
        await new Promise(resolve => setTimeout(resolve, 1500))
        await host.closeNotifications()
        app.exit(0)
      } catch (error) { console.error(error); await host.closeNotifications(); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const output = await new Promise<{ code: number | null; text: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let text = ''
    child.stdout.on('data', chunk => { text += chunk }); child.stderr.on('data', chunk => { text += chunk })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Native notification probe timed out')) }, 20_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, text }) })
  })
  console.log(output.text.trim())
  assert.equal(output.code, 0, output.text)
} finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
