import { safeStorage, shell } from 'electron'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ConvexClient, ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { z } from 'zod'
import type { CloudSnapshot, CloudSyncCommand, CloudSyncStatus } from '../shared/cloudSync.js'
import { failed, ok } from '../shared/envelope.js'
import { CloudSyncEngine, type SyncCheckpoint } from './cloudSyncEngine.js'
import { applySyncData, atomicSyncFile, cloudDataPath, readLocalSyncData, readSyncData, recoverSyncData } from './cloudSyncData.js'
import { withSavedDataLock } from './automaticBackup.js'
import { subscribeSavedDataChanged } from './savedDataEvents.js'
import { beginGitHubSignIn, GitHubSetupError, type GitHubSignIn, type OAuthTokens, type OAuthCompletion } from './cloudSyncOAuth.js'
import { convexDeploymentUrl } from '../shared/cloudOAuth.js'

const readRef = makeFunctionReference<'query', Record<string, never>, CloudSnapshot | null>('sync:read')
const userRef = makeFunctionReference<'query', Record<string, never>, string>('sync:identity')
const authConfigRef = makeFunctionReference<'query', Record<string, never>, { authVersion?: number; githubConfigured: boolean }>('sync:authConfiguration')
const writeRef = makeFunctionReference<'mutation', { expectedRevision: number; payload: string }, { accepted: boolean; revision: number; updatedAt: number }>('sync:write')
const startSignInRef = makeFunctionReference<'mutation', { redirectTo: string }, { redirect: string; state: string }>('auth:startSignInWithGithub')
const completeSignInRef = makeFunctionReference<'mutation', { code: string; state: string }, OAuthCompletion>('auth:completeSignInWithGithub')
const refreshRef = makeFunctionReference<'mutation', { refreshToken: string }, { kind: 'rotated'; tokens: OAuthTokens } | { kind: 'noSession' }>('auth:refreshSession')
const signOutRef = makeFunctionReference<'mutation', { refreshToken: string }, null>('auth:signOut')
const tokensSchema = z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1), refreshTokenExpiresAt: z.number().finite(), userId: z.string().min(1) })
const sessionSchema = z.object({ authVersion: z.literal(2), url: z.string(), userId: z.string(), tokens: tokensSchema })
type Session = z.infer<typeof sessionSchema>
const checkpointSchema = z.object({ account: z.string(), baseline: z.string().optional(), revision: z.number().int().nonnegative(), lastSyncedAt: z.number().optional(), cloudUpdatedAt: z.number().optional() })
const urlSchema = z.string().trim().url().transform(convexDeploymentUrl)
const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('signInGitHub'), url: urlSchema }),
  z.object({ type: z.literal('cancelSignIn') }),
  z.object({ type: z.literal('sync') }), z.object({ type: z.literal('disconnect') }),
  z.object({ type: z.literal('resolve'), use: z.enum(['local', 'cloud']) }),
])

const encryptionAvailable = () => safeStorage.isEncryptionAvailable() &&
  !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
const sessionPath = () => cloudDataPath('sync-session.bin')
const checkpointPath = () => cloudDataPath('sync-checkpoint.json')
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

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const result = busy.then(run)
  busy = result.catch(() => {})
  return result
}

async function saveSession(value: Session) {
  if (!encryptionAvailable()) throw new Error('OS credential encryption is unavailable.')
  const target = sessionPath()
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.tmp`
  try {
    await writeFile(temporary, safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 })
    await rename(temporary, target)
  } finally { await rm(temporary, { force: true }) }
}

async function connectTokens(url: string, value: OAuthTokens) {
  const tokens = tokensSchema.parse(value)
  const login = http(url)
  login.setAuth(tokens.accessToken)
  const userId = await login.query(userRef, {})
  if (userId !== tokens.userId) throw new Error('Sign-in identity mismatch.')
  const next: Session = { authVersion: 2, url, userId, tokens }
  await saveSession(next)
  await attach(next)
  authError = false
  message = undefined
}

async function authenticatedClient(forceRefresh = false) {
  if (!session || !client) throw new Error('Sign in first.')
  // Refresh tokens are serialized with every other sync operation and persisted before use.
  const expires = JSON.parse(Buffer.from(session.tokens.accessToken.split('.')[1], 'base64url').toString()).exp as number
  if (forceRefresh || !Number.isFinite(expires) || expires * 1000 < Date.now() + 30_000) {
    const result = await http(session.url).mutation(refreshRef, { refreshToken: session.tokens.refreshToken })
    if (result.kind === 'noSession') {
      savedUrl = session.url
      await rm(sessionPath(), { force: true })
      session = undefined
      client = undefined
      engine = undefined
      void subscription?.close()
      subscription = undefined
      authError = true
      message = 'Your cloud session expired. Sign in with GitHub again. Local data is available.'
      throw new Error('Session expired.')
    }
    if (result.tokens.userId !== session.userId) throw new Error('Refreshed identity mismatch.')
    const next = { ...session, tokens: tokensSchema.parse(result.tokens) }
    await saveSession(next)
    session = next
  }
  client.setAuth(session.tokens.accessToken)
  return client
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
  const account = `${value.url}|${value.userId}`
  let checkpoint: SyncCheckpoint = { account, revision: 0 }
  try {
    const parsed = checkpointSchema.parse(JSON.parse(await readFile(checkpointPath(), 'utf8')))
    if (parsed.account === account) checkpoint = parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') message = 'The sync checkpoint could not be read. Copies will be compared before replacing data.'
  }
  engine = new CloudSyncEngine(checkpoint, {
    readLocal: () => withSavedDataLock(readLocalSyncData),
    applyIfUnchanged: (expected, payload, updatedAt) => withSavedDataLock(async () => {
      if (await readSyncData() !== expected) return false
      await applySyncData(payload, updatedAt)
      return true
    }),
    readRemote: async () => (await authenticatedClient()).query(readRef, {}),
    writeRemote: async (expectedRevision, payload) => (await authenticatedClient()).mutation(writeRef, { expectedRevision, payload }),
    saveCheckpoint: checkpoint => atomicSyncFile(checkpointPath(), checkpoint),
  })
  // The subscription is only a wake-up signal. Network work never blocks local startup or writes.
  subscription = new ConvexClient(value.url, { logger: false })
  subscription.setAuth(async ({ forceRefreshToken }) => {
    // Convex can request this independently; serialize token rotation with HTTP sync.
    return enqueue(async () => {
      try { await authenticatedClient(forceRefreshToken); return session?.tokens.accessToken ?? null } catch { return null }
    })
  })
  subscription.onUpdate(readRef, {}, () => schedule(), () => { /* HTTP retry reports failures in Settings. */ })
  schedule()
}

export function cloudSyncStatus(): CloudSyncStatus {
  return { url: session?.url ?? savedUrl, signedIn: Boolean(session), encryptionAvailable: encryptionAvailable(),
    state: engine?.state ?? (authError ? 'error' : 'disconnected'), pending: engine?.pending ?? false,
    signInPending: Boolean(pendingGitHub),
    localUpdatedAt: engine?.localUpdatedAt,
    cloudUpdatedAt: engine?.cloudUpdatedAt ?? engine?.checkpoint.cloudUpdatedAt,
    revision: engine?.cloudRevision ?? engine?.checkpoint.revision,
    lastSyncedAt: engine?.checkpoint.lastSyncedAt, message: engine?.message ?? message }
}

export async function startCloudSync(): Promise<void> {
  closed = false
  // Local journal recovery is the only startup dependency; it never accesses Convex.
  await withSavedDataLock(recoverSyncData)
  // Establish the factory baseline before the window can make edits. Never require cloud access.
  await withSavedDataLock(readLocalSyncData).catch(() => {
    authError = true
    message = 'Local sync timestamps could not be initialized. Local data is still available.'
  })
  timer = setInterval(schedule, 15_000)
  timer.unref()
  stopEvents = subscribeSavedDataChanged(() => { if (engine) engine.pending = true; schedule() })
  void enqueue(async () => {
    try {
      const bytes = await readFile(sessionPath())
      if (!encryptionAvailable()) throw new Error('Encryption unavailable')
      const decoded = JSON.parse(safeStorage.decryptString(bytes))
      if (decoded.authVersion !== 2) {
        savedUrl = urlSchema.parse(decoded.url)
        message = 'Cloud sync now uses Convex Auth v2. Sign in with the same GitHub account again to reconnect your saved cloud data.'
        return
      }
      const stored = sessionSchema.parse(decoded)
      stored.url = urlSchema.parse(stored.url)
      if (!closed) await attach(stored)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        authError = true
        message = 'Saved sync sign-in could not be opened. Sign in again; your local data is available.'
      }
    }
  })
}

export function cloudSyncCommand(input: CloudSyncCommand) {
  return enqueue(async () => {
    try {
      const command = commandSchema.parse(input)
      message = undefined
      authError = false
      if (command.type === 'signInGitHub') {
        if (session || pendingGitHub || !encryptionAvailable()) throw new Error('Sign-in unavailable')
        const login = http(command.url)
        const flow = await beginGitHubSignIn(command.url, {
          isConfigured: async () => {
            const config = await login.query(authConfigRef, {})
            if (config.authVersion !== 2) throw new GitHubSetupError('This backend needs the Convex Auth v2 update. Run npm run convex:setup from the repository, then retry. Local data is available.')
            return config.githubConfigured
          },
          startSignIn: args => login.mutation(startSignInRef, args),
          completeSignIn: args => login.mutation(completeSignInRef, args), openExternal: url => shell.openExternal(url),
        })
        pendingGitHub = flow
        message = 'Complete GitHub sign-in in your browser. This request expires in 5 minutes.'
        void flow.result.then(result => enqueue(async () => {
          if (pendingGitHub !== flow || closed) return
          pendingGitHub = undefined
          if ('reason' in result) {
            authError = result.reason !== 'cancelled'
            message = result.reason === 'expired' ? 'GitHub sign-in expired. Try again.' :
              result.reason === 'cancelled' ? undefined : 'GitHub sign-in failed. Check the backend GitHub OAuth configuration and try again.'
            return
          }
          try { await connectTokens(command.url, result.tokens) }
          catch { authError = true; message = 'GitHub sign-in could not finish. Check your connection and try again. Local data is available.' }
        })).catch(() => { authError = true; message = 'GitHub sign-in could not finish. Try again.' })
      } else if (command.type === 'cancelSignIn') {
        pendingGitHub?.cancel()
        pendingGitHub = undefined
      } else if (command.type === 'disconnect') {
        pendingGitHub?.cancel()
        pendingGitHub = undefined
        // Remove local credentials first. Failed server revocation must never prevent disconnect.
        await rm(sessionPath(), { force: true })
        const previous = client
        const refreshToken = session?.tokens.refreshToken
        previous?.clearAuth()
        session = undefined
        engine = undefined
        client = undefined
        await subscription?.close()
        subscription = undefined
        try { if (refreshToken) await previous?.mutation(signOutRef, { refreshToken }) } catch { /* Local session is already removed. */ }
      } else {
        if (!engine) throw new Error('Sign in first.')
        await engine.sync(command.type === 'resolve' ? command.use : undefined)
      }
      const status = cloudSyncStatus()
      return status.state === 'error' ? failed(status, status.message ?? 'Sync failed.', 'cloud sync') : ok(status, 'cloud sync')
    } catch (error) {
      if (error instanceof GitHubSetupError) {
        authError = true
        message = error.message
        return failed(cloudSyncStatus(), message, 'cloud sync')
      }
      return failed(cloudSyncStatus(), 'Could not complete the sync command. Check the deployment URL, sign-in configuration, connection and OS credential encryption. Your local data is unchanged.', 'cloud sync')
    }
  })
}

export async function closeCloudSync(): Promise<void> {
  closed = true
  pendingGitHub?.cancel()
  pendingGitHub = undefined
  clearInterval(timer)
  stopEvents?.()
  await subscription?.close()
  subscription = undefined
  await busy
}
