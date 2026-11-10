import { safeStorage, shell, dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ConvexClient, ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { z } from 'zod'
import type { CloudSyncCommand, CloudSyncStatus } from '../shared/cloudSync.js'
import type { RecordPage, RecordWrite, RemoteRecord, SyncSignal, WriteResult } from '../shared/syncRecords.js'
import { joinSnapshot, splitSnapshot } from '../shared/syncRecords.js'
import { diagnosticLog } from './diagnosticLog.js'
import { failed, ok } from '../shared/envelope.js'
import { CloudRecordEngine, newRecordCheckpoint, type RecordCheckpoint } from './cloudRecordEngine.js'
import { applySyncData, atomicSyncFile, cloudDataPath, defaultSyncData, readLocalSyncData, readSyncData, recoverSyncData } from './cloudSyncData.js'
import { withSavedDataLock } from './automaticBackup.js'
import { subscribeSavedDataChanged } from './savedDataEvents.js'
import { beginGitHubSignIn, GitHubSetupError, type GitHubSignIn, type OAuthTokens } from './cloudSyncOAuth.js'
import { convexDeploymentUrl } from '../shared/cloudOAuth.js'
import { CloudBackendUpgradeError, requireCloudBackend, type CloudAuthConfiguration } from '../shared/cloudSyncConfiguration.js'

declare const __BUDGET_SYNC_URL__: string
const defaultUrl = typeof __BUDGET_SYNC_URL__ === 'string' ? __BUDGET_SYNC_URL__ : ''
const prepareRef = makeFunctionReference<'mutation', Record<string, never>, SyncSignal>('sync:prepare')
const migrateRef = makeFunctionReference<'mutation', { epoch: string }, SyncSignal>('sync:migrate')
const changesRef = makeFunctionReference<'query', { epoch: string; cursor: number }, RecordPage>('sync:changes')
const watchRef = makeFunctionReference<'query', Record<string, never>, SyncSignal | null>('sync:watch')
const pushRef = makeFunctionReference<'mutation', { epoch: string; records: RecordWrite[] }, WriteResult>('sync:push')
const deleteRef = makeFunctionReference<'mutation', { confirmation: 'DELETE MY ACCOUNT' }, null>('sync:deleteAccount')
const exportInfoRef = makeFunctionReference<'query', Record<string, never>, { profile: unknown; legacySnapshot: unknown; storageBytes: number; historyBytes: number }>('sync:exportInfo')
const userRef = makeFunctionReference<'query', Record<string, never>, string>('sync:identity')
const labelRef = makeFunctionReference<'query', Record<string, never>, string>('sync:accountLabel')
const authConfigRef = makeFunctionReference<'query', Record<string, never>, CloudAuthConfiguration>('sync:authConfiguration')
const signInRef = makeFunctionReference<'action', { provider?: string; params?: Record<string, string>; refreshToken?: string; verifier?: string },
  { tokens?: { token: string; refreshToken: string } | null; started?: boolean; redirect?: string; verifier?: string }>('auth:signIn')
const signOutRef = makeFunctionReference<'action', Record<string, never>, null>('auth:signOut')
const tokensSchema = z.object({ token: z.string().min(1), refreshToken: z.string().min(1) })
const sessionSchema = z.object({ url: z.string(), userId: z.string(), accountLabel: z.string().optional(), tokens: tokensSchema })
type Session = z.infer<typeof sessionSchema>
const recordKindSchema = z.enum(['format', 'portfolio', 'ticker', 'holding', 'option', 'cash', 'debt', 'bill', 'card', 'chunk', 'article', 'preference'])
const recordValueSchema = z.object({ key: z.string().max(1000), kind: recordKindSchema, data: z.string().max(64_000).nullable() })
const checkpointSchema = z.object({ version: z.literal(2), account: z.string(), epoch: z.string().optional(), cursor: z.number().int().nonnegative(),
  initialized: z.boolean(), reviewRequired: z.boolean().optional(), reviewToken: z.string().optional(), baseline: z.record(z.string(), z.string().nullable()),
  remote: z.record(z.string(), recordValueSchema.extend({ revision: z.number().int().positive(), seq: z.number().int().positive(), updatedAt: z.number() })),
  pending: z.array(recordValueSchema.extend({ expectedRevision: z.number().int().nonnegative() })),
  conflicts: z.array(z.object({ key: z.string(), kind: recordKindSchema, local: z.string().nullable(), cloud: z.string().nullable(),
    revision: z.number().int().nonnegative(), token: z.string().regex(/^[a-f0-9]{64}$/), groupHash: z.string().optional() })),
  lastSyncedAt: z.number().optional(), cloudUpdatedAt: z.number().optional() })
const urlSchema = z.string().trim().transform(value => convexDeploymentUrl(value || defaultUrl))
const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('signInGitHub'), url: urlSchema }),
  z.object({ type: z.literal('cancelSignIn') }),
  // Recognize retired renderer commands only to return a clear upgrade message. Never send mail.
  z.object({ type: z.literal('sendCode') }),
  z.object({ type: z.literal('verifyCode') }),
  z.object({ type: z.literal('sync') }), z.object({ type: z.literal('disconnect') }),
  z.object({ type: z.literal('resolve'), use: z.enum(['local', 'cloud']), key: z.string().max(1000).optional(), token: z.string().max(64).optional() }),
  z.object({ type: z.literal('exportAccount') }),
  z.object({ type: z.literal('deleteAccount'), confirmation: z.literal('DELETE MY ACCOUNT') }),
])

const encryptionAvailable = () => safeStorage.isEncryptionAvailable() &&
  !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
const sessionPath = () => cloudDataPath('sync-session.bin')
const checkpointPath = () => cloudDataPath('sync-checkpoint.json')
const http = (url: string) => new ConvexHttpClient(url, { logger: false,
  fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12_000) }) })

let session: Session | undefined
let engine: CloudRecordEngine | undefined
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
let authProviders: { url: string; configuration: CloudAuthConfiguration } | undefined
async function readAuthConfiguration(url: string): Promise<CloudAuthConfiguration> {
  const configuration = requireCloudBackend(await http(url).query(authConfigRef, {}))
  authProviders = { url, configuration }
  return configuration
}

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
  login.setAuth(tokens.token)
  const userId = await login.query(userRef, {})
  const accountLabel = await login.query(labelRef, {})
  const next = { url, userId, accountLabel, tokens }
  await saveSession(next)
  await attach(next)
  authError = false
  message = undefined
}

async function authenticatedClient(forceRefresh = false) {
  if (!session || !client) throw new Error('Sign in first.')
  // Refresh tokens are serialized with every other sync operation and persisted before use.
  const expires = JSON.parse(Buffer.from(session.tokens.token.split('.')[1], 'base64url').toString()).exp as number
  if (forceRefresh || !Number.isFinite(expires) || expires * 1000 < Date.now() + 60_000) {
    const result = await http(session.url).action(signInRef, { refreshToken: session.tokens.refreshToken })
    if (!result.tokens) throw new Error('Session expired.')
    const next = { ...session, tokens: tokensSchema.parse(result.tokens) }
    const identityCheck = http(session.url)
    identityCheck.setAuth(next.tokens.token)
    if (await identityCheck.query(userRef, {}) !== session.userId) throw Error('Account changed during refresh. Sign in again to review local data.')
    await saveSession(next)
    session = next
  }
  client.setAuth(session.tokens.token)
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
  client = http(value.url)
  const account = `${value.url}|${value.userId}`
  let checkpoint = newRecordCheckpoint(account)
  try {
    const raw = JSON.parse(await readFile(checkpointPath(), 'utf8'))
    if (raw.account !== account) checkpoint.reviewRequired = true
    else if (raw.version === 2) checkpoint = checkpointSchema.parse(raw) as RecordCheckpoint
    else if (typeof raw.baseline === 'string') {
      // Migrate the old acknowledged baseline locally, preserving unsynced offline edits.
      await atomicSyncFile(cloudDataPath(`sync-backups/legacy-checkpoint-${Date.now()}-${randomUUID()}.json`), raw)
      await atomicSyncFile(cloudDataPath(`sync-backups/before-record-migration-${Date.now()}-${randomUUID()}.json`), JSON.parse(await withSavedDataLock(readSyncData)))
      checkpoint.baseline = Object.fromEntries(splitSnapshot(raw.baseline).map(row => [row.key, row.data]))
      checkpoint.initialized = true
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') message = 'The sync checkpoint could not be read. Copies will be compared before replacing data.'
  }
  engine = new CloudRecordEngine(checkpoint, {
    defaults: defaultSyncData,
    readLocal: () => withSavedDataLock(readLocalSyncData),
    applyIfUnchanged: (expected, payload, updatedAt) => withSavedDataLock(async () => {
      if (await readSyncData() !== expected) return false
      await applySyncData(payload, updatedAt, true)
      return true
    }),
    prepare: async () => (await authenticatedClient()).mutation(prepareRef, {}),
    migrate: async epoch => (await authenticatedClient()).mutation(migrateRef, { epoch }),
    changes: async (epoch, cursor) => (await authenticatedClient()).query(changesRef, { epoch, cursor }),
    push: async (epoch, records) => (await authenticatedClient()).mutation(pushRef, { epoch, records }),
    saveCheckpoint: checkpoint => atomicSyncFile(checkpointPath(), checkpoint),
    archive: value => atomicSyncFile(cloudDataPath(`sync-backups/sync-review-${Date.now()}-${randomUUID()}.json`), value),
    onFailure: () => diagnosticLog.write('warn', 'sync', 'record-sync-failed'),
    onFinished: (state, metrics) => diagnosticLog.write('debug', 'sync', 'record-sync-finished', { state, ...metrics }),
  })
  // The subscription is only a wake-up signal. Network work never blocks local startup or writes.
  subscription = new ConvexClient(value.url, { logger: false })
  subscription.setAuth(async ({ forceRefreshToken }) => {
    // Convex can request this independently; serialize token rotation with HTTP sync.
    return enqueue(async () => {
      try { await authenticatedClient(forceRefreshToken); return session?.tokens.token ?? null } catch { return null }
    })
  })
  subscription.onUpdate(watchRef, {}, () => schedule(), () => { /* HTTP retry reports failures in Settings. */ })
  schedule()
}

export function cloudSyncStatus(): CloudSyncStatus {
  return { url: session?.url ?? defaultUrl, configured: Boolean(defaultUrl), signedIn: Boolean(session), encryptionAvailable: encryptionAvailable(),
    authProviders: authProviders?.url === (session?.url ?? defaultUrl) ? authProviders.configuration : undefined,
    accountLabel: session?.accountLabel,
    state: engine?.state ?? (authError ? 'error' : 'disconnected'), pending: engine?.pending ?? false,
    signInPending: Boolean(pendingGitHub),
    localUpdatedAt: engine?.localUpdatedAt,
    cloudUpdatedAt: engine?.cloudUpdatedAt ?? engine?.checkpoint.cloudUpdatedAt,
    revision: engine?.cloudRevision ?? engine?.checkpoint.cursor,
    conflicts: engine?.checkpoint.conflicts.slice(0, 20),
    conflictCount: engine?.checkpoint.conflicts.length,
    reviewToken: engine?.checkpoint.reviewToken,
    pendingRecords: engine?.checkpoint.pending.length,
    metrics: engine ? { ...engine.metrics } : undefined,
    lastSyncedAt: engine?.checkpoint.lastSyncedAt, message: engine?.message ?? message }
}

export async function startCloudSync(): Promise<void> {
  closed = false
  if (defaultUrl) void readAuthConfiguration(defaultUrl).catch(() => { /* Sign-in reports connection/setup failures when attempted. */ })
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
      const stored = sessionSchema.parse(JSON.parse(safeStorage.decryptString(bytes)))
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
          isConfigured: async () => (await readAuthConfiguration(command.url)).githubConfigured,
          signIn: args => login.action(signInRef, args), openExternal: url => shell.openExternal(url),
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
      } else if (command.type === 'sendCode' || command.type === 'verifyCode') {
        message = 'Email-code sign-in has been removed. Restart Budget Terminal and use GitHub to connect to your existing account.'
        return failed(cloudSyncStatus(), message, 'cloud sync')
      } else if (command.type === 'exportAccount') {
        if (!session) throw Error('Sign in first.')
        const api = await authenticatedClient()
        const start = await api.mutation(prepareRef, {})
        if (!start.migrated) throw Error('Finish migration before export.')
        const records = new Map<string, RemoteRecord>()
        let cursor = 0
        for (let count = 0; count < 3000; count++) {
          const page = await api.query(changesRef, { epoch: start.epoch, cursor })
          page.records.forEach(row => records.set(row.key, row))
          cursor = page.cursor
          if (page.done) break
          if (count === 2999) throw Error('Cloud library exceeds the export limit.')
        }
        const end = await api.query(watchRef, {})
        if (!end || end.epoch !== start.epoch || end.seq !== start.seq) throw Error('Cloud library changed during export. Try again.')
        const target = await dialog.showSaveDialog({ title: 'Export cloud account data', defaultPath: 'budget-terminal-cloud-export.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
        if (!target.canceled && target.filePath) {
          const info = await api.query(exportInfoRef, {})
          await atomicSyncFile(target.filePath, { ...JSON.parse(joinSnapshot(records.values(), defaultSyncData())),
            app: 'budget-terminal-electron', exportedAt: new Date().toISOString(),
            cloud: { protocol: 2, records: [...records.values()], ...info } })
          message = 'Cloud account data exported. Keep this file private.'
        }
      } else if (command.type === 'disconnect' || command.type === 'deleteAccount') {
        if (command.type === 'deleteAccount') await (await authenticatedClient()).mutation(deleteRef, { confirmation: command.confirmation })
        pendingGitHub?.cancel()
        pendingGitHub = undefined
        // Remove local credentials first. Failed server revocation must never prevent disconnect.
        await rm(sessionPath(), { force: true })
        const previous = client
        if (previous && session) previous.setAuth(session.tokens.token)
        session = undefined
        engine = undefined
        client = undefined
        await subscription?.close()
        subscription = undefined
        try { await previous?.action(signOutRef, {}) } catch { /* Local session is already removed. */ }
        message = command.type === 'deleteAccount' ? 'Cloud account deletion started. Local files and recovery backups are retained. Other devices cannot upload to the deleted account.' : 'Disconnected. Local data and cloud data are retained. Connecting a different account requires a review.'
      } else {
        if (!engine) throw new Error('Sign in first.')
        await engine.sync(command.type === 'resolve' ? command.use : undefined, command.type === 'resolve' ? command.key : undefined,
          command.type === 'resolve' ? command.token : undefined)
      }
      const status = cloudSyncStatus()
      return status.state === 'error' ? failed(status, status.message ?? 'Sync failed.', 'cloud sync') : ok(status, 'cloud sync')
    } catch (error) {
      if (error instanceof GitHubSetupError || error instanceof CloudBackendUpgradeError) {
        authError = true
        message = error.message
        return failed(cloudSyncStatus(), message, 'cloud sync')
      }
      return failed(cloudSyncStatus(), 'Could not complete this request. Check your connection and try again, or contact the service operator if sign-in remains unavailable. Your local data is safe.', 'cloud sync')
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
