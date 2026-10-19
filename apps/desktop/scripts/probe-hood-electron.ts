import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-hood-electron-'))
// External packages (especially PDF.js and its worker) resolve from the checkout.
await mkdir(join(root, 'out'), { recursive: true })
const bundleDirectory = await mkdtemp(join(root, 'out', 'probe-hood-electron-'))
const live = process.argv.includes('--live')
try {
  await mkdir(join(directory, 'userData'), { recursive: true })
  await build({
    stdin: { resolveDir: root, contents: `
      import assert from 'node:assert/strict'
      import { app, net } from 'electron'
      import { getHood, hoodIndexes, hoodTesting } from './electron/services/hood.ts'
      import { cache } from './electron/services/cache.ts'
      import { closeYahooWorker } from './electron/services/yahoo/client.ts'
      app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
      app.setPath('sessionData', ${JSON.stringify(join(directory, 'userData'))})
      app.whenReady().then(async () => {
      try {
        if (${live}) {
          const result = await getHood({ force: true })
          console.log(JSON.stringify({ meta: result.meta, progress: result.data.progress, errors: result.errors }))
          assert(result.data.market?.chart.candles.length, 'Electron market data failed')
          assert(result.data.financials?.quarterly.revenue.length, 'Electron financials failed')
          for (const kind of ['monthly', 'quarterly']) {
            assert(result.data[kind], 'Electron ' + kind + ' report failed')
            assert(result.data[kind].metrics.every(metric => metric.value !== null), 'Missing ' + kind + ' metrics')
          }
        } else {
          const calls = []
          const browserFetch = net.fetch
          const nodeFetch = globalThis.fetch
          globalThis.fetch = async () => { throw Error('HOOD must not use Node fetch inside Electron') }
          net.fetch = async (url, options) => {
            calls.push(url)
            assert.equal(options.headers['User-Agent'], 'Mozilla/5.0')
            assert(options.signal instanceof AbortSignal)
            if (url === hoodIndexes.monthly) return new Response('<h2>2026</h2><h3>Monthly Metrics PDF</h3><a href="/reports/monthly">Aug</a>')
            if (url === hoodIndexes.quarterly) return new Response('<h2>2026</h2><h3>Press Release</h3><a href="/reports/quarterly">Q2</a>')
            if (url.endsWith('/reports/monthly')) return new Response('<p>Funded Customers\\t28.6\\t28.5\\t-\\t26.7\\t+7%</p>', { headers: { 'content-type': 'text/html' } })
            if (url.endsWith('/reports/quarterly')) return new Response('<p>Total net revenues\\t989\\t1308\\t32%\\t1041\\t26%</p>', { headers: { 'content-type': 'text/html' } })
            return new Response('', { status: 403 })
          }
          try {
            const monthly = await hoodTesting.fetchReport('monthly')
            const quarterly = await hoodTesting.fetchReport('quarterly')
            assert.equal(monthly.metrics.find(metric => metric.id === 'customers').value, 28.6e6)
            assert.equal(quarterly.metrics.find(metric => metric.id === 'revenue').value, 1308e6)
            assert.equal(calls.length, 4, 'Both indexes and documents must use Chromium')
            await assert.rejects(hoodTesting.response('https://example.com/report'), /Unexpected Robinhood document host/)
            assert.equal(calls.length, 4, 'Reject unexpected hosts before fetching')
            await assert.rejects(hoodTesting.response('https://investors.robinhood.com/blocked'), /HTTP 403/)
            net.fetch = async () => Object.defineProperty(new Response(''), 'url', { value: 'https://example.com/redirect' })
            await assert.rejects(hoodTesting.response(hoodIndexes.monthly), /Unexpected Robinhood document redirect/)
          } finally {
            net.fetch = browserFetch
            globalThis.fetch = nodeFetch
          }
        }
        console.log('PASS: HOOD Electron ' + (${live} ? 'live prices, financials and PDF reports' : 'Chromium transport, report parsing, HTTP errors and host validation'))
        app.exit(0)
      } catch (error) { console.error(error); app.exit(1) }
      finally { cache.close(); closeYahooWorker() }
      })
    ` },
    outfile: join(bundleDirectory, 'main.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external',
  })
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'hood-electron-probe', main: join(bundleDirectory, 'main.mjs') }))
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [directory], { env, windowsHide: true, stdio: 'pipe' })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(new Error('HOOD Electron probe timed out: ' + output)) }, live ? 180_000 : 30_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
} finally {
  assert(!relative(tmpdir(), directory).startsWith('..'))
  assert(!relative(join(root, 'out'), bundleDirectory).startsWith('..'))
  await rm(bundleDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
