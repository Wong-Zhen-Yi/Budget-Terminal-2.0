import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-polymarket-ui-'))
const screenshot = join(root, 'out', 'polymarket-smoke.png')
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert.ok(css, 'Run npm run build before this UI probe')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
      import { PolymarketPage } from './src/pages/PolymarketPage'
      import { warmPolymarket } from './src/api/polymarketQueries'
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const check = (ok, message) => { if (!ok) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 300))
      const button = name => [...document.querySelectorAll('button')].find(b => b.textContent === name)
      const choose = (label, value) => { const el = document.querySelector('[aria-label="' + label + '"]'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(el, value); el.dispatchEvent(new Event('change', { bubbles: true })) }
      window.runProbe = async () => {
        await warmPolymarket(client)
        const before = window.calls.length
        check(before === 7, 'Startup should preload markets, board and five detail datasets')
        createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><PolymarketPage active={true} onStatusChange={panels => window.panels = panels} /></QueryClientProvider>)
        await settle()
        check(window.calls.length === before, 'Opening startup-loaded page should not fetch again')
        check(document.body.innerText.includes('Fixture election'), 'Market question missing')
        check(document.querySelector('svg[aria-label="Outcome probability over time"]'), 'Probability chart missing')
        check(document.body.innerText.includes('Bids · buyers'), 'Readable order book missing')
        const refreshBefore = window.calls.length; button('Refresh all').click(); await settle()
        check(window.calls.length >= refreshBefore + 7, 'Refresh all must force every workspace dataset')
        choose('Outcome', '1'); await settle()
        check(window.calls.some(r => r.endpoint === 'clob:/book' && r.params.token_id === '222'), 'Outcome selection did not request the corresponding book')
        choose('History range', '1d'); await settle()
        check(window.calls.some(r => r.endpoint.includes('prices-history') && r.params.interval === '1d'), 'History range ignored')
        button('Public data explorer (88)').click(); await settle()
        check(document.body.innerText.includes('Fixture trader'), 'Preloaded leaderboard missing')
        button('Next cursor page').click(); await settle()
        check(window.calls.some(r => r.params?.cursor === 'next-test'), 'Cursor pagination missing')
        button('Refresh').click(); await settle()
        check(window.calls.at(-1).force, 'Manual refresh should bypass provider cache')
        choose('Dataset', 'data:/v2/user-stats'); await settle()
        check(document.querySelector('[aria-label="user"]'), 'Public wallet field missing')
        window.fail = true
        document.querySelector('form').requestSubmit(); await settle()
        check(document.body.innerText.includes('Dataset unavailable'), 'Failed dataset state missing')
        check(window.panels.some(p => p.error || p.envelope?.meta.freshness === 'failed'), 'Settings diagnostics did not receive failure')
        check(!document.body.innerText.includes('Pages 1/') && !document.body.innerText.includes('Page needs attention'), 'Global diagnostics strip restored')
        check(document.documentElement.scrollWidth <= innerWidth, 'Page overflows viewport')
        window.fail = false; button('Market workspace').click(); await settle()
        check(document.body.innerText.toLowerCase().includes('discover markets'), 'Workspace navigation failed')
        check(document.querySelector('svg').getBoundingClientRect().width > 100, 'Chart collapsed')
        return 'PASS: startup-ready content, outcome and history selection, probability chart, order depth, explorer, pagination, forced refresh, wallet fields, failure diagnostics and viewport'
      }
    ` },
    bundle: true, jsx: 'automatic', write: false, format: 'iife', outfile: join(directory, 'renderer.js'),
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  for (const file of bundle.outputFiles) await writeFile(file.path, file.contents)
  await writeFile(join(directory, 'index.html'), `
    <html><head><meta charset="utf-8"><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="height:100vh;display:flex;min-width:0"></div>
    <script>
      window.calls = []; window.fail = false;
      const market = { id: '1', question: 'Fixture election', conditionId: '0x' + '1'.repeat(64), description: 'Public market rules', outcomes: '["Yes","No"]', outcomePrices: '["0.6","0.4"]', clobTokenIds: '["111","222"]', volume: '10000', liquidity: '1000', endDate: '2026-12-31' };
      window.api = {
        polymarket: async request => {
          window.calls.push(request);
          let value = { data: [] };
          if (request.endpoint === 'gamma:/markets') value = [market];
          if (request.endpoint === 'clob:/book') value = { bids: [{price: '0.59', size: '100'}], asks: [{price: '0.61', size: '200'}] };
          if (request.endpoint.includes('prices-history')) value = {data: [{timestamp: 1793000000, price: 0.5}, {timestamp: 1793100000, price: 0.6}]};
          if (request.endpoint.includes('leaderboard')) value = {data: [{rank: 1, user_name: 'Fixture trader', pnl: 100}], pagination: { next_cursor: request.params?.cursor ? null : 'next-test' }};
          return { data: { value: window.fail ? null : value, url: 'https://data-api.polymarket.com/v2/leaderboard' }, meta: { source: 'Polymarket', fetchedAt: Date.now(), expiresAt: Date.now() + 30000, freshness: window.fail ? 'failed' : 'fresh', ...(window.fail ? { failureReason: 'Fixture provider failure' } : {}) }, errors: window.fail ? [{ source: 'Polymarket', operation: 'read', reason: 'Fixture provider failure' }] : [] };
        },
        writeClipboard: async () => {},
        openExternal: async () => {}
      };
    </script><script src="renderer.js"></script></body></html>
  `)
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron');
    const fs = require('fs');
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: { backgroundThrottling: false, offscreen: true } });
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
        console.log(await window.webContents.executeJavaScript('window.runProbe().catch(error => { throw Error(error.stack) })'));
        await new Promise(resolve => setTimeout(resolve, 500));
        fs.writeFileSync(${JSON.stringify(screenshot)}, (await window.webContents.capturePage()).toPNG());
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
    const timer = setTimeout(() => { child.kill(); reject(new Error('Polymarket UI probe timed out')) }, 40_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log(`Screenshot: ${screenshot}`)
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
