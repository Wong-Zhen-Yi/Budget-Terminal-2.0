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
  '![Remote image](https://example.com/tracker.png)', '<img src=x onerror="window.unsafeMarkup=true">', '',
  '```pie', JSON.stringify({ title: 'Portfolio allocation', unit: 'USD', slices: [{ label: 'Stocks', value: 750 }, { label: 'Cash', value: 250 }, { label: 'Empty', value: 0 }], caption: 'Fixture values · as of 2026-10-17 · no live data' }), '```', '',
  '```pie', '{"title":"Incomplete",', '```', '',
  '```pie', JSON.stringify({ title: 'Cash only', slices: [{ label: '<img src=x onerror=alert(1)>', value: 1 }] }), '```', '',
  '```candlestick', JSON.stringify({ title: 'AAPL · daily OHLC', unit: 'USD', candles: [
    { time: '2026-10-14', open: 210, high: 215, low: 208, close: 214 },
    { time: '2026-10-15', open: 214, high: 216, low: 209, close: 211 },
    { time: '2026-10-16', open: 211, high: 213, low: 210, close: 211 },
  ], caption: 'Synthetic OHLC fixture · daily · as of 2026-10-17 · no live data' }), '```', '',
  '```candlestick', '{"title":"Streaming",', '```', '',
  '```candlestick', JSON.stringify({ title: '<img src=x onerror=alert(1)>', candles: [{ time: '2026-10-16', open: 0, high: 0, low: 0, close: 0 }], caption: '<script>alert(1)</script>' }), '```', '',
  '```candlestick', JSON.stringify({ title: 'Intraday scroll fixture', candles: Array.from({ length: 200 }, (_, index) => ({ time: new Date(Date.UTC(2026, 9, 16, 9, 30 + index)).toISOString(), open: -5, high: -4.9999, low: -5.0001, close: -5.00005 })) }), '```',
].join('\n')
try {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
      import { AgentsPage } from './src/pages/AgentsPage'
      import { agentQuickPrompts } from './src/lib/agentPrompts'
      import { buildTasks } from './src/api/prefetch'
      import { shouldPersistRemoteQuery } from './src/api/queryPersistence'
      const check = (value, message) => { if (!value) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 120))
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
      const root = createRoot(document.getElementById('root'))
      let reads = 0, commands = [], fail = false, portfolioSaves = 0, favorite = false, embedded = false
      const openedLinks = [], imageReads = []
      const generatedId = '11111111-1111-4111-8111-111111111111'
      const missingId = '22222222-2222-4222-8222-222222222222'
      window.api.openExternal = async url => { openedLinks.push(url) }
      const formattedReply = ${JSON.stringify(formattedReply)}
      const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 300
      const drawing = canvas.getContext('2d'); drawing.fillStyle = '#ffffff'; drawing.fillRect(0, 0, 900, 300); drawing.fillStyle = '#111111'; drawing.font = '24px monospace'
      drawing.fillText('Synthetic Portfolio Fixture', 30, 50)
      drawing.fillText('Ticker      Shares      Average cost (USD)', 30, 120)
      drawing.fillText('AAPL        25          123.45', 30, 180)
      window.portfolioImage = canvas.toDataURL('image/png')
      window.api.agentsImage = async id => {
        imageReads.push(id)
        return id === generatedId
          ? { data: { name: 'Generated illustration.png', dataUrl: window.portfolioImage }, meta: { freshness: 'fresh', source: 'fixture', fetchedAt: Date.now() }, errors: [] }
          : { data: null, meta: { freshness: 'failed', source: 'fixture', fetchedAt: Date.now() }, errors: [{ reason: 'Fixture image missing' }] }
      }
      const models = [
        { id: 'fixture-fast', name: 'Codex fast', defaultThinking: 'low', thinkingModes: [{ id: 'low', description: 'Quick' }, { id: 'high', description: 'Deeper' }] },
        { id: 'fixture-research', name: 'Codex research', defaultThinking: 'medium', thinkingModes: [{ id: 'medium', description: 'Balanced' }] },
      ]
      const trackerFixture = { id: 'tracker-fixture', title: 'Custom catalyst research', instructions: 'Use fresh research tools to evaluate my custom catalyst conditions. Compare with saved evidence and report unknown if coverage is missing.', intervalMinutes: 15, cooldownMinutes: 60, runLimit: 4, runsRemaining: 4, enabled: false, running: false, createdAt: Date.now(), updatedAt: Date.now(), nextRunAt: null, lastRunAt: null, lastNotifiedAt: null, lastOutcome: null, lastSummary: '', memory: '', error: '' }
      const state = { currentChatId: 'chat-current', history: [{ id: 'chat-current', title: 'New chat', createdAt: Date.now(), updatedAt: Date.now(), model: null, thinking: null, messageCount: 0 }, { id: 'chat-saved', title: 'Saved research', createdAt: Date.now(), updatedAt: Date.now(), model: 'fixture-fast', thinking: null, messageCount: 2 }], notifications: [{ id: 'notice-1', title: 'Monitoring update', body: 'Synthetic cited evidence · fresh. <img src=x onerror=alert(1)>', at: Date.now(), read: false, eventKey: 'fixture-1', source: 'autonomy', deliveryError: 'OS notifications blocked' }], trackers: [trackerFixture], storageError: '', portfolioProposal: null, model: null, thinking: null, models: [], connected: false, busy: false, autonomy: false, objective: '', intervalMinutes: 15, runsRemaining: 0, nextRunAt: null, messages: [], error: '', navigation: null }
      const historyMessages = new Map([['chat-saved', [{ id: 'saved-user', role: 'user', text: 'Previous research question', at: Date.now() }, { id: 'saved-answer', role: 'assistant', text: 'Saved answer with source dates', at: Date.now() }]]])
      const envelope = () => ({ data: structuredClone(state), meta: { freshness: 'fresh', source: 'fixture', fetchedAt: Date.now() }, errors: [] })
      window.api.agentsStatus = async () => {
        reads++
        if (reads === 1) {
          state.connected = true; state.models = models; state.model = models[0].id
          state.messages.push({ id: 'startup', role: 'activity', text: 'Codex connected.', at: Date.now() })
        }
        return envelope()
      }
      window.api.agentsCommand = async command => {
        commands.push(command)
        if (fail) throw Error('Fixture connection unavailable')
        if (command.type === 'connect') { state.connected = true; state.models = models; state.model ||= models[0].id }
        if (command.type === 'configure') { state.model = command.model; state.thinking = command.thinking }
        if (command.type === 'send') {
          state.messages.push({ id: 'user-' + commands.length, role: 'user', text: command.text, images: command.images?.map(image => image.name), at: Date.now() },
            { id: 'activity-' + commands.length, role: 'activity', text: 'Opening Charts · AAPL', at: Date.now() },
            { id: 'answer-' + commands.length, role: 'assistant', text: formattedReply, at: Date.now(), imageArtifacts: [{ id: generatedId, name: 'Generated illustration.png', kind: 'generated' }, { id: missingId, name: '<img src=x onerror=alert(1)>', kind: 'generated' }], imageStatus: 'ready' })
          if (command.images?.length) state.portfolioProposal = { id: 'review-' + commands.length, portfolioId: 'portfolio_1', portfolioName: 'Screenshot account', summary: 'Update the visible AAPL holding from the screenshot.', changes: [{ field: 'AAPL · Shares', before: '12', after: '25' }, { field: 'AAPL · Average cost', before: '5', after: '123.45' }] }
        }
        if (command.type === 'portfolioDecision') { if (command.approve) portfolioSaves++; state.portfolioProposal = null }
        if (command.type === 'autonomy') { state.autonomy = command.enabled; state.objective = command.objective || ''; state.runsRemaining = 3; state.nextRunAt = Date.now() + 900000 }
        if (command.type === 'stop') { state.autonomy = false; state.busy = false; state.connected = false; state.nextRunAt = null }
        if (command.type === 'newChat') {
          historyMessages.set(state.currentChatId, structuredClone(state.messages))
          state.currentChatId = 'chat-' + commands.length
          state.history.push({ id: state.currentChatId, title: 'New chat', createdAt: Date.now(), updatedAt: Date.now(), model: state.model, thinking: state.thinking, messageCount: 0 })
          state.messages = []; state.portfolioProposal = null; state.error = ''
        }
        if (command.type === 'openChat') { state.currentChatId = command.id; state.messages = structuredClone(historyMessages.get(command.id) || []); state.portfolioProposal = null }
        if (command.type === 'deleteChat') state.history = state.history.filter(chat => chat.id !== command.id)
        if (command.type === 'readNotifications') state.notifications.forEach(notification => { if (!command.id || command.id === notification.id) notification.read = true })
        if (command.type === 'deleteNotification') state.notifications = state.notifications.filter(notification => notification.id !== command.id)
        if (command.type === 'trackerEnabled') { const tracker = state.trackers.find(tracker => tracker.id === command.id); tracker.enabled = command.enabled; tracker.nextRunAt = command.enabled ? Date.now() + 900000 : null }
        if (command.type === 'deleteTracker') state.trackers = state.trackers.filter(tracker => tracker.id !== command.id)
        return envelope()
      }
      const render = () => root.render(<QueryClientProvider client={client}><AgentsPage embedded={embedded} onStatusChange={() => {}} favorite={favorite} onToggleFavorite={() => { favorite = !favorite; render() }} /></QueryClientProvider>)
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
        const suggestions = [...document.querySelectorAll('.agents-suggestions button')]
        check(suggestions.length === 2, 'Startup connection activity must not hide the two portfolio quick prompts')
        check(agentQuickPrompts[0].prompt === 'Summarize portfolio news' && agentQuickPrompts[1].prompt === 'Brief me on my portfolio for the day', 'Quick prompts retain their original one-line text')
        for (const embeddedMode of [false, true]) {
          embedded = embeddedMode; render(); await settle()
          const buttons = [...document.querySelectorAll('.agents-suggestions button')]
          const composerId = embeddedMode ? 'dashboard-agent-message' : 'agent-message'
          for (const [index, { label, prompt }] of agentQuickPrompts.entries()) {
            check(buttons[index].textContent.startsWith(label), 'Quick prompt label stays compact: ' + label)
            check(prompt === label, 'Original quick prompt contains only its label, with no added instructions')
            buttons[index].click(); await settle()
            check(document.getElementById(composerId).value === prompt && commands.length === 0, 'Full quick prompt fills the composer without sending: ' + label)
            check(document.activeElement.id === composerId, 'Quick prompt focuses the correct composer')
            await fill(composerId, prompt + '\\nMy additional context.')
            check(document.getElementById(composerId).value.endsWith('My additional context.') && commands.length === 0, 'Preset remains editable without inference')
          }
        }
        embedded = false; render(); await settle()
        check(document.querySelector('.agents-header').contains(document.getElementById('agent-model')), 'Model settings share the compact toolbar')
        await click('Add page to favorites')
        check(document.querySelector('[aria-label="Remove page from favorites"]').getAttribute('aria-pressed') === 'true', 'Toolbar favorite toggle stays accessible')
        await click('Remove page from favorites')
        check(document.getElementById('agent-controls').hidden, 'Chat starts with controls tucked away')
        await click('Controls')
        check(!document.getElementById('agent-controls').hidden, 'Controls can be expanded')
        check(document.querySelector('[role=switch]').getAttribute('aria-checked') === 'false', 'Autonomy starts off')
        check(!document.getElementById('agent-model').disabled && !document.getElementById('agent-thinking').disabled, 'Startup connection makes model settings ready without manual Connect')
        check(!shouldPersistRemoteQuery(client.getQueryCache().find({ queryKey: ['agents'] })), 'Private chat must not persist in renderer cache')
        check(document.querySelector('.agents-status').textContent === 'Connected', 'Startup connection status')
        check(!commands.some(command => command.type === 'connect'), 'Startup does not require a renderer Connect command')
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
        check(reply.querySelectorAll('ol > li').length === 2 && reply.querySelectorAll('.agents-prose-table tbody tr').length === 2, 'Ordered lists and GFM tables render')
        check(reply.querySelector('pre code').textContent.includes('-5% · A * B'), 'Literal minus signs and multiplication survive inside code')
        check(document.querySelector('.agents-message.user').textContent.includes('**my text** and -5%'), 'User text stays literal')
        check(!reply.querySelector('img, script, [onerror]') && !window.unsafeMarkup, 'Model output cannot load images or execute HTML')
        check(reply.querySelectorAll('a').length === 1, 'Unsafe URL schemes cannot produce links')
        reply.querySelector('a').click(); await settle()
        check(openedLinks[0] === 'https://example.com/research', 'Response links use the external browser bridge')
        const pie = reply.querySelector('.agents-pie')
        check(reply.querySelectorAll('.agents-pie').length === 2 && pie.querySelectorAll('svg path').length === 2, 'Valid pie blocks render native SVG; zero slices have no wedge')
        check(pie.querySelector('figcaption').textContent === 'Portfolio allocation' && pie.querySelector('svg').getAttribute('role') === 'img', 'Pie has an accessible title')
        check(pie.querySelector('tbody').textContent.includes('75075%') && pie.querySelector('tfoot').textContent.includes('1,000100%'), 'Pie table shows amounts, percentages and total')
        check(pie.querySelector('.agents-pie-caption').textContent.includes('no live data'), 'Chart provenance stays visible')
        check(reply.querySelectorAll('.agents-pie svg circle').length === 1 && reply.textContent.includes('<img src=x onerror=alert(1)>'), 'Single category renders a full circle and labels remain literal')
        check(reply.querySelector('.agents-pie-error').textContent.includes('incomplete or invalid'), 'Malformed streaming chart falls back without breaking the response')
        const candlesticks = reply.querySelectorAll('.agents-candlestick')
        const daily = candlesticks[0]
        check(candlesticks.length === 3 && daily.querySelectorAll('.agents-candle').length === 3, 'Candlestick blocks render native SVG candles')
        check(daily.querySelectorAll('.agents-candle.up').length === 2 && daily.querySelectorAll('.agents-candle.down').length === 1, 'Rising, falling and doji candles render')
        check(daily.querySelector('figcaption').textContent === 'AAPL · daily OHLC · USD' && daily.querySelector('svg').getAttribute('role') === 'img', 'Candlesticks have an accessible title and unit')
        const exact = daily.querySelector('details')
        exact.open = true
        check(exact.querySelectorAll('tbody tr').length === 3 && exact.querySelector('tbody tr').textContent === '2026-10-14210215208214', 'Exact OHLC values are inspectable')
        check(daily.querySelector('.agents-candlestick-caption').textContent.includes('no live data'), 'Candlestick source and freshness remain visible')
        check(candlesticks[1].textContent.includes('<script>alert(1)</script>') && !candlesticks[1].querySelector('script,img'), 'Candlestick titles and captions stay literal')
        check(candlesticks[2].querySelectorAll('.agents-candle').length === 200 && candlesticks[2].textContent.includes('Times in UTC'), 'Maximum-length intraday data renders with UTC labels')
        const wick = candlesticks[2].querySelector('.agents-candle line')
        check(Math.abs(Number(wick.getAttribute('y2')) - Number(wick.getAttribute('y1'))) > 190, 'Tight intraday price ranges use the available chart height')
        const scroller = candlesticks[2].querySelector('.agents-candlestick-plot')
        check(scroller.scrollWidth > scroller.clientWidth && scroller.tabIndex === 0, 'Long charts scroll within a keyboard-focusable region')
        check(![...reply.querySelectorAll('.agents-candlestick svg [x], .agents-candlestick svg [y], .agents-candlestick svg [height]')].some(node => [...node.attributes].some(attribute => /NaN|Infinity/.test(attribute.value))), 'Flat and negative-price geometry stays finite')
        check(reply.querySelector('.agents-candlestick-error').textContent.includes('incomplete or invalid'), 'Incomplete streaming candlesticks have a visible safe fallback')
        check(document.getElementById('agent-message').value === '', 'Successful send clears composer')
        const card = document.querySelector('.agents-chat-image')
        card.scrollIntoView({ block: 'center' }); await settle()
        check(card.querySelector('img')?.src === window.portfolioImage && card.textContent.includes('AI-generated image'), 'Trusted generated images display inline outside Markdown')
        check(!shouldPersistRemoteQuery(client.getQueryCache().find({ queryKey: ['agentImages', generatedId] })), 'Private image bytes must not persist in renderer query cache')
        const missing = document.querySelectorAll('.agents-chat-image')[1]
        missing.scrollIntoView({ block: 'center' }); await settle()
        check(missing.textContent.includes('Image unavailable') && !missing.querySelector('img,script,[onerror]'), 'Missing saved images have a visible fallback and literal names')
        card.querySelector('button').click(); await settle()
        check(document.querySelector('.agents-image-previews img').src === window.portfolioImage && document.getElementById('agent-message').value === 'Edit this image: ', 'Use for edit reattaches actual image pixels without inference')
        check(commands.length === 3, 'Using an image for edit must not send or run a tool')
        card.querySelectorAll('button')[1].click(); await settle()
        check(card.classList.contains('expanded'), 'Image can expand inline')
        card.querySelectorAll('button')[1].click(); await settle()
        await click('×'); await fill('agent-message', '')
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
        check(document.querySelectorAll('.agents-message').length === 4, 'Conversation survives disconnect/reconnect')
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
        const savedMessages = state.messages.filter(message => message.id !== 'startup').slice(0, 3)
        const beforeNewChat = commands.length
        await paste(); await fill('agent-message', 'Unsent draft')
        const selectedModel = document.getElementById('agent-model').value
        await click('New chat')
        check(state.connected && document.body.innerText.includes('Connected'), 'New chat stays connected')
        check(document.querySelectorAll('.agents-message').length === 0 && document.querySelectorAll('.agents-suggestions button').length === 2, 'New chat returns to the quick prompts')
        check(document.getElementById('agent-model').value === selectedModel && !document.getElementById('agent-thinking').disabled, 'New chat preserves model settings')
        check(!document.querySelector('.agents-image-previews') && document.getElementById('agent-message').value === '', 'New chat clears unsent draft and images')
        check(commands.length === beforeNewChat + 1 && commands.at(-1).type === 'newChat', 'New chat never sends a reconnect command')
        await fill('agent-message', 'Follow-up without reconnecting'); await click('Send message')
        check(commands.at(-1).type === 'send', 'Can send immediately after New chat')
        await click('History')
        check(document.querySelector('[aria-label="Chat history"]').textContent.includes('Saved research'), 'Saved history is visible')
        await fill('agent-message', 'Unsent before reopening')
        await click('Saved research')
        check(document.querySelector('[role=log]').textContent.includes('Saved answer with source dates') && state.connected, 'Opening history restores transcript without disconnect')
        check(document.getElementById('agent-message').value === '', 'Opening history clears the old draft')
        const savedArticle = [...document.querySelectorAll('.agents-saved-item')].find(item => item.textContent.includes('Saved research'))
        check(savedArticle.querySelectorAll('button')[1].disabled, 'Active chat cannot be deleted')
        await click('History')
        await click('Notifications')
        const inbox = document.querySelector('[aria-label="Notification inbox"]')
        check(inbox.textContent.includes('OS notifications blocked') && !inbox.querySelector('img,script,[onerror]'), 'Notification fallback is visible and body stays literal')
        await click('Mark all read')
        check(state.notifications.every(notification => notification.read) && !document.querySelector('.agents-workspace-tabs').textContent.includes('unread'), 'Read state updates the inbox badge')
        await click('Dismiss notification')
        check(!state.notifications.length && inbox.textContent.includes('No notifications yet'), 'Notification dismissal works')
        await click('Trackers')
        check(document.querySelector('[aria-label="Saved trackers"]').textContent.includes('custom catalyst conditions'), 'Full agent-written tracker instructions are inspectable')
        await click('Ask Codex to write a tracker')
        check(document.getElementById('agent-message').value.includes('Save it paused'), 'Tracker creation starts as a reviewable composer prompt')
        await click('Start tracker')
        check(state.trackers[0].enabled && document.querySelector('[aria-label="Saved trackers"]').textContent.includes('Scheduled'), 'Explicit tracker start')
        state.busy = true; client.setQueryData(['agents'], envelope()); await settle()
        await click('Pause tracker')
        check(!state.trackers[0].enabled, 'Pause remains available while the chat is busy')
        state.busy = false; client.setQueryData(['agents'], envelope()); await settle()
        await click('Delete tracker'); check(state.trackers.length === 1, 'Tracker deletion needs confirmation')
        await click('Confirm delete tracker'); check(state.trackers.length === 0, 'Confirmed tracker deletion')
        state.trackers = [{ ...trackerFixture, enabled: false, running: false, nextRunAt: null }]
        await click('Trackers')
        state.messages = savedMessages
        client.setQueryData(['agents'], envelope()); await settle()
        window.setWorkspace = async label => { await click(label) }
        window.setEmbedded = async value => { embedded = value; render(); await settle() }
        window.setControls = async open => { if (document.getElementById('agent-controls').hidden === open) await click('Controls') }
        return 'PASS: private history reopening, notification inbox/read/dismiss/OS fallback, tracker review/start/pause/delete, automatic startup readiness, connected New chat, preserved model settings, cleared drafts, private inline image display, image edit attachment, missing-image fallback, inline candlestick charts, OHLC inspection, doji/flat/negative/intraday charts, native pie charts, exact values, percentages, accessible tables, safe malformed chart fallback, formatted Markdown, nested lists, tables, code, safe links, literal user text, chat controls, image paste/picker/send, portfolio review, model settings, autonomy, startup readiness and private cache exclusion'
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
        await window.webContents.executeJavaScript('window.setControls(false); window.setEmbedded(true)')
        window.setSize(420, 900)
        await new Promise(resolve => setTimeout(resolve, 200))
        const embedded = await window.webContents.executeJavaScript('({ width: document.documentElement.scrollWidth, viewport: innerWidth, charts: document.querySelectorAll(".agents-embedded .agents-pie").length, candles: document.querySelectorAll(".agents-embedded .agents-candlestick").length })')
        if (embedded.width > embedded.viewport || embedded.charts !== 2 || embedded.candles !== 3) throw Error('Embedded chart layout failed: ' + JSON.stringify(embedded))
        await window.webContents.executeJavaScript('window.setEmbedded(false)')
        window.setSize(1300, 900)
        await new Promise(resolve => setTimeout(resolve, 200))
        await window.webContents.executeJavaScript('document.querySelector(".agents-transcript").scrollTop = 0')
        mkdirSync(${JSON.stringify(resolve(root, '../../output/playwright'))}, { recursive: true })
        writeFileSync(${JSON.stringify(screenshot)}, (await window.webContents.capturePage()).toPNG())
        await window.webContents.executeJavaScript('document.querySelector(".agents-pie").scrollIntoView({ block: "start" })')
        await new Promise(resolve => setTimeout(resolve, 150))
        writeFileSync(${JSON.stringify(resolve(root, '../../output/playwright/agents-pie.png'))}, (await window.webContents.capturePage()).toPNG())
        await window.webContents.executeJavaScript('document.querySelector(".agents-candlestick").scrollIntoView({ block: "start" })')
        await new Promise(resolve => setTimeout(resolve, 150))
        writeFileSync(${JSON.stringify(resolve(root, '../../output/playwright/agents-candlestick.png'))}, (await window.webContents.capturePage()).toPNG())
        await window.webContents.executeJavaScript('document.querySelector(".agents-chat-image").scrollIntoView({ block: "center" })')
        await new Promise(resolve => setTimeout(resolve, 150))
        writeFileSync(${JSON.stringify(resolve(root, '../../output/playwright/agents-images.png'))}, (await window.webContents.capturePage()).toPNG())
        await window.webContents.executeJavaScript('window.setWorkspace("Trackers")')
        writeFileSync(${JSON.stringify(resolve(root, '../../output/playwright/agents-workspace.png'))}, (await window.webContents.capturePage()).toPNG())
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
