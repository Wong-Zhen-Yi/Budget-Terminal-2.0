import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const directory = await mkdtemp(join(tmpdir(), 'budget-workers-build-'))
try {
  await writeFile(join(directory, 'main.cjs'), `
    const assert = require('node:assert/strict')
    const { Worker } = require('node:worker_threads')
    const { serialize, deserialize } = require('node:v8')
    const { app } = require('electron')
    app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))})
    const call = (worker, request) => new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); worker.off('message', receive); worker.off('error', fail) }
      const fail = error => { cleanup(); reject(error) }
      const receive = reply => { cleanup(); reply.error ? reject(Error(reply.error.message)) : resolve(reply.value) }
      const timer = setTimeout(() => fail(Error('Built worker timed out')), 15000)
      worker.on('message', receive); worker.on('error', fail)
      worker.postMessage({ ...request, id: 1 })
    })
    app.whenReady().then(async () => {
      const quant = new Worker(${JSON.stringify(join(root, 'out/main/quantWorker.js'))})
      const cache = new Worker(${JSON.stringify(join(root, 'out/main/cacheWorker.js'))}, {
        workerData: { path: ${JSON.stringify(join(directory, 'cache.sqlite'))}, maxBytes: 1000000 }
      })
      try {
        const bars = Array.from({ length: 100 }, (_, day) => ({ date: new Date(Date.UTC(2025, 0, day + 1)).toISOString().slice(0, 10),
          close: 100 + day / 10 + Math.sin(day), volume: 1000 }))
        assert(Array.isArray(await call(quant, { kind: 'discover', histories: { LEFT: bars, RIGHT: bars.map(bar => ({ ...bar, close: bar.close * 2 + 1 })) } })))
        const detail = await call(quant, { kind: 'detail', left: 'LEFT', right: 'RIGHT', leftBars: bars, rightBars: bars })
        assert.equal(detail.observations, 100)
        await call(cache, { kind: 'set', key: 'fixture', value: serialize({ value: Buffer.from('fixture'), snapshot: undefined }),
          storedAt: Date.now(), ttlMs: 60000, retention: 'snapshot' })
        const row = await call(cache, { kind: 'get', key: 'fixture' })
        assert.equal(deserialize(Buffer.from(row.value)).value.toString(), 'fixture')
        await call(cache, { kind: 'close' })
        console.log('PASS: production Quant and SQLite worker bundles execute in Electron and preserve binary cache values')
        await Promise.all([quant.terminate(), cache.terminate()])
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
    const timer = setTimeout(() => { child.kill(); reject(new Error('Built-worker probe timed out: ' + text)) }, 45_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, text }) })
  })
  assert.equal(result.code, 0, result.text)
  console.log(result.text.trim())
} finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
