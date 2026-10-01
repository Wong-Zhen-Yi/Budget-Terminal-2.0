import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
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
        import { TABS } from './electron/shared/contract'
        import { useDataHealth } from './src/stores/dataHealth'
        import { trimPersistedClientInBackground } from './src/api/queryPersistence'
        import { DEFAULT_BACKTEST_PAGE_SETTINGS } from './electron/shared/backtest'
        import { DEFAULT_QUANT_PAGE_SETTINGS } from './electron/shared/quant'
        import { DEFAULT_YOUTUBE_PAGE_SETTINGS } from './electron/shared/youtube'
        window.fixtureSettings = {
          clockCountry: 'US', time12h: true, tabOrder: TABS.map(tab => tab.id),
          hiddenTabs: [], favoriteTabs: [], obscuredTabs: [], sidebarCollapsed: false, sourcePath: '',
          backtestPage: DEFAULT_BACKTEST_PAGE_SETTINGS, quantPage: DEFAULT_QUANT_PAGE_SETTINGS,
          youtubePage: DEFAULT_YOUTUBE_PAGE_SETTINGS, signalsPage: { filter: 'all', setup: 'all', search: '' },
        }
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnMount: false } } })
        const check = (ok, message) => { if (!ok) throw Error(message) }
        const settle = () => new Promise(resolve => setTimeout(resolve, 150))
        window.runProbe = async () => {
          createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><App /></QueryClientProvider>)
          await settle()
          // Complete one measured page; leave the others pending to exercise navigation.
          await new Promise(resolve => setTimeout(resolve, 5600))
          check(useDataHealth.getState().startup?.planned > 0, 'Startup queue did not begin')
          const pageOrder = useDataHealth.getState().startup.pageOrder
          check(pageOrder.at(-1) === 'heatmap', 'Learned slowest page did not go last')
          const heatmapRequest = window.fixtureRequests.find(entry => entry.method === 'heatmap' && entry.request?.background)
          check(heatmapRequest?.request.backgroundOrder === pageOrder.indexOf('heatmap'), 'Learned page rank was not sent through the API')
          check(useDataHealth.getState().startupLoads.signals?.durationMs >= 100, 'Completed page duration was not learned')
          check(JSON.parse(localStorage.getItem('budget-terminal:data-health')).state.startupLoads.signals?.samples === 1, 'Completed page duration was not persisted')
          check(document.querySelector('footer [role=status]')?.textContent.includes('Loading pages'), 'Startup progress hidden by foreground loading')
          for (const key of ['globalMarkets', 'heatmap', 'tradingVolumes', 'money', 'economic', 'sp500', 'technicalScreen']) {
            check(client.getQueryCache().findAll({ queryKey: [key] }).some(query => query.state.fetchStatus === 'fetching'),
              'Startup did not start page in parallel: ' + key)
          }
          for (const tab of TABS.filter(tab => tab.implemented)) {
            console.log('Checking loading page: ' + tab.id)
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
            await settle()
            const result = [...document.querySelectorAll('[data-result-index]')].find(button => button.textContent.includes(tab.label))
            check(result, 'Missing picker result for ' + tab.id)
            result.click()
            await settle()
            check(document.querySelector('h1')?.textContent === tab.label, 'Navigation blocked for ' + tab.id)
            check(!document.body.innerText.includes('This page could not render'), 'Loading page crashed: ' + tab.id)
            check(!document.querySelector('[role=dialog]'), 'Picker did not close')
          }
          check(client.isFetching() > 0, 'Fixture unexpectedly finished loading')
          const orderTable = document.querySelector('table[aria-label="Startup page load order"]')
          check(orderTable && orderTable.getBoundingClientRect().height > 0, 'Page load order is not visible in Settings')
          const orderRows = [...orderTable.querySelectorAll('[data-startup-page]')]
          check(JSON.stringify(orderRows.map(row => row.dataset.startupPage)) === JSON.stringify(pageOrder), 'Settings does not show the actual startup order')
          check(orderRows.at(-1).innerText.includes('90.0s'), 'Saved heavy-page load time is missing')
          check(orderRows.some(row => row.innerText.includes('Not measured')), 'Unmeasured page is presented as timed')
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
        onPortfolioChanged: () => () => {},
        settings: async () => ok(window.fixtureSettings),
        portfolio: async () => ok({ portfolios: [], activeId: 'main', mainId: 'main', sourcePath: '' }),
        signals: async request => {
          window.fixtureRequests.push({ method: 'signals', request });
          await new Promise(resolve => setTimeout(resolve, 300));
          return ok(null);
        },
        apiUsage: async () => ({ providers: [], sampledAt: Date.now() }),
      }, { get: (target, key) => key in target ? target[key] : request => {
        window.fixtureRequests.push({ method: key, request });
        return new Promise(() => {});
      } });
    </script><script src="renderer.js"></script></body></html>
  `)
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron');
    const fs = require('fs');
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { backgroundThrottling: false, offscreen: true } });
      window.webContents.on('console-message', event => console.log(event.message));
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
        console.log(await window.webContents.executeJavaScript('window.runProbe()'));
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
    const timer = setTimeout(() => { child.kill(); reject(new Error('Loading UI probe timed out: ' + output)) }, 45_000)
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
