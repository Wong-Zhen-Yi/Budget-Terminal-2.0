import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const directory = await mkdtemp(join(tmpdir(), 'budget-logs-ui-'))
const root = resolve(import.meta.dirname, '..')
try {
  // Match the production layout, using real viewer main, preload, HTML and assets.
  const { mkdir, copyFile } = await import('node:fs/promises')
  await mkdir(join(directory, 'out/main'), { recursive: true })
  await mkdir(join(directory, 'out/preload'), { recursive: true })
  await mkdir(join(directory, 'resources'))
  for (const file of ['log-viewer.html', 'log-viewer.css', 'log-viewer.js']) await copyFile(join(root, 'resources', file), join(directory, 'resources', file))
  await build({ entryPoints: [join(root, 'electron/logViewer.ts')], bundle: true, platform: 'node', format: 'esm', external: ['electron'],
    outfile: join(directory, 'out/main/logViewer.mjs'), logLevel: 'silent' })
  await build({ entryPoints: [join(root, 'electron/logViewerPreload.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
    outfile: join(directory, 'out/preload/logViewer.cjs'), logLevel: 'silent' })
  const logDirectory = join(directory, 'local', 'BudgetTerminal', 'logs')
  await mkdir(logDirectory, { recursive: true })
  const filename = join(logDirectory, 'session-2026T01-00000000-0000-0000-0000-000000000000-0.jsonl')
  const entry = { time: '2026-11-04T00:00:00.000Z', session: '00000000-0000-0000-0000-000000000000', pid: 1,
    level: 'error', area: 'service', event: 'request-failed', details: { operation: 'stocks', code: 'timeout' } }
  await writeFile(filename, [entry, { ...entry, level: 'info', event: '<img src=x onerror="window.injected=true">', details: { operation: 'quotes' } }].map(value => JSON.stringify(value)).join('\n') + '\n')
  const exported = join(directory, 'export.jsonl')
  await writeFile(join(directory, 'runner.mjs'), `
    import { app, BrowserWindow, dialog, ipcMain } from 'electron'
    import fs from 'node:fs'
    import { spawn as spawnChild } from 'node:child_process'
    let readHandler
    const register = ipcMain.handle.bind(ipcMain)
    ipcMain.handle = (channel, listener) => { if (channel === 'logs:read') readHandler = listener; register(channel, listener) }
    app.setPath('appData', ${JSON.stringify(join(directory, 'roaming'))})
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(exported)} })
    const check = (value, message) => { if (!value) throw Error(message) }
    const deadline = setTimeout(() => { console.error('Viewer probe timed out'); app.exit(1) }, 25000)
    app.on('browser-window-created', (_event, window) => {
      window.webContents.once('did-finish-load', async () => {
        try {
          const evaluate = code => window.webContents.executeJavaScript(code)
          for (let count = 0; count < 100 && !(await evaluate('document.querySelectorAll("tbody tr").length === 2')); count++) await new Promise(resolve => setTimeout(resolve, 50))
          check(await evaluate('document.querySelectorAll("tbody tr").length === 2'), 'Real IPC did not load persisted records')
          check(window.isVisible(), 'The viewer must show its window without a test-only show call')
          check(!app.isHardwareAccelerationEnabled(), 'Text viewer must not depend on GPU rendering')
          check(app.getPath('sessionData') === app.getPath('userData'), 'Viewer cache must use its own profile')
          check(await evaluate('!document.querySelector("tbody img") && !window.injected'), 'Log content executed as HTML')
          await evaluate('document.getElementById("level").value="error";document.getElementById("level").dispatchEvent(new Event("input"))')
          check(await evaluate('document.querySelectorAll("tbody tr").length === 1'), 'Severity filter failed')
          await evaluate('document.querySelector("tbody tr").click()')
          check(await evaluate('document.getElementById("detail").textContent.includes("timeout")'), 'Record inspection failed')
          await evaluate('document.getElementById("search").value="nomatch";document.getElementById("search").dispatchEvent(new Event("input"))')
          check(await evaluate('!document.getElementById("empty").hidden'), 'Empty filter state failed')
          await evaluate('document.getElementById("search").value="";document.getElementById("level").value="";document.getElementById("search").dispatchEvent(new Event("input"));document.getElementById("pause").click()')
          check(await evaluate('document.getElementById("live").textContent.includes("paused")'), 'Pause failed')
          fs.appendFileSync(${JSON.stringify(filename)}, JSON.stringify(${JSON.stringify({ ...entry, level: 'warn', event: 'live-fixture' })}) + '\\n')
          await evaluate('document.getElementById("refresh").click()')
          for (let count = 0; count < 100 && !(await evaluate('document.querySelectorAll("tbody tr").length === 3')); count++) await new Promise(resolve => setTimeout(resolve, 50))
          check(await evaluate('document.querySelectorAll("tbody tr").length === 3'), 'Refresh failed')
          check(await evaluate('typeof window.api === "undefined" && typeof require === "undefined"'), 'Viewer has app or Node access')
          ipcMain.removeHandler('logs:read')
          register('logs:read', () => ({ entries: [], files: 0, bytes: 0, error: 'Fixture storage failure' }))
          await evaluate('document.getElementById("refresh").click()')
          for (let count = 0; count < 100 && !(await evaluate('!document.getElementById("read-error").hidden')); count++) await new Promise(resolve => setTimeout(resolve, 50))
          check(await evaluate('!document.getElementById("read-error").hidden && document.querySelectorAll("tbody tr").length === 3'), 'Read failure must be visible and retain the last snapshot')
          ipcMain.removeHandler('logs:read')
          register('logs:read', readHandler)
          await evaluate('document.getElementById("refresh").click()')
          for (let count = 0; count < 100 && !(await evaluate('document.getElementById("read-error").hidden')); count++) await new Promise(resolve => setTimeout(resolve, 50))
          check(await evaluate('document.getElementById("read-error").hidden'), 'Read error must clear after recovery')
          window.minimize()
          const second = spawnChild(process.execPath, [${JSON.stringify(join(directory, 'runner.mjs'))}], { env: process.env, windowsHide: false, stdio: 'ignore' })
          const secondExit = await new Promise((resolveExit, reject) => { second.once('error', reject); second.once('exit', resolveExit) })
          check(secondExit === 0, 'Repeat viewer launch must exit cleanly')
          check(BrowserWindow.getAllWindows().length === 1 && window.isVisible() && !window.isMinimized(), 'Repeat launch must reveal the existing viewer')
          const exportResult = await evaluate('window.logs.export()')
          check(exportResult.message.includes('3 records'), 'Export failed')
          check(fs.readFileSync(${JSON.stringify(exported)}, 'utf8').trim().split('\\n').length === 3, 'Export snapshot incomplete')
          await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
          fs.writeFileSync(${JSON.stringify(join(tmpdir(), 'budget-diagnostics-desktop.png'))}, (await window.webContents.capturePage()).toPNG())
          window.setSize(640, 740)
          await new Promise(resolve => setTimeout(resolve, 150))
          check(await evaluate('document.body.scrollWidth <= window.innerWidth'), 'Narrow viewer overflow')
          fs.writeFileSync(${JSON.stringify(join(tmpdir(), 'budget-diagnostics-narrow.png'))}, (await window.webContents.capturePage()).toPNG())
          clearTimeout(deadline)
          console.log('PASS: independent viewer, real IPC, safe text, filters, inspection, pause/refresh, export, sandbox, responsive layout, ESM startup, visible software rendering, isolated cache, repeat launches and read recovery')
          app.exit(0)
        } catch (error) { console.error(error.stack); app.exit(1) }
      })
    })
    await import('./out/main/logViewer.mjs')
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: join(directory, 'roaming'), LOCALAPPDATA: join(directory, 'local') }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [join(directory, 'runner.mjs')], { env, windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] })
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
