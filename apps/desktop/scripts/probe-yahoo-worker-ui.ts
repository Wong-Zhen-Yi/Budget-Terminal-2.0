import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const directory = await mkdtemp(join(tmpdir(), 'bt-yahoo-worker-'))
try {
  await build({
    entryPoints: [resolve(import.meta.dirname, 'probe-yahoo-worker.ts')],
    outfile: join(directory, 'probe.mjs'), bundle: true, platform: 'node', format: 'esm',
    external: ['electron'],
  })
  await writeFile(join(directory, 'main.cjs'), `
    const { app } = require('electron')
    app.whenReady().then(async () => {
      try { await import('./probe.mjs'); app.exit(0) }
      catch (error) { console.error(error); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const code = await new Promise<number | null>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: 'pipe' })
    child.stdout.on('data', data => process.stdout.write(data))
    child.stderr.on('data', data => process.stderr.write(data))
    const timer = setTimeout(() => { child.kill(); reject(new Error('Yahoo worker UI probe timed out')) }, 30_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun(code) })
  })
  assert.equal(code, 0)
} finally {
  assert(!relative(tmpdir(), directory).startsWith('..'))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
