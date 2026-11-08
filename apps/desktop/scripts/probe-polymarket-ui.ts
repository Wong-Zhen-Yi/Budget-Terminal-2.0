import { getPolymarket } from '../electron/services/polymarket.js'
import type { PolymarketRequest } from '../electron/shared/polymarket.js'
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
const liveMode = process.argv.includes('--live')
const screenshot = join(root, 'out', liveMode ? 'polymarket-live.png' : 'polymarket-smoke.png')
const liveResponses: Record<string, unknown> = {}
const liveImages: Record<string, unknown> = {}
if (liveMode) {
  const request: PolymarketRequest = { endpoint: 'gamma:/markets', params: { closed: 'false', limit: '25', offset: '0', order: 'volume24hr', ascending: 'false' } }
  const response = await getPolymarket(request)
  assert.equal(response.meta.freshness, 'fresh', response.meta.failureReason ?? 'Market fetch failed')
  liveResponses[request.endpoint] = response
  const images = [...new Set((response.data.value as Array<Record<string, string>>).map(row => row.image || row.icon).filter(Boolean))]
  for (let offset = 0; offset < images.length; offset += 4) await Promise.allSettled(images.slice(offset, offset + 4).map(async url => {
    if (!/^https:\/\/polymarket-upload\.s3\.[a-z0-9-]+\.amazonaws\.com\//.test(url)) return
    const image = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' })
    if (!image.ok || !image.headers.get('content-type')?.startsWith('image/')) return
    const bytes = Buffer.from(await image.arrayBuffer())
    if (bytes.length > 4 * 1024 * 1024) return
    liveImages[url] = { data: { url, dataUri: `data:${image.headers.get('content-type')};base64,${bytes.toString('base64')}`, bytes: bytes.length }, meta: { source: 'Polymarket public image CDN', fetchedAt: Date.now(), freshness: 'fresh' }, errors: [] }
  }))
  const market = (response.data.value as Array<Record<string, string>>)[0]
  const token = JSON.parse(market.clobTokenIds)[0] as string
  const requests: PolymarketRequest[] = [
    { endpoint: 'clob:/book', params: { token_id: token } },
    { endpoint: 'data:/v2/prices-history', params: { token_id: token, interval: '1w' } },
    { endpoint: 'data:/v2/trades', params: { condition: market.conditionId, limit: '25' } },
    { endpoint: 'data:/v2/oi', params: { condition: market.conditionId } },
    { endpoint: 'data:/v2/holders', params: { condition: market.conditionId, limit: '20' } },
    { endpoint: 'data:/v2/leaderboard', params: { limit: '25', time_period: 'day' } },
  ]
  await Promise.all(requests.map(async item => { liveResponses[item.endpoint] = await getPolymarket(item) }))
}

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
        if (window.liveMode) { check(document.querySelectorAll('.poly-market-card').length > 0, 'Live markets missing'); return 'PASS: live API market workspace rendered' }
        check(document.body.innerText.includes('Fixture election'), 'Market question missing: ' + document.body.innerText)
        check(document.querySelector('svg[aria-label="Outcome probability over time"]'), 'Probability chart missing')
        check(document.body.innerText.includes('Bids · buyers'), 'Readable order book missing')
        check(document.querySelectorAll('.poly-market-card').length === 6, 'Market card discovery missing')
        check(!document.querySelector('pre'), 'Raw API data should not occupy the market workspace')
        check(document.querySelector('.poly-market-metrics').textContent.includes('$10K'), 'Market statistics missing')
        const refreshBefore = window.calls.length; button('↻ Refresh').click(); await settle()
        check(window.calls.length >= refreshBefore + 7, 'Refresh all must force every workspace dataset')
        document.querySelector('.poly-outcomes .poly-no').click(); await settle()
        check(window.calls.some(r => r.endpoint === 'clob:/book' && r.params.token_id === '222'), 'Outcome selection did not request the corresponding book')
        button('1D').click(); await settle()
        check(window.calls.some(r => r.endpoint.includes('prices-history') && r.params.interval === '1d'), 'History range ignored')
        button('Politics').click(); await settle()
        check(window.calls.some(r => r.endpoint === 'gamma:/markets' && r.params.tag_id === '2'), 'Category selection must filter the provider request')
        button('↗ Trending').click(); await settle()
        const search = document.querySelector('[aria-label="Search markets"]')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'bitcoin')
        search.dispatchEvent(new Event('input', { bubbles: true })); await settle()
        document.querySelector('.poly-search').requestSubmit(); await settle()
        check(document.body.innerText.includes('Search result market'), 'Global market search failed')
        button('↗ Trending').click(); await settle()
        document.querySelector('.poly-outcomes .poly-no').click(); await settle()
        button('Data explorer').click(); await settle()
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
        window.fail = false; button('Markets').click(); await settle()
        check(document.body.innerText.toLowerCase().includes('trending markets'), 'Workspace navigation failed')
        check(document.querySelector('svg[aria-label="Outcome probability over time"]').getBoundingClientRect().width > 100, 'Chart collapsed')
        button('Order book').click(); await settle()
        check(document.body.innerText.includes('Bids · buyers'), 'Order book detail tab missing')
        button('Rules').click(); await settle()
        check(document.body.innerText.includes('Public market rules'), 'Resolution criteria missing')
        button('Top holders').click(); await settle()
        check(document.body.innerText.includes('Fixture holder'), 'Readable holders missing')
        button('Activity').click(); await settle()
        check(document.body.innerText.includes('Fixture buyer') && document.body.innerText.includes('Bought'), 'Readable trade activity missing')
        const svg = document.querySelector('svg[aria-label="Outcome probability over time"]')
        svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: svg.getBoundingClientRect().left + 100 }))
        await settle(); check(document.querySelector('.poly-chart-tooltip'), 'Chart hover inspection missing')
        svg.dispatchEvent(new PointerEvent('pointerout', { bubbles: true })); await settle()
        check(document.querySelector('.poly-page').scrollHeight <= document.querySelector('.poly-page').clientHeight + 1, 'Workspace should fit one viewport')
        return 'PASS: startup-ready market cards, outcome and range selection, chart hover, depth, typed trades/holders/rules, advanced explorer, pagination, forced refresh and failure diagnostics'
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
      window.liveMode = ${JSON.stringify(liveMode)}; window.liveResponses = ${JSON.stringify(liveResponses)}; window.liveImages = ${JSON.stringify(liveImages)};
      window.calls = []; window.fail = false;
      const market = { id: '1', question: 'Fixture election', oneDayPriceChange: 0.025, volume24hr: 2500, conditionId: '0x' + '1'.repeat(64), description: 'Public market rules', outcomes: '["Yes","No"]', outcomePrices: '["0.6","0.4"]', clobTokenIds: '["111","222"]', volume: '10000', liquidity: '1000', endDate: '2026-12-31' };
      window.api = {
        polymarket: async request => {
          window.calls.push(request);
          if (window.liveMode) return window.liveResponses[request.endpoint];
          let value = { data: [] };
          if (request.endpoint === 'gamma:/tags/slug/{slug}') value = {id: '2', slug: request.params.slug};
          if (request.endpoint === 'gamma:/public-search') value = {events: [{markets: [{...market, id: 'search', question: 'Search result market'}]}]};
          if (request.endpoint === 'gamma:/markets') value = [market, ...['Will Bitcoin reach a new all-time high?', 'Will the Fed cut rates in December?', 'Who will win the championship?', 'Will inflation fall below 2%?', 'Will the next launch reach orbit?'].map((question, index) => ({ ...market, id: String(index + 2), question }))];
          if (request.endpoint === 'clob:/book') value = { bids: [{price: '0.59', size: '100'}], asks: [{price: '0.61', size: '200'}] };
          if (request.endpoint.includes('prices-history')) value = {data: [...Array.from({length: 120}, (_, i) => ({timestamp: 1793000000 + i * 3600, price: 0.44 + i / 900 + Math.sin(i / 5) * 0.018 + Math.cos(i / 2) * 0.009}))]};
          if (request.endpoint.includes('/trades')) value = {data: [{name: 'Fixture buyer', side: 'BUY', outcome: 'Yes', price: 0.6, size: 240, timestamp: 1793100000}]};
          if (request.endpoint.includes('/holders')) value = {data: [{token_id: request.params.condition ? '222' : '111', holders: [{name: 'Fixture holder', amount: 1200, value: 720}]}]};
          if (request.endpoint.endsWith('/oi')) value = {data: [{value: 15000}]};
          if (request.endpoint.includes('leaderboard')) value = {data: [{rank: 1, user_name: 'Fixture trader', pnl: 100}], pagination: { next_cursor: request.params?.cursor ? null : 'next-test' }};
          return { data: { value: window.fail ? null : value, url: 'https://data-api.polymarket.com/v2/leaderboard' }, meta: { source: 'Polymarket', fetchedAt: Date.now(), expiresAt: Date.now() + 30000, freshness: window.fail ? 'failed' : 'fresh', ...(window.fail ? { failureReason: 'Fixture provider failure' } : {}) }, errors: window.fail ? [{ source: 'Polymarket', operation: 'read', reason: 'Fixture provider failure' }] : [] };
        },
        newsThumbnail: async ({url}) => window.liveImages[url] || { data: { url, dataUri: '', bytes: 0 }, meta: { source: 'image', fetchedAt: Date.now(), freshness: 'fresh' }, errors: [] },
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
      const window = new BrowserWindow({ show: false, width: 1600, height: 1200, webPreferences: { backgroundThrottling: false, offscreen: true } });
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
        console.log(await window.webContents.executeJavaScript('window.runProbe().catch(error => { throw Error(error.stack) })'));
        await new Promise(resolve => setTimeout(resolve, 500));
        if (!${JSON.stringify(liveMode)}) {
          window.setContentSize(1280, 750);
          await window.webContents.executeJavaScript('document.querySelector(".poly-page").style.cssText = "margin-left:64px;margin-top:143px"');
          await new Promise(resolve => setTimeout(resolve, 300));
          const assertViewport = await window.webContents.executeJavaScript(
            '(() => { const page = document.querySelector(".poly-page"); const activity = document.querySelector(".poly-activity-panel").getBoundingClientRect(); const feature = document.querySelector(".poly-feature"); const metrics = document.querySelector(".poly-market-metrics").getBoundingClientRect(); return document.documentElement.scrollWidth <= innerWidth && page.scrollHeight <= page.clientHeight + 1 && activity.bottom <= innerHeight && feature.scrollHeight <= feature.clientHeight + 1 && metrics.bottom <= feature.getBoundingClientRect().bottom + 1 })()'
          );
          if (!assertViewport) throw Error('Compact viewport overflows');
          await window.webContents.executeJavaScript('document.querySelector(".poly-page").style.cssText = ""');
          window.setSize(1600, 1200);
          await new Promise(resolve => setTimeout(resolve, 300));
        }
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
