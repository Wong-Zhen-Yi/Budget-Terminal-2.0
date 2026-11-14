import { safeStorage, shell } from 'electron'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ConvexClient, ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api.js'
import { z } from 'zod'
import { ConvexError } from 'convex/values'
import type { CloudSyncCommand, CloudSyncStatus } from '../shared/cloudSync.js'
import { failed, ok } from '../shared/envelope.js'
import { CloudSyncEngine, type SyncCheckpoint } from './cloudSyncEngine.js'
import { applySyncData, atomicSyncFile, cloudDataPath, readLocalSyncData, readSyncData, recoverSyncData } from './cloudSyncData.js'
import { withSavedDataLock } from './automaticBackup.js'
import { subscribeSavedDataChanged } from './savedDataEvents.js'
import { beginGitHubSignIn, GitHubSetupError, type GitHubSignIn, type OAuthTokens } from './cloudSyncOAuth.js'
import { convexDeploymentUrl } from '../shared/cloudOAuth.js'

const readRef = api.sync.read
const userRef = api.sync.identity
const accountRef = api.sync.account
const authenticatedRef = api.auth.isAuthenticated
const revokeOthersRef = api.auth.revokeOtherSessions
const authConfigRef = api.sync.authConfiguration
const writeRef = api.sync.write
const startSignInRef = api.auth.startSignInWithGithub
const completeSignInRef = api.auth.completeSignInWithGithub
const refreshRef = api.auth.refreshSession
const signOutRef = api.auth.signOut
const tokensSchema = z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1), refreshTokenExpiresAt: z.number().finite(), userId: z.string().min(1) })
const sessionSchema = z.object({ authVersion: z.literal(2), url: z.string(), userId: z.string(), githubLogin: z.string().optional(), tokens: tokensSchema })
type Session = z.infer<typeof sessionSchema>
const checkpointSchema = z.object({ account: z.string(), baseline: z.string().optional(), revision: z.number().int().nonnegative(), lastSyncedAt: z.number().optional(), cloudUpdatedAt: z.number().optional() })
const urlSchema = z.string().trim().url().transform(convexDeploymentUrl)
const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('signInGitHub'), url: urlSchema }),
  z.object({ type: z.literal('cancelSignIn') }),
  z.object({ type: z.literal('sync') }), z.object({ type: z.literal('disconnect') }),
  z.object({ type: z.literal('resolve'), use: z.enum(['local', 'cloud']) }),
  z.object({ type: z.literal('confirmWorkspace'), use: z.enum(['local', 'cloud']) }),
  z.object({ type: z.literal('revokeOtherSessions') }),
  z.object({ type: z.literal('retrySession') }),
  z.object({ type: z.literal('retryCredentialCleanup') }),
])

let encryptionAvailable = false
async function checkEncryption() {
  encryptionAvailable = await safeStorage.isAsyncEncryptionAvailable() &&
    !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  return encryptionAvailable
}
const sessionPath = () => cloudDataPath('sync-session.bin')
const checkpointPath = () => cloudDataPath('sync-checkpoint.json')
const ownerPath = () => cloudDataPath('sync-workspace-owner.json')
const signOutPath = () => cloudDataPath('sync-signout.json')
const signOutSchema = z.object({ signedOut: z.literal(true), cleanupRequired: z.boolean(), revocation: z.enum(['complete', 'unconfirmed']) })
const http = (url: string) => new ConvexHttpClient(url, { logger: false,
  fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12_000) }) })

let session: Session | undefined
let savedUrl = ''
let engine: CloudSyncEngine | undefined
let client: ConvexHttpClient | undefined
let subscription: ConvexClient | undefined
let timer: ReturnType<typeof setInterval> | undefined
let stopEvents: (() => void) | undefined
let busy: Promise<unknown> = Promise.resolve()
let scheduled = false
let closed = false
let message: string | undefined
let authError = false
let pendingGitHub: GitHubSignIn | undefined
let authState: CloudSyncStatus['authState'] = 'restoring'
let workspaceApprovalRequired = false
let revocation: CloudSyncStatus['revocation']
let credentialCleanupRequired = false
const activeSignIns = new Set<Promise<unknown>>()
function cancelPendingSignIn() {
  pendingGitHub?.cancel()
  pendingGitHub = undefined
}

class CredentialError extends Error {
  constructor(readonly kind: 'keyringUnavailable' | 'storageError' | 'reauthRequired', message: string) { super(message) }
}
function credentialFailure(error: CredentialError) {
  authState = error.kind
  authError = true
  message = error.message
}
const isTemporaryKeyringError = (error: unknown) => Boolean(error && typeof error === 'object' && 'isTemporarilyUnavailable' in error && error.isTemporarilyUnavailable)
const isNetworkError = (error: unknown) => error instanceof TypeError || error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const result = busy.then(run)
  busy = result.catch(() => {})
  return result
}

async function saveSession(value: Session) {
  let encrypted: Buffer
  try {
    if (!await checkEncryption()) throw new Error('Encryption unavailable')
    encrypted = await safeStorage.encryptStringAsync(JSON.stringify(value))
  } catch {
    encryptionAvailable = false
    const error = new CredentialError('keyringUnavailable', 'Your credential keyring is unavailable. Unlock it and retry. Your existing credentials are preserved.')
    credentialFailure(error)
    throw error
  }
  const target = sessionPath()
  const temporary = `${target}.tmp`
  try {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(temporary, encrypted, { mode: 0o600 })
    await rename(temporary, target)
  } catch {
    const error = new CredentialError('storageError', 'Saved sign-in could not be written. Check free disk space and app-data folder permissions, then retry. Your existing credentials are preserved.')
    credentialFailure(error)
    throw error
  } finally { await rm(temporary, { force: true }).catch(() => {}) }
}

async function connectTokens(url: string, value: OAuthTokens) {
  const tokens = tokensSchema.parse(value)
  const login = http(url)
  login.setAuth(tokens.accessToken)
  const userId = await login.query(userRef, {})
  if (userId !== tokens.userId) throw new Error('Sign-in identity mismatch.')
  const profile = await login.query(accountRef, {})
  if (profile.userId !== userId) throw new Error('Sign-in identity mismatch.')
  const next: Session = { authVersion: 2, url, userId, tokens, githubLogin: profile.githubLogin }
  await saveSession(next)
  await rm(signOutPath(), { force: true }).catch(() => { throw new CredentialError('storageError', 'The saved sign-out marker could not be cleared. Check app-data folder permissions, then retry.') })
  credentialCleanupRequired = false
  message = undefined
  revocation = undefined
  await attach(next)
  authState = 'authenticated'
  authError = false
}

/** JWT contents are only a refresh hint; the backend verifies identity and session liveness. */
function needsRefresh(token: string) {
  try {
    const expires: unknown = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp
    return typeof expires !== 'number' || !Number.isFinite(expires) || expires * 1000 < Date.now() + 30_000
  } catch { return true }
}

async function expireSession() {
  savedUrl = session?.url ?? savedUrl
  session = undefined
  client?.clearAuth()
  client = undefined
  engine = undefined
  workspaceApprovalRequired = false
  void subscription?.close()
  subscription = undefined
  authState = 'reauthRequired'
  authError = true
  message = 'Your cloud session expired or was revoked. Sign in with GitHub again. Local data is available.'
  try { await rm(sessionPath(), { force: true }) }
  catch { credentialCleanupRequired = true; message += ' Saved credentials could not be erased. Retry credential cleanup in Settings.' }
  await atomicSyncFile(signOutPath(), { signedOut: true, cleanupRequired: credentialCleanupRequired, revocation: 'complete' }).catch(() => {})
}

async function authenticatedClient(forceRefresh = false) {
  if (!session || !client) throw new Error('Sign in first.')
  // Refresh tokens are serialized with every other sync operation and persisted before use.
  if (forceRefresh || needsRefresh(session.tokens.accessToken)) {
    const result = await http(session.url).mutation(refreshRef, { refreshToken: session.tokens.refreshToken })
    if (result.kind === 'noSession') {
      await expireSession()
      throw new Error('Session expired.')
    }
    if (result.tokens.userId !== session.userId) throw new Error('Refreshed identity mismatch.')
    const next = { ...session, tokens: tokensSchema.parse(result.tokens) }
    await saveSession(next)
    session = next
    if (['keyringUnavailable', 'storageError'].includes(authState ?? '')) { authError = false; message = undefined }
    authState = 'authenticated'
  }
  client.setAuth(session.tokens.accessToken)
  return client
}

async function remote<T>(run: (connection: ConvexHttpClient) => Promise<T>): Promise<T> {
  try {
    const result = await run(await authenticatedClient())
    if (session && !['keyringUnavailable', 'storageError'].includes(authState ?? '')) authState = 'authenticated'
    return result
  } catch (error) {
    if (error instanceof CredentialError) credentialFailure(error)
    else if (session) {
      try {
        client!.setAuth(session.tokens.accessToken)
        if (!await client!.query(authenticatedRef, {})) await expireSession()
        else if (isNetworkError(error)) authState = 'offline'
      } catch (checkError) { if (session && isNetworkError(checkError)) authState = 'offline' }
    }
    throw error
  }
}

async function cleanupIssuedSession(url: string, tokens: OAuthTokens) {
  try { await http(url).mutation(signOutRef, { refreshToken: tokens.refreshToken }); return true }
  catch { return false }
}

async function eraseDisconnectedCredentials() {
  try {
    await rm(sessionPath(), { force: true })
    credentialCleanupRequired = false
  } catch {
    credentialCleanupRequired = true
    authState = 'storageError'
    authError = true
    message = 'Cloud sync stopped on this device, but saved credentials could not be erased. Check app-data folder permissions and retry credential cleanup.'
  }
  try {
    await atomicSyncFile(signOutPath(), { signedOut: true, cleanupRequired: credentialCleanupRequired, revocation: revocation ?? 'unconfirmed' })
  } catch {
    if (credentialCleanupRequired) message += ' Sign-out could not be recorded on disk; saved credentials may restore after restart.'
  }
}

async function disconnectSession() {
  const previous = session
  cancelPendingSignIn()
  session = undefined
  client?.clearAuth()
  client = undefined
  engine = undefined
  workspaceApprovalRequired = false
  const previousSubscription = subscription
  subscription = undefined
  authState = 'signedOut'
  revocation = previous ? 'unconfirmed' : revocation
  // A non-secret marker prevents credentials surviving a deletion failure from restoring.
  await atomicSyncFile(signOutPath(), { signedOut: true, cleanupRequired: true, revocation: revocation ?? 'unconfirmed' }).catch(() => {})
  await eraseDisconnectedCredentials()
  await previousSubscription?.close().catch(() => {})
  if (previous) revocation = await cleanupIssuedSession(previous.url, previous.tokens) ? 'complete' : 'unconfirmed'
  await atomicSyncFile(signOutPath(), { signedOut: true, cleanupRequired: credentialCleanupRequired, revocation: revocation ?? 'unconfirmed' }).catch(() => {})
  if (!credentialCleanupRequired) message = revocation === 'unconfirmed'
    ? 'Disconnected on this device. Server sign-out could not be confirmed. Reconnect and sign out other devices when online.'
    : 'Disconnected on this device. Local data and the cloud copy are preserved.'
}

const accountKey = (value: Session) => `${value.url}|${value.userId}`

async function confirmWorkspace(use: 'local' | 'cloud') {
  if (!session || !workspaceApprovalRequired) throw new Error('No workspace choice pending.')
  if (use === 'cloud') {
    const before = await withSavedDataLock(readSyncData)
    const snapshot = await remote(connection => connection.query(readRef, {}))
    if (!snapshot) {
      message = 'This account has no cloud copy. Import this device’s data or disconnect sync.'
      throw new Error('No cloud copy available.')
    }
    await withSavedDataLock(async () => {
      if (await readSyncData() !== before) throw new Error('Local data changed. Review your choice again.')
      await applySyncData(snapshot.payload, snapshot.updatedAt)
    })
    await atomicSyncFile(checkpointPath(), { account: accountKey(session), baseline: snapshot.payload,
      revision: snapshot.revision, cloudUpdatedAt: snapshot.updatedAt, lastSyncedAt: Date.now() })
  }
  await atomicSyncFile(ownerPath(), { account: accountKey(session) })
  message = undefined
  await attach(session)
}

function schedule() {
  if (scheduled || closed || !engine) return
  scheduled = true
  void enqueue(async () => {
    scheduled = false
    if (!closed) await engine?.sync()
  })
}

async function attach(value: Session) {
  await subscription?.close()
  subscription = undefined
  session = value
  savedUrl = value.url
  client = http(value.url)
  const account = accountKey(value)
  let checkpoint: SyncCheckpoint = { account, revision: 0 }
  try {
    const parsed = checkpointSchema.parse(JSON.parse(await readFile(checkpointPath(), 'utf8')))
    if (parsed.account === account) checkpoint = parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') message = 'The sync checkpoint could not be read. Copies will be compared before replacing data.'
  }
  // Ownership survives disconnect. A checkpoint migrates existing workspaces safely.
  let owner: string | undefined
  let unreadableOwner = false
  try { owner = z.object({ account: z.string().min(1) }).parse(JSON.parse(await readFile(ownerPath(), 'utf8'))).account }
  catch (error) { unreadableOwner = (error as NodeJS.ErrnoException).code !== 'ENOENT' }
  const local = await withSavedDataLock(readLocalSyncData)
  workspaceApprovalRequired = unreadableOwner || (owner ? owner !== account : checkpoint.baseline === undefined && !local.pristine)
  engine = undefined
  if (workspaceApprovalRequired) {
    message = 'Sync is paused. Choose whether to import this device’s saved data into this account or restore this account’s cloud copy.'
  } else {
    if (!owner) await atomicSyncFile(ownerPath(), { account })
    engine = new CloudSyncEngine(checkpoint, {
      readLocal: () => withSavedDataLock(readLocalSyncData),
      applyIfUnchanged: (expected, payload, updatedAt) => withSavedDataLock(async () => {
        if (await readSyncData() !== expected) return false
        await applySyncData(payload, updatedAt)
        return true
      }),
      readRemote: () => remote(connection => connection.query(readRef, {})),
      writeRemote: (expectedRevision, payload) => remote(connection => connection.mutation(writeRef, { expectedRevision, payload })),
      saveCheckpoint: checkpoint => atomicSyncFile(checkpointPath(), checkpoint),
    })
  }
  // The subscription is only a wake-up signal. Network work never blocks local startup or writes.
  const liveSubscription = new ConvexClient(value.url, { logger: false })
  subscription = liveSubscription
  subscription.setAuth(async ({ forceRefreshToken }) => {
    const observedToken = session?.tokens.accessToken
    // Convex can request this independently; serialize token rotation with HTTP sync.
    return enqueue(async () => {
      try {
        if (closed || subscription !== liveSubscription) return null
        await authenticatedClient(forceRefreshToken && observedToken === session?.tokens.accessToken)
        return session?.tokens.accessToken ?? null
      } catch (error) {
        if (error instanceof CredentialError) credentialFailure(error)
        else if (session && isNetworkError(error)) authState = 'offline'
        return null
      }
    })
  })
  subscription.onUpdate(authenticatedRef, {}, valid => {
    if (valid && subscription === liveSubscription && session && !['keyringUnavailable', 'storageError'].includes(authState ?? '')) authState = 'authenticated'
    if (!valid) void enqueue(async () => {
      if (subscription !== liveSubscription || !session) return
      // A socket temporarily using no token must not discard an offline saved session.
      try { await remote(async connection => { if (!await connection.query(authenticatedRef, {})) await expireSession() }) }
      catch { /* The HTTP check preserves credentials while offline. */ }
    }).catch(() => {})
  }, () => { /* HTTP retry distinguishes a revoked session from an offline connection. */ })
  if (engine) subscription.onUpdate(readRef, {}, () => schedule(), () => { /* HTTP retry reports failures in Settings. */ })
  schedule()
}

export function cloudSyncStatus(): CloudSyncStatus {
  return { url: session?.url ?? savedUrl, signedIn: Boolean(session), encryptionAvailable,
    credentialCleanupRequired,
    authState: pendingGitHub ? 'signingIn' : authState, githubLogin: session?.githubLogin, workspaceApprovalRequired, revocation,
    state: authError ? 'error' : engine?.state ?? 'disconnected', pending: engine?.pending ?? false,
    signInPending: Boolean(pendingGitHub),
    localUpdatedAt: engine?.localUpdatedAt,
    cloudUpdatedAt: engine?.cloudUpdatedAt ?? engine?.checkpoint.cloudUpdatedAt,
    revision: engine?.cloudRevision ?? engine?.checkpoint.revision,
    lastSyncedAt: engine?.checkpoint.lastSyncedAt, message: message ?? engine?.message }
}

async function restoreSession() {
  authState = 'restoring'
  await checkEncryption().catch(() => { encryptionAvailable = false })
  try {
    try {
      const marker = signOutSchema.parse(JSON.parse(await readFile(signOutPath(), 'utf8')))
      revocation = marker.revocation
      credentialCleanupRequired = marker.cleanupRequired
      authState = credentialCleanupRequired ? 'storageError' : 'signedOut'
      authError = credentialCleanupRequired
      message = credentialCleanupRequired ? 'Saved credentials still need to be erased. Retry credential cleanup in Settings.' :
        revocation === 'unconfirmed' ? 'This device is signed out. Server revocation is unconfirmed.' : undefined
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new CredentialError('storageError', 'Saved sign-out status could not be read. Check app-data folder permissions. Credentials will not be restored until this is resolved.')
    }
    let bytes: Buffer
    try { bytes = await readFile(sessionPath()) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { authState = encryptionAvailable ? 'signedOut' : 'keyringUnavailable'; return }
      throw new CredentialError('storageError', 'Saved credentials could not be read. Check app-data folder permissions, then retry saved sign-in.')
    }
    if (!encryptionAvailable) throw new CredentialError('keyringUnavailable', 'Unlock your credential keyring and retry saved sign-in. Your credentials are preserved.')
    let decrypted: Awaited<ReturnType<typeof safeStorage.decryptStringAsync>>
    try { decrypted = await safeStorage.decryptStringAsync(bytes) }
    catch (error) {
      if (isTemporaryKeyringError(error)) {
        encryptionAvailable = false
        throw new CredentialError('keyringUnavailable', 'Your credential keyring is temporarily unavailable. Unlock it and retry saved sign-in.')
      }
      throw new CredentialError('reauthRequired', 'Saved credentials could not be decrypted. Sign in again; local data is preserved.')
    }
    let decoded: z.infer<typeof sessionSchema> | { authVersion: unknown; url: string }
    try { decoded = JSON.parse(decrypted.result) }
    catch { throw new CredentialError('reauthRequired', 'Saved credentials are invalid. Sign in again; local data is preserved.') }
    if (decoded.authVersion !== 2) {
      savedUrl = urlSchema.parse(decoded.url)
      message = 'Cloud sync now uses Convex Auth v2. Sign in with the same GitHub account again to reconnect your saved cloud data.'
      authState = 'reauthRequired'
      return
    }
    const stored = sessionSchema.parse(decoded)
    stored.url = urlSchema.parse(stored.url)
    if (stored.tokens.userId !== stored.userId) throw new Error('Saved identity mismatch')
    if (decrypted.shouldReEncrypt) await saveSession(stored)
    if (!closed) { await attach(stored); authState = 'offline' }
  } catch (error) {
    credentialFailure(error instanceof CredentialError ? error : new CredentialError('reauthRequired', 'Saved credentials are invalid. Sign in again; local data is preserved.'))
  }
  if (authState === 'restoring') authState = encryptionAvailable ? 'signedOut' : 'keyringUnavailable'
}

export async function startCloudSync(): Promise<void> {
  closed = false
  await withSavedDataLock(recoverSyncData)
  await withSavedDataLock(readLocalSyncData).catch(() => {
    authError = true
    message = 'Local sync timestamps could not be initialized. Local data is still available.'
  })
  timer = setInterval(schedule, 15_000)
  timer.unref()
  stopEvents = subscribeSavedDataChanged(() => { if (engine) engine.pending = true; schedule() })
  // Restoring the encrypted session is local; remote sync runs separately.
  await enqueue(restoreSession)
}

export function cloudSyncCommand(input: CloudSyncCommand) {
  return enqueue(async () => {
    try {
      const command = commandSchema.parse(input)
      message = undefined
      authError = false
      if (command.type === 'retryCredentialCleanup') {
        if (session || pendingGitHub) throw new Error('Disconnect first.')
        await eraseDisconnectedCredentials()
        if (!credentialCleanupRequired) { authState = 'signedOut'; message = 'Saved credentials were erased. This device remains signed out.' }
      } else if (command.type === 'retrySession') {
        if (pendingGitHub || credentialCleanupRequired) throw new Error('Finish the pending account action first.')
        if (session) await authenticatedClient(true)
        else await restoreSession()
      } else if (command.type === 'signInGitHub' || command.type === 'revokeOtherSessions') {
        const managingSessions = command.type === 'revokeOtherSessions'
        if (credentialCleanupRequired || pendingGitHub || !await checkEncryption() || (managingSessions ? !session : Boolean(session))) throw new Error('Sign-in unavailable')
        const url = managingSessions ? session!.url : command.url
        const originalUserId = session?.userId
        const login = http(url)
        const flow = await beginGitHubSignIn(url, {
          isConfigured: async () => {
            const config = await login.query(authConfigRef, {})
            if (config.authVersion !== 2) throw new GitHubSetupError('This backend needs the Convex Auth v2 update. Run npm run convex:setup from the repository, then retry. Local data is available.')
            if (config.accountControlsVersion !== 2) throw new GitHubSetupError('This backend needs the account security update. Deploy the current Convex backend with npm run convex:setup, then retry. Local data is available.')
            return config.githubConfigured
          },
          startSignIn: args => managingSessions
            ? remote(connection => connection.mutation(startSignInRef, { ...args, purpose: 'revokeOthers' }))
            : login.mutation(startSignInRef, { ...args, purpose: 'signIn' }),
          completeSignIn: args => managingSessions ? remote(connection => connection.mutation(completeSignInRef, args)) : login.mutation(completeSignInRef, args),
          openExternal: url => shell.openExternal(url),
        })
        pendingGitHub = flow
        if (closed) { flow.cancel(); pendingGitHub = undefined }
        message = 'Complete GitHub sign-in in your browser. This request expires in 5 minutes.'
        const completion = flow.result.then(result => enqueue(async () => {
          if (pendingGitHub !== flow || closed) {
            if ('tokens' in result && !await cleanupIssuedSession(url, result.tokens)) {
              revocation = 'unconfirmed'
              message = 'An abandoned sign-in session could not be revoked. Reconnect and sign out other devices when online.'
            }
            return
          }
          if ('reason' in result) {
            pendingGitHub = undefined
            authError = result.reason !== 'cancelled'
            message = result.reason === 'expired' ? 'GitHub sign-in expired. Try again.' :
              result.reason === 'cancelled' ? undefined : result.reason === 'accountMismatch' ? 'Use the same GitHub account to sign out other devices. Your current account is unchanged.' : 'GitHub sign-in failed. Check the backend GitHub OAuth configuration and try again.'
            return
          }
          try {
            if (managingSessions && result.tokens.userId !== originalUserId) {
              await cleanupIssuedSession(url, result.tokens)
              authError = true
              message = 'Use the same GitHub account to sign out other devices. Your current account is unchanged.'
              return
            }
            if (managingSessions && !result.authorization) throw new Error('Missing single-use authorization.')
            await connectTokens(url, result.tokens)
            if (managingSessions) {
              await remote(connection => connection.mutation(revokeOthersRef, { authorization: result.authorization! }))
              revocation = 'complete'
              message = 'Other devices have been signed out. This device remains connected.'
            }
          }
          catch (error) {
            const cleaned = session?.tokens.refreshToken === result.tokens.refreshToken || await cleanupIssuedSession(url, result.tokens)
            if (error instanceof CredentialError) credentialFailure(error)
            else { authError = true; message = managingSessions ? 'Could not confirm sign-out of other devices. Check your connection and retry GitHub verification.' : 'GitHub sign-in could not finish. Check your connection and try again. Local data is available.' }
            if (!cleaned) { revocation = 'unconfirmed'; message += ' Server cleanup of the unused session is unconfirmed.' }
          }
          finally { pendingGitHub = undefined }
        })).catch(() => { authError = true; message = 'GitHub sign-in could not finish. Try again.' })
        activeSignIns.add(completion)
        void completion.finally(() => activeSignIns.delete(completion))
      } else if (command.type === 'cancelSignIn') {
        cancelPendingSignIn()
      } else if (command.type === 'disconnect') {
        await disconnectSession()
      } else if (command.type === 'confirmWorkspace') {
        await confirmWorkspace(command.use)
      } else {
        if (!engine) throw new Error('Sign in first.')
        await engine.sync(command.type === 'resolve' ? command.use : undefined)
      }
      const status = cloudSyncStatus()
      return status.state === 'error' ? failed(status, status.message ?? 'Sync failed.', 'cloud sync') : ok(status, 'cloud sync')
    } catch (error) {
      if (error instanceof CredentialError) credentialFailure(error)
      if (error instanceof ConvexError && error.data && typeof error.data === 'object' && !Array.isArray(error.data) && error.data.code === 'AUTH_RATE_LIMITED') {
        message = 'Too many sign-in requests. Wait a few minutes and retry.'
      }
      if (error instanceof GitHubSetupError) {
        authError = true
        message = error.message
        return failed(cloudSyncStatus(), message, 'cloud sync')
      }
      return failed(cloudSyncStatus(), message ?? 'Could not complete the sync command. Check your connection, cloud setup and OS credential keyring. Local saves remain available.', 'cloud sync')
    }
  })
}

export async function closeCloudSync(): Promise<void> {
  closed = true
  cancelPendingSignIn()
  clearInterval(timer)
  stopEvents?.()
  await subscription?.close()
  subscription = undefined
  await busy
  cancelPendingSignIn()
  await Promise.allSettled([...activeSignIns])
  await busy
}
