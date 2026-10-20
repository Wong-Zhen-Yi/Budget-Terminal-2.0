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
          check(pacingHost.innerText.includes('Yahoo background requests are paced at 1 per second, with up to 2 in flight'), 'Settings does not explain slower startup pacing')
          check(pacingHost.innerText.includes('slow further if rate limited. Foreground requests take priority.'), 'Settings does not explain backoff and foreground priority')
          check(pacingHost.innerText.includes('Temporary failures retry automatically; unresolved failures remain visible.'), 'Settings does not explain startup recovery')
          console.log('PASS: startup pacing explanation renders alongside live page load progress')
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
          check(document.body.innerText.includes('Yahoo background requests are paced at 1 per second, with up to 2 in flight'), 'Settings does not explain slower startup pacing')
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
      window.api = new Proxy({
        platform: 'win32',
        onScreenshotRequested: listener => window.captureApi.onScreenshotRequested(listener),
        screenshotReady: result => window.captureApi.screenshotReady(result),
        onPortfolioChanged: () => () => {},
        mcpStatus: async () => ({ available: true, tools: ${toolCount} }),
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
        apiUsage: async () => ({ providers: [], sampledAt: Date.now() }),
      }, { get: (target, key) => key in target ? target[key] : request => {
        window.fixtureRequests.push({ method: key, request });
        return new Promise(() => {});
      } });
    </script><script src="renderer.js"></script></body></html>
  `)
  await build({
    entryPoints: [join(root, 'electron/mcp/screenshot.ts')], outfile: join(directory, 'capture.cjs'),
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
    const { createScreenshotService } = require('./capture.cjs');
    const fs = require('fs');
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { backgroundThrottling: false, preload: ${JSON.stringify(join(directory, 'preload.cjs'))} } });
      window.webContents.on('console-message', event => console.log(event.message));
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
        console.log(await window.webContents.executeJavaScript('window.runProbe()'));
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
        fs.writeFileSync(${JSON.stringify(screenshot)}, (await window.webContents.capturePage()).toPNG());
        window.setSize(1000, 800);
        await new Promise(resolve => setTimeout(resolve, 250));
        if (!await window.webContents.executeJavaScript('(() => { const footer = document.querySelector("footer").getBoundingClientRect(); return footer.bottom <= innerHeight && footer.right <= innerWidth })()')) throw Error('Startup status overflows the window');
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
  console.log('Screenshot: ' + screenshot)
} finally {
  assert.ok(!relative(tmpdir(), directory).startsWith('..'))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
