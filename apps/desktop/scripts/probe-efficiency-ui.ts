import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(join(tmpdir(), 'budget-efficiency-ui-'))
const require = createRequire(import.meta.url)
try {
  await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import { contextBridge, ipcRenderer } from 'electron'
    import { createApi } from './electron/shared/createApi'
    const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)
    const subscribe = (channel, listener) => {
      const handler = (_event, payload) => listener(payload)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    }
    const modern = createApi(invoke, subscribe, process.platform)
    const legacy = { ...modern, onLiveStatusChanged: undefined }
    contextBridge.exposeInMainWorld('probeApis', { modern, legacy })
    contextBridge.exposeInMainWorld('fixture', {
      control: request => invoke('fixture:control', request),
      listeners: () => ipcRenderer.listenerCount('live-status:changed'),
    })
  ` }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: join(scratch, 'preload.cjs') })
  await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import { createRoot } from 'react-dom/client'
    import { QueryClient, QueryClientProvider, timeoutManager, focusManager } from '@tanstack/react-query'
    import { useAgents } from './src/api/agentsQueries'
    import { useNotifications } from './src/api/notificationsQueries'
    import { useBrowser } from './src/api/browserQueries'
    import { subscribeLiveStatus } from './src/api/liveStatus'
    import { McpActivity } from './src/components/chrome/McpActivity'
    const wait = () => new Promise(resolve => setTimeout(resolve, 10))
    const check = (value, message) => { if (!value) throw Error(message) }
    let time = 0, id = 0
    const timers = new Map()
    const add = (run, delay, repeat) => { const key = ++id; timers.set(key, { run, due: time + delay, delay, repeat }); return key }
    timeoutManager.setTimeoutProvider({
      setTimeout: (run, delay) => add(run, delay, false), clearTimeout: key => timers.delete(key),
      setInterval: (run, delay) => add(run, delay, true), clearInterval: key => timers.delete(key),
    })
    focusManager.setFocused(true)
    async function advance(duration) {
      const end = time + duration
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0]
        if (!next) break
        const [key, timer] = next
        time = timer.due
        if (timer.repeat) timer.due += timer.delay; else timers.delete(key)
        timer.run()
        await wait()
      }
      time = end
      await wait()
    }
    function StatusHooks() {
      const agents = useAgents(true)
      useNotifications()
      useBrowser(true)
      return <><p>{agents.data?.data.messages.at(-1)?.text}</p><McpActivity /></>
    }
    window.runChecks = async () => {
      const measurements = {}
      for (const mode of ['legacy', 'modern']) {
        window.api = window.probeApis[mode]
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
        const stop = mode === 'modern' ? subscribeLiveStatus(client, window.api.onLiveStatusChanged) : () => {}
        const host = document.createElement('div'); document.body.append(host)
        const root = createRoot(host)
        root.render(<QueryClientProvider client={client}><StatusHooks /></QueryClientProvider>)
        for (let index = 0; index < 100 && (!client.getQueryData(['browser']) || !client.getQueryData(['mcpStatus'])); index++) await wait()
        check(client.getQueryData(['agents']) && client.getQueryData(['notifications']) && client.getQueryData(['browser']), 'Initial status snapshots did not load')
        await window.fixture.control({ type: 'reset' })
        await advance(60000)
        measurements[mode] = await window.fixture.control({ type: 'stats' })
        if (mode === 'modern') {
          check(Object.values(measurements[mode].calls).every(count => count === 2), 'Modern status hooks must use bounded 30 s recovery reads')
          await window.fixture.control({ type: 'update', emit: true, text: 'Final streamed answer', read: true })
          for (let index = 0; index < 100 && client.getQueryData(['agents']).data.messages.at(-1).text !== 'Final streamed answer'; index++) await wait()
          check(client.getQueryData(['agents']).data.messages.at(-1).text === 'Final streamed answer', 'Native push lost the final answer')
          for (let index = 0; index < 100 && !client.getQueryData(['notifications']).data.notifications[0].read; index++) await wait()
          check(client.getQueryData(['notifications']).data.notifications[0].read, 'Unread state did not cross IPC')
          for (let index = 0; index < 100 && document.querySelector('[data-mcp-light="active"]')?.dataset.state !== 'on'; index++) await wait()
          check(document.querySelector('[data-mcp-light="active"]')?.dataset.state === 'on', 'MCP push must update the activity indicator')
          stop()
          check(window.fixture.listeners() === 0, 'Native IPC listeners leaked')
          await window.fixture.control({ type: 'update', emit: false, text: 'Recovered after disconnect', read: false })
          await advance(30000)
          check(client.getQueryData(['agents']).data.messages.at(-1).text === 'Recovered after disconnect', 'Recovery polling did not repair a missed revision')
        } else stop()
        root.unmount(); client.clear(); host.remove(); timers.clear()
      }
      check(measurements.legacy.calls.agents === 20 && measurements.legacy.calls.notifications === 20 && measurements.legacy.calls.browser === 100 && measurements.legacy.calls.mcpStatus === 120, 'Legacy transport polling changed')
      return measurements
    }
  ` }, bundle: true, platform: 'browser', format: 'iife', tsconfig: join(root, 'tsconfig.json'), outfile: join(scratch, 'renderer.js') })
  await writeFile(join(scratch, 'index.html'), '<!doctype html><body><script>window.api = window.probeApis.legacy</script><script src="renderer.js"></script></body>')
  await writeFile(join(scratch, 'main.cjs'), `
    const { app, BrowserWindow, ipcMain } = require('electron')
    const { join } = require('node:path')
    app.setPath('userData', join(__dirname, 'profile'))
    let calls = {}, bytes = 0, revision = 0
    const payloads = {
      agents: { connected: true, busy: false, trackers: [], messages: Array.from({ length: 300 }, (_, id) => ({ id: String(id), text: 'x'.repeat(1000) })) },
      notifications: { notifications: Array.from({ length: 500 }, (_, id) => ({ id: String(id), read: false, body: 'Synthetic inbox message' })) },
      browser: { tabs: [], activeTabId: '', agentEnabled: false, activity: '' },
      mcpStatus: { available: true, connected: true, active: false },
    }
    for (const kind of Object.keys(payloads)) ipcMain.handle(kind === 'mcpStatus' ? 'system:mcp-status' : kind + ':status', () => {
      const result = kind === 'mcpStatus' ? structuredClone(payloads[kind]) : { data: structuredClone(payloads[kind]), errors: [], meta: { source: 'synthetic fixture', freshness: 'fresh', fetchedAt: Date.now() } }
      calls[kind] = (calls[kind] || 0) + 1
      bytes += Buffer.byteLength(JSON.stringify(result))
      return result
    })
    ipcMain.handle('fixture:control', (event, request) => {
      if (request.type === 'reset') { calls = {}; bytes = 0 }
      if (request.type === 'stats') return { calls, bytes }
      if (request.type === 'update') {
        payloads.agents.messages.at(-1).text = request.text
        payloads.notifications.notifications[0].read = request.read
        payloads.mcpStatus.active = request.emit
        if (request.emit) for (const kind of ['agents', 'notifications', 'mcpStatus']) event.sender.send('live-status:changed', { kind, revision: ++revision })
      }
    })
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, webPreferences: { preload: join(__dirname, 'preload.cjs'), backgroundThrottling: false } })
      try {
        await window.loadFile(join(__dirname, 'index.html'))
        console.log(JSON.stringify(await window.webContents.executeJavaScript('window.runChecks()')))
        app.exit(0)
      } catch (error) { console.error(error); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: join(scratch, 'roaming'), LOCALAPPDATA: join(scratch, 'local') }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron'), [join(scratch, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(Error('Efficiency UI timeout: ' + output)) }, 60_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log('PASS: actual status hooks/native IPC, virtual 60 s idle session, legacy compatibility, pushed final answer/unread state, reconnect recovery and listener cleanup')
} finally { await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
