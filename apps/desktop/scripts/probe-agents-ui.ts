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
const formattedReply = [
  '## Your portfolio at a glance', '',
  'Opened the AAPL charts page. Here are the **key things to review** before exploring further.', '',
  '- **Holdings:** Compare position sizes and concentration.',
  '* **Research:** Review the latest company filings.',
  '  - Keep *source dates* alongside your notes.', '',
  '| View | What to look for |', '| --- | --- |',
  '| Charts | Price history and volume |', '| Portfolio | Position weights and cost basis |', '',
  '### Suggested next steps', '', '1. Open your saved portfolio.', '2. Review `AAPL` alongside your watchlist.', '',
  '> Figures depend on the freshness of your saved data.', '',
  '[Open source](https://example.com/research) · [Blocked link](javascript:alert(1))', '',
  '```text', 'Change: -5% · A * B', '```', '',
  '![Remote image](https://example.com/tracker.png)', '<img src=x onerror="window.unsafeMarkup=true">',
].join('\n')
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
      let reads = 0, commands = [], fail = false, portfolioSaves = 0, favorite = false
      const openedLinks = []
      window.api.openExternal = async url => { openedLinks.push(url) }
      const formattedReply = ${JSON.stringify(formattedReply)}
      const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 300
      const drawing = canvas.getContext('2d'); drawing.fillStyle = '#ffffff'; drawing.fillRect(0, 0, 900, 300); drawing.fillStyle = '#111111'; drawing.font = '24px monospace'
      drawing.fillText('Synthetic Portfolio Fixture', 30, 50)
      drawing.fillText('Ticker      Shares      Average cost (USD)', 30, 120)
      drawing.fillText('AAPL        25          123.45', 30, 180)
      window.portfolioImage = canvas.toDataURL('image/png')
      const models = [
        { id: 'fixture-fast', name: 'Codex fast', defaultThinking: 'low', thinkingModes: [{ id: 'low', description: 'Quick' }, { id: 'high', description: 'Deeper' }] },
        { id: 'fixture-research', name: 'Codex research', defaultThinking: 'medium', thinkingModes: [{ id: 'medium', description: 'Balanced' }] },
      ]
      const state = { portfolioProposal: null, model: null, thinking: null, models: [], connected: false, busy: false, autonomy: false, objective: '', intervalMinutes: 15, runsRemaining: 0, nextRunAt: null, messages: [], error: '', navigation: null }
      const envelope = () => ({ data: structuredClone(state), meta: { freshness: 'fresh', source: 'fixture', fetchedAt: Date.now() }, errors: [] })
      window.api.agentsStatus = async () => { reads++; return envelope() }
      window.api.agentsCommand = async command => {
        commands.push(command)
        if (fail) throw Error('Fixture connection unavailable')
        if (command.type === 'connect') { state.connected = true; state.models = models; state.model ||= models[0].id }
        if (command.type === 'configure') { state.model = command.model; state.thinking = command.thinking }
        if (command.type === 'send') {
          state.messages.push({ id: 'user-' + commands.length, role: 'user', text: command.text, images: command.images?.map(image => image.name), at: Date.now() },
            { id: 'activity-' + commands.length, role: 'activity', text: 'Opening Charts · AAPL', at: Date.now() },
            { id: 'answer-' + commands.length, role: 'assistant', text: formattedReply, at: Date.now() })
          if (command.images?.length) state.portfolioProposal = { id: 'review-' + commands.length, portfolioId: 'portfolio_1', portfolioName: 'Screenshot account', summary: 'Update the visible AAPL holding from the screenshot.', changes: [{ field: 'AAPL · Shares', before: '12', after: '25' }, { field: 'AAPL · Average cost', before: '5', after: '123.45' }] }
        }
        if (command.type === 'portfolioDecision') { if (command.approve) portfolioSaves++; state.portfolioProposal = null }
        if (command.type === 'autonomy') { state.autonomy = command.enabled; state.objective = command.objective || ''; state.runsRemaining = 3; state.nextRunAt = Date.now() + 900000 }
        if (command.type === 'stop') { state.autonomy = false; state.busy = false; state.connected = false; state.nextRunAt = null }
        if (command.type === 'newChat') { state.messages = []; state.connected = false }
        return envelope()
      }
      const render = () => root.render(<QueryClientProvider client={client}><AgentsPage onStatusChange={() => {}} favorite={favorite} onToggleFavorite={() => { favorite = !favorite; render() }} /></QueryClientProvider>)
      const click = async label => { const button = [...document.querySelectorAll('button')].find(button => button.textContent === label || button.getAttribute('aria-label') === label); check(button && !button.disabled, 'Missing or disabled ' + label); button.click(); await settle() }
      const fill = async (id, value) => { const input = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); await settle() }
      const select = async (id, value) => { const input = document.getElementById(id); input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); await settle() }
      const imageFile = () => new File([Uint8Array.from(atob(window.portfolioImage.split(',')[1]), character => character.charCodeAt(0))], 'Portfolio screenshot.png', { type: 'image/png' })
      const paste = async () => { const clipboard = new DataTransfer(); clipboard.items.add(imageFile()); document.getElementById('agent-message').dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true })); await settle() }
      window.runProbe = async () => {
        const tasks = buildTasks(undefined, { hiddenTabs: ['agents'] }, { stocks: '', fundamentals: '' }, { year: 2026, month: 9, earningsYear: 2026, ipoYear: 2026 }).filter(task => task.tab === 'agents')
        check(tasks.length === 1, 'Hidden Agents page must preload at startup')
        await tasks[0].run(client)
        render(); await settle()
        check(reads === 1 && commands.length === 0, 'Opening a warmed Agents page must neither reload nor connect')
        check(document.querySelector('.agents-header').contains(document.getElementById('agent-model')), 'Model settings share the compact toolbar')
        await click('Add page to favorites')
        check(document.querySelector('[aria-label="Remove page from favorites"]').getAttribute('aria-pressed') === 'true', 'Toolbar favorite toggle stays accessible')
        await click('Remove page from favorites')
        check(document.getElementById('agent-controls').hidden, 'Chat starts with controls tucked away')
        await click('Controls')
        check(!document.getElementById('agent-controls').hidden, 'Controls can be expanded')
        check(document.querySelector('[role=switch]').getAttribute('aria-checked') === 'false', 'Autonomy starts off')
        check(document.getElementById('agent-model').disabled && document.getElementById('agent-thinking').disabled, 'Model settings require a connection')
        check(!shouldPersistRemoteQuery(client.getQueryCache().find({ queryKey: ['agents'] })), 'Private chat must not persist in renderer cache')
        await click('Connect Codex')
        check(document.body.innerText.includes('Connected'), 'Connection status')
        check(document.getElementById('agent-model').value === 'fixture-fast', 'Current model is visible')
        check(document.getElementById('agent-thinking').textContent.includes('Default (Low)'), 'Current thinking default is visible')
        await select('agent-thinking', 'high')
        check(commands.at(-1).thinking === 'high' && document.getElementById('agent-thinking').value === 'high', 'Thinking selection reaches main process')
        await select('agent-model', 'fixture-research')
        check(commands.at(-1).model === 'fixture-research' && commands.at(-1).thinking === null, 'Model change resets thinking to the new default')
        check(!document.getElementById('agent-thinking').textContent.includes('High') && document.getElementById('agent-thinking').textContent.includes('Medium'), 'Only supported thinking modes are offered')
        await fill('agent-message', 'Show me the charts for AAPL. Keep **my text** and -5%.')
        await click('Send message')
        check(document.querySelector('[role=log]').textContent.includes('Opened the AAPL charts page'), 'Assistant response')
        const reply = document.querySelector('.agents-prose')
        check(reply.querySelector('h2').textContent === 'Your portfolio at a glance', 'Markdown headings render without hash markers')
        check(reply.querySelector('strong').textContent === 'key things to review' && !reply.textContent.includes('**'), 'Bold markers become emphasis')
        check(reply.querySelectorAll('ul > li').length === 3 && reply.querySelector('ul ul em').textContent === 'source dates', 'Dash and asterisk lists render with nested emphasis')
        check(reply.querySelectorAll('ol > li').length === 2 && reply.querySelectorAll('tbody tr').length === 2, 'Ordered lists and GFM tables render')
        check(reply.querySelector('pre code').textContent.includes('-5% · A * B'), 'Literal minus signs and multiplication survive inside code')
        check(document.querySelector('.agents-message.user').textContent.includes('**my text** and -5%'), 'User text stays literal')
        check(!reply.querySelector('img, script, [onerror]') && !window.unsafeMarkup, 'Model output cannot load images or execute HTML')
        check(reply.querySelectorAll('a').length === 1, 'Unsafe URL schemes cannot produce links')
        reply.querySelector('a').click(); await settle()
        check(openedLinks[0] === 'https://example.com/research', 'Response links use the external browser bridge')
        check(document.getElementById('agent-message').value === '', 'Successful send clears composer')
        await fill('agent-objective', 'Review portfolio news for meaningful changes')
        await click('Enable autonomous mode')
        check(document.querySelector('[role=switch]').getAttribute('aria-checked') === 'true', 'Explicit autonomy enable')
        check(document.getElementById('agent-model').disabled && document.getElementById('agent-thinking').disabled, 'Model settings are locked during autonomy')
        check(commands.at(-1).intervalMinutes === 15 && commands.at(-1).runs === 4, 'User monitoring bounds')
        check(document.body.innerText.includes('future runs remaining'), 'Visible monitoring schedule')
        await click('Controls')
        check(document.querySelector('.agents-monitoring').textContent.includes('3 runs remaining'), 'Active monitoring stays visible with controls closed')
        await click('Controls')
        await click('Stop')
        check(document.querySelector('[role=switch]').getAttribute('aria-checked') === 'false', 'Stop disables autonomy')
        check(document.body.innerText.includes('Disconnected'), 'Stop disconnects')
        fail = true; await click('Connect Codex')
        check(document.querySelector('[role=alert]').textContent.includes('Fixture connection unavailable'), 'Visible connection failures')
        fail = false; await click('Connect Codex')
        check(document.querySelectorAll('.agents-message').length === 3, 'Conversation survives disconnect/reconnect')
        await paste()
        check(document.querySelectorAll('.agents-image-previews img').length === 1, 'Ctrl+V clipboard image produces a preview')
        await click('×')
        check(!document.querySelector('.agents-image-previews'), 'Attached image can be removed')
        await paste(); await fill('agent-message', 'Update my portfolio from this screenshot')
        await click('Send message')
        check(commands.at(-1).images[0].dataUrl === window.portfolioImage, 'Pasted image bytes must reach the agent')
        check(!document.querySelector('.agents-image-previews'), 'Successful image send clears attachments')
        check(document.body.textContent.includes('Attached image: Portfolio screenshot.png'), 'Sent image remains identified in conversation')
        check(document.querySelector('[aria-label="Review portfolio update"]').textContent.includes('123.45') && portfolioSaves === 0, 'Portfolio values must be previewed before a write')
        await click('Apply portfolio update')
        check(portfolioSaves === 1 && !document.querySelector('[aria-label="Review portfolio update"]'), 'Apply sends a portfolio approval')
        await paste(); await click('Send message')
        check(commands.at(-1).text === '' && commands.at(-1).images.length === 1, 'Image-only submission works')
        await click('Dismiss update')
        check(portfolioSaves === 1, 'Dismissing a preview never saves')
        const picker = document.querySelector('input[aria-label="Attach images"]')
        const files = new DataTransfer(); files.items.add(imageFile()); picker.files = files.files; picker.dispatchEvent(new Event('change', { bubbles: true })); await settle()
        check(document.querySelectorAll('.agents-image-previews img').length === 1, 'File picker attaches images')
        await click('Send message')
        check(document.documentElement.scrollWidth <= innerWidth, 'No horizontal overflow')
        await click('Dismiss update')
        state.messages = state.messages.slice(0, 3)
        client.setQueryData(['agents'], envelope()); await settle()
        window.setControls = async open => { if (document.getElementById('agent-controls').hidden === open) await click('Controls') }
        return 'PASS: formatted Markdown, nested lists, tables, code, safe links, literal user text, chat controls, image paste/picker/send, portfolio review, model settings, autonomy, startup readiness and private cache exclusion'
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
        mkdirSync(${JSON.stringify(resolve(root, '../../output/playwright'))}, { recursive: true })
        const fixture = await window.webContents.executeJavaScript('window.portfolioImage')
        writeFileSync(${JSON.stringify(resolve(root, '../../output/playwright/agent-portfolio-fixture.png'))}, Buffer.from(fixture.split(',')[1], 'base64'))
        console.log(await window.webContents.executeJavaScript('window.runProbe()'))
        const errors = await window.webContents.executeJavaScript('window.probeErrors')
        if (errors.length) throw Error(errors.join('; '))
        for (const width of [900, 1600, 600]) {
          window.setSize(width, 900)
          await new Promise(resolve => setTimeout(resolve, 150))
          for (const controls of [true, false]) {
            await window.webContents.executeJavaScript('window.setControls(' + controls + ')')
            const sizing = await window.webContents.executeJavaScript('({ viewport: innerWidth, width: document.documentElement.scrollWidth, composer: document.querySelector(".agents-composer").getBoundingClientRect().bottom, height: innerHeight, reply: document.querySelector(".agents-prose").getBoundingClientRect().width, transcript: document.querySelector(".agents-transcript").clientWidth, toolbar: document.querySelector(".agents-header").getBoundingClientRect().height })')
            if (sizing.width > sizing.viewport || (width > 700 && sizing.composer > sizing.height) || sizing.reply > sizing.transcript) throw Error('Layout overflow: ' + JSON.stringify(sizing))
            if (width === 1600 && sizing.toolbar > 44) throw Error('Desktop Agents toolbar must fit in one compact row: ' + JSON.stringify(sizing))
          }
        }
        window.setSize(1300, 900)
        await new Promise(resolve => setTimeout(resolve, 200))
        await window.webContents.executeJavaScript('document.querySelector(".agents-transcript").scrollTop = 0')
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
