import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-finance-ui-'))
try {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import { createRoot } from 'react-dom/client'
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
    import { PersonalFinancePage } from './src/pages/PersonalFinancePage'
    import { queryKeys } from './src/api/client'
    const envelope = data => ({ data, meta: { freshness: 'fresh', fetchedAt: Date.now(), source: 'Fixture' }, errors: [] })
    window.api = { onPortfolioChanged: () => () => {} }
    const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } })
    client.setQueryData(queryKeys.personalFinance, envelope({
      cash: [{ id: 'cash', desc: 'Savings account', amount: 25000 }],
      debt: [{ id: 'debt', desc: 'Credit card', amount: 100 }],
      recurringBills: [
        { id: 'bill1', desc: 'Home internet subscription', amount: 59.90, currency: 'SGD', frequency: 'monthly' },
        { id: 'bill2', desc: 'Annual household insurance premium', amount: 1234.56, currency: 'USD', frequency: 'yearly' },
      ],
      totalsCurrency: 'SGD', goal: { title: 'Emergency savings goal', targetAmount: 100000, currency: 'SGD' }, sourcePath: '',
    }))
    client.setQueryData(queryKeys.portfolio, envelope({ portfolios: [], sourcePath: '' }))
    client.setQueryData(queryKeys.fx, envelope({ usdSgd: 1.3, collectedAt: Date.now() }))
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><PersonalFinancePage onStatusChange={() => {}} /></QueryClientProvider>)
    window.checkLayout = () => {
      const check = (value, message) => { if (!value) throw Error(message) }
      const page = document.querySelector('.finance-page')
      check(page.scrollWidth <= page.clientWidth + 1, 'Finance overflows horizontally')
      check(page.scrollHeight <= page.clientHeight + 1, 'Finance overflows vertically')
      const panels = [...document.querySelectorAll('.finance-grid > section')]
      check(panels.length === 6, 'Expected all six finance panels')
      for (const panel of panels) {
        const rect = panel.getBoundingClientRect()
        check(rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1, 'Panel outside viewport: ' + panel.textContent.slice(0, 30))
        const body = panel.lastElementChild
        check(body.scrollHeight <= body.clientHeight + 1, 'Panel clips content: ' + panel.className)
      }
      for (const input of document.querySelectorAll('.finance-bills textarea')) {
        check(input.clientWidth >= 120, 'Bill description too narrow: ' + input.clientWidth)
        check(input.scrollHeight <= input.clientHeight + 1, 'Bill name is clipped: ' + input.clientHeight + '/' + input.scrollHeight + ' width ' + input.clientWidth)
      }
      const table = document.querySelector('.finance-bills table')
      check(table.parentElement.scrollWidth <= table.parentElement.clientWidth + 1, 'Bills require horizontal scrolling')
      for (const node of document.querySelectorAll('.finance-goal input, .finance-goal select, .finance-goal svg')) {
        const rect = node.getBoundingClientRect()
        const body = document.querySelector('.finance-goal > div').getBoundingClientRect()
        check(rect.height > 0 && rect.top >= body.top && rect.bottom <= body.bottom + 1, 'Goal control or ring is clipped')
      }
      return 'PASS: finance layout at ' + innerWidth + 'x' + innerHeight + ' (sidebar reserved)'
    }
  ` }, bundle: true, jsx: 'automatic', write: false, format: 'iife', loader: { '.css': 'empty' }, alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') }, define: { 'process.env.NODE_ENV': '"production"' } })
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(file => file.endsWith('.css'))
  assert.ok(css, 'Run the build before this UI probe')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), '<meta charset="utf-8"><link rel="stylesheet" href="theme.css"><style>#root{display:flex;height:calc(100% - 64px);margin-top:64px;margin-left:192px}</style><div id="root"></div><script>window.api = { onPortfolioChanged: () => () => {} }</script><script src="renderer.js"></script>')
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))})
    app.whenReady().then(async () => {
      const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false, offscreen: true } })
      win.webContents.on('console-message', event => console.log(event.message))
      try {
        await win.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        for (const [width, height] of [[1280, 800], [1280, 720], [1920, 1080]]) {
          win.setContentSize(width, height)
          await new Promise(resolve => setTimeout(resolve, 1200))
          if (process.env.FINANCE_SCREENSHOT && width === 1280 && height === 800) require('node:fs').writeFileSync(process.env.FINANCE_SCREENSHOT, (await win.webContents.capturePage()).toPNG())
          const result = await win.webContents.executeJavaScript('try { window.checkLayout() } catch (error) { "FAIL: " + error.message }')
          console.log(result)
          if (!result.startsWith('PASS:')) throw Error(result)

        }
        app.exit(0)
      } catch (error) { console.error(error); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((done, reject) => {
    const child = spawn(createRequire(import.meta.url)('electron'), [join(directory, 'main.cjs')], { env })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(Error('Finance UI probe timed out')) }, 30000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); done({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output)
} finally { await rm(directory, { recursive: true, force: true }) }
