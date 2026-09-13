import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-bitcoin-ui-'))
const screenshot = join(root, 'out', 'bitcoin-smoke.png')
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
        import { BitcoinPage } from './src/pages/BitcoinPage'
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const check = (ok, message) => { if (!ok) throw Error(message) }
        const settle = () => new Promise(resolve => setTimeout(resolve, 150))
        const text = () => document.body.innerText
        window.runProbe = async () => {
          createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><BitcoinPage onStatusChange={() => {}} /></QueryClientProvider>)
          await settle()
          check(text().includes('Loading Bitcoin'), 'Missing loading state')
          window.ready = true
          await new Promise(resolve => setTimeout(resolve, 350))
          check(text().includes('144') && text().includes('3.125 BTC'), 'Network metrics not rendered')
          check(document.querySelectorAll('tbody tr').length === 15, 'Missing recent blocks')
          document.querySelector('tbody button').click()
          check(window.opened.startsWith('https://mempool.space/block/'), 'Block explorer link failed')
          const refresh = () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Refresh').click()
          refresh()
          await settle()
          check(window.forced, 'Refresh did not force provider request')
          window.mode = 'partial'
          refresh()
          await settle()
          check(text().includes('stats: HTTP 429'), 'Partial failure not visible')
          check(document.querySelectorAll('tbody tr').length === 15, 'Partial failure hid healthy blocks')
          window.mode = 'failed'
          refresh()
          await settle()
          check(text().includes('Recent blocks unavailable'), 'Missing failed state')
          window.mode = 'success'
          refresh()
          await settle()
          check(!document.querySelector('[role=status]'), 'Failure did not recover')
          return 'PASS: loading, metrics, blocks, explorer link, forced refresh, partial failure, total failure, recovery'
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
    <script>
      window.mode = 'success'; window.ready = false;
      const good = {
        stats: { timestamp: Date.now(), market_price_usd: 76710.53, hash_rate: 905e9, n_btc_mined: 450e8, n_tx: 723135, n_blocks_mined: 144, minutes_between_blocks: 10, totalbc: 20083828e8, difficulty: 127e12 },
        blocks: Array.from({ length: 15 }, (_, i) => ({ id: i.toString(16).padStart(64, '0'), height: 966825-i, timestamp: Math.floor(Date.now()/1000)-i*600, tx_count: 4472-i*50, size: 1577804, weight: 3992741, difficulty: 127450789715843 })),
        fees: { fastestFee: 3, halfHourFee: 2, hourFee: 1, economyFee: 1, minimumFee: 1 },
        mempool: { count: 75975, vsize: 38806603, total_fee: 6298092 }
      };
      window.api = {
        openExternal: async url => { window.opened = url },
        bitcoin: async request => {
          while (!window.ready) await new Promise(resolve => setTimeout(resolve, 50));
          window.forced = request.force;
          const errors = window.mode === 'success' ? [] : [{ symbol: 'stats', source: 'fixture', operation: 'bitcoin', reason: 'HTTP 429' }];
          return { data: window.mode === 'failed' ? { stats: null, blocks: [], fees: null, mempool: null } : window.mode === 'partial' ? { ...good, stats: null } : good,
            meta: { source: 'UI probe fixture', fetchedAt: Date.now(), freshness: window.mode === 'success' ? 'fresh' : window.mode, failureReason: errors.length ? 'stats: HTTP 429' : undefined }, errors };
        }
      };
    </script><script src="renderer.js"></script></body></html>
  `)
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron');
    const fs = require('fs');
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { backgroundThrottling: false } });
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
        console.log(await window.webContents.executeJavaScript('window.runProbe()'));
        await new Promise(resolve => setTimeout(resolve, 300));
        fs.writeFileSync(${JSON.stringify(screenshot)}, (await window.webContents.capturePage()).toPNG());
        window.setSize(800, 800);
        await new Promise(resolve => setTimeout(resolve, 200));
        if (await window.webContents.executeJavaScript('document.documentElement.scrollWidth > window.innerWidth')) throw Error('Narrow layout overflows');
        console.log('PASS: responsive layout and screenshot'); app.exit(0);
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
    const timer = setTimeout(() => { child.kill(); reject(new Error('Bitcoin UI probe timed out')) }, 30_000)
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
