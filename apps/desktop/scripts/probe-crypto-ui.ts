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
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
        import { createRoot } from 'react-dom/client'
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
        import { CryptoPage } from './src/pages/CryptoPage'
        import { queryKeys } from './src/api/client'
        import { applyEquityMarketUpdate } from './src/api/equityStream'
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const check = (ok, message) => { if (!ok) throw Error(message) }
        const settle = () => new Promise(resolve => setTimeout(resolve, 200))
        const text = () => document.body.innerText
        let mode = 'success'
        let ready = false
        let forced = false
        const good = {
          fetchedAt: '2026-09-29T10:00:00',
          heatmap: { tiles: Array.from({ length: 30 }, (_, i) => ({ rank: i+1, symbol: 'C'+i, name: 'Coin '+i, price: 100, changePct: 1, marketCap: 1e9, volume: 1e6, source: 'Yahoo Finance' })), coverage: { loaded: 30, total: 30 }, updatedAt: '2026-09-29T10:00:00' },
          quotes: Object.fromEntries(['BTC','ETH','SOL','XRP','BNB','COIN','MSTR','BMNR','IBIT','ETHA','BITQ'].map(label => [label, { label, price: 100, changePct: 1, volume: 1e6, marketCap: 1e9 }])), global: { marketCap: 2e12, volume24h: 1e11, changePct: 1 },
          fearGreed: { value: 70, classification: 'Greed', source: 'Alternative.me' },
          hyperliquid: { fetchedAt: '2026-09-29T10:00:00', markets: [
            { symbol: 'BTC', markPrice: 110, changePct: 10, fundingHourlyPct: 0.00125, openInterestUsd: 550, volume24hUsd: 1000 },
            { symbol: 'ETH', markPrice: 20, changePct: null, fundingHourlyPct: -0.002, openInterestUsd: 60, volume24hUsd: 2000 }
          ] },
          news: [{ id: 'fixture', title: 'Crypto market fixture headline', time: '10:00', source: 'Fixture' }], progress: { heatmap: 'loaded', quotes: 'loaded', market: 'loaded', news: 'loaded', hyperliquid: 'loaded' }
        }
        good.quotes.COIN = { ...good.quotes.COIN, source: 'Hyperliquid equity perp (xyz:COIN)',
          volumeSource: 'Yahoo Finance stock volume (shares)', marketCapSource: 'Yahoo Finance', metadataAsOf: Date.now() }
        Object.assign(window.api, {
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
          createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><CryptoPage onStatusChange={() => {}} /></QueryClientProvider>)
          await settle()
          check(text().includes('Fetching crypto market data'), 'Missing loading state')
          ready = true
          await settle()
          check(text().includes('Snapshot coverage 30/30'), 'Missing complete heatmap')
          check(document.querySelectorAll('[title^="Rank:"]').length === 30, 'Missing heatmap tiles')
          check(text().includes('BTC PERP') && text().includes('+0.00125%'), 'Missing Hyperliquid market or incorrect funding units')
          check(text().includes('-0.00200%'), 'Negative funding must keep its sign')
          const perps = [...document.querySelectorAll('section')].find(section => section.textContent.includes('Hyperliquid Perpetuals'))
          check(perps.querySelector('tbody tr').textContent.startsWith('ETH PERP'), 'Perpetuals must initially sort by numeric volume')
          const volumeHeader = [...perps.querySelectorAll('th')].find(header => header.textContent.includes('24h volume'))
          volumeHeader.click()
          await settle()
          check(perps.querySelector('tbody tr').textContent.startsWith('BTC PERP'), 'Perpetual market sorting failed')
          check(text().includes('live feed') && text().includes('REST fallback'), 'Live feed and fallback must be visible')
          check(document.querySelector('[title="Yahoo Finance stock volume (shares)"]').textContent === '1M sh', 'Stock volume must show shares instead of dollars')
          const beforeStream = client.getQueryState(queryKeys.crypto).dataUpdatedAt
          applyEquityMarketUpdate(client, { quotes: [], candles: [], hyperliquid: { ...good.hyperliquid,
            markets: good.hyperliquid.markets.map(row => ({ ...row, markPrice: 12345 })) } })
          await settle()
          check(perps.textContent.includes('$12,345'), 'Shared stream did not update the rendered perpetual table')
          check(client.getQueryData(queryKeys.crypto).data.quotes.BTC.price === 100, 'Perp stream replaced a spot watchlist price')
          check(client.getQueryState(queryKeys.crypto).dataUpdatedAt === beforeStream, 'Live table must preserve other sources freshness')
          const spotSnapshot = client.getQueryData(queryKeys.crypto)
          client.setQueryData(queryKeys.crypto, { ...spotSnapshot, data: { ...spotSnapshot.data,
            quotes: { ...spotSnapshot.data.quotes, BTC: { ...spotSnapshot.data.quotes.BTC, source: 'Hyperliquid crypto perp' } } } })
          await settle()
          check(document.querySelector('.grid-cols-6').textContent.includes('BTC PERP'), 'Perpetual fallback must be labelled in the headline price tile')
          client.setQueryData(queryKeys.crypto, spotSnapshot)
          const refresh = () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Refresh').click()
          mode = 'partial'
          refresh()
          await settle()
          check(forced, 'Refresh must force request')
          check(text().includes('4/5 stages ready'), 'Partial load must not report all stages ready')
          check(text().includes('Only 5/30 cryptocurrencies available'), 'Missing provider failure detail')
          mode = 'hyperliquid-failed'
          refresh()
          await settle()
          check(text().includes('Hyperliquid HTTP 429'), 'Missing Hyperliquid failure')
          check(text().includes('4/5 stages ready'), 'Hyperliquid outage must prevent full readiness')
          check(!text().includes('BTC PERP') && text().includes('Snapshot coverage 30/30'), 'Hyperliquid outage must preserve other data')
          mode = 'reject'
          refresh()
          await settle()
          check(text().includes('Crypto refresh failed: IPC disconnected'), 'Missing rejected refresh error')
          mode = 'success'
          refresh()
          await settle()
          check(text().includes('Snapshot coverage 30/30'), 'Refresh did not recover')
          check(!text().includes('IPC disconnected'), 'Recovered page retained error')
          const snapshot = client.getQueryData(queryKeys.crypto)
          client.setQueryData(queryKeys.crypto, { ...snapshot, meta: { ...snapshot.meta, freshness: 'stale', fetchedAt: Date.now() - 180000 } })
          await settle()
          check(text().includes('Snapshot updated at'), 'Retained snapshot timestamp missing')
          check(!document.body.innerHTML.includes('Snapshot expired'), 'Expired snapshot warning escaped Settings')
          return 'PASS: loading, 30 tiles, Hyperliquid funding units and sorting, isolated outages, partial readiness, forced refresh and recovery'
        }
      `,
    },
    bundle: true, jsx: 'automatic', write: false, format: 'iife',
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), `
    <html><head><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="height:100vh;display:flex"></div>
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
        window.setSize(1280, 720);
        await new Promise(resolve => setTimeout(resolve, 200));
        if (await window.webContents.executeJavaScript('document.documentElement.scrollWidth > window.innerWidth')) throw Error('Narrow layout overflows');
        console.log('PASS: minimum supported window size and screenshot'); app.exit(0);
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

