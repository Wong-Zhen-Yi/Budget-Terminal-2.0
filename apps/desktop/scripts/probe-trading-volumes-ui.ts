import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-trading-volumes-ui-'))
try {
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
        import { createRoot } from 'react-dom/client'
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
        import { TradingVolumesPage } from './src/pages/TradingVolumesPage'
        import { useTradingVolumesPage } from './src/stores/tradingVolumes'
        const check = (value, message) => { if (!value) throw Error(message) }
        const settle = () => new Promise(resolve => setTimeout(resolve, 100))
        const makeRow = (ticker, volume, cap) => ({
          ticker, name: ticker + ' fixture', sector: '', marketCap: cap,
          oneDayDollarVolume: volume, fiveDayAvgDollarVolume: volume,
          thirtyDayAvgDollarVolume: volume, ytdAvgDollarVolume: volume,
          oneYearAvgDollarVolume: volume, threeYearAvgDollarVolume: volume,
          oneDayPriceReturnPct: 2, fiveDayPriceReturnPct: -1,
          thirtyDayPriceReturnPct: 2, ytdPriceReturnPct: 2,
          oneYearPriceReturnPct: 2, threeYearPriceReturnPct: 2,
          marketCapHistory: cap ? [
            { date: '2026-10-14', value: cap / 2 },
            { date: '2026-10-15', value: cap },
          ] : [],
        })
        const rows = Array.from({ length: 21 }, (_, i) => makeRow('N' + i, 10 ** (6 + i / 10), 10 ** (8 + i / 10)))
        rows.push(makeRow('DUP', 1e7, 1e9), makeRow('LOW', 1e7, 1e6), makeRow('MISSING', null, null))
        let calls = 0
        window.api.tradingVolumes = async () => {
          calls++
          const refreshedRows = calls === 1 ? rows : rows.map(row => ({ ...row, marketCap: row.marketCap === null ? null : row.marketCap * 1.01 }))
          return { data: { rows: refreshedRows, source: 'Offline fixture', asOf: '2026-10-15', missing: [] },
            meta: { source: 'Offline fixture', freshness: 'live', fetchedAt: Date.now() }, errors: [] }
        }
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const ticker = (name) => [...document.querySelectorAll('tbody td span')].find(node => node.textContent === name)
        const ring = () => document.querySelector('circle[aria-label^="Hovered ticker "]')
        const hover = async (name) => {
          ticker(name).dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))
          await settle()
        }
        const leave = async (name) => {
          ticker(name).dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
          await settle()
        }
        const click = async (text) => {
          [...document.querySelectorAll('button')].find(button => button.textContent === text).click()
          await settle()
        }
        const checkRing = (name) => {
          const element = ring()
          check(element?.getAttribute('aria-label') === 'Hovered ticker ' + name, 'Matching hover ring: ' + name)
          check(element.getAttribute('fill') === 'none' && element.getAttribute('stroke-width') === '2', 'Visible outline, not a filled dot')
          check(getComputedStyle(element).pointerEvents === 'none', 'Ring must not intercept pointer events')
          const dots = [...document.querySelectorAll('svg circle')].filter(dot => dot.getAttribute('fill') !== 'none')
          check(dots.some(dot => dot.getAttribute('cx') === element.getAttribute('cx') && dot.getAttribute('cy') === element.getAttribute('cy')), 'Ring centered on a plotted dot')
          check([...document.querySelectorAll('svg text')].some(label => label.textContent === name), 'Hovered ticker label revealed')
        }
        window.runProbe = async () => {
          useTradingVolumesPage.setState({ interval: '1d', tableWidth: 650 })
          createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><TradingVolumesPage onStatusChange={() => {}} /></QueryClientProvider>)
          await settle(); await settle()
          check(calls === 1 && document.querySelector('svg circle'), 'Page loads and plots fixture once')
          check(!ring(), 'No hover ring initially')
          check(![...document.querySelectorAll('svg text')].some(label => label.textContent === 'DUP'), 'Collision fixture label initially suppressed')
          await hover('DUP'); checkRing('DUP')
          await leave('DUP'); check(!ring(), 'Ring clears on ticker mouse leave')
          await hover('N20'); checkRing('N20')
          await leave('N20'); await hover('LOW'); checkRing('LOW')
          check(document.querySelectorAll('circle[aria-label^="Hovered ticker "]').length === 1, 'Only one ticker circled')
          await leave('LOW'); await hover('MISSING')
          check(!ring(), 'Missing numeric values do not create a bogus ring')
          await leave('MISSING')
          const slider = document.querySelector('input[type="range"]')
          slider.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); await settle()
          check(document.querySelector('circle[aria-label="Remove outlier LOW"]'), 'Outlier preview still works')
          slider.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); await settle()
          await click('5D')
          await hover('N20'); checkRing('N20'); await leave('N20')
          await click('Replay'); await hover('N20'); checkRing('N20')
          const before = ring().getAttribute('cy')
          await new Promise(resolve => setTimeout(resolve, 250))
          checkRing('N20')
          check(ring().getAttribute('cy') !== before, 'Hover ring follows moving replay dot: ' + before + ' -> ' + ring().getAttribute('cy'))
          await leave('N20'); await click('Stop')
          await hover('LOW'); checkRing('LOW')
          // A new row set must clear transient hover state, including after a refresh.
          await click('Refresh')
          check(!ring(), 'Refreshing clears obsolete table hover')
          check(calls === 2, 'Hover, intervals and replay reuse loaded data without extra requests')
          return 'PASS: table hover, hidden labels, ring position, leave/switch cleanup, missing values, outlier preview, intervals, replay and refresh'
        }
      `,
    },
    bundle: true, jsx: 'automatic', write: false, format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
  })
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find((file) => file.endsWith('.css'))
  assert.ok(css, 'Run npm run build before this UI probe')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), '<link rel="stylesheet" href="theme.css"><style>html,body,#root{height:100%;margin:0}#root{display:flex}</style><div id="root"></div><script>window.api={}</script><script src="renderer.js"></script>')
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: true, width: 1500, height: 850, webPreferences: { backgroundThrottling: false } })
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        console.log(await window.webContents.executeJavaScript('window.runProbe()'))
        app.exit(0)
      } catch (error) { console.error(error); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (data) => { output += data })
    child.stderr.on('data', (data) => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Trading Volumes UI probe timed out')) }, 30_000)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('exit', (code) => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
