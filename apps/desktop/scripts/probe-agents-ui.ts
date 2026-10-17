import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-agents-ui-'))
try {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
      import { AgentsPage } from './src/pages/AgentsPage'
      import { buildTasks } from './src/api/prefetch'
      import { shouldPersistRemoteQuery } from './src/api/queryPersistence'
      const check = (value, message) => { if (!value) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 120))
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
      const root = createRoot(document.getElementById('root'))
      let reads = 0, commands = [], fail = false
      const state = { connected: false, busy: false, autonomy: false, objective: '', intervalMinutes: 15, runsRemaining: 0, nextRunAt: null, messages: [], error: '', navigation: null }
      const envelope = () => ({ data: structuredClone(state), meta: { freshness: 'fresh', source: 'fixture', fetchedAt: Date.now() }, errors: [] })
      window.api.agentsStatus = async () => { reads++; return envelope() }
      window.api.agentsCommand = async command => {
        commands.push(command)
        if (fail) throw Error('Fixture connection unavailable')
        if (command.type === 'connect') state.connected = true
        if (command.type === 'send') {
          state.messages.push({ id: 'user-' + commands.length, role: 'user', text: command.text, at: Date.now() },
            { id: 'activity-' + commands.length, role: 'activity', text: 'Opening Charts · AAPL', at: Date.now() },
            { id: 'answer-' + commands.length, role: 'assistant', text: 'Opened the AAPL charts page. Your terminal is ready to explore.', at: Date.now() })
        }
        if (command.type === 'autonomy') { state.autonomy = command.enabled; state.objective = command.objective || ''; state.runsRemaining = 3; state.nextRunAt = Date.now() + 900000 }
        if (command.type === 'stop') { state.autonomy = false; state.busy = false; state.connected = false; state.nextRunAt = null }
        if (command.type === 'newChat') { state.messages = []; state.connected = false }
        return envelope()
      }
      const render = () => root.render(<QueryClientProvider client={client}><AgentsPage onStatusChange={() => {}} /></QueryClientProvider>)
      const click = async label => { const button = [...document.querySelectorAll('button')].find(button => button.textContent === label); check(button && !button.disabled, 'Missing or disabled ' + label); button.click(); await settle() }
      const fill = async (id, value) => { const input = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); await settle() }
      window.runProbe = async () => {
        const tasks = buildTasks(undefined, { hiddenTabs: ['agents'] }, { stocks: '', fundamentals: '' }, { year: 2026, month: 9, earningsYear: 2026, ipoYear: 2026 }).filter(task => task.tab === 'agents')
        check(tasks.length === 1, 'Hidden Agents page must preload at startup')
        await tasks[0].run(client)
        render(); await settle()
        check(reads === 1 && commands.length === 0, 'Opening a warmed Agents page must neither reload nor connect')
        check(document.querySelector('[role=switch]').getAttribute('aria-checked') === 'false', 'Autonomy starts off')
        check(!shouldPersistRemoteQuery(client.getQueryCache().find({ queryKey: ['agents'] })), 'Private chat must not persist in renderer cache')
        await click('Connect Codex')
        check(document.body.innerText.includes('Connected'), 'Connection status')
        await fill('agent-message', 'Show me the charts for AAPL')
        await click('Send ↗')
        check(document.querySelector('[role=log]').textContent.includes('Opened the AAPL charts page'), 'Assistant response')
        check(document.getElementById('agent-message').value === '', 'Successful send clears composer')
        await fill('agent-objective', 'Review portfolio news for meaningful changes')
        await click('Enable autonomous mode')
        check(document.querySelector('[role=switch]').getAttribute('aria-checked') === 'true', 'Explicit autonomy enable')
        check(commands.at(-1).intervalMinutes === 15 && commands.at(-1).runs === 4, 'User monitoring bounds')
        check(document.body.innerText.includes('future runs remaining'), 'Visible monitoring schedule')
        await click('Stop')
        check(document.querySelector('[role=switch]').getAttribute('aria-checked') === 'false', 'Stop disables autonomy')
        check(document.body.innerText.includes('Disconnected'), 'Stop disconnects')
        fail = true; await click('Connect Codex')
        check(document.querySelector('[role=alert]').textContent.includes('Fixture connection unavailable'), 'Visible connection failures')
        fail = false; await click('Connect Codex')
        check(document.querySelectorAll('.agents-message').length === 3, 'Conversation survives disconnect/reconnect')
        check(document.documentElement.scrollWidth <= innerWidth, 'No horizontal overflow')
        return 'PASS: startup readiness, no automatic connection, chat, autonomy defaults, bounded schedule, stop, error visibility and private cache exclusion'
      }
    ` }, bundle: true, jsx: 'automatic', write: false, format: 'iife', loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' }, alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
  })
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(file => file.endsWith('.css'))!
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), '<link rel="stylesheet" href="theme.css"><style>html,body,#root{height:100%;width:100%;margin:0}#root{display:flex}</style><div id="root"></div><script>window.api={};window.probeErrors=[];window.addEventListener("error",event=>window.probeErrors.push(event.message))</script><script src="renderer.js"></script>')
  const screenshot = resolve(root, '../../output/playwright/agents.png')
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    const { mkdirSync, writeFileSync } = require('node:fs')
    app.disableHardwareAcceleration()
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1300, height: 900, webPreferences: { backgroundThrottling: false, offscreen: true } })
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        console.log(await window.webContents.executeJavaScript('window.runProbe()'))
        const errors = await window.webContents.executeJavaScript('window.probeErrors')
        if (errors.length) throw Error(errors.join('; '))
        for (const width of [900, 1600]) {
          window.setSize(width, 900)
          await new Promise(resolve => setTimeout(resolve, 150))
          const sizing = await window.webContents.executeJavaScript('({ viewport: innerWidth, width: document.documentElement.scrollWidth, composer: document.querySelector(".agents-composer").getBoundingClientRect().bottom, height: innerHeight })')
          if (sizing.width > sizing.viewport || sizing.composer > sizing.height) throw Error('Layout overflow: ' + JSON.stringify(sizing))
        }
        window.setSize(1300, 900)
        await new Promise(resolve => setTimeout(resolve, 200))
        mkdirSync(${JSON.stringify(resolve(root, '../../output/playwright'))}, { recursive: true })
        writeFileSync(${JSON.stringify(screenshot)}, (await window.webContents.capturePage()).toPNG())
        app.exit(0)
      } catch (error) { console.error(error); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Agents UI probe timed out')) }, 40_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log('Screenshot:', screenshot)
} finally {
  assert(directory.startsWith(join(tmpdir(), 'budget-agents-ui-')))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
