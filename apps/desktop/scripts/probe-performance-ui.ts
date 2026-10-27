import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-performance-ui-'))
const require = createRequire(import.meta.url)
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))!
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import { useState } from 'react'
    import { createRoot } from 'react-dom/client'
    import { dehydrate, QueryClient, QueryObserver } from '@tanstack/react-query'
    import { DataTable } from './src/components/ui/DataTable'
    import { manageQueryMemory, pinStartupQuery, completeStartupRegistration } from './src/api/queryMemory'
    import { warmStartupQuery } from './src/api/warmQueue'
    import { createRendererQueryPersister } from './src/api/queryPersistence'
    const check = (value, message) => { if (!value) throw Error(message) }
    const wait = (ms = 220) => new Promise(resolve => setTimeout(resolve, ms))
    let changeLayout
    let changeCount
    let clicked
    let doubled
    const fixture = Array.from({ length: 10000 }, (_, i) => ({ id: 'S' + i, value: i,
      description: i % 5 ? 'Measured variable-height row' : 'Wrapped contents '.repeat(24) }))
    const columns = [
      { key: 'id', header: 'Symbol', width: '120px', cell: row => row.id, sortValue: row => row.value },
      { key: 'value', header: 'Editable value', width: '160px', numeric: true,
        cell: row => <input aria-label={'Edit ' + row.id} defaultValue={row.value} style={{ width: 100 }} /> },
      { key: 'description', header: 'Wrapped research notes', wrap: true, cell: row => row.description },
    ]
    function App() {
      const [layout, setLayout] = useState('fixed')
      changeLayout = setLayout
      const [count, setCount] = useState(10000)
      changeCount = setCount
      return <main style={{ padding: 20, height: '100vh', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h1>Virtualized table · {count.toLocaleString()} rows</h1>
        <section id="table-host" style={{ height: 550, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <DataTable rows={fixture.slice(0, count)} columns={columns} layout={layout} minWidth="1400px" showIndex
            rowKey={row => row.id} defaultSort={{ key: 'id', direction: 'asc' }}
            onRowClick={(row, index) => { clicked = [row.id, index] }}
            onRowDoubleClick={(row, index) => { doubled = [row.id, index] }} />
        </section>
      </main>
    }
    createRoot(document.getElementById('root')).render(<App />)
    window.runChecks = async () => {
      await wait(500)
      const table = () => document.querySelector('table')
      const rows = () => [...document.querySelectorAll('tr[data-row-key]')]
      const scroll = () => table().parentElement
      check(table().getAttribute('aria-rowcount') === '10001', 'Accessible total row count is wrong')
      check(rows().length > 0 && rows().length < 100, 'Initial DOM is not bounded: ' + rows().length)
      check(scroll().scrollWidth > scroll().clientWidth, 'Horizontal scrolling was lost')
      const editor = document.querySelector('input[aria-label="Edit S0"]')
      editor.focus(); editor.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); await wait()
      check(document.activeElement === editor, 'Editor could not take focus')
      for (let i = 0; i < 3; i++) { scroll().scrollTop = scroll().scrollHeight; await wait() }
      check(document.activeElement === editor && editor.isConnected, 'Virtual scrolling unmounted the focused editor: connected=' + editor.isConnected + ', active=' + document.activeElement?.tagName + ', first=' + rows()[0]?.dataset.rowKey)
      check(rows().some(row => row.dataset.rowKey === 'S9999'), 'Cannot reach the last row')
      check(rows().length < 110, 'Focused row made the DOM unbounded')
      const last = rows().find(row => row.dataset.rowKey === 'S9999')
      last.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      last.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      check(clicked[0] === 'S9999' && clicked[1] === 9999 && doubled[1] === 9999, 'Row callbacks lost their full sorted index')
      const header = document.querySelector('thead').getBoundingClientRect()
      check(Math.abs(header.top - scroll().getBoundingClientRect().top) < 3, 'Header stopped sticking')
      editor.blur(); editor.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); await wait()
      const host = document.getElementById('table-host')
      host.style.display = 'none'; await wait(); host.style.display = 'flex'; await wait()
      check(rows().length > 0 && rows().length < 100, 'Hidden page did not recover its viewport: ' + JSON.stringify({ rows: rows().length, height: scroll().clientHeight, scrollHeight: scroll().scrollHeight, top: scroll().scrollTop, hostHeight: host.clientHeight }))
      document.querySelector('th:nth-child(2)').click(); await wait()
      check(rows()[0].dataset.rowKey === 'S9999', 'Full-dataset sorting failed: ' + JSON.stringify({ first: rows()[0]?.dataset.rowKey, text: document.querySelector('th:nth-child(2)').textContent, top: scroll().scrollTop }))
      changeCount(10); await wait()
      check(rows().length === 10 && table().getAttribute('aria-rowcount') === '11', 'Small/filtered table path failed')
      changeCount(10000); await wait()
      scroll().scrollLeft = 0
      window.dispatchEvent(new Event('resize')); await wait()
      check(rows().length < 100, 'Resize expanded the entire dataset')

      changeLayout('auto'); await wait()
      const widths = () => [...document.querySelectorAll('th')].map(cell => cell.getBoundingClientRect().width)
      const beforeWidths = widths()
      scroll().scrollTop = scroll().scrollHeight; await wait()
      check(widths().every((width, i) => Math.abs(width - beforeWidths[i]) < 2), 'Auto columns moved while scrolling')
      scroll().scrollTop = 0; await wait()
      const client = new QueryClient({ defaultOptions: { queries: { gcTime: 1000, retry: false } } })
      const startupKey = ['chart', 'PREPARED']
      await warmStartupQuery(client, { queryKey: startupKey, staleTime: Infinity, queryFn: async () => ({ rows: [1] }) })
      check(client.getQueryCache().find({ queryKey: startupKey }).gcTime === Infinity, 'Startup query was not pinned')
      pinStartupQuery(client, ['chart', 'PARTIAL'])
      client.setQueryData(['chart', 'PARTIAL'], { meta: { freshness: 'partial' }, rows: [1] })
      client.setQueryData(['browser'], { localSession: true })
      for (let i = 0; i < 2000; i++) client.setQueryData(['chart', 'EXTRA' + i], { text: 'x'.repeat(200) })
      const observer = new QueryObserver(client, { queryKey: ['chart', 'ACTIVE'], enabled: false })
      const unsubscribe = observer.subscribe(() => {})
      client.setQueryData(['chart', 'ACTIVE'], { text: 'x'.repeat(8000) })
      completeStartupRegistration(client)
      const manager = manageQueryMemory(client, { maxBytes: 4096, maxQueries: 10, deferUntilStartup: true })
      await manager.sweep()
      check(client.getQueryData(startupKey) && client.getQueryData(['chart', 'PARTIAL']), 'Memory eviction removed prepared startup content')
      check(client.getQueryData(['browser']) && client.getQueryData(['chart', 'ACTIVE']), 'Protected data was evicted')
      check(client.getQueryCache().getAll().length <= 4, 'Memory pressure did not converge')
      unsubscribe(); await manager.sweep()
      check(!client.getQueryData(['chart', 'ACTIVE']), 'Inactive oversized query was retained')
      manager.stop(); client.clear()
      client.setQueryData(['chart', 'IDLE'], 1)
      const idle = manageQueryMemory(client, { idleMs: 0 })
      await idle.sweep()
      check(!client.getQueryData(['chart', 'IDLE']), 'Idle queries were retained past their lifetime')
      idle.stop(); client.clear()

      const diskClient = new QueryClient()
      const persister = createRendererQueryPersister({ database: 'performance-eviction', throttleMs: 0 })
      diskClient.setQueryData(['chart', 'EVICTED'], { value: 42 })
      const snapshot = () => ({ timestamp: Date.now(), buster: 'test', clientState: dehydrate(diskClient) })
      persister.persistClient(snapshot()); await persister.flush()
      diskClient.removeQueries({ queryKey: ['chart', 'EVICTED'] })
      persister.persistClient(snapshot()); await persister.flush()
      const restored = await persister.restoreClient()
      check(restored.clientState.queries[0].state.data.value === 42, 'Memory GC erased the reusable disk snapshot')
      await persister.removeClient(); diskClient.clear()
      return 'PASS: 10,000 variable-height rows, bounded DOM, full scroll/sort/filter, focused editing, sticky header, hidden-page restore, row callbacks, memory budgets, startup pins and disk retention'
    }
  ` }, bundle: true, platform: 'browser', format: 'iife', tsconfig: join(root, 'tsconfig.json'), outfile: join(directory, 'renderer.js') })
  await writeFile(join(directory, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="theme.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>')
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    const { join } = require('node:path')
    const { writeFile } = require('node:fs/promises')
    app.setPath('userData', join(__dirname, 'profile'))
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1100, height: 800, webPreferences: { backgroundThrottling: false } })
      try {
        await window.loadFile(join(__dirname, 'index.html'))
        console.log(await window.webContents.executeJavaScript('window.runChecks()'))
        await writeFile(${JSON.stringify(join(root, 'out/performance-smoke.png'))}, (await window.webContents.capturePage()).toPNG())
        app.exit(0)
      } catch (error) { console.error(error); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: join(directory, 'roaming'), LOCALAPPDATA: join(directory, 'local') }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; text: string }>((resolveRun, reject) => {
    const child = spawn(require('electron'), [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let text = ''
    child.stdout.on('data', data => { text += data })
    child.stderr.on('data', data => { text += data })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Performance UI timeout: ' + text)) }, 60_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, text }) })
  })
  assert.equal(result.code, 0, result.text)
  console.log(result.text.trim())
} finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
