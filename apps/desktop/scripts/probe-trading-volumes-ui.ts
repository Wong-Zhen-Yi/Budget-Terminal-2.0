import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-trading-volumes-ui-'))
const capture = process.argv.includes('--capture') ? resolve(root, '../../output/trading-volumes-default.png') : null
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
        import { verifyPlotZoom, scrollPlot, resetZoomButton } from './scripts/fixtures/plot-zoom'
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
        rows[0].fiveDayAvgDollarVolume = 2e9
        rows[0].name = 'A long company name that should stay within the compact table'
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
        window.checkLayout = async (width) => {
          const state = useTradingVolumesPage.getState()
          const pane = document.querySelector('table').parentElement.parentElement
          const chart = document.querySelector('svg').parentElement
          const scroller = document.querySelector('table').parentElement
          const headers = [...document.querySelectorAll('th')]
          check(headers.length === 5 && headers[4].textContent.includes('YTD ADV ($m)'), 'Only selected volume is shown')
          check(scroller.scrollWidth <= scroller.clientWidth, 'All table columns visible without horizontal scrolling at ' + width)
          check(headers[4].getBoundingClientRect().right <= scroller.getBoundingClientRect().right, 'Selected volume fits inside left pane')
          check([headers[0], headers[1], headers[3], headers[4]].every(cell => cell.scrollWidth <= cell.clientWidth), 'Identity and volume headings are readable at ' + width + ': ' + headers.map(cell => cell.textContent + ' ' + cell.scrollWidth + '/' + cell.clientWidth).join(', '))
          check([...document.querySelectorAll('tbody tr')].every(row => [row.cells[0], row.cells[3], row.cells[4]].every(cell => cell.scrollWidth <= cell.clientWidth)), 'Rank, market cap and volume values are readable at ' + width)
          check(chart.getBoundingClientRect().width > pane.getBoundingClientRect().width, 'Plot wider than table at ' + width)
          check(document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight, 'Page fits viewport at ' + width)
          check(document.querySelector('span[title="' + rows[0].name + '"]'), 'Full company name available on hover')
          const separator = document.querySelector('[role="separator"]')
          const bounds = separator.parentElement.getBoundingClientRect()
          separator.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
          window.dispatchEvent(new PointerEvent('pointermove', { clientX: bounds.left + 474 }))
          window.dispatchEvent(new PointerEvent('pointerup'))
          await settle()
          check(Math.abs(pane.getBoundingClientRect().width - 470) <= 1, 'Divider uses pane-relative position at ' + width)
          // A narrow window clamps the rendered width without overwriting the user's saved width.
          useTradingVolumesPage.setState({ tableWidth: 2000 })
          await settle()
          check(chart.getBoundingClientRect().width >= 320, 'Resizing preserves usable chart width')
          check(useTradingVolumesPage.getState().tableWidth === 2000, 'Viewport clamping does not overwrite saved divider preference')
          useTradingVolumesPage.setState({ tableWidth: state.tableWidth })
          await settle()
        }
        window.runProbe = async () => {
          check(useTradingVolumesPage.getState().interval === 'ytd', 'Existing installs migrate to YTD')
          check(useTradingVolumesPage.getState().tableWidth === 430, 'Existing installs migrate to narrow table')
          localStorage.removeItem('budget-terminal:trading-volumes')
          useTradingVolumesPage.setState(useTradingVolumesPage.getInitialState())
          check(useTradingVolumesPage.getState().interval === 'ytd' && useTradingVolumesPage.getState().tableWidth === 430, 'Fresh installs use the same default')
          createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><TradingVolumesPage onStatusChange={() => {}} /></QueryClientProvider>)
          await settle(); await settle()
          check(calls === 1 && document.querySelector('svg circle'), 'Page loads and plots fixture once')
          await verifyPlotZoom()
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
          scrollPlot(); await settle()
          await click('5D')
          check(resetZoomButton().disabled, 'Changing volume interval resets zoom')
          check(document.querySelectorAll('th').length === 5 && document.querySelectorAll('th')[4].textContent.includes('5D ADV ($m)'), 'Interval switches the visible volume header')
          check(document.querySelector('tbody tr').dataset.rowKey === 'N0', 'Selected interval determines table rank')
          check(document.querySelector('tbody tr').lastElementChild.textContent === '2,000', 'Selected interval determines displayed volume in millions')
          await hover('N20'); checkRing('N20'); await leave('N20')
          await click('Replay'); await hover('N20'); checkRing('N20')
          const before = ring().getAttribute('cy')
          await new Promise(resolve => setTimeout(resolve, 250))
          checkRing('N20')
          check(ring().getAttribute('cy') !== before, 'Hover ring follows moving replay dot: ' + before + ' -> ' + ring().getAttribute('cy'))
          scrollPlot(); await settle()
          const replayXs = [...document.querySelectorAll('svg circle')].filter(dot => dot.getAttribute('fill') !== 'none').map(dot => dot.getAttribute('cx'))
          await new Promise(resolve => setTimeout(resolve, 200))
          check(!resetZoomButton().disabled && JSON.stringify(replayXs) === JSON.stringify([...document.querySelectorAll('svg circle')].filter(dot => dot.getAttribute('fill') !== 'none').map(dot => dot.getAttribute('cx'))), 'Replay retains zoom and horizontal positions')
          resetZoomButton().click(); await settle()
          await leave('N20'); await click('Stop')
          scrollPlot(); await settle()
          await hover('LOW'); checkRing('LOW')
          // A new row set must clear transient hover state, including after a refresh.
          await client.refetchQueries(); await settle()
          check(!ring(), 'Refreshing clears obsolete table hover')
          check(resetZoomButton().disabled, 'Refreshed data resets zoom')
          check(calls === 2, 'Hover, intervals and replay reuse loaded data without extra requests')
          for (const label of ['1D', '30D', '1Y', '3Y', 'YTD']) {
            await click(label)
            check(document.querySelectorAll('th')[4].textContent.includes(label + ' ADV ($m)'), 'Volume header follows ' + label)
          }
          useTradingVolumesPage.setState({ interval: '30d', tableWidth: 500 })
          await useTradingVolumesPage.persist.rehydrate()
          check(useTradingVolumesPage.getState().interval === '30d' && useTradingVolumesPage.getState().tableWidth === 500, 'New selections survive rehydration')
          useTradingVolumesPage.setState({ interval: 'ytd', tableWidth: 430 })
          await settle()
          return 'PASS: scroll zoom, pointer anchoring, limits, reset, clipping, default layout, migration, persistence, selected volume and sorting, table hover, hidden labels, missing values, outlier preview, replay and refresh'
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
  await writeFile(join(directory, 'index.html'), '<link rel="stylesheet" href="theme.css"><style>html,body,#root{height:100%;margin:0}#root{display:flex}</style><div id="root"></div><script>window.api={};localStorage.setItem("budget-terminal:trading-volumes",JSON.stringify({version:2,state:{interval:"1d",tableWidth:904}}))</script><script src="renderer.js"></script>')
  if (capture) await mkdir(resolve(capture, '..'), { recursive: true })
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: true, width: 1500, height: 850, webPreferences: { backgroundThrottling: false } })
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        console.log(await window.webContents.executeJavaScript('window.runProbe()'))
        await window.webContents.executeJavaScript('document.getElementById("root").style.cssText = "position:absolute;inset:143px 0 0 64px;height:auto"')
        for (const [width, height] of [[1920, 1032], [1280, 750], [1024, 768]]) {
          window.setContentSize(width, height)
          await new Promise(resolve => setTimeout(resolve, 250))
          await window.webContents.executeJavaScript('window.checkLayout(' + width + ')')
        }
        console.log('PASS: viewport fit, selected volume visibility, divider position and resize clamping at 1920, 1280 and 1024 pixels')
        const fits = await window.webContents.executeJavaScript(
          '(() => { const title = [...document.querySelectorAll("span")].find(e => e.textContent === "Trading Volumes Dot Plot"); const toolbar = title.parentElement; return toolbar.scrollWidth <= toolbar.clientWidth && [...toolbar.querySelectorAll("button")].every(e => { const r = e.getBoundingClientRect(); const p = toolbar.getBoundingClientRect(); return r.right <= p.right && r.bottom <= p.bottom }) })()'
        )
        if (!fits) throw Error('Dot plot controls must fit the compact viewport')
        ${capture ? `window.setContentSize(1920, 1032)
        await new Promise(resolve => setTimeout(resolve, 250))
        require('node:fs').writeFileSync(${JSON.stringify(capture)}, (await window.webContents.capturePage()).toPNG())` : ''}
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
