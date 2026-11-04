import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile, mkdir, readdir } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const directory = realpathSync(await mkdtemp(join(tmpdir(), 'budget-settings-logs-ui-')))
const root = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
try {
  const assets = join(root, 'out/renderer/assets')
  const stylesheet = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert(stylesheet, 'Build before running the diagnostics UI probe')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, stylesheet)))
  await build({ entryPoints: [join(root, 'electron/preload.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: join(directory, 'preload.cjs'), logLevel: 'silent' })
  await build({ entryPoints: [join(root, 'electron/services/diagnosticHost.ts')], bundle: true, platform: 'node', format: 'esm', external: ['electron'], outfile: join(directory, 'host.mjs'), logLevel: 'silent' })
  await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { DiagnosticLogsPanel } from './src/components/settings/DiagnosticLogsPanel'
    import './src/styles/settings.css'
    const host = createRoot(document.getElementById('root'))
    window.setActive = active => host.render(<DiagnosticLogsPanel active={active} />)
    window.setActive(true)
    window.api.onOpenDiagnostics(() => { window.openedDiagnostics = true })
  ` }, bundle: true, platform: 'browser', format: 'iife', outfile: join(directory, 'renderer.js'), alias: { '@': join(root, 'src') }, jsx: 'automatic', logLevel: 'silent' })
  await writeFile(join(directory, 'index.html'), '<html><head><meta charset="utf-8"><link rel="stylesheet" href="theme.css"><link rel="stylesheet" href="renderer.css"></head><body style="background:#101722;color:#ddd;margin:0"><div id="root"></div><script src="renderer.js"></script></body></html>')
  const logDirectory = join(directory, 'local', 'BudgetTerminal', 'logs')
  await mkdir(logDirectory, { recursive: true })
  const filename = join(logDirectory, 'session-2026T01-00000000-0000-0000-0000-000000000000-0.jsonl')
  const entry = { time: '2026-11-04T00:00:00.000Z', session: 'fixture', pid: 1, level: 'error', area: 'service', event: 'request-failed', details: { code: 'timeout' } }
  await writeFile(filename, [entry, { ...entry, level: 'info', area: 'startup', session: 'other', event: '<img src=x onerror="window.injected=true">' }].map(value => JSON.stringify(value)).join('\n') + '\n')
  const exported = join(directory, 'export.jsonl')
  await writeFile(join(directory, 'runner.mjs'), `
    import { app, BrowserWindow, dialog, ipcMain } from 'electron'
    import { pathToFileURL } from 'node:url'
    import fs from 'node:fs'
    import { observeDiagnosticWindow } from './host.mjs'
    app.disableHardwareAcceleration()
    app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))})
    const check = (value, message) => { if (!value) throw Error(message) }
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    const deadline = setTimeout(() => { console.error('Settings diagnostics timed out'); app.exit(1) }, 30000)
    let readHandler
    let readCount = 0
    const register = ipcMain.handle.bind(ipcMain)
    ipcMain.handle = (channel, listener) => {
      if (channel === 'diagnostics:read') { readHandler = listener; register(channel, (...args) => { readCount++; return listener(...args) }) }
      else register(channel, listener)
    }
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(exported)} })
    app.whenReady().then(async () => {
    const window = new BrowserWindow({ width: 1200, height: 820, show: false, webPreferences: { backgroundThrottling: false, preload: ${JSON.stringify(join(directory, 'preload.cjs'))}, sandbox: true, contextIsolation: true, nodeIntegration: false } })
    const html = ${JSON.stringify(join(directory, 'index.html'))}
    observeDiagnosticWindow(window, pathToFileURL(html).href)
    await window.loadFile(html)
    const evaluate = code => window.webContents.executeJavaScript(code)
    const until = async code => { for (let i = 0; i < 100; i++) { if (await evaluate(code)) return; await wait(50) } throw Error('Timed out: ' + code) }
    const click = text => evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent === ' + JSON.stringify(text) + ').click()')
    const filter = (label, value) => evaluate('(() => { const input = document.querySelector(' + JSON.stringify('[aria-label="' + label + '"]') + '); const setter = Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value").set; setter.call(input, ' + JSON.stringify(value) + '); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles:true })); })()')
    try {
      await until('document.querySelectorAll("tbody tr").length === 2')
      check(await evaluate('!document.querySelector("tbody img") && !window.injected'), 'Log text executed as HTML')
      await filter('Log severity', 'error')
      await until('document.querySelectorAll("tbody tr").length === 1')
      await click('request-failed')
      await until('document.querySelector("pre").textContent.includes("timeout")')
      await filter('Search logs', 'nomatch')
      await until('document.querySelectorAll("tbody tr").length === 0')
      await filter('Search logs', '')
      await filter('Log severity', '')
      await filter('Log area', 'startup')
      await until('document.querySelectorAll("tbody tr").length === 1')
      await filter('Log area', '')
      await filter('Log session', 'fixture')
      await until('document.querySelectorAll("tbody tr").length === 1')
      await filter('Log session', '')
      await click('Pause live')
      await until('document.body.textContent.includes("Live paused")')
      const before = readCount
      fs.appendFileSync(${JSON.stringify(filename)}, JSON.stringify(${JSON.stringify({ ...entry, level: 'warn', event: 'live-fixture' })}) + '\\n')
      await wait(2200)
      check(readCount === before, 'Pause did not stop polling')
      await click('Refresh logs')
      await until('document.querySelector("tbody").textContent.includes("live-fixture")')
      ipcMain.removeHandler('diagnostics:read')
      register('diagnostics:read', () => { throw Error('Fixture storage failure') })
      await click('Refresh logs')
      await until('!!document.querySelector("[role=alert]")')
      check(await evaluate('document.querySelector("tbody").textContent.includes("live-fixture")'), 'Read failure discarded snapshot')
      ipcMain.removeHandler('diagnostics:read'); register('diagnostics:read', readHandler)
      await click('Refresh logs')
      await until('!document.querySelector("[role=alert]")')
      await filter('Log severity', 'error')
      await click('Export snapshot')
      await until('document.body.textContent.includes("Exported ")')
      check(fs.readFileSync(${JSON.stringify(exported)}, 'utf8').includes('live-fixture') && fs.readFileSync(${JSON.stringify(exported)}, 'utf8').includes('onerror'), 'Export lost filtered-out records')
      window.webContents.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', key: 'l', control: true, shift: true })
      await until('window.openedDiagnostics === true')
      check(BrowserWindow.getAllWindows().length === 1, 'Shortcut created another window')
      await evaluate('window.setActive(false)')
      await wait(50)
      check(await evaluate('typeof require === "undefined"'), 'Renderer has Node access')
      fs.writeFileSync(${JSON.stringify(join(tmpdir(), 'budget-diagnostics-desktop.png'))}, (await window.webContents.capturePage()).toPNG())
      window.setSize(640, 740)
      await wait(150)
      check(await evaluate('document.body.scrollWidth <= window.innerWidth'), 'Narrow panel overflow')
      fs.writeFileSync(${JSON.stringify(join(tmpdir(), 'budget-diagnostics-narrow.png'))}, (await window.webContents.capturePage()).toPNG())
      clearTimeout(deadline)
      console.log('PASS: Settings log panel, real IPC, safe text, all filters, inspection, pause/refresh, full export, failure recovery, shortcut and narrow layout')
      app.exit(0)
    } catch (error) { console.error(error.stack); app.exit(1) }
    }).catch(error => { console.error(error); app.exit(1) })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: join(directory, 'roaming'), LOCALAPPDATA: join(directory, 'local') }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [join(directory, 'runner.mjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', data => { output += String(data) })
  child.stderr.on('data', data => { output += String(data) })
  const code = await new Promise<number | null>((resolveExit, reject) => { child.once('error', reject); child.once('exit', resolveExit) })
  assert.equal(code, 0, output)
  assert(output.includes('PASS:'), output)
  assert((await readFile(exported, 'utf8')).includes('live-fixture'))
  console.log(output.trim())
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
