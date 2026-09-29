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
          news: [{ id: 'fixture', title: 'Crypto market fixture headline', time: '10:00', source: 'Fixture' }], progress: { heatmap: 'loaded', quotes: 'loaded', market: 'loaded', news: 'loaded' }
        }
        Object.assign(window.api, {
          crypto: async request => {
            while (!ready) await new Promise(resolve => setTimeout(resolve, 25))
            forced = request.force
            await new Promise(resolve => setTimeout(resolve, 50))
            if (mode === 'reject') throw Error('IPC disconnected')
            const data = mode === 'partial' ? { ...good, heatmap: { ...good.heatmap, tiles: good.heatmap.tiles.slice(0, 5), coverage: { loaded: 5, total: 30 } }, progress: { ...good.progress, heatmap: 'unavailable' } } : good
            return { data, meta: { freshness: mode === 'partial' ? 'partial' : 'fresh', source: 'fixture', fetchedAt: Date.now() }, errors: mode === 'partial' ? [{ symbol: 'Top 30 Cryptocurrencies', reason: 'Only 5/30 cryptocurrencies available.' }] : [] }
          }
        })
        window.runProbe = async () => {
          createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><CryptoPage onStatusChange={() => {}} /></QueryClientProvider>)
          await settle()
          check(text().includes('Fetching live crypto'), 'Missing loading state')
          ready = true
          await settle()
          check(text().includes('Live coverage 30/30'), 'Missing complete heatmap')
          check(document.querySelectorAll('[title^="Rank:"]').length === 30, 'Missing heatmap tiles')
          const refresh = () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Refresh').click()
          mode = 'partial'
          refresh()
          await settle()
          check(forced, 'Refresh must force request')
          check(text().includes('3/4 stages ready'), 'Partial load must not report all stages ready')
          check(text().includes('Only 5/30 cryptocurrencies available'), 'Missing provider failure detail')
          mode = 'reject'
          refresh()
          await settle()
          check(text().includes('Crypto refresh failed: IPC disconnected'), 'Missing rejected refresh error')
          mode = 'success'
          refresh()
          await settle()
          check(text().includes('Live coverage 30/30'), 'Refresh did not recover')
          check(!text().includes('IPC disconnected'), 'Recovered page retained error')
          return 'PASS: loading, 30 tiles, partial readiness, forced refresh, rejection, and recovery'
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

