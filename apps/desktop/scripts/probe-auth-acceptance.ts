import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { convexDeploymentUrl } from '../electron/shared/cloudOAuth.js'

// Opt-in: two human-approved GitHub sign-ins, no writes to saved cloud data.
// Each stage starts a new Electron process and uses a private temporary profile.
const offline = process.argv.includes('--offline')
const cleanupIndex = process.argv.indexOf('--cleanup-only')
const recoveryDirectory = cleanupIndex >= 0 ? process.argv[cleanupIndex + 1] : undefined
if (cleanupIndex >= 0 && (!recoveryDirectory || offline)) throw Error('Use --cleanup-only with an encrypted test recovery directory.')
if (!offline) process.loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url)))
const url = offline ? 'https://fixture.convex.cloud' : convexDeploymentUrl(process.env.VITE_CONVEX_URL ?? '')
const directory = recoveryDirectory ? resolve(recoveryDirectory) : await mkdtemp(join(tmpdir(), 'budget-auth-acceptance-'))
assert(directory.startsWith(resolve(tmpdir()) + sep) && basename(directory).startsWith('budget-auth-acceptance-'), 'The acceptance directory must be inside its dedicated OS temporary folder')
const runner = join(directory, 'runner.cjs')
const require = createRequire(import.meta.url)
let cleanupConfirmed = false
try {
  await build({ stdin: { resolveDir: import.meta.dirname, sourcefile: 'live-auth-acceptance.ts', loader: 'ts', contents: `
    import { app, safeStorage, shell } from 'electron'
    import assert from 'node:assert/strict'
    import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
    import { join } from 'node:path'
    import { ConvexHttpClient } from 'convex/browser'
    import { makeFunctionReference } from 'convex/server'
    import { z } from 'zod'
    import { beginGitHubSignIn } from '../electron/services/cloudSyncOAuth'
    const directory = process.env.BUDGET_AUTH_ACCEPTANCE_DIR
    const url = process.env.BUDGET_AUTH_ACCEPTANCE_URL
    const stage = process.argv.at(-1)
    app.setPath('userData', join(directory, 'profile'))
    const ref = name => makeFunctionReference(name)
    const http = () => new ConvexHttpClient(url, { logger: false,
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) })
    const tokensSchema = z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1), userId: z.string().min(1), refreshTokenExpiresAt: z.number() })
    const path = device => join(directory, device + '.bin')
    const save = async (device, tokens) => {
      await writeFile(path(device) + '.tmp', await safeStorage.encryptStringAsync(JSON.stringify(tokens)), { mode: 0o600 })
      await rename(path(device) + '.tmp', path(device))
    }
    const load = async device => tokensSchema.parse(JSON.parse((await safeStorage.decryptStringAsync(await readFile(path(device)))).result))
    let pending
    app.whenReady().then(async () => {
      try {
        assert(await safeStorage.isAsyncEncryptionAvailable())
        assert(!(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'))
        await mkdir(directory, { recursive: true })
        if (stage === 'selftest-write') {
          await save('selftest', { accessToken: 'fixture', refreshToken: 'fixture', userId: 'fixture', refreshTokenExpiresAt: 1 })
          assert(!(await readFile(path('selftest'))).includes(Buffer.from('fixture')))
          console.log('PASS: isolated acceptance runner encrypted its fixture')
        } else if (stage === 'selftest-read') {
          assert.equal((await load('selftest')).userId, 'fixture')
          await rm(path('selftest'), { force: true })
          console.log('PASS: acceptance runner restored its encrypted fixture in a new Electron process')
        } else if (stage === 'a' || stage === 'b') {
          const client = http()
          console.log('APPROVE: GitHub sign-in for temporary device ' + stage.toUpperCase())
          pending = await beginGitHubSignIn(url, {
            isConfigured: async () => { const value = await client.query(ref('sync:authConfiguration'), {}); return value.authVersion === 2 && value.accountControlsVersion === 2 && value.githubConfigured },
            startSignIn: args => client.mutation(ref('auth:startSignInWithGithub'), { ...args, purpose: 'signIn' }),
            completeSignIn: args => client.mutation(ref('auth:completeSignInWithGithub'), args),
            openExternal: value => shell.openExternal(value),
          })
          const completed = await pending.result
          assert('tokens' in completed)
          try { await save(stage, completed.tokens) }
          catch (error) { await client.mutation(ref('auth:signOut'), { refreshToken: completed.tokens.refreshToken }); throw error }
          if (stage === 'b') assert.equal((await load('a')).userId, completed.tokens.userId, 'Use the same GitHub account for both temporary devices')
          console.log('PASS: temporary device ' + stage.toUpperCase() + ' signed in and encrypted its credentials')
        } else if (stage === 'verify') {
          let a = await load('a')
          const b = await load('b')
          assert.equal(a.userId, b.userId)
          const clientA = http(), clientB = http()
          clientA.setAuth(a.accessToken); clientB.setAuth(b.accessToken)
          assert.equal(await clientA.query(ref('sync:identity'), {}), a.userId)
          assert.equal(await clientB.query(ref('sync:identity'), {}), b.userId)
          const before = await clientA.query(ref('sync:read'), {})
          assert.deepEqual(await clientB.query(ref('sync:read'), {}), before)
          const refreshed = await http().mutation(ref('auth:refreshSession'), { refreshToken: a.refreshToken })
          assert.equal(refreshed.kind, 'rotated')
          assert.equal(refreshed.tokens.userId, a.userId)
          await save('a', refreshed.tokens)
          a = await load('a'); clientA.setAuth(a.accessToken)
          assert.deepEqual(await clientA.query(ref('sync:read'), {}), before)
          // Revoke only A using its own refresh token; existing application sessions stay connected.
          await http().mutation(ref('auth:signOut'), { refreshToken: a.refreshToken })
          assert.equal(await clientA.query(ref('auth:isAuthenticated'), {}), false)
          await assert.rejects(clientA.query(ref('sync:read'), {}))
          assert.equal(await clientB.query(ref('auth:isAuthenticated'), {}), true)
          assert.deepEqual(await clientB.query(ref('sync:read'), {}), before)
          console.log('PASS: process-restart restoration, two live devices reading the same snapshot, persisted token rotation and immediate remote revocation isolated to the test session')
        } else if (stage === 'cleanup') {
          for (const device of ['a', 'b']) {
            for (const suffix of ['', '.tmp']) {
              const target = path(device) + suffix
              let tokens
              try { tokens = tokensSchema.parse(JSON.parse((await safeStorage.decryptStringAsync(await readFile(target))).result)) }
              catch (error) { if (error.code === 'ENOENT') continue; throw error }
              await http().mutation(ref('auth:signOut'), { refreshToken: tokens.refreshToken })
              await rm(target, { force: true })
            }
          }
          console.log('PASS: temporary test sessions revoked')
        } else throw Error('Invalid live acceptance stage')
        app.exit(0)
      } catch { console.error('FAIL: live acceptance stage ' + stage + '; no credentials or saved data are included in this diagnostic'); app.exit(1) }
      finally { pending?.cancel() }
    })
  ` }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: runner })
  const run = (stage: string) => new Promise<boolean>((done, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory,
      BUDGET_AUTH_ACCEPTANCE_DIR: directory, BUDGET_AUTH_ACCEPTANCE_URL: url }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(require('electron') as string, [runner, stage], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', data => process.stdout.write(data))
    // Never echo raw Electron/provider errors or command arguments.
    child.stderr.resume()
    const timer = setTimeout(() => { child.kill(); reject(Error('Live GitHub approval timed out. Temporary-session cleanup will run.')) }, stage === 'a' || stage === 'b' ? 330_000 : 60_000)
    child.on('error', () => { clearTimeout(timer); reject(Error('Could not start the isolated live acceptance process.')) })
    child.on('exit', code => { clearTimeout(timer); done(code === 0) })
  })
  if (offline) {
    assert(await run('selftest-write'), 'Acceptance encryption self-test failed')
    assert(await run('selftest-read'), 'Acceptance restart self-test failed')
    cleanupConfirmed = true
  } else {
    try {
      if (!recoveryDirectory) {
        assert(await run('a'), 'Device A sign-in did not complete')
        assert(await run('b'), 'Device B sign-in did not complete')
        assert(await run('verify'), 'Two-device live acceptance did not pass')
      }
    } finally { cleanupConfirmed = await run('cleanup') }
  }
  assert(cleanupConfirmed, 'Server cleanup is unconfirmed; encrypted test credentials are retained for recovery')
} finally {
  assert(resolve(directory).startsWith(resolve(tmpdir()) + sep))
  if (cleanupConfirmed) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  else console.error('Live test did not confirm cleanup. Its isolated encrypted recovery directory is: ' + directory)
}
