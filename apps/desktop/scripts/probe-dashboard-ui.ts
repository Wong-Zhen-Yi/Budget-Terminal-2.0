import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const directory = await mkdtemp(join(tmpdir(), 'budget-dashboard-ui-'))
const bundle = await build({
  stdin: {
    resolveDir: resolve(import.meta.dirname, '..'), loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
      import { MacroBar } from './src/components/dashboard/MacroBar'
      import { useMacroCharts } from './src/api/dashboardQueries'
      import { useReloadAll } from './src/api/queries'
      import { queryKeys } from './src/api/client'
      import { MACRO_SYMBOLS } from './electron/shared/contract'
      const check = (value, message) => { if (!value) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 150))
      const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
      const calls = []
      const fixture = symbol => ({data: {symbol, candles: Array.from({length: 40}, (_, i) => ({close: 100 + Math.sin(i) * 5 + i / 3}))}, meta: {freshness: 'fresh'}})
      window.api.chart = async request => { calls.push(request); return fixture(request.symbol) }
      const macro = Object.fromEntries(MACRO_SYMBOLS.map((entry, i) => [entry.label, {price: 100 + i, change: i % 2 ? -0.5 : 0.5}]))
      let reload
      function Shell() {
        const charts = useMacroCharts()
        reload = useReloadAll()
        return <MacroBar macro={macro} loading={false} charts={charts} />
      }
      const root = createRoot(document.getElementById('root'))
      window.checkLayout = () => {
        check(document.documentElement.scrollWidth <= innerWidth, 'Horizontal overflow')
        for (const svg of document.querySelectorAll('svg')) {
          check(svg.getBoundingClientRect().height >= 20, 'Collapsed sparkline')
          const points = svg.querySelector('polyline').getAttribute('points')
          check(!/NaN|Infinity/.test(points), 'Invalid chart coordinates')
        }
        return 'PASS: layout at ' + innerWidth
      }
      window.runProbe = async () => {
        for (const entry of MACRO_SYMBOLS) client.setQueryData(queryKeys.chart(entry.symbol, '1 Day'), fixture(entry.symbol))
        root.render(<QueryClientProvider client={client}><Shell /></QueryClientProvider>)
        await settle()
        check(calls.length === 0, 'Warm cache must avoid first-visit fetches')
        check(document.querySelectorAll('svg').length === 5, 'Five macro sparklines')
        for (const svg of document.querySelectorAll('svg')) {
          check(svg.getAttribute('aria-label').includes('30 trading sessions'), 'History range label')
          check(svg.querySelector('polyline').getAttribute('points').split(' ').length === 30, 'Last 30 closes')
        }
        await reload(); await settle()
        check(calls.length === 5 && calls.every(call => call.force), 'F5 refreshes every sparkline')
        root.render(<MacroBar macro={macro} loading={false} charts={MACRO_SYMBOLS.map((entry, i) => ({data: { ...fixture(entry.symbol), meta: {freshness: 'stale'} }, isLoading: false, isError: false}))} />)
        await settle()
        check(document.querySelectorAll('svg').length === 5 && !document.body.textContent.includes('Stale history'), 'Retain stale charts without yellow text')
        check(document.querySelectorAll('[title*="stale"]').length === 5, 'Stale history remains available in tooltips')
        root.render(<MacroBar macro={macro} loading={false} charts={MACRO_SYMBOLS.map(() => ({isLoading: true, isError: false}))} />)
        await settle()
        check(document.body.textContent.includes('Loading history'), 'Visible loading state')
        root.render(<MacroBar macro={macro} loading={false} charts={MACRO_SYMBOLS.map(() => ({isLoading: false, isError: true}))} />)
        await settle()
        check(document.body.textContent.includes('History unavailable'), 'Visible failure state')
        root.render(<MacroBar macro={macro} loading={false} charts={MACRO_SYMBOLS.map(entry => ({data: { ...fixture(entry.symbol), data: {candles: [{close: 100}, {close: NaN}, {close: 100}]} }, isLoading: false, isError: false}))} />)
        await settle(); window.checkLayout()
        root.render(<QueryClientProvider client={client}><Shell /></QueryClientProvider>)
        for (let attempt = 0; attempt < 20 && document.querySelectorAll('svg').length !== 5; attempt++) await settle()
        check(document.querySelectorAll('svg').length === 5, 'Remounted history ready')
        return 'PASS: five sparklines, startup cache, F5, stale/loading/failure states and flat/invalid history'
      }
    `,
  },
  bundle: true, jsx: 'automatic', write: false, format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '@': resolve(import.meta.dirname, '../src'), '@shared': resolve(import.meta.dirname, '../electron/shared') },
})
const assets = resolve(import.meta.dirname, '../out/renderer/assets')
const css = (await readdir(assets)).find(file => file.endsWith('.css'))!
await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
await writeFile(join(directory, 'index.html'), '<link rel="stylesheet" href="theme.css"><style>body{margin:0;padding:12px;background:#0e1520}</style><div id="root"></div><script>window.api={}</script><script src="renderer.js"></script>')
await writeFile(join(directory, 'main.cjs'), `
  const { app, BrowserWindow } = require('electron')
  const { writeFileSync } = require('node:fs')
  app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
  app.whenReady().then(async () => {
    const window = new BrowserWindow({show: false, width: 1440, height: 240, webPreferences: {backgroundThrottling: false}})
    try {
      await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
      console.log(await window.webContents.executeJavaScript('window.runProbe()'))
      await new Promise(resolve => setTimeout(resolve, 250))
      for (const width of [1680, 1000, 700]) {
        window.setSize(width, 240)
        await new Promise(resolve => setTimeout(resolve, 150))
        console.log(await window.webContents.executeJavaScript('window.checkLayout()'))
        writeFileSync(${JSON.stringify(directory)} + '/dashboard-' + width + '.png', (await window.webContents.capturePage()).toPNG())
      }
      app.exit(0)
    } catch (error) {console.error(error); app.exit(1)}
  })
`)
const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
delete env.ELECTRON_RUN_AS_NODE
const output = await new Promise<{code: number | null; text: string}>((resolveRun, reject) => {
  const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], {env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']})
  let text = ''
  child.stdout.on('data', chunk => { text += chunk })
  child.stderr.on('data', chunk => { text += chunk })
  const timer = setTimeout(() => { child.kill(); reject(Error('Dashboard UI probe timed out')) }, 30_000)
  child.on('error', error => { clearTimeout(timer); reject(error) })
  child.on('exit', code => { clearTimeout(timer); resolveRun({code, text}) })
})
assert.equal(output.code, 0, output.text)
console.log(output.text.trim())
console.log(`Screenshots: ${directory}`)
