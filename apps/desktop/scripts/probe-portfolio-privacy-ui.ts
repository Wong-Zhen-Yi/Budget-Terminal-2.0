import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-portfolio-privacy-ui-'))
const screenshot = join(tmpdir(), 'budget-portfolio-privacy.png')
try {
  const bundle = await build({
    stdin: {
      resolveDir: root, loader: 'tsx',
      contents: `
        import { createRoot } from 'react-dom/client'
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
        import { PortfolioPage } from './src/pages/PortfolioPage'
        import { PersonalFinancePage } from './src/pages/PersonalFinancePage'
        import { NumberPrivacy } from './src/components/ui/NumberPrivacy'
        import { NumberInput } from './src/components/ui/NumberInput'
        const check = (value, message) => { if (!value) throw Error(message) }
        const settle = () => new Promise(resolve => setTimeout(resolve, 150))
        const envelope = data => ({ data, meta: { freshness: 'fresh', fetchedAt: Date.now(), source: 'Synthetic fixture' }, errors: [] })
        const option = { rowId: 'option', ticker: 'DEMO', strategy: 'Calls', strike: 150, contracts: 3,
          premium: 7.25, currentPrice: 8.5, expiry: '2027-01-15', openDate: '2026-10-01', status: 'Open' }
        const portfolio = { id: 'demo', name: 'Demo Portfolio', tickers: ['DEMO'], cashBalance: 12345.67, marginDebt: 123.45,
          includeCashInWeight: true, holdings: { DEMO: { ticker: 'DEMO', shares: 17, avgPrice: 111.25, includeInWeight: true } }, options: [option] }
        let payload = { portfolios: [portfolio], activeId: 'demo', mainId: 'demo', sourcePath: '' }
        let finance = { cash: [{ id: 'cash', desc: 'Demo savings', amount: 45678.91 }],
          debt: [{ id: 'debt', desc: 'Demo loan', amount: 2345.67 }],
          recurringBills: [{ id: 'bill', desc: 'Demo subscription', amount: 88.99, frequency: 'monthly', currency: 'SGD' }],
          totalsCurrency: 'SGD', goal: { title: 'Demo goal', targetAmount: 200000, currency: 'SGD' }, sourcePath: '' }
        let fx = { usdSgd: 1.3142, collectedAt: Date.now() }
        const mutations = []
        window.api.onPortfolioChanged = () => () => {}
        window.api.portfolio = async () => envelope(payload)
        window.api.personalFinance = async () => envelope(finance)
        window.api.fx = async () => envelope(fx)
        window.api.mutatePersonalFinance = async mutation => {
          mutations.push(mutation)
          if (mutation.type === 'setEntry') finance = { ...finance, [mutation.category]: finance[mutation.category].map(row => row.id === mutation.id ? { ...row, amount: mutation.amount } : row) }
          return envelope(finance)
        }
        window.api.quotes = async () => envelope({ holdings: { DEMO: { symbol: 'DEMO', price: 145.5, change: 2.75, absChange: 3.89, currency: 'USD', priceBasis: 'equity-perp-mark', source: 'Synthetic Hyperliquid equity perp' } } })
        window.api.fundamentals = async () => envelope({ fundamentals: { DEMO: { sector: 'Technology', marketCap: 987654321, trailingPe: 20, forwardPe: 18 } } })
        window.api.optionQuotes = async ({ positions }) => envelope({ quotes: Object.fromEntries(positions.map(position => [position.rowId,
          { currentPrice: 8.5, volume: 555, openInterest: 333, impliedVolatility: .45 }])), expiries: {} })
        window.api.returns = async () => envelope({ returns: { DEMO: 12.5 } })
        window.api.momentum = async () => envelope({ includedTickers: ['DEMO'], excludedTickers: [], dates: ['2026-10-01', '2026-10-02'], returns: [0, 12.5], ema: [0, 6.25], emaPeriod: 20, startDate: '2026-10-01' })
        window.api.analytics = async () => envelope({ includedTickers: ['DEMO'], excludedTickers: [], metrics: { beta: 1.23, alpha: 12.5 }, historyPoints: 200,
          startDate: '2026-01-01', endDate: '2026-10-01', benchmarkSymbol: 'SPY' })
        window.api.mutatePortfolio = async mutation => {
          mutations.push(mutation)
          if (mutation.type === 'setCash') payload = { ...payload, portfolios: [{ ...payload.portfolios[0], cashBalance: mutation.cashBalance }] }
          return envelope(payload)
        }
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const root = createRoot(document.getElementById('root'))
        let hidden = true
        let financePage = false
        const render = () => root.render(<QueryClientProvider client={client}><NumberPrivacy value={hidden}>
          {financePage ? <PersonalFinancePage onStatusChange={() => {}} /> : <PortfolioPage onStatusChange={() => {}} />}
        </NumberPrivacy><div id="outside"><NumberInput aria-label="Outside number" value={42} onCommit={() => {}} /></div></QueryClientProvider>)
        const body = () => document.body.innerText
        const click = async text => {
          const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text)
          check(button, 'Missing button: ' + text); button.click(); await settle()
        }
        const maskedCells = () => {
          const cells = [...document.querySelectorAll('tbody td.num')]
          check(cells.length > 1 && cells.every(cell => cell.textContent === '****'), 'Every numeric cell must be masked')
          check(!document.querySelector('tbody input[inputmode="decimal"]'), 'Masked cells must not expose numeric editors')
        }
        const noAmounts = () => {
          const accessible = body() + [...document.querySelectorAll('[title],svg title')].map(node => node.getAttribute('title') || node.textContent).join(' ')
          for (const value of ['12,345.67', '12345.67', '111.25', '145.50', '987.65M', '12.5%', '1.23', '7.25', '8.50']) {
            check(!accessible.includes(value), 'Private figure leaked: ' + value)
          }
        }
        window.runProbe = async () => {
          render(); await settle(); await settle()
          check(document.querySelector('select[aria-label="Active portfolio"]').selectedOptions[0].textContent.includes('Demo Portfolio') && body().includes('DEMO') && body().toLowerCase().includes('stock p&l'), 'Labels and tickers stay visible: ' + body())
          check(!document.querySelector('input[aria-label="Brokerage cash"]'), 'Cash editor replaced with stars')
          check(document.querySelector('#outside input').value === '42', 'Privacy is scoped to the portfolio')
          maskedCells(); noAmounts()
          await click('Options'); maskedCells(); noAmounts()
          for (const tab of ['Portfolio Weight', 'Dip Finder', 'Pie Chart', 'Portfolio Heatmap', 'Momentum Tracker', 'Portfolio Metrics']) {
            await click(tab); noAmounts()
            check(body().includes('****'), tab + ' displays masked values')
          }
          await click('Stocks')
          await click('- Remove Position'); noAmounts()
          check(document.querySelector('[role="dialog"]').innerText.includes('****'), 'Removal dialog hides values')
          await click('Cancel')
          // Updating data while hidden must retain masking, then reveal the latest values.
          payload = { ...payload, portfolios: [{ ...portfolio, cashBalance: 23456.78 }] }
          client.setQueryData(['portfolio'], envelope(payload)); await settle()
          check(!body().includes('23,456.78'), 'Live updates remain hidden')
          hidden = false; render(); await settle()
          check([...document.querySelectorAll('tbody td')].some(cell => cell.textContent.includes('PERP')), 'Revealed portfolio prices must identify equity-perpetual marks')
          check(document.querySelector('input[aria-label="Brokerage cash"]').value === '23456.78', 'Reveal shows current cash')
          check(document.querySelector('input[aria-label="DEMO shares"]').value === '17', 'Reveal restores shares editor')
          check(body().includes('$145.50'), 'Reveal restores table values')
          const cash = document.querySelector('input[aria-label="Brokerage cash"]')
          cash.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); await settle()
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(cash, '30000')
          cash.dispatchEvent(new Event('input', { bubbles: true })); await settle()
          cash.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); await settle()
          check(mutations.some(mutation => mutation.type === 'setCash' && mutation.cashBalance === 30000), 'Revealed values remain editable')
          hidden = true; render(); await settle(); maskedCells(); noAmounts()
          check(!body().includes('30,000'), 'Hiding again masks edited values')
          financePage = true; render(); await settle(); await settle()
          const checkFinance = () => {
            maskedCells()
            const accessible = body() + [...document.querySelectorAll('[title],svg title')].map(node => node.getAttribute('title') || node.textContent).join(' ')
            check(!/(?:S\\$|US\\$|\\$)[\\d,]+/.test(accessible), 'Finance amounts must be hidden in totals, goal, footers, charts and titles')
            check(!document.querySelector('input[inputmode="decimal"]:not(#outside input)'), 'All finance numeric editors replaced by stars')
            check(!accessible.includes('1.3142'), 'FX value masked')
            check(body().includes('Cash total: ****') && body().includes('Debt total: ****'), 'Cash and debt labels remain visible')
            check(body().includes('**** remaining | **** complete'), 'Goal status masks both numbers: ' + body())
            check(document.querySelector('[aria-label="Demo savings description"]'), 'Account descriptions stay visible')
            check(document.querySelector('[aria-label="Demo subscription cycle"]'), 'Bill controls stay usable')
          }
          checkFinance()
          await click('Log'); checkFinance()
          await click('Show Animation'); await settle(); checkFinance()
          hidden = false; render(); await settle()
          check(document.querySelector('input[aria-label="Demo savings amount"]').value === '45678.91', 'Finance reveal restores cash editor')
          check(document.querySelector('input[aria-label="Goal target"]').value === '200000.00', 'Finance reveal restores target editor')
          check(body().includes('45,678.91') && body().includes('1.3142'), 'Finance reveal restores footer and FX values')
          const savings = document.querySelector('input[aria-label="Demo savings amount"]')
          savings.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); await settle()
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(savings, '56789.12')
          savings.dispatchEvent(new Event('input', { bubbles: true })); await settle()
          savings.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); await settle()
          check(mutations.some(mutation => mutation.type === 'setEntry' && mutation.amount === 56789.12), 'Finance amounts remain editable after reveal')
          hidden = true; render(); await settle(); checkFinance()
          check(!body().includes('56,789.12'), 'Finance edited balance hidden again')
          finance = { ...finance, cash: [{ ...finance.cash[0], amount: 67890.12 }] }
          client.setQueryData(['personalFinance'], envelope(finance)); await settle(); checkFinance()
          check(!body().includes('67,890.12'), 'Finance live updates remain masked')
          fx = { usdSgd: null }; client.setQueryData(['fx'], envelope(fx)); await settle()
          check(body().includes('FX required') && !body().includes('67,890.12'), 'FX failures remain visible without exposing balances')
          fx = { usdSgd: 1.3142, collectedAt: Date.now() }; client.setQueryData(['fx'], envelope(fx)); await settle(); checkFinance()
          return 'PASS: Portfolio all eight tabs; Personal Finance cash, debt, margin, bills, totals, goals, chart labels, FX failures, live updates and reveal/edit/hide; scoped privacy'
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
  await writeFile(join(directory, 'index.html'), '<link rel="stylesheet" href="theme.css"><style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}</style><div id="root"></div><script>window.api={}</script><script src="renderer.js"></script>')
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1500, height: 850, webPreferences: { backgroundThrottling: false, offscreen: true } })
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
    const timer = setTimeout(() => { child.kill(); reject(new Error('Portfolio privacy UI probe timed out')) }, 30_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log(`Screenshot: ${screenshot}`)
} finally {
  if (resolve(directory).startsWith(resolve(tmpdir()) + sep) && directory.startsWith(join(tmpdir(), 'budget-portfolio-privacy-ui-'))) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
