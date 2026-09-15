import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-fundamentals-ui-'))
const screenshot = join(root, 'out', 'fundamentals-usd-smoke.png')
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert.ok(css, 'Run npm run build first')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({
    stdin: {
      resolveDir: root, loader: 'tsx',
      contents: `
        import { createRoot } from 'react-dom/client'
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
        import { FundamentalsPage } from './src/pages/FundamentalsPage'
        import { useFundamentalsStore } from './src/stores/fundamentals'
        import { FUNDAMENTAL_SERIES_KEYS } from './electron/shared/contract'
        const check = (ok, message) => { if (!ok) throw Error(message) }
        const settle = () => new Promise(resolve => setTimeout(resolve, 400))
        const payload = symbol => ({
          symbol, displayCurrency: 'USD', currencyVersion: 2, generatedAt: Date.now(),
          currencyNote: symbol === 'TSM' ? '1 TWD = 0.03125 USD' : 'Reported in USD',
          company: { name: symbol === 'TSM' ? 'Taiwan Semiconductor Manufacturing Company' : 'Apple', currency: 'USD' },
          facts: { trailingPe: 20, forwardPe: 18, priceToSales: 8, pegRatio: 1, earningsGrowth: 0.2, enterpriseValue: 200e9, ebitda: 40e9, marketCap: 210e9, totalRevenue: 100e9, freeCashFlow: 20e9, totalCash: 30e9, totalDebt: 20e9, beta: 1.2 },
          annual: Object.fromEntries(FUNDAMENTAL_SERIES_KEYS.map(key => [key, [2023, 2024, 2025].map((year, i) => ({ endDate: year + '-12-31', label: String(year), value: (key === 'sharesOutstanding' ? 5e9 : 80e9) * (1 + i / 10), source: 'yahoo' }))])),
          quarterly: Object.fromEntries(FUNDAMENTAL_SERIES_KEYS.map(key => [key, []])),
          sec: { available: false, filings: [], warnings: [] }, warnings: []
        })
        window.api = { fundamentalsPage: async ({symbol}) => ({ data: payload(symbol), meta: { freshness: 'fresh' }, errors: [] }) }
        window.runProbe = async () => {
          useFundamentalsStore.setState({ symbol: 'TSM', compareSymbol: 'AAPL', snapshot: null })
          const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
          createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><FundamentalsPage onStatusChange={() => {}} /></QueryClientProvider>)
          await settle()
          const text = document.body.innerText
          check(text.includes('Amounts in USD'), 'Missing USD label')
          check(text.includes('TSM: 1 TWD = 0.03125 USD') && text.includes('AAPL: Reported in USD'), 'Missing comparison FX basis')
          check(text.includes('share counts are unchanged'), 'Missing share unit explanation')
          const full = [...document.querySelectorAll('button')].filter(button => button.textContent === 'Full')
          check(full.length === 6, 'Missing chart panels')
          full[0].click()
          await settle()
          check(document.querySelector('[role="dialog"]'), 'Fullscreen chart did not open')
          document.querySelector('[aria-label="Close"]').click()
          await settle()
          check(!document.querySelector('[role="dialog"]'), 'Fullscreen chart did not close')
          return 'PASS: USD labels, comparison FX basis, six chart panels, fullscreen'
        }
      `,
    },
    bundle: true, jsx: 'automatic', write: false, format: 'iife',
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.BROWSER_MODE': 'false' },
  })
  await writeFile(join(directory, 'index.html'), '<html><head><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="height:100vh;display:flex"></div><script>window.api = { fundamentalsPage: request => window.fixtureApi(request) }</script><script src="renderer.js"></script></body></html>')
  // client.ts captures the preload API at import time; forward it to the fixture installed by the bundle.
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text + '\nwindow.fixtureApi = window.api.fundamentalsPage;')
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron');
    const fs = require('node:fs');
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ width: 1600, height: 1000, show: false, webPreferences: { contextIsolation: false, nodeIntegration: false, backgroundThrottling: false } });
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
        console.log(await window.webContents.executeJavaScript('window.runProbe()'));
        await new Promise(resolve => setTimeout(resolve, 300));
        fs.writeFileSync(${JSON.stringify(screenshot)}, (await window.webContents.capturePage()).toPNG());
        app.exit(0);
      } catch(error) { console.error(error); app.exit(1); }
    });
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(new Error('UI probe timed out')) }, 30_000)
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
