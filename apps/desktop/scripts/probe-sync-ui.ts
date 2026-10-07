import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-sync-ui-'))
const screenshot = join(root, 'out', 'sync-smoke.png')
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find((file) => file.endsWith('.css'))
  assert.ok(css, 'Run npm run build first')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { PersonalSyncPanel } from './src/components/settings/PersonalSyncPanel'
      const settle = () => new Promise(resolve => setTimeout(resolve, 150))
      const check = (condition, message) => { if (!condition) throw Error(message) }
      const button = text => [...document.querySelectorAll('button')].find(el => el.textContent === text)
      const fill = (name, value) => {
        const el = document.querySelector('[aria-label="' + name + '"]')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      window.runProbe = async () => {
        createRoot(document.getElementById('root')).render(<PersonalSyncPanel />)
        await settle()
        check(button('Create account').disabled, 'Empty signup should be disabled')
        fill('Sync email', 'sync-fixture@example.com'); fill('Sync password', 'fixture-password')
        await settle()
        check(!button('Create account').disabled, 'Valid signup should be enabled')
        button('Sign in').click(); await settle()
        check(document.body.innerText.includes('sync-fixture@example.com'), 'Signed-in identity is missing')
        check(document.body.innerText.includes('Pending: Cards'), 'Pending changes are missing')
        check(button('Use cloud copy'), 'Conflict controls are missing')
        document.querySelector('summary').click(); await settle()
        check(document.querySelectorAll('pre').length === 2, 'Both copies should be reviewable')
      }
      window.finishProbe = async () => {
        button('Use cloud copy').click(); await settle()
        check(!button('Use cloud copy'), 'Resolved conflict remains visible')
        button('Sync now / Retry').click(); await settle()
        check(document.body.innerText.includes('Fixture offline'), 'Sync failures are hidden')
        button('Sign out').click(); await settle()
        check(document.querySelector('[aria-label="Sync password"]').value === '', 'Password retained after sign-out')
        check(button('Sign in'), 'Sign-in controls not restored')
      }
    ` },
    bundle: true, format: 'iife', write: false, jsx: 'automatic',
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
  })
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), '<link rel="stylesheet" href="theme.css"><body style="background:#080b12;padding:24px"><div id="root"></div><script src="renderer.js"></script>')
  await writeFile(join(directory, 'preload.cjs'), `
    const { contextBridge, ipcRenderer } = require('electron')
    contextBridge.exposeInMainWorld('api', {
      syncStatus: () => ipcRenderer.invoke('status'),
      syncAction: action => ipcRenderer.invoke('action', action),
      onSyncChanged: callback => { const listener = (_, status) => callback(status); ipcRenderer.on('changed', listener); return () => ipcRenderer.removeListener('changed', listener) }
    })
  `)
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow, ipcMain } = require('electron')
    const assert = require('node:assert/strict')
    const fs = require('node:fs')
    let status = { email: null, state: 'signedOut', pending: [], conflicts: [] }
    const envelope = () => ({ data: status, meta: {}, errors: [] })
    ipcMain.handle('status', envelope)
    ipcMain.handle('action', (_, action) => {
      if (action.type === 'signIn') {
        assert.equal(action.email, 'sync-fixture@example.com'); assert.equal(action.password, 'fixture-password')
        status = { email: action.email, state: 'conflict', pending: ['cards'], lastSyncedAt: new Date().toISOString(),
          conflicts: [{ token: 'a'.repeat(64), dataset: 'cards', local: { customCards: ['Local strategy'] }, cloud: { customCards: ['Cloud strategy'] }, updatedAt: new Date().toISOString() }] }
      } else if (action.type === 'resolve') { assert.equal(action.choice, 'cloud'); assert.equal(action.token, 'a'.repeat(64)); status = { ...status, state: 'ready', pending: [], conflicts: [] } }
      else if (action.type === 'sync') status = { ...status, state: 'error', message: 'Fixture offline: your edits remain saved.' }
      else if (action.type === 'signOut') status = { email: null, state: 'signedOut', pending: [], conflicts: [] }
      return envelope()
    })
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { preload: ${JSON.stringify(join(directory, 'preload.cjs'))}, contextIsolation: true, sandbox: true } })
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        await window.webContents.executeJavaScript('window.runProbe()')
        fs.writeFileSync(${JSON.stringify(screenshot)}, (await window.webContents.capturePage()).toPNG())
        await window.webContents.executeJavaScript('window.finishProbe()')
        console.log('PASS: sign-in form, account status, pending edits, conflict comparison, cloud choice, retry errors and sign-out')
        app.exit(0)
      } catch (error) { console.error(error); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (data) => { output += data })
    child.stderr.on('data', (data) => { output += data })
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Sync UI probe timed out: ' + output)) }, 30_000)
    child.on('error', (error) => { clearTimeout(timeout); reject(error) })
    child.on('exit', (code) => { clearTimeout(timeout); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log('Screenshot: ' + screenshot)
} finally {
  assert.ok(!relative(tmpdir(), directory).startsWith('..'))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
