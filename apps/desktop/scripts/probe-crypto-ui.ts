import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-crypto-ui-'))
const screenshot = join(root, 'out', 'crypto-smoke.png')
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert.ok(css, 'Run npm run build before this UI probe')
  // Exercise current page styles even when a full desktop rebuild is unavailable.
  await writeFile(join(directory, 'theme.css'), `${await readFile(join(assets, css), 'utf8')}\n${await readFile(join(root, 'src/styles/crypto.css'), 'utf8')}`)
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
        import { createRoot } from 'react-dom/client'
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
        import { CryptoPage } from './src/pages/CryptoPage'
        import { queryKeys } from './src/api/client'
        import { fetchRetainedQuery } from './src/api/snapshotResult'
        import { applyEquityMarketUpdate } from './src/api/equityStream'
        import { buildTasks } from './src/api/prefetch'
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
        const check = (ok, message) => { if (!ok) throw Error(message) }
        const settle = () => new Promise(resolve => setTimeout(resolve, 200))
        const text = () => document.body.innerText
        window.checkViewport = () => {
          const page = document.querySelector('.crypto-workspace')
          check(page.scrollWidth <= page.clientWidth + 1, 'Crypto page overflows horizontally at ' + innerWidth)
          check(page.scrollHeight <= page.clientHeight + 1, 'Crypto page needs vertical scrolling at ' + innerWidth + 'x' + innerHeight)
          const bounds = page.getBoundingClientRect()
          check(bounds.bottom <= innerHeight + 1, 'Crypto page exceeds app viewport')
          for (const panel of document.querySelector('.crypto-layout').children) {
            const rect = panel.getBoundingClientRect()
            check(rect.height > 0 && rect.right <= bounds.right + 1 && rect.bottom <= bounds.bottom + 1, 'Crypto panel outside viewport: ' + panel.className)
          }
          const breadth = document.querySelector('.crypto-breadth').getBoundingClientRect()
          const right = document.querySelector('.crypto-right').getBoundingClientRect()
          for (const panel of document.querySelector('.crypto-right').children) {
            check(panel.getBoundingClientRect().bottom <= right.bottom + 1, 'Right column clips ' + panel.className)
          }
          for (const cell of document.querySelectorAll('.crypto-heatmap-cell')) {
            const rect = cell.getBoundingClientRect()
            check(rect.bottom <= breadth.bottom + 1 && rect.height >= 20, 'Heatmap row clipped or too short at ' + innerWidth + 'x' + innerHeight)
            for (const label of cell.children) check(label.scrollWidth <= cell.clientWidth, 'Heatmap label clipped at ' + innerWidth)
          }
          check(document.querySelector('.crypto-chart-canvas').getBoundingClientRect().height >= 80, 'Price chart squeezed out of viewport')
        }
        let mode = 'success'
        let ready = false
        let forced = false
        let chartCalls = 0, chartRequest, opened = ''
        const good = {
          fetchedAt: new Date().toISOString(),
          heatmap: { tiles: Array.from({ length: 30 }, (_, i) => ({ rank: i+1, symbol: 'C'+i, name: 'Coin '+i, price: 100, changePct: 1, marketCap: 1e9, volume: 1e6, source: 'Yahoo Finance' })), coverage: { loaded: 30, total: 30 }, updatedAt: '2026-09-29T10:00:00' },
          quotes: Object.fromEntries(['BTC','ETH','SOL','XRP','BNB','COIN','MSTR','BMNR','IBIT','ETHA','BITQ'].map(label => [label, { label, price: 100, changePct: 1, volume: 1e6, marketCap: 1e9 }])), global: { marketCap: 2e12, volume24h: 1e11, changePct: 1 },
          fearGreed: { value: 70, classification: 'Greed', source: 'Alternative.me' },
          hyperliquid: { fetchedAt: new Date().toISOString(), markets: [
            { symbol: 'BTC', markPrice: 110, changePct: 10, fundingHourlyPct: 0.00125, openInterestUsd: 550, volume24hUsd: 1000 },
            { symbol: 'ETH', markPrice: 20, changePct: null, fundingHourlyPct: -0.002, openInterestUsd: 60, volume24hUsd: 2000 }
          ] },
          news: [{ id: 'fixture', title: 'Crypto market fixture headline', time: '10:00', source: 'Fixture', url: 'https://example.com/crypto' }], progress: { heatmap: 'loaded', quotes: 'loaded', market: 'loaded', news: 'loaded', hyperliquid: 'loaded' }
        }
        good.quotes.COIN = { ...good.quotes.COIN, source: 'Hyperliquid equity perp (xyz:COIN)',
          volumeSource: 'Yahoo Finance stock volume (shares)', marketCapSource: 'Yahoo Finance', metadataAsOf: Date.now() }
        Object.assign(window.api, {
          apiUsage: async () => ({ providers: [], sampledAt: Date.now() }),
          openExternal: async url => { opened = url },
          chartsHistory: async request => {
            chartCalls++; chartRequest = request
            const base = request.symbol.startsWith('ETH') ? 20 : 110
            const candles = Array.from({length: 60}, (_, index) => ({time: Math.floor(Date.now()/3600000)*3600 - (60-index)*3600,
              open: base+index, close: base+index+1, high: base+index+2, low: base+index-1, volume: 42+index}))
            return { data: { symbol: request.symbol, interval: request.interval === '4 Hours' ? '4h' : '1h', candles,
              stats: { market: request.symbol.replace('-PERP',''), source: 'Hyperliquid crypto perp ('+request.symbol.replace('-PERP','')+')' } },
              meta: { freshness: 'fresh', source: 'Hyperliquid crypto perp', fetchedAt: Date.now() }, errors: [] }
          },
          crypto: async request => {
            while (!ready) await new Promise(resolve => setTimeout(resolve, 25))
            forced = request.force
            await new Promise(resolve => setTimeout(resolve, 50))
            if (mode === 'reject') throw Error('IPC disconnected')
            const data = mode === 'partial' ? { ...good, heatmap: { ...good.heatmap, tiles: good.heatmap.tiles.slice(0, 5), coverage: { loaded: 5, total: 30 } }, progress: { ...good.progress, heatmap: 'unavailable' } } : mode === 'hyperliquid-failed' ? { ...good, hyperliquid: null, progress: { ...good.progress, hyperliquid: 'unavailable' } } : good
            return { data, meta: { freshness: mode === 'partial' || mode === 'hyperliquid-failed' ? 'partial' : 'fresh', source: 'fixture', fetchedAt: Date.now() }, errors: mode === 'partial' ? [{ symbol: 'Top 30 Cryptocurrencies', reason: 'Only 5/30 cryptocurrencies available.' }] : mode === 'hyperliquid-failed' ? [{ symbol: 'Hyperliquid Perpetuals', reason: 'Hyperliquid HTTP 429.' }] : [] }
          }
        })
        window.runProbe = async () => {
          const chartTask = buildTasks(undefined, undefined, {stocks:'AAPL',fundamentals:'AAPL'}, {year:2026,month:9,earningsYear:2026,ipoYear:2026}).find(task => task.label === 'Crypto perpetual chart')
          check(chartTask, 'Crypto startup chart task is missing')
          await chartTask.run(client, 9)
          check(chartRequest.background && chartRequest.backgroundOrder === 9, 'Startup chart lost background priority')
          createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><CryptoPage onStatusChange={() => {}} /></QueryClientProvider>)
          await settle()
          check(text().includes('Fetching crypto market data'), 'Missing loading state')
          ready = true
          await settle()
          check(text().includes('Snapshot coverage 30/30'), 'Missing complete heatmap')
          check(chartCalls === 1, 'First visit re-fetched prepared chart history')
          check(document.querySelector('.crypto-chart-canvas').dataset.candleCount === '60', 'Prepared candles missing')
          check(document.querySelectorAll('canvas').length > 0, 'Candlestick canvas did not render')
          const historyQuery = client.getQueryCache().getAll().find(query => query.queryKey[0] === 'chartsHistory' && query.state.data?.data.symbol === 'BTC-PERP')
          check(historyQuery, 'Prepared crypto history missing')
          const lastBar = historyQuery.state.data.data.candles.at(-1)
          applyEquityMarketUpdate(client, { quotes: [], candles: [{ symbol: 'BTC-PERP', market: 'BTC', interval: '1h', candle: { ...lastBar, time: lastBar.time + 3600, close: lastBar.close + 1, high: lastBar.high + 1 } }] })
          await settle()
          check(document.querySelector('.crypto-chart-canvas').dataset.candleCount === '61', 'Live crypto candle did not reach rendered chart')
          check(document.querySelectorAll('[title^="Rank:"]').length === 30, 'Missing heatmap tiles')
          check(text().includes('BTC-PERP') && text().includes('+0.00125%'), 'Missing Hyperliquid market or incorrect funding units')
          check(text().includes('-0.00200%'), 'Negative funding must keep its sign')
          const perps = document.querySelector('[aria-label="Perpetual markets"]')
          check(perps.querySelector('tbody tr').textContent.startsWith('ETH-PERP'), 'Perpetuals must initially sort by numeric volume')
          const volumeHeader = [...perps.querySelectorAll('th')].find(header => header.textContent.includes('24h volume'))
          volumeHeader.click()
          await settle()
          check(perps.querySelector('tbody tr').textContent.startsWith('BTC-PERP'), 'Perpetual market sorting failed')
          check(text().includes('Live feed') && text().includes('REST fallback'), 'Live feed and fallback must be visible')
          check(document.querySelector('[title="Yahoo Finance stock volume (shares)"]').textContent === '1M sh', 'Stock volume must show shares instead of dollars')
          const beforeStream = client.getQueryState(queryKeys.crypto).dataUpdatedAt
          applyEquityMarketUpdate(client, { quotes: [], candles: [], hyperliquid: { ...good.hyperliquid,
            markets: good.hyperliquid.markets.map(row => ({ ...row, markPrice: 12345 })) } })
          await settle()
          check(perps.textContent.includes('$12,345'), 'Shared stream did not update the rendered perpetual table')
          check(client.getQueryData(queryKeys.crypto).data.quotes.BTC.price === 100, 'Perp stream replaced a spot watchlist price')
          check(client.getQueryState(queryKeys.crypto).dataUpdatedAt === beforeStream, 'Live table must preserve other sources freshness')
          document.querySelector('[aria-label="Chart ETH perpetual"]').click(); await settle()
          check(chartRequest.symbol === 'ETH-PERP' && text().includes('ETH-PERP / USD'), 'Watchlist failed to change the chart market')
          ;[...document.querySelectorAll('button')].find(button => button.textContent === '4h').click(); await settle()
          check(chartRequest.interval === '4 Hours' && chartRequest.range === '3M', 'Timeframe lost its native interval/range')
          const countBeforeSearch = chartCalls
          const input = document.querySelector('#crypto-market-search')
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'ETH')
          input.dispatchEvent(new Event('input', {bubbles:true})); await settle()
          check(perps.querySelectorAll('tbody tr').length === 1 && perps.querySelector('tbody tr').textContent.includes('ETH-PERP'), 'Market search failed')
          check(chartCalls === countBeforeSearch, 'Search sent a history request')
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '')
          input.dispatchEvent(new Event('input', {bubbles:true})); await settle()
          const spotSnapshot = client.getQueryData(queryKeys.crypto)
          client.setQueryData(queryKeys.crypto, { ...spotSnapshot, data: { ...spotSnapshot.data,
            quotes: { ...spotSnapshot.data.quotes, BTC: { ...spotSnapshot.data.quotes.BTC, source: 'Hyperliquid crypto perp' } } } })
          await settle()
          check(document.querySelector('.crypto-ribbon').textContent.includes('BTC PERP'), 'Perpetual fallback must be labelled in the headline ribbon')
          client.setQueryData(queryKeys.crypto, spotSnapshot)
          const refresh = () => fetchRetainedQuery(client, queryKeys.crypto, () => window.api.crypto({ force: true })).catch(() => {})
          mode = 'partial'
          await refresh()
          await settle()
          check(forced, 'Refresh must force request')
          check(!text().includes('stages ready'), 'Partial load restored the snapshot summary banner')
          check(text().includes('Only 5/30 cryptocurrencies available'), 'Missing provider failure detail')
          mode = 'hyperliquid-failed'
          await refresh()
          await settle()
          check(text().includes('Hyperliquid HTTP 429'), 'Missing Hyperliquid failure')
          check(!text().includes('stages ready'), 'Hyperliquid outage restored the snapshot summary banner')
          check(perps.textContent.includes('BTC-PERP') && text().includes('Snapshot coverage 30/30'), 'Hyperliquid outage must preserve other data')
          mode = 'reject'
          await refresh()
          await settle()
          check(text().includes('Crypto data refresh failed: IPC disconnected'), 'Missing rejected refresh error')
          mode = 'success'
          await refresh()
          await settle()
          check(text().includes('Snapshot coverage 30/30'), 'Refresh did not recover')
          check(!text().includes('IPC disconnected'), 'Recovered page retained error')
          client.setQueryData(['apiUsage'], {sampledAt:Date.now(), providers:[{id:'coingecko',throttled:true,cooldownMs:42000}]})
          await settle()
          const cooldownButton = [...document.querySelectorAll('button')].find(button => button.textContent.startsWith('Retry in'))
          check(!cooldownButton && text().includes('CoinGecko rate limited'), 'Cooldown must remain visible without restoring a refresh button')
          check(document.querySelector('.crypto-chart-canvas').dataset.candleCount === '60' && text().includes('Crypto market fixture headline'), 'Cooldown erased healthy data')
          client.setQueryData(['apiUsage'], {sampledAt:Date.now(),providers:[]}); await settle()
          const snapshot = client.getQueryData(queryKeys.crypto)
          client.setQueryData(queryKeys.crypto, { ...snapshot, meta: { ...snapshot.meta, freshness: 'stale', fetchedAt: Date.now() - 180000 } })
          await settle()
          check(!document.querySelector('.crypto-notice'), 'Stale snapshot restored the summary banner')
          check(document.querySelector('.crypto-chart-caption').textContent.includes('stale'), 'Retained snapshot freshness missing')
          check(!document.body.innerHTML.includes('Snapshot expired'), 'Expired snapshot warning escaped Settings')
          client.setQueryData(queryKeys.crypto, snapshot)
          document.querySelector('[aria-label="Chart BTC perpetual"]').click()
          ;[...document.querySelectorAll('button')].find(button => button.textContent === '1h').click()
          await settle()
          check(!document.querySelector('.crypto-heading') && !text().includes('Crypto Workspace'), 'Removed workspace header returned')
          check(![...document.querySelectorAll('button')].some(button => button.textContent === 'Copy snapshot'), 'Removed header action returned')
          document.querySelector('.crypto-news-item').click(); await settle()
          check(opened === 'https://example.com/crypto', 'News link failed')
          const lastCell = document.querySelector('.crypto-heatmap-cell:last-child')
          check(lastCell.getBoundingClientRect().bottom <= document.querySelector('.crypto-breadth').getBoundingClientRect().bottom, 'The last heatmap row is clipped')
          const complete = client.getQueryData(queryKeys.crypto)
          client.setQueryData(queryKeys.crypto, { ...complete, data: { ...complete.data,
            hyperliquid: { ...good.hyperliquid, markets: [...good.hyperliquid.markets, ...Array.from({ length: 248 }, (_, i) => ({ ...good.hyperliquid.markets[i % 2], symbol: 'COIN' + i }))] },
            news: Array.from({ length: 10 }, (_, i) => ({ ...good.news[0], id: 'news-' + i, title: 'Crypto market fixture headline with a longer title to exercise wrapping in the news panel ' + i }))
          } })
          await settle()
          window.checkViewport()
          return 'PASS: prepared startup chart, watchlist/timeframes, real candlestick rendering, market search/sort, source separation, removed workspace header, news actions, cooldown, partial readiness and recovery'
        }
      `,
    },
    bundle: true, jsx: 'automatic', write: false, format: 'iife',
    loader: { '.css': 'empty' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), `
    <html><head><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="height:calc(100vh - 100px);width:calc(100vw - 220px);margin:100px 0 0 220px;display:flex"></div>
    <script>window.api = {}</script><script src="renderer.js"></script></body></html>
  `)
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron');
    const fs = require('fs');
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { backgroundThrottling: false, offscreen: true } });
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
        const result = await window.webContents.executeJavaScript('window.runProbe().catch(error => ({ error: error.stack }))');
        if (result.error) throw Error(result.error);
        console.log(result);
        await new Promise(resolve => setTimeout(resolve, 300));
        window.webContents.invalidate();
        fs.writeFileSync(${JSON.stringify(screenshot)}, (await window.webContents.capturePage()).toPNG());
        for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 720], [960, 600]]) {
          window.setContentSize(width, height);
          await new Promise(resolve => setTimeout(resolve, 250));
          const failure = await window.webContents.executeJavaScript('(() => { try { window.checkViewport(); return null } catch (error) { return error.stack } })()');
          fs.writeFileSync(${JSON.stringify(join(root, 'out'))} + '/crypto-smoke-' + width + 'x' + height + '.png', (await window.webContents.capturePage()).toPNG());
          if (failure) throw Error(failure);
        }
        console.log('PASS: viewport fit at 1920x1080, 1440x900, 1280x720 and 960x600 with app chrome, 250 markets and 10 headlines'); app.exit(0);
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
    const timer = setTimeout(() => { child.kill(); reject(new Error('Crypto UI probe timed out')) }, 30_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log(`Screenshot: ${screenshot}`)
} finally {
  assert.ok(!relative(tmpdir(), directory).startsWith('..'))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

