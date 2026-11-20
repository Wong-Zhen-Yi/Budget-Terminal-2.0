import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-page-progress-ui-'))
try {
  const appSource = await readFile(join(root, 'src/App.tsx'), 'utf8')
  assert.ok(!appSource.includes('LoadingStatus'), 'The global startup diagnostics banner must stay removed')
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
        import { createRoot } from 'react-dom/client'
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
        import { useQuery } from './src/api/progressiveQuery'
        import { trackPageQuery } from './src/api/pageProgress'
        import { api } from './src/api/client'
        import { WorkspaceHeader } from './src/components/chrome/WorkspaceNavigation'
        import { ProjectionsPage } from './src/pages/ProjectionsPage'
        import { useDataHealth } from './src/stores/dataHealth'
        import { useProjectionsPage } from './src/stores/projections'
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const check = (ok, message) => { if (!ok) throw Error(message) }
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
        let finish
        let preview = null
        let key
        let projectionsTransportFailure = false
        window.api = Object.freeze({
          bitcoin: () => new Promise(resolve => { finish = resolve }),
          pageProgress: async request => { key = request; return preview },
          projections: async ({ symbol, timeframe }) => {
            if (projectionsTransportFailure) throw Error('Network request failed')
            return {
              data: { symbol, timeframe, chartError: '', stats: null, spotPrice: 0, marketDate: '', buckets: [],
                candles: [{ time: 1795190400, open: 14, high: 15, low: 13, close: 14.05, volume: 1000 }] },
              meta: { freshness: 'partial', fetchedAt: Date.now(), source: 'fixture' },
              errors: [{ symbol: 'Expirations', operation: 'projections', reason: 'Failed to fetch', source: 'fixture' }],
            }
          },
        })
        const queryKey = ['bitcoin']
        function Demo() {
          const query = useQuery({ queryKey, queryFn: () => api.bitcoin({ background: true }) })
          return <><WorkspaceHeader tabs={[{id: 'bitcoin', label: 'Bitcoin', implemented: true}, {id: 'sofi', label: 'SOFI', implemented: true}]} activeTab="bitcoin" onSelectTab={() => {}} favorite={false} onToggleFavorite={() => {}} saving={false} isMac={false} /><main aria-busy={query.isFetching}><h1>Bitcoin</h1><p>{query.data?.data.sections.join(' / ') ?? 'Waiting'}</p><span>{query.isFetching ? 'Loading remaining data' : 'Complete'}</span></main></>
        }
        window.runProbe = async () => {
          // Start in the background, then mount while that same query is pending.
          const pending = client.fetchQuery({ queryKey, queryFn: () => trackPageQuery(queryKey, () => api.bitcoin({ background: true })) })
          await wait(20)
          const root = createRoot(document.getElementById('root'))
          root.render(<QueryClientProvider client={client}><Demo /></QueryClientProvider>)
          await wait(300)
          check(key === 'bitcoin:read:{}', 'Preview must share the canonical foreground/background service identity')
          preview = { data: { sections: ['Mining stats'] }, meta: { source: 'fixture', freshness: 'partial', fetchedAt: Date.now() }, errors: [] }
          await wait(600)
          check(document.body.innerText.includes('Mining stats') && document.body.innerText.includes('Loading remaining data'), 'Completed sections must paint while the next section is pending')
          check(!client.getQueryData(queryKey) && client.getQueryState(queryKey).status === 'pending', 'Previews cannot become completed or persisted snapshots')
          preview = { ...preview, data: { sections: ['Mining stats', 'Fees'] } }
          await wait(600)
          check(document.body.innerText.includes('Mining stats / Fees'), 'Later sources must fill in the same page')
          finish({ ...preview, meta: { ...preview.meta, freshness: 'fresh' } })
          await pending; await wait(150)
          check(document.body.innerText.includes('Complete') && document.body.innerText.includes('Fees'), 'Final content must replace preview without disappearing')
          check(client.getQueryState(queryKey).status === 'success', 'Only the final response completes startup')
          useDataHealth.getState().setStartup({durationMs: 100, planned: 2, timings: [], pages: {
            bitcoin: {state: 'ready'}, sofi: {state: 'failed', reason: 'Fixture provider unavailable'},
          }})
          await wait(100)
          check(!document.querySelector('[aria-label="Page loading status"]'), 'Global startup diagnostics banner must not render')
          check([...document.querySelectorAll('[aria-label="Workspace pages"] button')].map(button => button.textContent).join('|') === 'Bitcoin|SOFI', 'Page labels show only page names for ready and failed pages')
          check(!document.querySelector('[data-page-readiness]'), 'Page labels must not show readiness notes')
          check(useDataHealth.getState().startup.pages.sofi.reason === 'Fixture provider unavailable', 'Startup failure details remain available for Settings')
          const before = client.getQueryData(queryKey)
          const refresh = client.refetchQueries({queryKey})
          await wait(300)
          check(document.querySelector('main').innerText.includes('Mining stats / Fees'), 'Refresh hid previous sections')
          finish({data: {sections: []}, meta: {source: 'fixture', freshness: 'failed', fetchedAt: Date.now(), failureReason: 'Fixture refresh failed'}, errors: []})
          await refresh; await wait(150)
          check(client.getQueryData(queryKey) === before && client.getQueryState(queryKey).status === 'error', 'Failed manual refresh must retain content and expose error')
          check(document.querySelector('main').innerText.includes('Fees'), 'Refresh failure erased data')
          preview = null
          useProjectionsPage.getState().setSymbol('BMNR')
          root.render(<QueryClientProvider client={client}><ProjectionsPage onStatusChange={() => {}} /></QueryClientProvider>)
          await wait(300)
          check(document.body.innerText.includes('Options unavailable for BMNR: Failed to fetch'), 'BMNR must identify the failed options listing')
          check(document.body.innerText.includes('$14.05'), 'BMNR must keep the chart close when options fail')
          projectionsTransportFailure = true
          document.querySelector('button[type="submit"]').click()
          await wait(300)
          check(document.body.innerText.includes('Error loading BMNR: Network request failed'), 'A rejected manual load must show the error')
          check(document.body.innerText.includes('$14.05') && document.querySelector('button[type="submit"]').textContent === 'Load', 'A failed refresh must retain the chart and allow retry')
          return 'PASS: progressive sections, shared preview identity, retained Settings diagnostics, no global diagnostics banner, retained refresh content and BMNR chart survival'
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
  await writeFile(join(directory, 'index.html'), '<link rel="stylesheet" href="theme.css"><style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}</style><div id="root"></div><script>window.api={}</script><script src="renderer.js"></script>')
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1300, height: 850, webPreferences: { backgroundThrottling: false } })
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        console.log(await window.webContents.executeJavaScript('window.runProbe()'))
        require('node:fs').writeFileSync(${JSON.stringify(join(tmpdir(), 'budget-page-progress.png'))}, (await window.webContents.capturePage()).toPNG())
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
    const timer = setTimeout(() => { child.kill(); reject(new Error('Page progress UI probe timed out')) }, 30_000)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('exit', (code) => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
} finally {
  if (directory.startsWith(join(tmpdir(), 'budget-page-progress-ui-'))) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

