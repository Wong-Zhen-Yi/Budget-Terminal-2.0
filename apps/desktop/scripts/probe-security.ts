import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { isTrustedRendererUrl } from '../electron/shared/ipcSecurity.js'

assert.equal(isTrustedRendererUrl('http://localhost:5173/', 'http://localhost:5173'), true)
assert.equal(isTrustedRendererUrl('http://localhost:5173/other', 'http://localhost:5173/'), false)
assert.equal(isTrustedRendererUrl('https://evil.test/', 'http://localhost:5173/'), false)
assert.equal(isTrustedRendererUrl('file:///app/index.html#chart', 'file:///app/index.html'), true)
assert.equal(isTrustedRendererUrl('file:///app/other.html', 'file:///app/index.html'), false)

const root = resolve(import.meta.dirname, '..')
await mkdir(join(root, 'out'), { recursive: true })
const directory = await mkdtemp(join(root, 'out', 'security-'))
try {
  const trustedPath = join(directory, 'trusted.html')
  const otherPath = join(directory, 'other.html')
  await writeFile(trustedPath, '<h1>Trusted shell</h1>')
  await writeFile(otherPath, '<h1>Another document</h1>')
  await build({
    stdin: { resolveDir: root, loader: 'ts', contents: `
      import assert from 'node:assert/strict'
      import { app, BrowserWindow } from 'electron'
      import { pathToFileURL } from 'node:url'
      import { registerIpcHandlers } from './electron/ipc/handlers'
      import { isTrustedRendererUrl } from './electron/shared/ipcSecurity'
      import { acquireDataSession } from './electron/services/dataSession'
      import { startMcpHost } from './electron/mcp/host'
      import { invokeBridge, runtimePath } from './mcp/runtime'
      app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
      const expected = pathToFileURL(${JSON.stringify(trustedPath)}).href
      app.whenReady().then(async () => {
        let dispose, release
        try {
          assert.equal(runtimePath(), ${JSON.stringify(join(directory, 'BudgetTerminalElectron', '.mcp', 'runtime.json'))})
          release = acquireDataSession()
          dispose = registerIpcHandlers(event => {
            const frame = event.senderFrame
            return Boolean(frame && frame === event.sender.mainFrame &&
              BrowserWindow.fromWebContents(event.sender) && isTrustedRendererUrl(frame.url, expected))
          })
          const options = { show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
            preload: ${JSON.stringify(join(root, 'out/preload/preload.cjs'))} } }
          const trusted = new BrowserWindow(options)
          await trusted.loadFile(${JSON.stringify(trustedPath)})
          assert.equal(trusted.webContents.getLastWebPreferences().sandbox, true)
          assert.equal(await trusted.webContents.executeJavaScript('typeof require'), 'undefined')
          assert.equal(await trusted.webContents.executeJavaScript('typeof process'), 'undefined')
          assert.equal(await trusted.webContents.executeJavaScript('window.api.platform'), process.platform)
          const result = await trusted.webContents.executeJavaScript('window.api.settings()')
          assert.ok(result.data.tabOrder.includes('settings'))
          const agents = await trusted.webContents.executeJavaScript('window.api.agentsStatus()')
          assert.equal(agents.data.autonomy, false)
          assert.equal(agents.data.connected, false)
          assert.equal(agents.data.busy, false)
          const other = new BrowserWindow(options)
          await other.loadFile(${JSON.stringify(otherPath)})
          await assert.rejects(other.webContents.executeJavaScript('window.api.settings()'), /Untrusted IPC sender/)
          await assert.rejects(other.webContents.executeJavaScript('window.api.agentsStatus()'), /Untrusted IPC sender/)
          await assert.rejects(other.webContents.executeJavaScript("window.api.agentsCommand({ type: 'connect' })"), /Untrusted IPC sender/)
          const invalidAgent = await trusted.webContents.executeJavaScript("window.api.agentsCommand({ type: 'send', text: '' })")
          assert.equal(invalidAgent.meta.freshness, 'failed')
          await assert.rejects(other.webContents.executeJavaScript("window.api.maintenance('clearUserData')"), /Untrusted IPC sender/)
          await assert.rejects(trusted.webContents.executeJavaScript("window.api.maintenance('unknown')"), /Unknown maintenance action/)
          const stopMcp = await startMcpHost()
          assert.equal((await trusted.webContents.executeJavaScript('window.api.mcpStatus()')).available, true)
          await assert.rejects(other.webContents.executeJavaScript('window.api.mcpStatus()'), /Untrusted IPC sender/)
          await trusted.webContents.executeJavaScript('window.savedChanges = []; window.stopSavedChanges = window.api.onSavedDataChanged(event => window.savedChanges.push(event)); true')
          await invokeBridge('budget_terminal_mutate_settings', { request: { type: 'setTime12h', value: false } })
          await new Promise(resolve => setTimeout(resolve, 100))
          assert.deepEqual(await trusted.webContents.executeJavaScript('window.savedChanges'), [{ domains: ['settings'] }])
          assert.equal((await trusted.webContents.executeJavaScript('window.api.settings()')).data.time12h, false)
          await trusted.webContents.executeJavaScript('window.stopSavedChanges()')
          await invokeBridge('budget_terminal_mutate_settings', { request: { type: 'setTime12h', value: true } })
          await new Promise(resolve => setTimeout(resolve, 100))
          assert.equal(await trusted.webContents.executeJavaScript('window.savedChanges.length'), 1)
          await stopMcp()
          console.log('PASS: Electron MCP host, status IPC, real mutation notification and unsubscribe through sandboxed preload')
          console.log('PASS: real sandboxed preload, isolated renderer, trusted IPC, rejected foreign document and maintenance action')
          dispose(); release(); app.exit(0)
        } catch (error) { console.error(error); dispose?.(); release?.(); app.exit(1) }
      })
    ` },
    outfile: join(directory, 'main.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external',
  })
  // Keep the bridge client and Electron host on this probe's profile, including
  // when the maintenance runner already supplied its own outer scratch path.
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory,
    BUDGET_TERMINAL_DATA_DIR: join(directory, 'BudgetTerminalElectron') }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(createRequire(import.meta.url)('electron') as string, [join(directory, 'main.mjs')], {
      env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Security probe timed out: ${output}`)) }, 30_000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code) => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  assert.match(result.output, /PASS:/)
  console.log(result.output.split(/\r?\n/).filter((line) => line.startsWith('PASS:')).join('\n'))
} finally {
  await rm(directory, { recursive: true, force: true })
}
