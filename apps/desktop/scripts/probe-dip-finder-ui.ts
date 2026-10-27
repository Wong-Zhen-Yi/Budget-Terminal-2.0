import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-dip-finder-ui-'))
const screenshot = join(tmpdir(), 'budget-dip-finder-entry.png')
try {
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
        import { createRoot } from 'react-dom/client'
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
        import { DipFinderPanel } from './src/components/portfolio/DipFinderPanel'
        import { buildPositionRows } from './electron/shared/portfolioMath'
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const check = (value, message) => { if (!value) throw Error(message) }
        const settle = () => new Promise(resolve => setTimeout(resolve, 180))
        const body = () => document.body.innerText
        const tickers = ['GAIN', 'FLAT', 'DIP', 'MISSING', 'NOCOST', 'EXCLUDED', 'WATCH']
        let portfolio = { tickers, cashBalance: 0, includeCashInWeight: false, holdings: Object.fromEntries(tickers.map(ticker => [ticker,
          { ticker, shares: ticker === 'WATCH' ? 0 : 2, avgPrice: ticker === 'NOCOST' ? 0 : 100, includeInWeight: ticker !== 'EXCLUDED' }])) }
        let quotes = Object.fromEntries(tickers.filter(ticker => ticker !== 'MISSING').map(ticker => [ticker,
          { ticker, price: ticker === 'GAIN' ? 125 : ticker === 'DIP' ? 75 : 100, currency: 'USD' }]))
        const calls = []
        window.api.returns = async ({ window }) => {
          calls.push(window)
          return { data: { returns: { GAIN: 3, FLAT: 0, DIP: -5 } }, meta: { freshness: 'fresh', fetchedAt: Date.now() }, errors: [] }
        }
        const root = createRoot(document.getElementById('root'))
        const render = () => root.render(<QueryClientProvider client={client}><DipFinderPanel rows={buildPositionRows(portfolio, quotes)} visible /></QueryClientProvider>)
        const button = text => [...document.querySelectorAll('button')].find(button => button.textContent === text)
        const click = async text => { button(text).click(); await settle() }
        const labels = () => [...document.querySelectorAll('span[title]')].map(element => element.title)
        window.runProbe = async () => {
          render(); await settle()
          check(calls.join() === '1mo' && body().includes('+3.0%'), 'Default month returns unchanged')
          await click('Entry')
          check(button('Entry').getAttribute('aria-pressed') === 'true', 'Entry selected')
          check(calls.length === 1, 'Entry must reuse quotes without requesting history')
          check(body().includes('+25.0%') && body().includes('-25.0%') && body().includes('+0.0%'), 'Gain, dip and breakeven measured against average cost')
          check(labels().join() === 'GAIN,FLAT,DIP', 'Biggest dips on right; excluded and zero-share positions omitted')
          check(body().includes('Unavailable') && body().includes('MISSING, NOCOST'), 'Missing quote and zero average cost reported')
          portfolio = { ...portfolio, holdings: { ...portfolio.holdings, DIP: { ...portfolio.holdings.DIP, avgPrice: 150 } } }
          render(); await settle()
          check(body().includes('-50.0%'), 'Average cost edits immediately update Entry')
          quotes = { ...quotes, GAIN: { ...quotes.GAIN, price: 150 } }
          render(); await settle()
          check(body().includes('+50.0%'), 'Live price changes update Entry')
          await click('YTD')
          check(calls.join() === '1mo,ytd' && body().includes('-5.0%') && !body().includes('Unavailable'), 'Historical mode and explanation reset')
          await click('1 Month')
          check(calls.length === 2 && body().includes('+3.0%'), 'Cached month returns reused')
          await click('Entry')
          portfolio = { ...portfolio, tickers: ['GAIN'], holdings: { GAIN: { ticker: 'GAIN', shares: 1, avgPrice: 200, includeInWeight: true } } }
          render(); await settle()
          check(labels().join() === 'GAIN' && body().includes('-25.0%'), 'Portfolio switches use the current portfolio average cost')
          quotes = {}; render(); await settle()
          check(body().includes('No positions with a quote and positive average price') && body().includes('Unavailable'), 'All missing data produces honest empty state')
          portfolio = { ...portfolio, tickers: [] }; render(); await settle()
          check(!body().includes('Unavailable'), 'Empty portfolio has no misleading missing-data warning')
          portfolio = { ...portfolio, tickers: ['GAIN', 'FLAT', 'DIP'], holdings: Object.fromEntries(['GAIN', 'FLAT', 'DIP'].map(ticker => [ticker, { ticker, shares: 2, avgPrice: 100, includeInWeight: true }])) }
          quotes = { GAIN: { price: 125, currency: 'USD' }, FLAT: { price: 100, currency: 'USD' }, DIP: { price: 75, currency: 'USD' } }
          render(); await settle()
          check(button('Entry').getAttribute('aria-pressed') === 'true' && !body().includes('Unavailable'), 'Final clean Entry view')
          return 'PASS: Entry gains/losses, ordering, exclusions, missing data, average-cost and quote updates, portfolio switches and historical controls'
        }
      `,
    },
    bundle: true, jsx: 'automatic', write: false, format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
  })
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(file => file.endsWith('.css'))
  assert.ok(css, 'Run npm run build before this UI probe')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), '<link rel="stylesheet" href="theme.css"><style>html,body,#root{height:100%;margin:0}#root{display:flex;padding:12px}</style><div id="root"></div><script>window.api={}</script><script src="renderer.js"></script>')
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1300, height: 750, webPreferences: { backgroundThrottling: false, offscreen: true } })
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        console.log(await window.webContents.executeJavaScript('window.runProbe()'))
        require('node:fs').writeFileSync(${JSON.stringify(screenshot)}, (await window.webContents.capturePage()).toPNG())
        app.exit(0)
      } catch (error) { console.error(error); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Dip Finder UI probe timed out')) }, 30_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log(`Screenshot: ${screenshot}`)
} finally {
  if (resolve(directory).startsWith(resolve(tmpdir()) + sep) && directory.startsWith(join(tmpdir(), 'budget-dip-finder-ui-'))) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
