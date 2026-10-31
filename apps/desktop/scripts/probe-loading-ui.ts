import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { mutationDomains, operations } from '../mcp/operations'
import { TABS } from '../electron/shared/contract'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const statusBarOnly = process.argv.includes('--status-bar-only')
const toolCount = Object.keys(operations).length + 1
const implementedPages = TABS.filter(tab => tab.implemented).map(tab => tab.id)
const directory = await mkdtemp(join(tmpdir(), 'budget-loading-ui-'))
const screenshot = join(root, 'out', 'loading-smoke.png')
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert.ok(css, 'Run npm run build before this UI probe')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({
    stdin: {
      resolveDir: root, loader: 'tsx',
      contents: `
        import { createRoot } from 'react-dom/client'
        import { dehydrate, QueryClient, QueryClientProvider } from '@tanstack/react-query'
        import { App } from './src/App'
        import { PageLoadOrderPanel } from './src/components/settings/PageLoadOrderPanel'
        import { TABS } from './electron/shared/contract'
        import { useDataHealth } from './src/stores/dataHealth'
        import { trimPersistedClientInBackground } from './src/api/queryPersistence'
        import { DEFAULT_BACKTEST_PAGE_SETTINGS } from './electron/shared/backtest'
        import { DEFAULT_QUANT_PAGE_SETTINGS } from './electron/shared/quant'
        import { DEFAULT_YOUTUBE_PAGE_SETTINGS } from './electron/shared/youtube'
        const toolCount = ${toolCount}
        window.fixtureSettings = {
          clockCountry: 'US', time12h: true, tabOrder: TABS.map(tab => tab.id),
          hiddenTabs: [], favoriteTabs: [], obscuredTabs: [], sidebarCollapsed: false, sourcePath: '',
          backtestPage: DEFAULT_BACKTEST_PAGE_SETTINGS, quantPage: DEFAULT_QUANT_PAGE_SETTINGS,
          youtubePage: DEFAULT_YOUTUBE_PAGE_SETTINGS, signalsPage: { filter: 'all', setup: 'all', search: '' },
          automaticBackup: { path: '/fixture/Downloads/budget-terminal-backup.json', savedAt: Date.now() },
        }
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnMount: false } } })
        const check = (ok, message) => { if (!ok) throw Error(message) }
        const settle = () => new Promise(resolve => setTimeout(resolve, 150))
        window.capturePrivacyFixture = () => client.setQueryData(['settings'], result => ({ ...result,
          data: { ...result.data, hiddenTabs: ['dictionary'], obscuredTabs: ['dictionary'] } }))
        window.runProbe = async () => {
          createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><App /></QueryClientProvider>)
          await settle()
          const meters = () => document.querySelector('footer [aria-label="API request pressure"]')
          await new Promise(resolve => setTimeout(resolve, 1100))
          check(meters()?.textContent.includes('API USAGE'), 'Footer must describe usage, not provider quota')
          check(meters()?.textContent.includes('60/240 · 1 active · 120 queued'), 'Yahoo request counts and queue are missing')
          check(meters()?.querySelector('[title*="Startup paced at 1 requests/s"]'), 'Yahoo plateau explanation is missing')
          window.fixtureYahooUsage.queued = 80
          await new Promise(resolve => setTimeout(resolve, 1100))
          check(meters()?.textContent.includes('25%') && meters()?.textContent.includes('80 queued'), 'Yahoo queue must update even when rolling usage stays at 25%')
          Object.assign(window.fixtureYahooUsage, { percent: 0, requestCount: 0, inFlight: 0, queued: 0 })
          await new Promise(resolve => setTimeout(resolve, 1100))
          check(meters()?.textContent.includes('0/240 · 0 active · 0 queued'), 'Yahoo idle state did not update')
          console.log('PASS: Yahoo steady 25% usage shows a live queue and updates to idle')
          const light = name => document.querySelector('[data-mcp-light="' + name + '"]')
          check(light('active')?.dataset.state === 'off', 'Idle MCP activity light should be off')
          check(light('connected')?.dataset.state === 'off', 'MCP readiness alone must not imply a connected client')
          client.setQueryData(['mcpStatus'], { available: true, connected: true, active: true, tools: toolCount })
          await settle()
          check(light('active')?.dataset.state === 'on', 'MCP activity light did not turn on')
          check(light('connected')?.dataset.state === 'on', 'MCP connection light did not turn on')
          check(light('active').getBoundingClientRect().width === 8, 'MCP light has no visible size')
          client.setQueryData(['mcpStatus'], { available: false, error: 'Fixture MCP startup failure' })
          await settle()
          check(light('active')?.dataset.state === 'error' && light('connected')?.dataset.state === 'error', 'MCP failure lights are missing')
          client.setQueryData(['mcpStatus'], { available: true, tools: toolCount })
          // Complete one measured page; leave the others pending to exercise navigation.
          await new Promise(resolve => setTimeout(resolve, 5600))
          check(useDataHealth.getState().startup?.planned > 0, 'Startup queue did not begin')
          const pageOrder = useDataHealth.getState().startup.pageOrder
          check(pageOrder.at(-1) === 'heatmap', 'Learned slowest page did not go last')
          const heatmapRequest = window.fixtureRequests.find(entry => entry.method === 'heatmap' && entry.request?.background)
          check(heatmapRequest?.request.backgroundOrder === pageOrder.indexOf('heatmap'), 'Learned page rank was not sent through the API')
          check(useDataHealth.getState().startupLoads.bitcoin?.durationMs >= 100, 'Completed page duration was not learned')
          check(JSON.parse(localStorage.getItem('budget-terminal:data-health')).state.startupLoads.bitcoin?.samples === 1, 'Completed page duration was not persisted')
          check(document.querySelector('footer [role=status]')?.textContent.includes('Loading pages'), 'Startup progress hidden by foreground loading')
          const pacingHost = document.createElement('div')
          document.body.append(pacingHost)
          const pacingRoot = createRoot(pacingHost)
          pacingRoot.render(<PageLoadOrderPanel />)
          await settle()
          check(pacingHost.innerText.includes('Retry 2/2') && pacingHost.innerText.includes('HTTP 503'), 'Transient startup failure did not show its recovery attempt')
          check(pacingHost.innerText.includes('Yahoo background requests are paced at 3 per second, with up to 3 in flight'), 'Settings does not explain startup pacing')
          check(pacingHost.innerText.includes('slow further if rate limited. Foreground requests take priority.'), 'Settings does not explain backoff and foreground priority')
          check(pacingHost.innerText.includes('Temporary failures retry automatically; unresolved failures remain visible.'), 'Settings does not explain startup recovery')
          const exportButton = () => [...pacingHost.querySelectorAll('button')].find(button => button.textContent === 'Export for AI')
          check(exportButton() && !exportButton().disabled, 'Page load Export for AI button is missing or disabled')
          exportButton().click()
          await settle()
          check(window.fixtureExport.name.startsWith('BudgetTerminal_PageLoadOrder_') && window.fixtureExport.name.endsWith('.txt'), 'Page load report filename is incorrect')
          const report = window.fixtureExport.text
          check(report.includes('Budget Terminal — Page Load Order') && report.includes('Startup tasks completed:'), 'Export is missing its diagnostic summary')
          check(report.includes('90.0s') && report.includes('Not measured'), 'Export omits saved or unmeasured page times')
          check(report.includes('Retry 2/2') && report.includes('HTTP 503'), 'Export omits startup retry and failure reasons')
          check(report.includes('Completed startup task timings:') && report.includes('Bitcoin'), 'Export omits completed task timings')
          let previous = -1
          for (const [index, page] of pageOrder.entries()) {
            const position = report.indexOf((index + 1) + ' | ' + TABS.find(tab => tab.id === page).label + ' (' + page + ') | ')
            check(position > previous, 'Export changed or omitted page order: ' + page)
            previous = position
          }
          check(!report.includes('/fixture/') && !report.includes('mcpServers'), 'Export leaked unrelated settings')
          check(pacingHost.innerText.includes('Page load report exported.'), 'Export success is not visible')
          window.fixtureExportMode = 'cancel'
          exportButton().click()
          await settle()
          check(pacingHost.innerText.includes('Export cancelled.'), 'Cancelled export was reported as successful')
          window.fixtureExportMode = 'error'
          exportButton().click()
          await settle()
          check(pacingHost.querySelector('[role=alert]')?.textContent.includes('Unable to export'), 'Export failure is not visible')
          window.fixtureExportMode = null
          const startupSnapshot = useDataHealth.getState().startup
          useDataHealth.getState().setStartup(null)
          await settle()
          check(exportButton().disabled, 'Export must be disabled before startup has a page order')
          useDataHealth.getState().setStartup(startupSnapshot)
          await settle()
          console.log('PASS: startup pacing and Export for AI cover page order, timings, retries, cancellation, errors and empty startup')
          pacingRoot.unmount()
          pacingHost.remove()
          for (const key of ['globalMarkets', 'heatmap', 'tradingVolumes', 'money', 'economic', 'sp500', 'technicalScreen']) {
            check(client.getQueryCache().findAll({ queryKey: [key] }).some(query => query.state.fetchStatus === 'fetching'),
              'Startup did not start page in parallel: ' + key)
          }
          for (const tab of TABS.filter(tab => tab.implemented)) {
            console.log('Checking loading page: ' + tab.id)
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
            await settle()
            const result = [...document.querySelectorAll('[data-result-index]')].find(button => button.querySelector('span')?.textContent === tab.label)
            check(result, 'Missing picker result for ' + tab.id)
            result.click()
            await settle()
            const activePage = document.querySelector('[data-page-id="' + tab.id + '"]')
            check(activePage?.getBoundingClientRect().height > 0, 'Navigation blocked for ' + tab.id)
            check(!document.body.innerText.includes('This page could not render'), 'Loading page crashed: ' + tab.id)
            check(!document.querySelector('[role=dialog]'), 'Picker did not close')
          }
          check(client.isFetching() > 0, 'Fixture unexpectedly finished loading')
          const orderTable = document.querySelector('table[aria-label="Startup page load order"]')
          check(orderTable && orderTable.getBoundingClientRect().height > 0, 'Page load order is not visible in Settings')
          check(document.body.innerText.includes('Yahoo background requests are paced at 3 per second, with up to 3 in flight'), 'Settings does not explain startup pacing')
          const orderRows = [...orderTable.querySelectorAll('[data-startup-page]')]
          check(JSON.stringify(orderRows.map(row => row.dataset.startupPage)) === JSON.stringify(pageOrder), 'Settings does not show the actual startup order')
          check(orderRows.at(-1).innerText.includes('90.0s'), 'Saved heavy-page load time is missing')
          check(orderRows.some(row => row.innerText.includes('Not measured')), 'Unmeasured page is presented as timed')
          const recoveryDeadline = Date.now() + 20_000
          while (!useDataHealth.getState().startup.timings.some(task => task.label === 'Forex news') && Date.now() < recoveryDeadline) await settle()
          const recovery = useDataHealth.getState().startup.timings.filter(task => task.label === 'Forex news')
          check(recovery.length === 1 && recovery[0].state === 'ready', 'Recovered task was failed or counted more than once')
          check(window.fixtureRequests.filter(entry => entry.method === 'forexNews' && entry.request?.background).length === 2, 'Transient startup data did not retry exactly once')
          check(!useDataHealth.getState().startup.pages.forex.reason?.includes('Retry'), 'Completed recovery left an obsolete retry warning')
          console.log('PASS: transient partial startup data retries automatically, displays recovery progress, reuses its background lane and settles ready once')
          check(document.body.innerText.includes('/fixture/Downloads/budget-terminal-backup.json'), 'Automatic backup file is not shown in Settings')
          check(document.body.innerText.includes('Ready · ' + toolCount + ' tools for ChatGPT / Codex'), 'MCP status is not visible in Settings')
          const capabilities = document.querySelector('[aria-label="MCP capabilities"]')
          check(capabilities?.querySelectorAll('[data-mcp-capability]').length === toolCount, 'Settings does not list every MCP capability')
          check(capabilities?.querySelector('[data-mcp-capability="budget_terminal_hood"]'), 'HOOD capability is missing')
          check(capabilities?.querySelector('[data-mcp-capability="budget_terminal_screenshot"]'), 'Screenshot capability is missing')
          const edits = [...capabilities.querySelectorAll('details')].find(group => group.querySelector('summary').textContent.includes('Saved-record edits'))
          check(edits, 'Saved-record edit capabilities are missing')
          edits.open = true
          await settle()
          check(edits.querySelectorAll('[data-mcp-capability]').length === ${Object.keys(mutationDomains).length}, 'Saved-record edit list is incomplete')
          check(edits.querySelector('[data-mcp-capability="budget_terminal_mutate_portfolio"]').getBoundingClientRect().height > 0, 'Expanded capability list is not visible')
          client.setQueryData(['mcpStatus'], await window.api.mcpStatus())
          await settle()
          const readOnlyControl = [...document.querySelectorAll('label')].find(label => label.textContent.includes('Read-only MCP')).querySelector('input')
          check(readOnlyControl.checked, 'MCP must default to read-only')
          readOnlyControl.click()
          await settle()
          check(!window.fixtureMcp.policy.readOnly && !readOnlyControl.checked, 'MCP read-only control did not save')
          const approvalControl = [...document.querySelectorAll('label')].find(label => label.textContent.includes('Require local approval')).querySelector('input')
          check(approvalControl.checked, 'Local approval must default on')
          approvalControl.click()
          await settle()
          check(!window.fixtureMcp.policy.requireApproval, 'MCP approval control did not save')
          ;[...document.querySelectorAll('button')].find(button => button.textContent === 'Test MCP connection').click()
          await settle()
          check(document.body.innerText.includes('Connection test passed'), 'MCP connection test result is missing')
          const activityTable = document.querySelector('table[aria-label="Recent MCP activity"]')
          check(activityTable?.textContent.includes('budget_terminal_stocks') && activityTable.textContent.includes('partial'), 'Privacy-safe MCP activity did not render')
          check(activityTable.textContent.includes('23 ms'), 'MCP call duration is missing')
          const privacy = [...document.querySelectorAll('label')].find(label => label.textContent.includes('Ask before agents')).querySelector('input')
          privacy.click()
          await settle()
          check(window.fixtureMcp.policy.browserRequireApproval, 'Browser content approval option did not save')
          const setup = [...document.querySelectorAll('details')].find(item => item.querySelector('summary')?.textContent === 'Client setup')
          setup.open = true
          ;[...setup.querySelectorAll('button')].find(button => button.textContent === 'Copy client configuration').click()
          await settle()
          check(window.fixtureClipboard.includes('mcpServers') && setup.textContent.includes('configuration copied'), 'Token-free configuration copy failed')
          window.fixtureMcp.activity.push({ id: 2, tool: 'budget_terminal_quant_scan', source: 'external', startedAt: Date.now(), state: 'running' })
          client.setQueryData(['mcpStatus'], await window.api.mcpStatus())
          await settle()
          ;[...document.querySelectorAll('button')].find(button => button.textContent === 'Cancel request').click()
          await settle()
          check(window.fixtureMcp.activity.at(-1).state === 'cancelled', 'Local request cancellation failed')
          console.log('PASS: MCP permissions, browser content approval, token-free setup/copy, cancellation, authenticated connection-test UI and metadata-only activity table')
          client.setQueryData(['mcpStatus'], { available: false, error: 'Fixture MCP startup failure' })
          await settle()
          check(document.body.innerText.includes('Fixture MCP startup failure'), 'MCP startup failure is not visible')
          client.setQueryData(['mcpStatus'], { available: true, tools: toolCount })
          client.setQueryData(['settings'], result => ({ ...result, data: { ...result.data,
            automaticBackup: { ...result.data.automaticBackup, error: 'Fixture backup failure' } } }))
          await settle()
          check([...document.querySelectorAll('[role=alert]')].some(alert => alert.textContent.includes('Automatic backup failed: Fixture backup failure')), 'Backup failure is not visible')
          client.setQueryData(['settings'], result => ({ ...result, data: { ...result.data, automaticBackup: window.fixtureSettings.automaticBackup } }))
          await settle()
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
          await settle()
          check(document.activeElement?.getAttribute('aria-label') === 'Search pages', 'Picker input cannot receive focus')
          // Model a cache full of page histories arriving during startup. An input
          // task must run before trimming the whole cache has finished.
          const snapshots = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
          for (let index = 0; index < 200; index++) {
            snapshots.setQueryData(['history', index], Array.from({ length: 2000 }, (_, day) => ({ day, close: day * 1.234, label: 'Fixture history ' + index })))
          }
          let handledInput = false
          setTimeout(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
            handledInput = true
          }, 0)
          await trimPersistedClientInBackground({ timestamp: Date.now(), buster: 'probe', clientState: dehydrate(snapshots) })
          check(handledInput, 'Cache serialization blocked queued input for the entire snapshot')
          await settle()
          check(!document.querySelector('[role=dialog]'), 'Escape was not handled during cache serialization')
          snapshots.clear()
          document.querySelector('[data-startup-order-scroll]').scrollTop = orderTable.scrollHeight
          await settle()
          return 'PASS: all implemented pages navigate during startup; Settings shows the actual load order and saved timings; picker stays interactive'
        }
      `,
    },
    bundle: true, jsx: 'automatic', write: false, format: 'iife',
    loader: { '.png': 'dataurl', '.css': 'empty' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), `
    <html><head><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="height:100vh"></div>
    <script>
      const ok = data => ({ data, errors: [], meta: { freshness: 'fresh', source: 'fixture', fetchedAt: Date.now() } });
      localStorage.setItem('budget-terminal:data-health', JSON.stringify({ state: {
        records: {}, startupLoads: {
          heatmap: { durationMs: 90000, samples: 1 },
          'trading-volumes': { durationMs: 60000, samples: 1 },
        },
      }, version: 0 }));
      window.fixtureRequests = [];
      window.fixtureMcp = { policy: { readOnly: true, requireApproval: true }, writeReceipts: 0, writeReceiptLimit: 500,
        activity: [{ id: 1, tool: 'budget_terminal_stocks', source: 'external', startedAt: Date.now(), durationMs: 23, state: 'partial' }] };
      window.api = new Proxy({
        platform: 'win32',
        onScreenshotRequested: listener => window.captureApi.onScreenshotRequested(listener),
        screenshotReady: result => window.captureApi.screenshotReady(result),
        onPortfolioChanged: () => () => {},
        onNotificationClicked: () => () => {},
        mcpStatus: async () => ({ available: true, tools: ${toolCount}, diagnostics: structuredClone(window.fixtureMcp), setup: { valid: true, message: 'Fixture data folder validated', configuration: '{"mcpServers":{"fixture":{"command":"node"}}}' } }),
        configureMcp: async policy => { window.fixtureMcp.policy = policy; return window.api.mcpStatus(); },
        testMcpConnection: async () => window.api.mcpStatus(),
        writeClipboard: async text => { window.fixtureClipboard = text; },
        saveText: async (name, text) => {
          window.fixtureExport = { name, text };
          if (window.fixtureExportMode === 'error') throw Error('Fixture save failure');
          return window.fixtureExportMode === 'cancel' ? null : '/fixture/Downloads/' + name;
        },
        cancelMcpCall: async id => { const entry = window.fixtureMcp.activity.find(entry => entry.id === id); entry.state = 'cancelled'; entry.durationMs = 12; return window.api.mcpStatus(); },
        settings: async () => ok(window.fixtureSettings),
        portfolio: async () => ok({ portfolios: [], activeId: 'main', mainId: 'main', sourcePath: '' }),
        bitcoin: async request => {
          window.fixtureRequests.push({ method: 'bitcoin', request });
          await new Promise(resolve => setTimeout(resolve, 300));
          return ok({ stats: null, blocks: [], fees: null, mempool: null });
        },
        forexNews: async request => {
          window.fixtureRequests.push({ method: 'forexNews', request });
          const calls = window.fixtureRequests.filter(entry => entry.method === 'forexNews').length;
          return calls === 1 ? { data: [], errors: [{ source: 'fixture', operation: 'fetch', reason: 'HTTP 503' }],
            meta: { source: 'fixture', freshness: 'partial', fetchedAt: Date.now() } } : ok([]);
        },
        apiUsage: async () => ({ providers: ['Yahoo', 'CoinGecko', 'Alt.me', 'DefeatBeta'].map((label, index) => ({
          id: label.toLowerCase(), label, percent: 0, requestCount: 0,
          softLimit: 100, windowSeconds: 60, inFlight: 0, throttled: false, cooldownMs: 0, updatedAt: Date.now(),
          ...(index === 0 ? (window.fixtureYahooUsage ??= { percent: 25, requestCount: 60, softLimit: 240,
            inFlight: 1, queued: 120, backgroundRequestsPerSecond: 1 }) : {}),
        })), sampledAt: Date.now() }),
      }, { get: (target, key) => key in target ? target[key] : request => {
        window.fixtureRequests.push({ method: key, request });
        return new Promise(() => {});
      } });
    </script><script src="renderer.js"></script></body></html>
  `)
  await build({
    stdin: { resolveDir: root, contents: `export { createScreenshotService } from './electron/mcp/screenshot'; export { mcpExecution } from './electron/services/mcpContext'` }, outfile: join(directory, 'capture.cjs'),
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
  })
  await build({
    stdin: { resolveDir: root, contents: `
      import { contextBridge, ipcRenderer } from 'electron'
      import { createApi } from './electron/shared/createApi'
      contextBridge.exposeInMainWorld('captureApi', createApi(
        (channel, ...args) => ipcRenderer.invoke(channel, ...args),
        (channel, listener) => {
          const handler = (_event, payload) => listener(payload)
          ipcRenderer.on(channel, handler)
          return () => ipcRenderer.removeListener(channel, handler)
        }, process.platform))
    ` }, outfile: join(directory, 'preload.cjs'),
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
  })
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow, nativeImage } = require('electron');
    const assert = require('node:assert/strict');
    const { createScreenshotService, mcpExecution } = require('./capture.cjs');
    const fs = require('fs');
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { backgroundThrottling: false, preload: ${JSON.stringify(join(directory, 'preload.cjs'))} } });
      window.webContents.on('console-message', event => console.log(event.message));
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
        console.log(await window.webContents.executeJavaScript('window.runProbe()'));
        if (!${statusBarOnly}) {
        const capture = createScreenshotService(() => window);
        const snapshot = () => window.webContents.executeJavaScript('JSON.stringify({ page: document.querySelector("h1")?.textContent, navigation: localStorage.getItem("budget-terminal:navigation"), scroll: document.querySelector("[data-startup-order-scroll]")?.scrollTop })');
        const original = await snapshot();
        await window.webContents.executeJavaScript('window.capturePrivacyFixture(); true');
        await new Promise(resolve => setTimeout(resolve, 200));
        window.webContents.setBackgroundThrottling(true);
        const all = await capture({ page: 'all' });
        assert.equal(all.meta.freshness, 'fresh', JSON.stringify(all.errors));
        assert.deepEqual(all.data.screenshots.map(page => page.pageId).sort(), ${JSON.stringify(implementedPages.sort())});
        assert.equal(new Set(all.data.screenshots.map(page => page.pageId)).size, ${implementedPages.length});
        assert.equal(window.isVisible(), false, 'Hidden window was shown during capture');
        assert.equal(window.webContents.getBackgroundThrottling(), true);
        assert.equal(await snapshot(), original, 'Selected page or recent history changed');
        for (const page of all.data.screenshots) {
          assert.equal(page.startupLoading, true, page.pageId + ' lost startup state');
          const image = nativeImage.createFromBuffer(Buffer.from(page.base64, 'base64'));
          assert.equal(image.isEmpty(), false, page.pageId + ' has an empty image');
          assert.deepEqual(image.getSize(), { width: page.width, height: page.height });
          const bitmap = image.toBitmap();
          const colors = new Set();
          for (let offset = 0; offset < bitmap.length; offset += 400) colors.add(bitmap.readUInt32LE(offset));
          assert.ok(colors.size > 10, page.pageId + ' captured a blank frame');
        }
        assert.equal(all.data.screenshots.find(page => page.pageId === 'dictionary').obscured, true);
        assert.notEqual(all.data.screenshots.find(page => page.pageId === 'dictionary').base64,
          all.data.screenshots.find(page => page.pageId === 'settings').base64, 'Page captures reused a stale frame');
        // Overlap requests to model two MCP clients; each gets its own named page.
        const concurrent = await Promise.all([capture({ page: 'charts' }), capture({ page: 'dictionary' })]);
        assert.deepEqual(concurrent.map(result => result.data.screenshots[0]?.pageId), ['charts', 'dictionary']);
        assert.equal(await snapshot(), original);
        const cancellation = new AbortController();
        await assert.rejects(mcpExecution.run({ signal: cancellation.signal, progress: completed => { if (completed >= 1) cancellation.abort(); } }, () => capture({ page: 'all' })));
        assert.equal(await snapshot(), original, 'Cancelled capture did not restore navigation');
        assert.equal(window.webContents.getBackgroundThrottling(), true, 'Cancelled capture did not restore throttling');
        assert.equal((await capture({ page: 'dictionary' })).meta.freshness, 'fresh', 'Cancelled capture left stale IPC handlers');
        console.log('PASS: cancelled multi-page capture restores navigation, background throttle and capture queue');
        const invalid = await capture({ page: 'unknown' });
        assert.equal(invalid.meta.freshness, 'failed');
        assert.equal((await createScreenshotService(() => undefined)({})).meta.freshness, 'failed');
        const unresponsive = new BrowserWindow({ show: false });
        await unresponsive.loadURL('data:text/html,<body>No screenshot listener</body>');
        const started = Date.now();
        const timeout = await createScreenshotService(() => unresponsive)({ page: 'all' });
        assert.equal(timeout.meta.freshness, 'failed');
        assert.equal(timeout.data.screenshots.length, 0);
        assert.ok(Date.now() - started < 15000, 'An unresponsive renderer waited separately for every page');
        assert.equal(unresponsive.webContents.getBackgroundThrottling(), true, 'Timeout did not restore throttling');
        unresponsive.destroy();
        window.showInactive();
        window.minimize();
        await new Promise(resolve => setTimeout(resolve, 350));
        const minimized = await capture({ page: 'dictionary' });
        assert.equal(minimized.meta.freshness, 'fresh', JSON.stringify(minimized.errors));
        assert.equal(window.isMinimized(), true, 'Capture restored a minimized window');
        window.restore();
        const cover = new BrowserWindow({ width: 1500, height: 1000, alwaysOnTop: true });
        cover.setBounds(window.getBounds());
        await cover.loadURL('data:text/html,<body style="background:%23ff00ff">Covering window</body>');
        cover.focus();
        await new Promise(resolve => setTimeout(resolve, 300));
        const covered = await capture({});
        assert.equal(covered.meta.freshness, 'fresh', JSON.stringify(covered.errors));
        assert.equal(covered.data.screenshots[0].pageId, 'settings');
        assert.equal(BrowserWindow.getFocusedWindow(), cover, 'Capture stole focus');
        const coveredImage = nativeImage.createFromBuffer(Buffer.from(covered.data.screenshots[0].base64, 'base64'));
        const corner = coveredImage.toBitmap();
        assert.notDeepEqual([...corner.subarray(0, 3)], [255, 0, 255], 'Capture included the covering app');
        cover.destroy();
        window.hide();
        window.webContents.setBackgroundThrottling(false);
        assert.equal(await snapshot(), original);
        console.log('PASS: all ${implementedPages.length} page screenshots, hidden/obscured pages, background throttle restoration, concurrent captures, timeout recovery, hidden/minimized/covered windows, native PNG pixels and navigation/scroll restoration');
        await new Promise(resolve => setTimeout(resolve, 350));
        // Reuse the image whose native pixels were checked above. Electron can
        // wait indefinitely for a new frame after a previously shown window hides.
        fs.writeFileSync(${JSON.stringify(screenshot)}, coveredImage.toPNG());
        }
        // Hidden/minimized capture behavior is verified above. Resume visible
        // painting for the separate responsive-footer checks after hide/show.
        window.showInactive();
        for (const width of [1920, 1280, 1000, 800]) {
          window.setSize(width, 800);
          await new Promise(resolve => setTimeout(resolve, 250));
          await window.webContents.executeJavaScript(\`(() => {
            const footer = document.querySelector('[aria-label="API request pressure"]').closest('footer');
            const bounds = footer.getBoundingClientRect();
            const check = (ok, message) => { if (!ok) throw Error(message + ' at width ' + innerWidth) };
            check(bounds.height === 32, 'Status bar changed height');
            check(bounds.bottom <= innerHeight && bounds.right <= innerWidth, 'Status bar overflows window');
            const meters = footer.querySelector('[aria-label="API request pressure"]');
            check(meters.children.length === 5, 'API meters did not load');
            const meterTop = meters.firstElementChild.getBoundingClientRect().top;
            check([...meters.children].every(child => Math.abs(child.getBoundingClientRect().top - meterTop) <= 2), 'API meters wrapped');
            const status = footer.querySelector('[role="status"]');
            const health = footer.firstElementChild;
            const top = health.getBoundingClientRect().top;
            for (const message of ['', 'Loading pages: 12 of 60 complete', '0 startup load(s) failed · 9 incomplete. Open Settings for details.']) {
              status.textContent = message;
              check(footer.getBoundingClientRect().height === bounds.height, 'Startup progress changed footer height');
              check(health.getBoundingClientRect().top === top, 'Startup progress moved footer content');
            }
          })()\`);
        }
        fs.writeFileSync(${JSON.stringify(join(root, 'out', 'status-bar-smoke.png'))}, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        console.log('PASS: status bar stays on one 32px line with API meters and changing progress at 800, 1000, 1280 and 1920px');
        app.exit(0);
      } catch (error) { console.error(error); app.exit(1); }
    });
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Loading UI probe timed out: ' + output)) }, 100_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log('Screenshot: ' + (statusBarOnly ? join(root, 'out', 'status-bar-smoke.png') : screenshot))
} finally {
  assert.ok(!relative(tmpdir(), directory).startsWith('..'))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
