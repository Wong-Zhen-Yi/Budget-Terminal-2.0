import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'budget-cache-ui-'))
const root = resolve(import.meta.dirname, '..')
const electron = createRequire(import.meta.url)('electron') as string
const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
delete env.ELECTRON_RUN_AS_NODE
try {
  await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import { contextBridge, ipcRenderer } from 'electron'
    import { createApi } from './electron/shared/createApi'
    contextBridge.exposeInMainWorld('api', createApi((channel, ...args) => ipcRenderer.invoke(channel, ...args),
      (channel, listener) => {
        const handler = (_event, payload) => listener(payload)
        ipcRenderer.on(channel, handler)
        return () => ipcRenderer.removeListener(channel, handler)
      }, process.platform))
  ` }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: join(directory, 'preload.cjs') })
  await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import { QueryClient, dehydrate, hydrate } from '@tanstack/react-query'
    import { createRoot } from 'react-dom/client'
    import { createRendererQueryPersister, shouldPersistRemoteQuery } from './src/api/queryPersistence'
    import { warmStartupQuery } from './src/api/warmQueue'
    import { effectiveFreshness } from './src/api/snapshotHealth'
    const check = (condition, message) => { if (!condition) throw Error(message) }
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    const database = 'synthetic-restart-cache'
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    const persister = createRendererQueryPersister({ database, throttleMs: 60_000 })
    window.api.onCacheFlush(() => persister.flush())
    const envelope = (price, fetchedAt = Date.now()) => ({ data: { price }, errors: [],
      meta: { source: 'synthetic fixture', freshness: 'fresh', fetchedAt } })
    const snapshot = () => ({ timestamp: Date.now(), buster: 'fixture',
      clientState: dehydrate(client, { shouldDehydrateQuery: shouldPersistRemoteQuery }) })
    window.runChecks = async mode => {
      if (mode === 'seed') {
        // Upgrade the old monolithic cache without discarding its data.
        await new Promise((resolve, reject) => {
          const request = indexedDB.open('synthetic-legacy-cache', 1)
          request.onupgradeneeded = () => request.result.createObjectStore('clients')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const transaction = db.transaction('clients', 'readwrite')
            client.setQueryData(['quotes', 'LEGACY'], envelope(7))
            transaction.objectStore('clients').put(snapshot(), 'remote-query-client')
            transaction.oncomplete = () => { db.close(); resolve() }
          }
        })
        const legacy = createRendererQueryPersister({ database: 'synthetic-legacy-cache', throttleMs: 0 })
        const upgraded = await legacy.restoreClient()
        check(upgraded.clientState.queries[0].state.data.data.price === 7, 'Legacy snapshot was lost during upgrade')
        legacy.persistClient(upgraded)
        await legacy.flush()
        check((await legacy.restoreClient()).clientState.queries.length === 1, 'Incremental migration failed')
        await legacy.removeClient()
        client.clear()

        // Keep emitting excluded local polling faster than the save interval.
        const polling = createRendererQueryPersister({ database: 'synthetic-polling-cache', throttleMs: 50 })
        let remoteWrites = 0
        const put = IDBObjectStore.prototype.put
        IDBObjectStore.prototype.put = function(value, ...args) {
          if (this.name === 'queries') remoteWrites++
          return put.call(this, value, ...args)
        }
        client.setQueryData(['quotes', 'POLL'], envelope(10))
        polling.persistClient(snapshot())
        await polling.flush()
        client.setQueryData(['quotes', 'POLL'], envelope(11))
        const timer = setInterval(() => {
          client.setQueryData(['browser'], { syntheticLocalPoll: Date.now() })
          polling.persistClient(snapshot())
        }, 5)
        try {
          await wait(240)
          const restored = await polling.restoreClient()
          check(restored.clientState.queries[0].state.data.data.price === 11, 'Continuous polling starved the disk save')
          check(remoteWrites === 2, 'Local polling rewrote unchanged remote snapshots: ' + remoteWrites)
        } finally {
          clearInterval(timer)
          await polling.flush()
          IDBObjectStore.prototype.put = put
          await polling.removeClient()
        }
        // Clear must win over a pending asynchronous write.
        polling.persistClient(snapshot())
        await polling.removeClient()
        await polling.flush()
        check(!await polling.restoreClient(), 'Cleared data was resurrected by a pending save')
        client.clear()

        client.setQueryData(['quotes', 'FIXTURE'], envelope(100))
        client.setQueryData(['fundamentals', 'FIXTURE'], envelope(200))
        await client.fetchQuery({ queryKey: ['fundamentals', 'FIXTURE'],
          queryFn: async () => { throw Error('Synthetic offline refresh') } }).catch(() => {})
        client.setQueryData(['quotes', 'AGED'], envelope(50, Date.now() - 120_000))
        client.setQueryData(['browser'], { secret: 'synthetic private tab' })
        client.setQueryData(['agents'], { secret: 'synthetic private conversation' })
        persister.persistClient(snapshot())
        await persister.flush()
        // This update is still throttled when the native window closes. Only the
        // production close handshake can save it before the renderer is destroyed.
        client.setQueryData(['quotes', 'FIXTURE'], envelope(101))
        persister.persistClient(snapshot())
        return 'seed ready; final update pending'
      }
      const restored = await persister.restoreClient()
      check(restored, 'No snapshot survived the Electron process restart')
      hydrate(client, restored.clientState)
      check(client.getQueryData(['quotes', 'FIXTURE']).data.price === 101, 'Close lost the final pending update')
      check(!client.getQueryData(['browser']) && !client.getQueryData(['agents']), 'Private state entered the remote cache')
      check(client.getQueryState(['fundamentals', 'FIXTURE']).status === 'success', 'Refresh failure erased the usable snapshot')
      let providerRequests = 0
      for (const key of [['quotes', 'FIXTURE'], ['fundamentals', 'FIXTURE']]) {
        const result = await warmStartupQuery(client, { queryKey: key, staleTime: Infinity,
          queryFn: async () => { providerRequests++; throw Error('Fresh data must not refetch: ' + JSON.stringify(key) + ' ' + JSON.stringify(client.getQueryState(key))) } })
        check(result.meta.freshness === 'cached', 'Restored data must be labelled cached')
      }
      check(providerRequests === 0, 'Startup refetched fresh saved snapshots')
      let restartWrites = 0
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function(value, ...args) {
        if (this.name === 'queries') restartWrites++
        return put.call(this, value, ...args)
      }
      try {
        persister.persistClient(snapshot())
        await persister.flush()
        check(restartWrites === 0, 'Unchanged hydrated snapshots were rewritten after restart')
      } finally { IDBObjectStore.prototype.put = put }
      const aged = client.getQueryData(['quotes', 'AGED'])
      check(effectiveFreshness(aged, Date.now(), 30_000) === 'stale', 'Old data was incorrectly labelled current')
      let seenOldData = false
      await warmStartupQuery(client, { queryKey: ['quotes', 'AGED'], staleTime: Infinity,
        queryFn: async () => {
          seenOldData = client.getQueryData(['quotes', 'AGED']).data.price === 50
          providerRequests++
          return envelope(51)
        } })
      check(seenOldData && providerRequests === 1, 'Refresh must retain expired data and fetch only the expired key')
      createRoot(document.getElementById('root')).render(<main>Saved snapshot ready: {client.getQueryData(['quotes', 'FIXTURE']).data.price} (cached)</main>)
      await wait(100)
      check(document.querySelector('main').textContent.includes('101 (cached)'), 'Restored UI did not paint its ready content')
      return 'PASS: incremental migration, non-starving polling, no redundant writes, clear/write race, close flush, real restart, cache privacy, fresh startup reuse and selective expiry refresh'
    }
  ` }, bundle: true, platform: 'browser', format: 'iife', tsconfig: join(root, 'tsconfig.json'), outfile: join(directory, 'renderer.js') })
  await writeFile(join(directory, 'index.html'), '<!doctype html><html><body><div id="root"></div><script src="renderer.js"></script></body></html>')
  await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import assert from 'node:assert/strict'
    import { app, BrowserWindow, ipcMain } from 'electron'
    import { join } from 'node:path'
    import { CHANNELS } from './electron/shared/contract'
    import { configureRendererCacheShutdown, rendererCacheFlushed } from './electron/services/rendererCacheShutdown'
    const directory = ${JSON.stringify(directory)}
    app.setPath('userData', join(directory, 'profile'))
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, webPreferences: {
        preload: join(directory, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } })
      configureRendererCacheShutdown(window)
      ipcMain.handle(CHANNELS.rendererCacheFlushed, event => {
        assert.equal(event.sender, window.webContents)
        rendererCacheFlushed(event.sender)
      })
      try {
        await window.loadFile(join(directory, 'index.html'))
        console.log(await window.webContents.executeJavaScript('window.runChecks(' + JSON.stringify(process.argv[2]) + ')'))
        if (process.argv[2] === 'restore') {
          const unresponsive = new BrowserWindow({ show: false })
          configureRendererCacheShutdown(unresponsive, 50)
          const started = Date.now()
          const closed = new Promise(resolve => unresponsive.once('closed', resolve))
          unresponsive.close()
          unresponsive.close()
          await closed
          assert(Date.now() - started < 2_000, 'Missing renderer acknowledgement blocked closing')
          console.log('PASS: missing acknowledgement and repeated close requests have a bounded shutdown')
        }
        window.close()
      } catch (error) { console.error(error); app.exit(1) }
    })
    app.on('window-all-closed', () => app.quit())
  ` }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: join(directory, 'main.cjs') })
  for (const mode of ['seed', 'restore']) {
    const result = await new Promise<{ code: number | null; text: string }>((resolveRun, reject) => {
      const child = spawn(electron, [join(directory, 'main.cjs'), mode], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let text = ''
      child.stdout.on('data', chunk => { text += chunk })
      child.stderr.on('data', chunk => { text += chunk })
      const timer = setTimeout(() => { child.kill(); reject(Error('Cache restart probe timed out: ' + text)) }, 45_000)
      child.on('error', error => { clearTimeout(timer); reject(error) })
      child.on('exit', code => { clearTimeout(timer); resolveRun({ code, text }) })
    })
    assert.equal(result.code, 0, result.text)
    console.log(result.text.trim())
  }
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
