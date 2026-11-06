import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-watchlists-ui-'))
try {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { useChartsStore, readPortfolioWithCharts, flushChartsWatchlists } from './src/stores/charts'
      import { UserDataPanel } from './src/components/settings/UserDataPanel'
      const check = (value, message) => { if (!value) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 30))
      const envelope = data => ({ data, meta: { source: 'fixture', freshness: 'fresh', fetchedAt: Date.now() }, errors: [] })
      let savedLists
      let rejectSave = false
      window.api.portfolio = async () => {
        const snapshot = structuredClone(savedLists)
        await settle()
        return envelope({ portfolios: [], activeId: null, mainId: null, sourcePath: '', chartsWatchlists: snapshot })
      }
      window.api.mutatePortfolio = async mutation => {
        await settle()
        if (rejectSave) return { ...await window.api.portfolio(), errors: [{ message: 'Fixture write rejected' }] }
        if (!mutation.migrateOnly || savedLists === undefined) savedLists = structuredClone(mutation.value)
        return window.api.portfolio()
      }
      window.runProbe = async () => {
        check(useChartsStore.getState().watchlist[0] === 'SPY', 'Legacy profile did not hydrate')
        await readPortfolioWithCharts()
        check(savedLists.watchlist[0] === 'SPY' && savedLists.multiCustomSymbols[0] === 'AAPL', 'Legacy lists were not migrated')
        const staleRead = readPortfolioWithCharts()
        useChartsStore.getState().setWatchlist(['qqq', 'QQQ'])
        useChartsStore.getState().setMultiCustomSymbols(['msft'])
        useChartsStore.getState().setMultiOrder(['MSFT'])
        await staleRead
        await flushChartsWatchlists()
        check(savedLists.watchlist.join() === 'QQQ' && savedLists.multiCustomSymbols.join() === 'MSFT' && savedLists.multiOrder.join() === 'MSFT', 'Rapid edits or a stale read lost lists')
        savedLists = { watchlist: ['IWM'], multiCustomSymbols: ['NVDA'], multiOrder: ['NVDA'] }
        await readPortfolioWithCharts()
        check(useChartsStore.getState().watchlist[0] === 'IWM', 'Restored lists did not reach the renderer')
        rejectSave = true
        useChartsStore.getState().setWatchlist(['REJECTED'])
        await flushChartsWatchlists()
        check(useChartsStore.getState().watchlist[0] === 'IWM', 'Rejected edits must revert to saved lists')
        rejectSave = false
        savedLists = { watchlist: [], multiCustomSymbols: [], multiOrder: [] }
        await readPortfolioWithCharts()
        check(useChartsStore.getState().watchlist.length === 0 && useChartsStore.getState().multiCustomSymbols.length === 0, 'Clear resurrected profile lists')
        check(JSON.parse(localStorage.getItem('budget-terminal:charts')).state.watchlist.length === 0, 'Clear left a stale migration copy')
        const app = createRoot(document.getElementById('root'))
        app.render(<UserDataPanel onRun={() => {}} busy={null} sourcePath="fixture" />)
        await settle()
        check(document.body.innerText.includes('Charts watchlists'), 'Backup scope does not mention charts')
        const clear = [...document.querySelectorAll('button')].find(button => button.textContent === 'Clear All User Data and Cards')
        check(clear, 'Missing clear action')
        clear.click(); await settle()
        check(document.body.innerText.includes('Charts watchlist and custom Card'), 'Clear confirmation omits watchlists')
        app.unmount()
        return 'PASS: legacy profile migration, serialized edits, stale reads, restore, rejected writes, clear and Settings confirmation'
      }
    ` },
    bundle: true, jsx: 'automatic', write: false, format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
  })
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(file => file.endsWith('.css'))
  assert.ok(css, 'Run npm run build before this UI probe')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), `<link rel="stylesheet" href="theme.css"><div id="root"></div><script>
    window.api={}
    localStorage.setItem('budget-terminal:charts', JSON.stringify({ version: 1, state: { watchlist: ['SPY'], multiCustomSymbols: ['AAPL'], multiOrder: ['AAPL'] } }))
    </script><script src="renderer.js"></script>`)
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1200, height: 800 })
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
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Watchlists UI probe timed out')) }, 30_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
} finally {
  assert.ok(directory.startsWith(join(tmpdir(), 'budget-watchlists-ui-')))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
