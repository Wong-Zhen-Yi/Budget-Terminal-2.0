import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-agents-topbar-'))
try {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
      import { TabBar } from './src/components/chrome/TabBar'
      import { AgentsPage } from './src/pages/AgentsPage'
      import { NewsReader } from './src/components/news/NewsReader'
      import { useAgentDraft } from './src/stores/agentDraft'
      const check = (value, message) => { if (!value) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 70))
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: Infinity } } })
      const root = createRoot(document.getElementById('root'))
      const commands = []
      let reads = 0, historyReads = 0, available = true, fail = false, gate = null, release, page = 'Charts', isMac = false
      const state = { activity: 'idle', currentChatId: 'fixture-chat', history: [], notifications: [], trackers: [], storageError: '', portfolioProposal: null,
        model: 'fixture', thinking: null, models: [{ id: 'fixture', name: 'Fixture Codex', defaultThinking: 'low', thinkingModes: [{ id: 'low', description: 'Quick' }] }],
        connected: true, busy: false, autonomy: false, objective: '', intervalMinutes: 15, runsRemaining: 0, nextRunAt: null,
        messages: [{ id: 'hello', role: 'assistant', text: '## Research ready\\n\\nYour existing conversation is available here.', at: Date.now() }], error: '', navigation: null }
      const envelope = () => ({ data: structuredClone(state), meta: { freshness: 'fresh', source: 'fixture', fetchedAt: Date.now() }, errors: [] })
      const publish = async () => { client.setQueryData(['agents'], envelope()); await settle() }
      window.api.platform = 'win32'
      window.api.mcpStatus = async () => ({ available: true, active: false, connected: true })
      const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
      window.api.agentsImage = async () => ({ data: { name: 'Generated pixel.png', dataUrl: pixel }, meta: { freshness: 'fresh', source: 'fixture', fetchedAt: Date.now() }, errors: [] })
      window.api.agentsStatus = async () => { reads++; return envelope() }
      window.api.chartsHistory = async request => {
        historyReads++
        return { data: { symbol: request.symbol, intervalLabel: request.interval, rangeLabel: request.range, interval: '1d', candles: Array.from({ length: 1000 }, (_, index) => ({ time: Date.UTC(2023, 0, index + 1) / 1000, open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index, volume: 1000 })), stats: null, indicators: { ma50: [], ma200: [], rsi: [], rsiMa: [] } }, meta: { freshness: 'fresh', source: 'fixture', fetchedAt: Date.now() }, errors: [] }
      }
      window.api.agentsCommand = async command => {
        commands.push(command)
        if (gate && command.type === 'send') await gate
        if (fail) throw Error('Fixture send failed')
        if (command.type === 'send') { state.messages.push({ id: 'user-' + commands.length, role: 'user', text: command.text, at: Date.now() }); state.activity = 'done' }
        if (command.type === 'connect') { state.connected = true; state.activity = 'idle' }
        if (command.type === 'stop') { state.busy = false; state.connected = false; state.activity = 'stopped' }
        if (command.type === 'newChat') { state.messages = []; state.activity = 'idle' }
        return envelope()
      }
      const status = () => {}
      let showReader = false, readerLoading = false
      const story = { id: 'summary-fixture', title: 'Fixture chipmaker reports revenue growth', source: 'Fixture publisher', time: '10:00', url: 'https://example.test/news', ticker: 'NVDA', category: 'portfolio', publishedAt: Date.now(), score: null, signals: [], imageUrl: '', summary: 'Fixture publisher summary.' }
      const preview = { url: story.url, text: 'Fixture revenue grew 12% to $5 billion. Management left guidance unchanged.', origin: 'article', truncated: false }
      const render = () => root.render(<QueryClientProvider client={client}>
        <TabBar onOpenPicker={() => {}} onReload={() => {}} reloading={false} clockCountry="US" time12h obscured={false} onToggleObscure={() => {}} agentChatAvailable={available} />
        <main className="flex min-h-0 flex-1 flex-col"><h1 id="underlying-page">{page}</h1><AgentsPage onStatusChange={status} /><div hidden><AgentsPage embedded onStatusChange={status} /></div>
        {showReader && <div id="news-reader-fixture" style={{ position: 'fixed', right: 12, top: 150, width: 300, height: 550, display: 'flex', flexDirection: 'column' }}><NewsReader article={story} preview={preview} loading={readerLoading} onOpen={() => {}} onClose={() => {}} now={Date.now()} /></div>}</main>
      </QueryClientProvider>)
      const input = () => document.querySelector('input[aria-label="Ask Agent"]')
      const dialog = () => document.getElementById('topbar-agent-chat')
      const activity = () => document.querySelector('[data-agent-activity]')
      const fill = async (element, value) => {
        Object.getOwnPropertyDescriptor(element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value').set.call(element, value)
        element.dispatchEvent(new Event('input', { bubbles: true })); await settle()
      }
      const click = async label => { const button = [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label); check(button && !button.disabled, 'Missing/disabled ' + label); button.click(); await settle() }
      window.runProbe = async () => {
        client.setQueryData(['agents'], envelope()); render(); await settle()
        check(input() && !dialog() && reads === 0 && commands.length === 0, 'Warmed top bar starts closed without connection, inference or reload')
        check(activity().textContent === 'Ready', 'Saved assistant text must not be mistaken for a newly completed run')
        input().click(); await settle()
        check(dialog().getAttribute('role') === 'dialog' && dialog().getAttribute('aria-modal') === 'false', 'Input opens a nonmodal full chat dropdown')
        check(dialog().textContent.includes('existing conversation') && input().getAttribute('aria-expanded') === 'true', 'Shared transcript and expanded state')
        const ids = [...document.querySelectorAll('[id]')].map(element => element.id)
        check(ids.length === new Set(ids).size, 'Top bar, page and Dashboard chat controls must have unique IDs')
        await fill(input(), 'Research AAPL in this chat')
        check(document.getElementById('topbar-agent-message').value === input().value && document.getElementById('agent-message').value === input().value, 'Draft is shared across chat surfaces')
        input().closest('form').requestSubmit(); await settle()
        check(commands.length === 1 && commands[0].type === 'send' && commands[0].text === 'Research AAPL in this chat', 'Top bar sends exactly once')
        check(input().value === '' && document.activeElement.id === 'topbar-agent-message', 'Successful top-bar send clears draft and focuses full composer')
        check(document.getElementById('underlying-page').textContent === 'Charts', 'Chat never navigates away from current page')
        await fill(document.getElementById('topbar-agent-message'), 'Follow up')
        dialog().querySelector('button[aria-label="Send message"]').click(); await settle()
        check(commands.at(-1).text === 'Follow up', 'Dropdown has a working full composer')
        state.busy = true; state.activity = 'thinking'; state.messages.push({ id: 'stream', role: 'assistant', text: 'Streaming', at: Date.now() }); await publish()
        check(activity().textContent === 'Thinking' && input().getAttribute('aria-busy') === 'true', 'Top bar shows live thinking without replacing the draft field')
        state.activity = 'researching'; await publish()
        check(activity().textContent === 'Researching', 'Research activity is distinct from thinking')
        await click('Close Agent chat panel')
        check(!dialog() && document.activeElement === input() && commands.length === 2, 'Closing restores focus without Stop or disconnect')
        check(activity().textContent === 'Researching', 'Activity remains visible when the chat is closed')
        state.activity = 'responding'; await publish()
        check(activity().textContent === 'Writing', 'Response streaming has its own status')
        state.messages.at(-1).text += ' completed while closed'; state.busy = false; state.activity = 'done'; await publish()
        check(activity().textContent === 'Done' && input().getAttribute('aria-busy') === 'false', 'Successful completion shows Done while chat is closed')
        await click('Open Agent chat')
        check(dialog().textContent.includes('completed while closed') && state.connected && commands.length === 2, 'Reopening retains background output and connection')
        await fill(input(), 'Unsent draft')
        document.getElementById('topbar-agent-message').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle()
        check(!dialog() && document.activeElement === input() && input().value === 'Unsent draft', 'Escape closes and preserves draft')
        await click('Open Agent chat')
        document.getElementById('underlying-page').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await settle()
        check(!dialog() && input().value === 'Unsent draft', 'Outside click dismisses without dropping draft')
        await click('Open Agent chat')
        let escapedBacktick = false
        const shortcut = event => { if (event.key === String.fromCharCode(96)) escapedBacktick = true }
        window.addEventListener('keydown', shortcut)
        for (const element of [input(), document.getElementById('topbar-agent-message')]) element.dispatchEvent(new KeyboardEvent('keydown', { key: String.fromCharCode(96), bubbles: true }))
        window.removeEventListener('keydown', shortcut)
        check(!escapedBacktick, 'Literal backticks do not trigger page search from either chat field')
        const composing = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })
        input().dispatchEvent(composing); check(composing.defaultPrevented, 'IME composition must not submit')
        fail = true; input().closest('form').requestSubmit(); await settle()
        check(dialog().querySelector('[role=alert]').textContent.includes('Fixture send failed') && input().value === 'Unsent draft', 'Failed sends stay visible and preserve text')
        check(activity().textContent === 'Error', 'Failed sends must not show Done')
        fail = false; gate = new Promise(resolve => { release = resolve })
        input().closest('form').requestSubmit(); await settle()
        const count = commands.length
        check(activity().textContent === 'Thinking', 'Sending shows Thinking immediately before IPC returns')
        dialog().querySelector('form').requestSubmit(); await settle()
        check(commands.length === count && dialog().querySelector('[aria-label="Send message"]').disabled, 'Shared lock prevents duplicate sends from simultaneous surfaces')
        await fill(input(), 'Next draft typed while sending')
        release(); gate = null; await settle()
        check(input().value === 'Next draft typed while sending', 'Completing a send must not erase newly typed text')
        state.connected = false; await publish()
        check(input().closest('form').querySelector('[aria-label="Send to Agent"]').disabled, 'Disconnected send is disabled')
        check(activity().textContent === 'Disconnected', 'Disconnected snapshots cannot keep a stale Done status')
        dialog().querySelector('.agents-actions button').click(); await settle()
        check(commands.at(-1).type === 'connect' && state.connected, 'Existing connection help works inside dropdown')
        state.portfolioProposal = { id: 'proposal', portfolioName: 'Fixture account', summary: 'Review first', changes: [{ field: 'AAPL Shares', before: '1', after: '2' }] }; await publish()
        check(dialog().querySelector('[aria-label="Review portfolio update"]') && input().closest('form').querySelector('[aria-label="Send to Agent"]').disabled, 'Portfolio approval flow remains visible and blocks overlapping sends')
        state.portfolioProposal = null; await publish()
        available = false; render(); await settle()
        check(!dialog() && input().disabled && input().value === '', 'Privacy/screenshot mode hides the panel and unsent text')
        check(activity().textContent === 'Hidden', 'Privacy mode hides activity rather than exposing task details')
        available = true; render(); await settle()
        check(!dialog() && input().value === 'Next draft typed while sending', 'Restoring availability preserves draft without reopening private chat')
        page = 'Portfolio'; render(); await settle(); await click('Open Agent chat')
        check(document.getElementById('underlying-page').textContent === 'Portfolio' && dialog().textContent.includes('completed while closed'), 'Chat is available on another page with the same conversation')
        await click('Close Agent chat panel')
        showReader = true; render(); await settle()
        const summaryButton = () => [...document.querySelectorAll('#news-reader-fixture button')].find(button => button.textContent === 'AI Summary')
        check(summaryButton() && !summaryButton().disabled, 'Reader offers AI Summary with a connected Agent')
        const footer = summaryButton().parentElement.getBoundingClientRect()
        check(footer.width <= 300 && summaryButton().getBoundingClientRect().right <= footer.right, 'Summary action fits the narrow 300px reader')
        readerLoading = true; render(); await settle()
        check(summaryButton().disabled, 'Summary waits for preview loading')
        readerLoading = false; state.busy = true; await publish(); render(); await settle()
        check(summaryButton().disabled, 'Summary respects the shared Agent busy lock')
        state.busy = false; state.connected = false; await publish()
        check(summaryButton().disabled && summaryButton().title.includes('Connect Codex'), 'Disconnected reader explains how to enable summaries')
        state.connected = true; await publish(); available = false; render(); await settle()
        check(summaryButton().disabled && !dialog(), 'Privacy mode disables summary requests')
        available = true; render(); await settle()
        const savedDraft = useAgentDraft.getState().draft
        const savedImages = [{ name: 'Unsent pixel.png', dataUrl: pixel }]
        useAgentDraft.getState().update({ images: savedImages }); await settle()
        const beforeSummary = commands.length
        summaryButton().click(); summaryButton().click(); await settle()
        check(commands.length === beforeSummary + 1 && commands.at(-1).text.includes(preview.text) && commands.at(-1).text.includes(story.title), 'Reader sends exactly one selected-story summary through the existing Agent')
        check(dialog() && document.getElementById('underlying-page').textContent === 'Portfolio', 'Summary opens the full chat without navigating')
        check(useAgentDraft.getState().draft === savedDraft && useAgentDraft.getState().images === savedImages, 'Summary preserves unsent draft and image attachments')
        await click('Close Agent chat panel')
        fail = true; summaryButton().click(); await settle()
        check(dialog().querySelector('[role=alert]').textContent.includes('Fixture send failed'), 'Failed summary is visible in Agent chat')
        fail = false; useAgentDraft.getState().update({ images: [], error: '' }); showReader = false; render(); await settle()
        const chart = { title: 'Synthetic full-history chart', symbol: 'AAPL', unit: 'USD', caption: 'Synthetic fixture only · not market data' }
        state.activity = 'done'
        state.messages.push({ id: 'chart', role: 'assistant', text: ['## Inline candlestick chart', '', String.fromCharCode(96).repeat(3) + 'candlestick', JSON.stringify(chart), String.fromCharCode(96).repeat(3)].join('\\n'), at: Date.now(), imageArtifacts: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Generated pixel.png', kind: 'generated' }] }); await publish()
        check(dialog().querySelector('.agents-market-chart canvas') && dialog().querySelector('[data-history-count]').dataset.historyCount === '1000', 'Dropdown displays real interactive full-history charts')
        check(historyReads === 1, 'Agents, embedded Dashboard and dropdown share the full-history cache')
        const oneYear = [...dialog().querySelectorAll('.agents-history-ranges button')].find(button => button.textContent === '1Y')
        oneYear.click(); await publish()
        check(oneYear.getAttribute('aria-pressed') === 'true', 'Top-bar chart timeframe survives shared Agent polling')
        dialog().querySelector('.agents-chat-image').scrollIntoView({ block: 'center' }); await settle()
        check(dialog().querySelector('.agents-chat-image img')?.src === pixel, 'Top-bar dropdown displays trusted generated images')
        dialog().querySelector('.agents-chat-image button').click(); await settle()
        check(dialog().querySelector('.agents-image-previews img')?.src === pixel && useAgentDraft.getState().images.length === 1, 'Image edit attachment works in dropdown and shares the global draft')
        window.checkLayout = async (mac = false) => {
          window.api.platform = mac ? 'darwin' : 'win32'; render(); await settle()
          const topbar = document.querySelector('.terminal-topbar').getBoundingClientRect()
          const box = dialog().getBoundingClientRect()
          const composer = dialog().querySelector('.agents-composer').getBoundingClientRect()
          check(document.documentElement.scrollWidth <= innerWidth, 'Top bar must not overflow viewport')
          check(input().getBoundingClientRect().width > 60, 'Keep top-bar chat input usable')
          check(box.left >= 0 && box.right <= innerWidth && box.top >= topbar.bottom && box.bottom <= innerHeight, 'Dropdown stays below title bar and inside viewport')
          check(composer.bottom <= box.bottom && composer.height > 60, 'Full composer remains inside dropdown')
          const savedActivity = state.activity
          for (const phase of ['researching', 'generating', 'done']) {
            state.activity = phase; state.busy = phase !== 'done'; await publish()
            check(input().getBoundingClientRect().width > 60 && document.documentElement.scrollWidth <= innerWidth, 'Keep input usable with ' + phase + ' badge')
          }
          state.activity = savedActivity; state.busy = false; await publish()
          return 'PASS: top-bar/dropdown layout at ' + innerWidth + (mac ? ' macOS' : ' Windows')
        }
        return 'PASS: News reader AI Summary sends selected evidence once, preserves drafts/images, respects loading/busy/privacy/disconnect, fits a 300px reader and surfaces failures; live Thinking/Researching/Writing/Done badges while closed, immediate sending feedback, Error/disconnect/privacy states, narrow badge layouts, shared full Agent chat, no extra startup reads/inference, unique control IDs, top-bar and composer sends, background output, draft retention, Escape/outside dismissal, focus return, safe keyboard/IME handling, failures, global send lock, connection help, portfolio review, privacy and inline charts'
      }
    ` }, bundle: true, jsx: 'automatic', write: false, format: 'iife', loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' }, alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
  })
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(file => file.endsWith('.css'))!
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), '<link rel="stylesheet" href="theme.css"><style>html,body,#root{height:100%;width:100%;margin:0}#root{display:flex;flex-direction:column}</style><div id="root"></div><script>window.api={};window.probeErrors=[];window.addEventListener("error",event=>window.probeErrors.push(event.message))</script><script src="renderer.js"></script>')
  const screenshot = resolve(root, '../../output/playwright/agents-topbar.png')
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    const { mkdirSync, writeFileSync } = require('node:fs')
    app.disableHardwareAcceleration()
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1920, height: 1080, webPreferences: { backgroundThrottling: false, offscreen: true } })
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        console.log(await window.webContents.executeJavaScript('window.runProbe()'))
        for (const width of [900, 1280, 1920]) {
          window.setSize(width, 900)
          console.log(await window.webContents.executeJavaScript('window.checkLayout()'))
        }
        window.setSize(1280, 720)
        console.log(await window.webContents.executeJavaScript('window.checkLayout(true)'))
        window.setSize(1920, 1080)
        await window.webContents.executeJavaScript('window.checkLayout(false)')
        await window.webContents.executeJavaScript('document.querySelector("#topbar-agent-chat .agents-candlestick").scrollIntoView({block:"center"})')
        await new Promise(resolve => setTimeout(resolve, 150))
        const errors = await window.webContents.executeJavaScript('window.probeErrors')
        if (errors.length) throw Error(errors.join('; '))
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
    const timer = setTimeout(() => { child.kill(); reject(new Error('Top bar Agent UI probe timed out')) }, 40_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log('Screenshot:', screenshot)
} finally {
  assert(directory.startsWith(join(tmpdir(), 'budget-agents-topbar-')))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
