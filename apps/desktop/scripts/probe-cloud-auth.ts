import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import type { CloudSnapshot } from '../electron/shared/cloudSync.js'

// Run the real host and loopback OAuth exchange against an isolated provider fixture.
// No live deployment, browser profile, tokens or application data are accessed.
const directory = await mkdtemp(join(tmpdir(), 'budget-cloud-auth-'))
const previous = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
const url = 'https://fixture.convex.cloud'
let nextUser = 'account-a', serial = 0, refreshCalls = 0, writes = 0, reads = 0, backups = 0
let offline = false, revoked = false, loseResponse = false, failEncryption = false, rotateKey = false, keyring = true, unavailableDecrypt = false
let callbackUrl = '', oauthState = '', autoApprove = true
let accountControlsVersion = 2, encryptionWrites = 0, cleanups = 0
let failDelete = false, failWrite = false, failRename = false, holdCompletion = false
let releaseCompletion: (() => void) | undefined
let purpose: 'signIn' | 'revokeOthers' = 'signIn', initiatingUser: string | undefined
let lastIssuedFamily = 0
const grants = new Map<string, { user: string; family: number }>()
let local = { payload: 'local-account-a', updatedAt: 1, pristine: false }
const snapshots = new Map<string, CloudSnapshot>()
const refreshTokens = new Map<string, { user: string; generation: number; family: number }>()
const accessTokens = new Map<string, { user: string; family: number }>()
const usedGeneration = new Map<number, number>()
const revokedFamilies = new Set<number>()
const subscriptions: { fetchToken?: (args: { forceRefreshToken: boolean }) => Promise<string | null>; onAuth?: (valid: boolean) => void; closed?: boolean }[] = []
function bundle(user: string, generation = 0, family = ++serial) {
  const accessToken = `fixture.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, serial: ++serial })).toString('base64url')}.signature`
  const refreshToken = `refresh-${++serial}`
  refreshTokens.set(refreshToken, { user, generation, family })
  accessTokens.set(accessToken, { user, family })
  lastIssuedFamily = family
  return { accessToken, refreshToken, userId: user, refreshTokenExpiresAt: Date.now() + 86_400_000 }
}
function owner(token: string) {
  const identity = accessTokens.get(token)
  if (revoked || !identity || revokedFamilies.has(identity.family)) throw Error('Synthetic unauthorized session')
  return identity
}
const fixture = {
  async query(name: string, _args: unknown, token: string) {
    if (offline) throw TypeError('Synthetic network failure')
    if (name === 'sync:authConfiguration') return { authVersion: 2, accountControlsVersion, githubConfigured: true }
    if (name === 'auth:isAuthenticated') { try { owner(token); return true } catch { return false } }
    const identity = owner(token)
    if (name === 'sync:identity') return identity.user
    if (name === 'sync:account') return { userId: identity.user, githubLogin: identity.user }
    if (name === 'sync:read') { reads++; return snapshots.get(identity.user) ?? null }
    throw Error('Unexpected fixture query')
  },
  async mutation(name: string, args: Record<string, any>, token: string) {
    if (offline) throw TypeError('Synthetic network failure')
    if (name === 'auth:startSignInWithGithub') {
      purpose = args.purpose
      initiatingUser = purpose === 'revokeOthers' ? owner(token).user : undefined
      callbackUrl = args.redirectTo
      oauthState = `state-${++serial}`
      return { state: oauthState, redirect: `https://github.com/login/oauth/authorize?client_id=fixture&state=${oauthState}&redirect_uri=${encodeURIComponent('https://fixture.convex.site/api/auth/callback/github/callback')}&code_challenge=fixture&code_challenge_method=S256` }
    }
    if (name === 'auth:completeSignInWithGithub') {
      assert.equal(args.state, oauthState)
      assert.equal(args.code, 'fixture-code')
      const tokens = bundle(nextUser)
      if (holdCompletion) await new Promise<void>(resolve => { releaseCompletion = resolve })
      if (purpose === 'revokeOthers' && nextUser !== initiatingUser) {
        revokedFamilies.add(lastIssuedFamily)
        return { status: 'error', userError: { error: 'ACCOUNT_MISMATCH' } }
      }
      const authorization = purpose === 'revokeOthers' ? `${++serial}`.padStart(64, 'a') : undefined
      if (authorization) grants.set(authorization, { user: nextUser, family: lastIssuedFamily })
      return { status: 'complete', tokens, ...(authorization ? { authorization } : {}) }
    }
    if (name === 'auth:refreshSession') {
      refreshCalls++
      const stored = refreshTokens.get(args.refreshToken)
      if (revoked || !stored || revokedFamilies.has(stored.family)) return { kind: 'noSession' }
      if (stored.generation < (usedGeneration.get(stored.family) ?? 0)) {
        revokedFamilies.add(stored.family)
        return { kind: 'noSession' }
      }
      usedGeneration.set(stored.family, stored.generation)
      const tokens = bundle(stored.user, stored.generation + 1, stored.family)
      if (loseResponse) { loseResponse = false; throw TypeError('Synthetic lost refresh response') }
      return { kind: 'rotated', tokens }
    }
    if (name === 'auth:signOut') {
      cleanups++
      const stored = refreshTokens.get(args.refreshToken)
      if (stored) revokedFamilies.add(stored.family)
      return null
    }
    const identity = owner(token)
    if (name === 'auth:revokeOtherSessions') {
      const grant = grants.get(args.authorization)
      assert(grant && grant.family === identity.family && grant.user === identity.user, 'A persisted session alone cannot revoke other sessions')
      grants.delete(args.authorization)
      for (const value of refreshTokens.values()) if (value.user === identity.user && value.family !== identity.family) revokedFamilies.add(value.family)
      return 1
    }
    if (name === 'sync:write') {
      // A rotated token must be persisted successfully before it is used for data.
      assert((await readSession()).tokens.accessToken === token)
      writes++
      const snapshot = { revision: args.expectedRevision + 1, payload: args.payload, updatedAt: Date.now() }
      snapshots.set(identity.user, snapshot)
      return { accepted: true, revision: snapshot.revision, updatedAt: snapshot.updatedAt }
    }
    throw Error('Unexpected fixture mutation')
  },
  local: () => local,
  apply: (payload: string, updatedAt: number) => { backups++; local = { payload, updatedAt, pristine: false } },
  subscriptions,
  failDelete: () => failDelete,
  failWrite: () => failWrite,
  failRename: () => failRename,
  safeStorage: {
    isAsyncEncryptionAvailable: async () => keyring,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptStringAsync: async (value: string) => { if (failEncryption) throw Error('Synthetic credential write failure'); encryptionWrites++; return Buffer.from(`encrypted:${value}`) },
    decryptStringAsync: async (value: Buffer) => {
      if (unavailableDecrypt) throw Object.assign(Error('Synthetic locked keyring'), { isTemporarilyUnavailable: true })
      return { result: value.toString().slice('encrypted:'.length), shouldReEncrypt: rotateKey }
    },
  },
  shell: { openExternal: async () => { if (autoApprove) await fetch(`${callbackUrl}?convexAuthCode=fixture-code`) } },
}
const globals = globalThis as typeof globalThis & { __cloudAuthFixture?: typeof fixture }
globals.__cloudAuthFixture = fixture
const target = join(directory, 'host.cjs')
let host: typeof import('../electron/services/cloudSyncHost.js') | undefined
const sessionPath = join(directory, 'sync-session.bin')
const readSession = async () => JSON.parse((await readFile(sessionPath, 'utf8')).slice('encrypted:'.length))
const waitFor = async (predicate: () => boolean, label: string) => {
  for (let count = 0; count < 300; count++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail(label)
}
try {
  await build({ entryPoints: [resolve(import.meta.dirname, '../electron/services/cloudSyncHost.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: target,
    plugins: [{ name: 'isolated-auth-provider', setup(builder) {
      builder.onResolve({ filter: /^node:fs\/promises$/ }, args => args.namespace === 'auth-fs' ? { path: args.path, external: true } : { path: args.path, namespace: 'auth-fs' })
      builder.onLoad({ filter: /.*/, namespace: 'auth-fs' }, () => ({ contents: `
        import * as fs from 'node:fs/promises'
        export * from 'node:fs/promises'
        const fixture = globalThis.__cloudAuthFixture
        export const rm = async (path, ...args) => {
          if (String(path).endsWith('sync-session.bin') && fixture.failDelete()) throw Object.assign(Error('Synthetic delete permission failure'), { code: 'EACCES' })
          return fs.rm(path, ...args)
        }
        export const writeFile = async (path, ...args) => {
          if (String(path).endsWith('sync-session.bin.tmp') && fixture.failWrite()) throw Object.assign(Error('Synthetic full disk'), { code: 'ENOSPC' })
          return fs.writeFile(path, ...args)
        }
        export const rename = async (from, to) => {
          if (String(to).endsWith('sync-session.bin') && fixture.failRename()) throw Object.assign(Error('Synthetic rename permission failure'), { code: 'EACCES' })
          return fs.rename(from, to)
        }
      ` }))
      builder.onResolve({ filter: /^(electron|convex\/browser|\.\/cloudSyncData\.js|\.\/automaticBackup\.js)$/ }, args => ({ path: args.path, namespace: 'auth-fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'auth-fixture' }, args => ({ contents: args.path === 'electron' ? `
        export const { safeStorage, shell } = globalThis.__cloudAuthFixture
      ` : args.path === 'convex/browser' ? `
        import { getFunctionName } from 'convex/server'
        export class ConvexHttpClient {
          token = ''
          setAuth(token) { this.token = token } clearAuth() { this.token = '' }
          query(ref, args) { return globalThis.__cloudAuthFixture.query(getFunctionName(ref), args, this.token) }
          mutation(ref, args) { return globalThis.__cloudAuthFixture.mutation(getFunctionName(ref), args, this.token) }
        }
        export class ConvexClient {
          constructor() { globalThis.__cloudAuthFixture.subscriptions.push(this) }
          setAuth(fn) { this.fetchToken = fn }
          onUpdate(ref, args, fn) { if (getFunctionName(ref) === 'auth:isAuthenticated') this.onAuth = fn }
          async close() { this.closed = true }
        }
      ` : args.path.includes('automaticBackup') ? `export const withSavedDataLock = run => run()` : `
        import { join, dirname } from 'node:path'
        import { mkdir, writeFile } from 'node:fs/promises'
        export const cloudDataPath = name => join(process.env.APPDATA, name)
        export const readLocalSyncData = async () => globalThis.__cloudAuthFixture.local()
        export const readSyncData = async () => globalThis.__cloudAuthFixture.local().payload
        export const recoverSyncData = async () => {}
        export const applySyncData = async (payload, updatedAt) => globalThis.__cloudAuthFixture.apply(payload, updatedAt)
        export const atomicSyncFile = async (path, value) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value)) }
      `, resolveDir: resolve(import.meta.dirname, '..') }))
    } }],
  })
  const require = createRequire(import.meta.url)
  const fresh = () => { delete require.cache[target]; host = require(target); return host! }
  const signIn = async (user: string) => {
    nextUser = user
    const result = await host!.cloudSyncCommand({ type: 'signInGitHub', url })
    assert(!result.meta.failureReason, result.meta.failureReason ?? 'Sign-in command failed')
    await waitFor(() => !host!.cloudSyncStatus().signInPending, 'OAuth completion timed out')
    assert.equal(host!.cloudSyncStatus().signedIn, true)
    assert.equal(host!.cloudSyncStatus().githubLogin, user)
  }
  fresh(); await host!.startCloudSync()
  accountControlsVersion = 0
  const needsUpgrade = await host!.cloudSyncCommand({ type: 'signInGitHub', url })
  assert(needsUpgrade.meta.failureReason?.includes('account security update'))
  assert.equal(callbackUrl, '', 'An outdated backend must be rejected before opening OAuth')
  accountControlsVersion = 2
  await signIn('account-a')
  assert.equal(host!.cloudSyncStatus().workspaceApprovalRequired, true, 'Unowned existing data requires import consent')
  assert.equal(writes, 0)
  assert.equal(reads, 0)
  await host!.cloudSyncCommand({ type: 'confirmWorkspace', use: 'local' })
  await host!.cloudSyncCommand({ type: 'sync' })
  assert.equal(snapshots.get('account-a')?.payload, local.payload)
  await host!.closeCloudSync()
  await rm(join(directory, 'sync-workspace-owner.json'))
  fresh(); await host!.startCloudSync()
  assert.equal(host!.cloudSyncStatus().workspaceApprovalRequired, false, 'A matching legacy checkpoint migrates workspace ownership')
  await host!.closeCloudSync()
  await writeFile(join(directory, 'sync-workspace-owner.json'), 'invalid-owner-record')
  fresh(); await host!.startCloudSync()
  assert.equal(host!.cloudSyncStatus().workspaceApprovalRequired, true, 'An unreadable ownership record must fail closed')
  await host!.cloudSyncCommand({ type: 'confirmWorkspace', use: 'local' })
  offline = true
  await host!.cloudSyncCommand({ type: 'disconnect' })
  assert.equal(host!.cloudSyncStatus().revocation, 'unconfirmed')
  await assert.rejects(readFile(sessionPath))
  offline = false
  await signIn('account-b')
  const beforeWrites = writes
  await host!.cloudSyncCommand({ type: 'sync' })
  assert.equal(writes, beforeWrites, 'An empty destination account cannot receive another account’s data automatically')
  const missingCloud = await host!.cloudSyncCommand({ type: 'confirmWorkspace', use: 'cloud' })
  assert(missingCloud.meta.failureReason?.includes('no cloud copy'))
  assert.equal(local.payload, 'local-account-a')
  await host!.cloudSyncCommand({ type: 'confirmWorkspace', use: 'local' })
  await host!.cloudSyncCommand({ type: 'sync' })
  local = { payload: 'local-account-b', updatedAt: 2, pristine: false }
  await host!.cloudSyncCommand({ type: 'disconnect' })
  assert.equal(host!.cloudSyncStatus().revocation, 'complete')
  await signIn('account-a')
  assert.equal(host!.cloudSyncStatus().workspaceApprovalRequired, true)
  await host!.cloudSyncCommand({ type: 'confirmWorkspace', use: 'cloud' })
  assert.equal(local.payload, 'local-account-a')
  assert.equal(backups, 1, 'Restoring another account’s cloud copy backs up local data')

  // Concurrent HTTP/WebSocket requests must not rotate the same session twice.
  const socket = subscriptions.at(-1)!
  const beforeRefresh = refreshCalls
  await Promise.all([socket.fetchToken!({ forceRefreshToken: true }), socket.fetchToken!({ forceRefreshToken: true })])
  assert.equal(refreshCalls, beforeRefresh + 1)
  let stored = await readSession()
  const firstToken = stored.tokens.refreshToken
  loseResponse = true
  assert.equal(await socket.fetchToken!({ forceRefreshToken: true }), null)
  assert.equal((await readSession()).tokens.refreshToken, firstToken, 'A lost response preserves the previous refresh token')
  assert(await socket.fetchToken!({ forceRefreshToken: true }), 'Retrying the previous token recovers a lost rotation response')
  stored = await readSession()
  failEncryption = true
  assert.equal(await socket.fetchToken!({ forceRefreshToken: true }), null)
  assert.equal((await readSession()).tokens.refreshToken, stored.tokens.refreshToken, 'Failed persistence must not advance the saved token')
  failEncryption = false
  assert(await socket.fetchToken!({ forceRefreshToken: true }))
  await host!.cloudSyncCommand({ type: 'sync' })
  assert.equal(host!.cloudSyncStatus().authState, 'authenticated')
  offline = true
  socket.onAuth!(false)
  await host!.cloudSyncCommand({ type: 'sync' })
  assert.equal(host!.cloudSyncStatus().signedIn, true, 'An unauthenticated offline socket cannot invalidate saved credentials')
  assert.equal(host!.cloudSyncStatus().authState, 'offline')
  offline = false

  await host!.closeCloudSync()
  stored = await readSession()
  stored.tokens.accessToken = 'malformed-token'
  await writeFile(sessionPath, `encrypted:${JSON.stringify(stored)}`)
  fresh(); await host!.startCloudSync()
  await host!.cloudSyncCommand({ type: 'sync' })
  assert.notEqual((await readSession()).tokens.accessToken, 'malformed-token', 'Malformed JWT expiry recovers through refresh')
  await host!.closeCloudSync()
  unavailableDecrypt = true
  fresh(); await host!.startCloudSync()
  assert.equal(host!.cloudSyncStatus().authState, 'keyringUnavailable')
  assert(await readFile(sessionPath), 'Temporary keyring unavailability preserves credentials')
  unavailableDecrypt = false; rotateKey = true
  const beforeEncryptionWrites = encryptionWrites
  await host!.cloudSyncCommand({ type: 'retrySession' })
  assert.equal(host!.cloudSyncStatus().signedIn, true)
  assert.equal(encryptionWrites, beforeEncryptionWrites + 1, 'Key rotation must re-encrypt the restored session')
  rotateKey = false
  await host!.cloudSyncCommand({ type: 'sync' })

  // A reauthentication with the wrong GitHub account cannot end any current sessions.
  nextUser = 'account-b'
  await host!.cloudSyncCommand({ type: 'revokeOtherSessions' })
  await waitFor(() => !host!.cloudSyncStatus().signInPending, 'Session management did not finish')
  assert.equal(host!.cloudSyncStatus().githubLogin, 'account-a')
  assert(host!.cloudSyncStatus().message?.includes('same GitHub account'))
  nextUser = 'account-a'
  await host!.cloudSyncCommand({ type: 'revokeOtherSessions' })
  await waitFor(() => !host!.cloudSyncStatus().signInPending && host!.cloudSyncStatus().revocation === 'complete', 'Other sessions were not revoked')
  assert.equal(host!.cloudSyncStatus().signedIn, true)
  const live = subscriptions.at(-1)!
  revoked = true
  live.onAuth!(false)
  await waitFor(() => host!.cloudSyncStatus().authState === 'reauthRequired', 'Remote revocation did not clear the session')
  assert.equal(host!.cloudSyncStatus().signedIn, false)
  // Drain the queue before inspecting credential removal.
  await host!.cloudSyncCommand({ type: 'cancelSignIn' })
  await assert.rejects(readFile(sessionPath))
  revoked = false; autoApprove = false
  await host!.cloudSyncCommand({ type: 'signInGitHub', url })
  await host!.cloudSyncCommand({ type: 'cancelSignIn' })
  assert.equal(host!.cloudSyncStatus().signedIn, false)
  assert.equal(host!.cloudSyncStatus().signInPending, false)
  autoApprove = true
  holdCompletion = true
  const beforeCancelledCleanup = cleanups
  await host!.cloudSyncCommand({ type: 'signInGitHub', url })
  await waitFor(() => Boolean(releaseCompletion), 'Redemption did not start')
  const abandonedFamily = lastIssuedFamily
  await host!.cloudSyncCommand({ type: 'cancelSignIn' })
  releaseCompletion!(); releaseCompletion = undefined; holdCompletion = false
  await waitFor(() => cleanups > beforeCancelledCleanup, 'Cancelled redemption was not revoked')
  assert(revokedFamilies.has(abandonedFamily))
  assert.equal(host!.cloudSyncStatus().signedIn, false)
  failEncryption = true
  const beforeFailedCleanup = cleanups
  await host!.cloudSyncCommand({ type: 'signInGitHub', url })
  await waitFor(() => !host!.cloudSyncStatus().signInPending, 'Failed persistence did not settle')
  assert.equal(host!.cloudSyncStatus().signedIn, false)
  assert.equal(host!.cloudSyncStatus().authState, 'keyringUnavailable')
  assert.equal(cleanups, beforeFailedCleanup + 1, 'Failed sign-in persistence revokes the unused session')
  failEncryption = false
  await signIn('account-a')
  let currentSocket = subscriptions.at(-1)!
  const beforeStorageFailure = await readSession()
  failWrite = true
  assert.equal(await currentSocket.fetchToken!({ forceRefreshToken: true }), null)
  assert.equal(host!.cloudSyncStatus().authState, 'storageError')
  assert.equal(host!.cloudSyncStatus().encryptionAvailable, true, 'Disk errors must not be reported as a locked keyring')
  assert.equal((await readSession()).tokens.refreshToken, beforeStorageFailure.tokens.refreshToken)
  failWrite = false; failRename = true
  assert.equal(await currentSocket.fetchToken!({ forceRefreshToken: true }), null)
  assert.equal(host!.cloudSyncStatus().authState, 'storageError')
  failRename = false
  assert(await currentSocket.fetchToken!({ forceRefreshToken: true }))
  failDelete = true
  await host!.cloudSyncCommand({ type: 'disconnect' })
  assert.equal(host!.cloudSyncStatus().signedIn, false, 'Deletion failure must not leave in-memory sync connected')
  assert.equal(host!.cloudSyncStatus().credentialCleanupRequired, true)
  assert.equal(host!.cloudSyncStatus().revocation, 'complete', 'Server revocation must still run after deletion failure')
  assert(await readFile(sessionPath))
  await host!.closeCloudSync()
  fresh(); await host!.startCloudSync()
  assert.equal(host!.cloudSyncStatus().signedIn, false, 'The sign-out marker prevents leftover credentials restoring after restart')
  assert.equal(host!.cloudSyncStatus().credentialCleanupRequired, true)
  failDelete = false
  await host!.cloudSyncCommand({ type: 'retryCredentialCleanup' })
  assert.equal(host!.cloudSyncStatus().credentialCleanupRequired, false)
  await assert.rejects(readFile(sessionPath))
  await signIn('account-a')
  await host!.cloudSyncCommand({ type: 'disconnect' })
  holdCompletion = true
  await host!.cloudSyncCommand({ type: 'signInGitHub', url })
  await waitFor(() => Boolean(releaseCompletion), 'Shutdown redemption did not start')
  const shutdownFamily = lastIssuedFamily
  const closing = host!.closeCloudSync()
  releaseCompletion!(); holdCompletion = false; releaseCompletion = undefined
  await closing
  assert(revokedFamilies.has(shutdownFamily), 'Shutdown drains cleanup of a late OAuth result')
  console.log('PASS: full loopback sign-in, account import/restore consent, offline sign-out, refresh serialization/lost responses/persistence failure, malformed JWT recovery, locked keyring retry, same-account session management and remote revocation')
} finally {
  await host?.closeCloudSync()
  delete globals.__cloudAuthFixture
  for (const key of ['APPDATA', 'LOCALAPPDATA'] as const) {
    if (previous[key] === undefined) delete process.env[key]
    else process.env[key] = previous[key]
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
