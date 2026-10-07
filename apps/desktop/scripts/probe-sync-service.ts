import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-sync-service-'))
try {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'ts', contents: `
      import assert from 'node:assert/strict'
      import { app, safeStorage } from 'electron'
      import { readFile } from 'node:fs/promises'
      import { join } from 'node:path'
      import { startPersonalSync, syncAction, syncStatus } from './electron/services/supabaseSync'
      import { mutatePortfolios, readPortfolios } from './electron/services/portfolioStore'
      import { exportSettings } from './electron/services/settingsStore'
      import { exportUserData } from './electron/services/portfolioStore'
      import { exportCards } from './electron/services/cardsStore'
      let offline = false
      let owner = 'f7a86a8a-53c7-4c18-aec3-010010010001'
      const rows = new Map()
      const reply = (value, code = 200) => Promise.resolve(new Response(JSON.stringify(value), { status: code, headers: { 'Content-Type': 'application/json' } }))
      globalThis.fetch = async (input, init) => {
        if (offline) throw Error('Fixture offline')
        const url = String(input)
        assert.ok(url.startsWith('https://rclwztheheenuyisyswy.supabase.co/'), 'Unexpected sync destination')
        if (url.includes('/auth/v1/token')) {
          const credentials = JSON.parse(init.body)
          assert.equal(credentials.password, 'fixture-password')
          const user = { id: owner, email: 'sync-fixture@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
          const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
          const payload = Buffer.from(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
          return reply({ user, access_token: header + '.' + payload + '.fixture', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600 })
        }
        if (url.includes('/auth/v1/logout')) return reply({})
        if (url.includes('/rpc/budget_terminal_sync_write')) {
          const body = JSON.parse(init.body)
          const previous = rows.get(body.p_dataset)
          assert.equal(body.p_revision, previous?.revision ?? 0)
          const row = { user_id: owner, dataset: body.p_dataset, payload: body.p_payload, schema_version: 1, revision: body.p_revision + 1, updated_at: new Date().toISOString() }
          rows.set(body.p_dataset, row)
          return reply([row])
        }
        if (url.includes('/rest/v1/budget_terminal_sync')) return reply([...rows.values()])
        throw Error('Unexpected fixture request: ' + url)
      }
      app.whenReady().then(async () => {
        let stop
        try {
          assert.ok(safeStorage.isEncryptionAvailable(), 'OS secure storage must be available')
          stop = await startPersonalSync()
          await syncAction({ type: 'sync' })
          assert.equal(syncStatus().data.state, 'signedOut')
          const signedIn = await syncAction({ type: 'signIn', email: 'sync-fixture@example.com', password: 'fixture-password' })
          assert.equal(signedIn.meta.freshness, 'fresh', JSON.stringify(signedIn.errors))
          assert.equal(signedIn.data.state, 'ready')
          assert.equal(rows.size, 3)
          const bytes = await readFile(join(process.env.APPDATA, 'BudgetTerminalElectron', 'sync-session.bin'))
          assert.ok(!bytes.toString().includes('sync-fixture@example.com'))
          const session = safeStorage.decryptString(bytes)
          assert.ok(session.includes('fixture-refresh'))
          assert.ok(!session.includes('fixture-password'))
          const backup = JSON.stringify({ userData: await exportUserData(), settings: await exportSettings(), cards: await exportCards() })
          assert.ok(!backup.includes('fixture-refresh') && !backup.includes('fixture-password'))
          const portfolio = (await readPortfolios()).portfolios[0]
          offline = true
          await mutatePortfolios({ type: 'setCash', portfolioId: portfolio.id, cashBalance: 75 })
          const failed = await syncAction({ type: 'sync' })
          assert.equal(failed.meta.freshness, 'failed')
          assert.ok(failed.data.pending.includes('portfolio'))
          assert.equal((await readPortfolios()).portfolios[0].cashBalance, 75)
          offline = false
          assert.equal((await syncAction({ type: 'sync' })).data.state, 'ready')
          offline = true
          await syncAction({ type: 'signOut' })
          assert.equal(syncStatus().data.state, 'signedOut')
          await assert.rejects(readFile(join(process.env.APPDATA, 'BudgetTerminalElectron', 'sync-session.bin')), { code: 'ENOENT' })
          offline = false
          owner = 'f7a86a8a-53c7-4c18-aec3-010010010002'
          const other = await syncAction({ type: 'signIn', email: 'sync-fixture@example.com', password: 'fixture-password' })
          assert.equal(other.meta.freshness, 'failed')
          assert.match(other.meta.failureReason, /another sync account/)
          assert.ok([...rows.values()].every(row => row.user_id !== owner))
          console.log('PASS: SDK auth, encrypted OS session, backup exclusion, offline delivery, sign-out and cross-account upload prevention')
          stop(); app.exit(0)
        } catch (error) { console.error(error); stop?.(); app.exit(1) }
      })
    ` },
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron'],
  })
  await writeFile(join(directory, 'main.cjs'), bundle.outputFiles[0].text)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (data) => { output += data })
    child.stderr.on('data', (data) => { output += data })
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Sync service probe timed out: ' + output)) }, 45_000)
    child.on('error', (error) => { clearTimeout(timeout); reject(error) })
    child.on('exit', (code) => { clearTimeout(timeout); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
} finally {
  assert.ok(!relative(tmpdir(), directory).startsWith('..'))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
