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
        import { LoadingStatus } from './src/components/chrome/LoadingStatus'
        import { useDataHealth } from './src/stores/dataHealth'
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const check = (ok, message) => { if (!ok) throw Error(message) }
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
        let finish
        let preview = null
        let key
        let retries = []
        window.api = Object.freeze({
          bitcoin: () => new Promise(resolve => { finish = resolve }),
          pageProgress: async request => { key = request; return preview },
        })
        const queryKey = ['bitcoin']
        function Demo() {
          const query = useQuery({ queryKey, queryFn: () => api.bitcoin({ background: true }) })
          return <><LoadingStatus page="bitcoin" panels={[{label: 'Bitcoin', envelope: query.data, error: query.error, loading: query.isFetching}]} retry={page => retries.push(page)} /><main aria-busy={query.isFetching}><h1>Bitcoin</h1><p>{query.data?.data.sections.join(' / ') ?? 'Waiting'}</p><span>{query.isFetching ? 'Loading remaining data' : 'Complete'}</span></main></>
        }
        window.runProbe = async () => {
          // Start in the background, then mount while that same query is pending.
          const pending = client.fetchQuery({ queryKey, queryFn: () => trackPageQuery(queryKey, () => api.bitcoin({ background: true })) })
          await wait(20)
          createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><Demo /></QueryClientProvider>)
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
            bitcoin: {state: 'ready'}, forex: {state: 'failed', reason: 'Fixture provider unavailable'},
          }})
          await wait(100)
          const status = document.querySelector('[aria-label="Page loading status"]')
          check(status.getClientRects().length > 0 && status.innerText.includes('Pages 1/2 ready'), 'Startup status must be visible outside Settings')
          status.querySelector('[aria-expanded]').click()
          await wait(100)
          check(status.innerText.includes('Fixture provider unavailable'), 'Expanded details must expose unresolved failures')
          const retryButton = [...status.querySelectorAll('button')].find(button => button.textContent === 'Retry Forex')
          check(retryButton, 'Targeted retry button missing')
          retryButton.click()
          check(retries[0] === 'forex', 'Retry must target the selected failed page')
          const before = client.getQueryData(queryKey)
          const refresh = client.refetchQueries({queryKey})
          await wait(300)
          check(document.querySelector('main').innerText.includes('Mining stats / Fees'), 'Refresh hid previous sections')
          check(status.innerText.includes('Refreshing') && status.innerText.includes('Data retrieved'), 'Retained content needs refresh and timestamp labels')
          finish({data: {sections: []}, meta: {source: 'fixture', freshness: 'failed', fetchedAt: Date.now(), failureReason: 'Fixture refresh failed'}, errors: []})
          await refresh; await wait(150)
          check(client.getQueryData(queryKey) === before && client.getQueryState(queryKey).status === 'error', 'Failed manual refresh must retain content and expose error')
          check(document.querySelector('main').innerText.includes('Fees') && status.innerText.includes('Fixture refresh failed'), 'Refresh failure erased data or hid its reason')
          return 'PASS: progressive sections, shared preview identity, visible loading details, targeted retry, timestamps, retained refresh content and failure visibility'
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

