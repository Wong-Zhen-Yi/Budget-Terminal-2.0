import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'budget-cloud-session-'))
try {
  const hostPath = join(directory, 'host.cjs')
  // Exercise the real session lifecycle and OS encryption without a cloud connection.
  await build({
    entryPoints: [resolve(import.meta.dirname, '../electron/services/cloudSyncHost.ts')],
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: hostPath,
    plugins: [{ name: 'offline-session-dependencies', setup(builder) {
      builder.onResolve({ filter: /^(convex\/browser|\.\/cloudSyncData\.js|\.\/automaticBackup\.js)$/ }, args => ({ path: args.path, namespace: 'session-fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'session-fixture' }, args => ({ contents: args.path === 'convex/browser' ? `
        export class ConvexHttpClient {
          setAuth() {} clearAuth() {}
          async query() { throw Error('Synthetic offline connection') }
          async mutation() { throw Error('Synthetic offline connection') }
        }
        export class ConvexClient { setAuth() {} onUpdate() {} async close() {} }
      ` : args.path.includes('automaticBackup') ? `
        export const withSavedDataLock = run => run()
      ` : `
        import { join } from 'node:path'
        export const cloudDataPath = name => join(process.env.APPDATA, 'BudgetTerminalElectron', name)
        export const readLocalSyncData = async () => ({ payload: '{}', updatedAt: 0, pristine: true })
        export const recoverSyncData = async () => {}
        export const readSyncData = async () => '{}'
        export const applySyncData = async () => {}
        export const atomicSyncFile = async () => {}
      ` }))
    } }],
  })
  await writeFile(join(directory, 'main.cjs'), `
    const { app, safeStorage } = require('electron')
    const assert = require('node:assert/strict')
    const { mkdir, writeFile, readFile } = require('node:fs/promises')
    const { join } = require('node:path')
    app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))})
    const freshHost = () => { delete require.cache[${JSON.stringify(hostPath)}]; return require(${JSON.stringify(hostPath)}) }
    app.whenReady().then(async () => {
      let host
      try {
        if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
          console.log('SKIP: secure OS keyring unavailable; persistent cloud sessions remain disabled')
          app.exit(0); return
        }
        host = freshHost(); await host.startCloudSync()
        assert.equal(host.cloudSyncStatus().signedIn, false)
        await host.closeCloudSync()
        const folder = join(process.env.APPDATA, 'BudgetTerminalElectron')
        const target = join(folder, 'sync-session.bin')
        await mkdir(folder, { recursive: true })
        const accessToken = 'fixture.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now()/1000) + 3600 })).toString('base64url') + '.fixture'
        const session = { authVersion: 2, url: 'https://fixture.convex.cloud', userId: 'fixture-user',
          tokens: { accessToken, refreshToken: 'fixture-refresh', refreshTokenExpiresAt: Date.now()+86400000, userId: 'fixture-user' } }
        const encrypted = safeStorage.encryptString(JSON.stringify(session))
        await writeFile(target, encrypted)
        assert(!encrypted.includes(Buffer.from('fixture-refresh')), 'Credentials must remain encrypted on disk')
        for (let restart = 0; restart < 2; restart++) {
          host = freshHost(); await host.startCloudSync()
          assert.equal(host.cloudSyncStatus().signedIn, true, 'Saved sign-in must be restored before startup resolves')
          assert.equal(host.cloudSyncStatus().url, session.url)
          await host.closeCloudSync()
          assert.deepEqual(await readFile(target), encrypted, 'Offline sync must retain the saved session')
        }
        host = freshHost(); await host.startCloudSync()
        await host.cloudSyncCommand({ type: 'disconnect' })
        assert.equal(host.cloudSyncStatus().signedIn, false)
        await host.closeCloudSync()
        host = freshHost(); await host.startCloudSync()
        assert.equal(host.cloudSyncStatus().signedIn, false, 'Explicit disconnect must survive restart')
        await host.closeCloudSync()
        console.log('PASS: real encrypted sessions restore before the first account check, stay signed in across offline restarts and clear on explicit disconnect')
        app.exit(0)
      } catch (error) { console.error(error); if (host) await host.closeCloudSync(); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((done, reject) => {
    const child = spawn(createRequire(import.meta.url)('electron'), [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timeout = setTimeout(() => { child.kill(); reject(Error('Cloud session probe timed out')) }, 30_000)
    child.on('error', error => { clearTimeout(timeout); reject(error) })
    child.on('exit', code => { clearTimeout(timeout); done({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
