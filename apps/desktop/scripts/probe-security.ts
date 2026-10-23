import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { createServer } from 'vite'
import { loadConfigFromFile } from 'electron-vite'
import { isTrustedRendererUrl } from '../electron/shared/ipcSecurity.js'
import { isSafeExternalUrl } from '../electron/services/urls.js'

for (const value of [undefined, null, {}, ['https://example.com'], 'javascript:alert(1)', 'file:///private',
  'https://user:password@example.com', 'https://example.com/\nunsafe', 'https://example.com/\u0000', 'https://example.com/' + 'x'.repeat(8192)]) {
  assert.equal(isSafeExternalUrl(value), false, 'Unsafe external links must not reach the operating system')
}
assert.equal(isSafeExternalUrl('https://example.com/article?q=hello%20world#source'), true)
assert.equal(isSafeExternalUrl('http://example.com/'), true)

assert.equal(isTrustedRendererUrl('http://localhost:5173/', 'http://localhost:5173'), true)
assert.equal(isTrustedRendererUrl('http://localhost:5173/other', 'http://localhost:5173/'), false)
assert.equal(isTrustedRendererUrl('https://evil.test/', 'http://localhost:5173/'), false)
assert.equal(isTrustedRendererUrl('file:///app/index.html#chart', 'file:///app/index.html'), true)
assert.equal(isTrustedRendererUrl('file:///app/other.html', 'file:///app/index.html'), false)

const root = resolve(import.meta.dirname, '..')
const { config } = await loadConfigFromFile({ command: 'serve', mode: 'development' }, join(root, 'electron.vite.config.ts'), root)
const development = await createServer({ ...config.renderer, configFile: false, logLevel: 'silent',
  server: { ...config.renderer?.server, port: 0 }, optimizeDeps: { noDiscovery: true } })
try {
  await development.listen()
  const address = development.httpServer?.address()
  assert.ok(address && typeof address !== 'string')
  assert.equal(address.address, '127.0.0.1', 'Development server must bind only to loopback')
  const origin = `http://127.0.0.1:${address.port}`
  const html = await (await fetch(origin)).text()
  assert(html.includes("connect-src 'self' ws://localhost:* ws://127.0.0.1:*"), 'Development retains HMR websocket access')
  const fsUrl = (file: string) => `${origin}/@fs/${file.replaceAll('\\', '/')}`
  for (const file of [join(root, '../../package.json'), join(root, 'electron/services/agentWorkspace.ts')]) {
    const response = await fetch(fsUrl(file))
    assert.equal(response.status, 403, 'Development cannot serve main-process files or unrelated workspace data')
    await response.text()
  }
  const shared = await fetch(fsUrl(join(root, 'electron/shared/ipcSecurity.ts')))
  assert.equal(shared.status, 200, 'Shared renderer modules remain accessible')
  await shared.text()
  console.log('PASS: real Vite server binds to loopback, retains HMR and rejects files outside renderer/shared/dependency directories')
} finally { await development.close() }
await mkdir(join(root, 'out'), { recursive: true })
const directory = await mkdtemp(join(root, 'out', 'security-'))
const dataDirectory = await mkdtemp(join(tmpdir(), 'budget-security-data-'))
try {
  const trustedPath = join(directory, 'trusted.html')
  const otherPath = join(directory, 'other.html')
  const sourceHtml = await readFile(join(root, 'src/index.html'), 'utf8')
  const policy = sourceHtml.match(/content="(default-src[^"\n]+)"/)?.[1]
  assert.ok(policy)
  assert(!/localhost|127\.0\.0\.1|ws:/.test(policy), 'Production shell must not allow connections to local services')
  await writeFile(trustedPath, `<head><meta http-equiv="Content-Security-Policy" content="${policy}"></head><body><h1>Trusted shell</h1></body>`)
  await writeFile(otherPath, '<h1>Another document</h1>')
  await build({
    stdin: { resolveDir: root, loader: 'ts', contents: `
      import assert from 'node:assert/strict'
      import { app, BrowserWindow } from 'electron'
      import { assertDesktopCertificateSecurity } from './electron/shared/certificateSecurity'
      import { pathToFileURL } from 'node:url'
      import { readFile } from 'node:fs/promises'
      import { registerIpcHandlers } from './electron/ipc/handlers'
      import { isTrustedRendererUrl } from './electron/shared/ipcSecurity'
      import { CHANNELS } from './electron/shared/contract'
      import { acquireDataSession } from './electron/services/dataSession'
      import { startMcpHost } from './electron/mcp/host'
      import { startAgents, closeAgents } from './electron/services/agentsHost'
      import { invokeBridge, runtimePath } from './mcp/runtime'
      app.setPath('userData', ${JSON.stringify(join(dataDirectory, 'userData'))})
      const expected = pathToFileURL(${JSON.stringify(trustedPath)}).href
      app.whenReady().then(async () => {
        let dispose, release
        try {
          assertDesktopCertificateSecurity(process.versions.electron, process.env, name => app.commandLine.hasSwitch(name))
          assert.equal(runtimePath(), ${JSON.stringify(join(dataDirectory, 'BudgetTerminalElectron', '.mcp', 'runtime.json'))})
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
          const contentPolicy = await trusted.webContents.executeJavaScript(\`(async () => {
            const violations = []
            document.addEventListener('securitypolicyviolation', event => violations.push(event.effectiveDirective))
            const base = document.createElement('base')
            base.href = 'https://example.com/'
            document.head.append(base)
            const script = document.createElement('script')
            script.textContent = 'window.injectedScriptRan = true'
            document.body.append(script)
            let connected = false
            try { await fetch('http://127.0.0.1:9/'); connected = true } catch {}
            await new Promise(resolve => setTimeout(resolve, 50))
            return { base: document.baseURI, injected: Boolean(window.injectedScriptRan), connected, violations }
          })()\`)
          assert.equal(contentPolicy.base, expected, 'Injected base elements cannot redirect shell resources')
          assert.equal(contentPolicy.injected, false, 'Inline script injection is blocked')
          assert.equal(contentPolicy.connected, false, 'Shell cannot connect to local services')
          assert(contentPolicy.violations.includes('connect-src'), 'Connection must be rejected by CSP before a socket opens')
          assert(contentPolicy.violations.includes('base-uri'), 'CSP rejects injected base elements')
          console.log('PASS: production content policy blocks base changes, inline script and local-service connections')
          assert.equal(Object.values(CHANNELS).some(channel => channel.startsWith('system:web-')), false, 'Remote IPC channels must be removed')
          for (const method of ['webStatus', 'configureWebAccess', 'rotateWebPairingCode', 'revokeWebSessions', 'decideWebAccess']) {
            assert.equal(await trusted.webContents.executeJavaScript('typeof window.api[' + JSON.stringify(method) + ']'), 'undefined', 'Remote methods must not be exposed by preload')
          }
          console.log('PASS: desktop-only preload and IPC contract without remote access methods')
          const result = await trusted.webContents.executeJavaScript('window.api.settings()')
          assert.ok(result.data.tabOrder.includes('settings'))
          const agents = await trusted.webContents.executeJavaScript('window.api.agentsStatus()')
          assert.equal(agents.data.autonomy, false)
          assert.equal(agents.data.connected, false)
          assert.equal(agents.data.busy, false)
          const startup = startAgents()
          assert.equal(startAgents(), startup, 'Desktop startup connection is single-flight')
          const connected = await trusted.webContents.executeJavaScript('window.api.agentsStatus()')
          assert.equal(connected.data.connected, true, 'Status readiness waits for startup connection')
          assert.equal(connected.data.autonomy, false)
          assert.equal(connected.data.models[0].id, 'fixture-model')
          assert.equal(globalThis.codexFixture.starts, 1)
          assert.equal(globalThis.codexFixture.turns, 0, 'Auto-connect never starts inference')
          const fresh = await trusted.webContents.executeJavaScript("window.api.agentsCommand({ type: 'newChat' })")
          assert.equal(fresh.data.connected, true)
          assert.equal(fresh.data.messages.length, 0)
          assert.equal(globalThis.codexFixture.starts, 1)
          assert.equal(globalThis.codexFixture.closes, 0, 'New chat retains the process')
          assert.equal(globalThis.codexFixture.threads, 2, 'New chat creates a fresh ephemeral thread')
          await trusted.webContents.executeJavaScript("window.api.agentsCommand({ type: 'stop' })")
          assert.equal((await trusted.webContents.executeJavaScript('window.api.agentsStatus()')).data.connected, false)
          assert.equal(globalThis.codexFixture.starts, 1, 'Polling after Stop never auto-reconnects')
          closeAgents()
          globalThis.codexFixture.authenticated = false
          await startAgents()
          const missingLogin = await trusted.webContents.executeJavaScript('window.api.agentsStatus()')
          assert.equal(missingLogin.meta.freshness, 'failed', 'Startup failure stays visible in readiness')
          assert.match(missingLogin.data.error, /codex login/)
          assert.equal(missingLogin.data.busy, false)
          assert.equal(globalThis.codexFixture.turns, 0)
          console.log('PASS: automatic Codex startup, single connection attempt, connected New chat, no inference, Stop without reconnect and visible sign-in failure')
          const other = new BrowserWindow(options)
          await other.loadFile(${JSON.stringify(otherPath)})
          await assert.rejects(other.webContents.executeJavaScript('window.api.settings()'), /Untrusted IPC sender/)
          await assert.rejects(other.webContents.executeJavaScript('window.api.agentsStatus()'), /Untrusted IPC sender/)
          await assert.rejects(other.webContents.executeJavaScript('window.api.browserStatus()'), /Untrusted IPC sender/)
          await assert.rejects(other.webContents.executeJavaScript("window.api.browserResearch({ action: 'read' })"), /Untrusted IPC sender/)
          await assert.rejects(other.webContents.executeJavaScript("window.api.browserControl({ action: 'agentAccess', enabled: true })"), /Untrusted IPC sender/)
          await assert.rejects(other.webContents.executeJavaScript('window.api.browserViewport({ visible: true, x: 0, y: 0, width: 500, height: 500 })'), /Untrusted IPC sender/)
          await assert.rejects(other.webContents.executeJavaScript("window.api.agentsImage('11111111-1111-4111-8111-111111111111')"), /Untrusted IPC sender/)
          const invalidImage = await trusted.webContents.executeJavaScript("window.api.agentsImage('../../private.png')")
          assert.equal(invalidImage.data, null)
          assert.equal(invalidImage.meta.freshness, 'failed', 'Image IPC must never expose arbitrary local paths')
          await assert.rejects(other.webContents.executeJavaScript("window.api.agentsCommand({ type: 'connect' })"), /Untrusted IPC sender/)
          const invalidAgent = await trusted.webContents.executeJavaScript("window.api.agentsCommand({ type: 'send', text: '' })")
          assert.equal(invalidAgent.meta.freshness, 'failed')
          await assert.rejects(other.webContents.executeJavaScript("window.api.maintenance('clearUserData')"), /Untrusted IPC sender/)
          await assert.rejects(trusted.webContents.executeJavaScript("window.api.maintenance('unknown')"), /Unknown maintenance action/)
          const stopMcp = await startMcpHost()
          assert.equal((await trusted.webContents.executeJavaScript('window.api.mcpStatus()')).available, true)
          await assert.rejects(other.webContents.executeJavaScript('window.api.mcpStatus()'), /Untrusted IPC sender/)
          await assert.rejects(other.webContents.executeJavaScript('window.api.configureMcp({ readOnly: false, requireApproval: false })'), /Untrusted IPC sender/)
          await assert.rejects(other.webContents.executeJavaScript('window.api.testMcpConnection()'), /Untrusted IPC sender/)
          await assert.rejects(other.webContents.executeJavaScript('window.api.cancelMcpCall(1)'), /Untrusted IPC sender/)
          await assert.rejects(trusted.webContents.executeJavaScript('window.api.configureMcp({ readOnly: false })'))
          const tested = await trusted.webContents.executeJavaScript('window.api.testMcpConnection()')
          assert.equal(tested.diagnostics.policy.readOnly, true)
          assert.equal(tested.setup.valid, true)
          const descriptor = JSON.parse(await readFile(runtimePath(), 'utf8'))
          assert(!tested.setup.configuration.includes(descriptor.token))
          assert(tested.setup.configuration.includes('BUDGET_TERMINAL_DATA_DIR'))
          assert.equal(tested.diagnostics.activity.length, 0, 'Connection tests and heartbeats do not create activity records')
          await assert.rejects(invokeBridge('budget_terminal_mutate_settings', { request: { type: 'setTime12h', value: false }, requestId: 'blocked', expectedRevision: (await invokeBridge('budget_terminal_settings', { request: {} })).meta.revision }), /read only/)
          await trusted.webContents.executeJavaScript('window.api.configureMcp({ readOnly: false, requireApproval: false })')
          await trusted.webContents.executeJavaScript('window.savedChanges = []; window.stopSavedChanges = window.api.onSavedDataChanged(event => window.savedChanges.push(event)); true')
          await invokeBridge('budget_terminal_mutate_settings', { request: { type: 'setTime12h', value: false }, requestId: 'time-false', expectedRevision: (await invokeBridge('budget_terminal_settings', { request: {} })).meta.revision })
          await new Promise(resolve => setTimeout(resolve, 100))
          assert.deepEqual(await trusted.webContents.executeJavaScript('window.savedChanges'), [{ domains: ['settings'] }])
          assert.equal((await trusted.webContents.executeJavaScript('window.api.settings()')).data.time12h, false)
          await trusted.webContents.executeJavaScript('window.stopSavedChanges()')
          await invokeBridge('budget_terminal_mutate_settings', { request: { type: 'setTime12h', value: true }, requestId: 'time-true', expectedRevision: (await invokeBridge('budget_terminal_settings', { request: {} })).meta.revision })
          await new Promise(resolve => setTimeout(resolve, 100))
          assert.equal(await trusted.webContents.executeJavaScript('window.savedChanges.length'), 1)
          const diagnostics = (await trusted.webContents.executeJavaScript('window.api.mcpStatus()')).diagnostics
          assert.equal(diagnostics.activity.at(-1).state, 'success')
          assert.equal('arguments' in diagnostics.activity.at(-1), false)
          await stopMcp()
          const stopRestartedMcp = await startMcpHost()
          assert.equal((await trusted.webContents.executeJavaScript('window.api.mcpStatus()')).diagnostics.policy.readOnly, false, 'Locally saved permissions survive restart')
          await stopRestartedMcp()
          console.log('PASS: Electron MCP host, status IPC, real mutation notification and unsubscribe through sandboxed preload')
          console.log('PASS: real sandboxed preload, isolated renderer, trusted IPC, rejected foreign document and maintenance action')
          dispose(); release(); app.exit(0)
        } catch (error) { console.error(error); dispose?.(); release?.(); app.exit(1) }
      })
    ` },
    outfile: join(directory, 'main.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external',
    plugins: [{ name: 'fixture-codex-transport', setup(builder) {
      // Exercise the real host/IPC lifecycle without using the user's Codex account.
      builder.onLoad({ filter: /[\\/]codexClient\.ts$/ }, () => ({ loader: 'ts', contents: `
        globalThis.codexFixture = { starts: 0, closes: 0, turns: 0, threads: 0, authenticated: true }
        export class CodexClient {
          async start() { globalThis.codexFixture.starts++ }
          async request(method) {
            const fixture = globalThis.codexFixture
            await new Promise(resolve => setTimeout(resolve, 10))
            if (method === 'account/read') return { account: fixture.authenticated ? {} : null }
            if (method === 'config/read') return { config: {} }
            if (method === 'model/list') return { data: [{ model: 'fixture-model', displayName: 'Fixture', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Quick' }] }] }
            if (method === 'thread/start') return { thread: { id: 'fixture-' + (++fixture.threads) }, model: 'fixture-model' }
            if (method === 'turn/start') { fixture.turns++; throw Error('Unexpected inference') }
            throw Error('Unexpected method: ' + method)
          }
          write() {}
          close() { globalThis.codexFixture.closes++ }
        }
      ` }))
    } }],
  })
  // Keep the bridge client and Electron host on this probe's profile, including
  // when the maintenance runner already supplied its own outer scratch path.
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: dataDirectory, LOCALAPPDATA: dataDirectory,
    BUDGET_TERMINAL_DATA_DIR: join(dataDirectory, 'BudgetTerminalElectron') }
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
  await rm(dataDirectory, { recursive: true, force: true })
}
