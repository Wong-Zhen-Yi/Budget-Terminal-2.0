import { BrowserWindow, safeStorage } from 'electron'
import { createClient } from '@supabase/supabase-js'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { CHANNELS } from '../shared/contract.js'
import type { Envelope } from '../shared/contract.js'
import type { SyncAction, SyncDataset, SyncStatus } from '../shared/sync.js'
import { SYNC_DATASETS } from '../shared/sync.js'
import { failed, ok } from '../shared/envelope.js'
import { applySyncBook, readSyncBook, storePath, syncFinanceSchema, syncPortfolioSchema } from './portfolioStore.js'
import { applySyncCards, exportCards, syncCardsSchema } from './cardsStore.js'
import { SyncEngine } from './syncEngine.js'
import type { CloudDocument, SyncCheckpoint } from './syncEngine.js'

// Publishable keys identify the app. User authentication and RLS protect records.
const URL = 'https://rclwztheheenuyisyswy.supabase.co'
const KEY = 'sb_publishable_tCEoTvqqaSxLrYatnDdriw_rdb6c6fC'
const directory = () => dirname(storePath())
const sessionPath = () => join(directory(), 'sync-session.bin')
const checkpointPath = () => join(directory(), 'sync-checkpoint.json')
const schemas = { portfolio: syncPortfolioSchema, personalFinance: syncFinanceSchema, cards: syncCardsSchema }
const rowSchema = z.object({
  dataset: z.enum(SYNC_DATASETS), payload: z.unknown(), revision: z.number().int().positive(),
  updated_at: z.string(), schema_version: z.literal(1),
})

async function atomicWrite(path: string, value: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, value)
  await rename(temporary, path)
}

function requireEncryption(): void {
  if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
    throw new Error('Secure credential storage is unavailable. Enable your operating system credential store before signing in.')
  }
}

const client = createClient(URL, KEY, {
  auth: {
    detectSessionInUrl: false,
    storage: {
      async getItem() {
        try {
          const bytes = await readFile(sessionPath())
          requireEncryption()
          return safeStorage.decryptString(bytes)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw new Error('Saved sign-in could not be unlocked. Your local data is intact.')
        }
      },
      async setItem(_key, value) {
        requireEncryption()
        await atomicWrite(sessionPath(), safeStorage.encryptString(value))
      },
      async removeItem() { await rm(sessionPath(), { force: true }) },
    },
  },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) },
})

let status: SyncStatus = { email: null, state: 'signedOut', pending: [], conflicts: [] }
let checkpoint: SyncCheckpoint | undefined
let engine: SyncEngine | undefined
let queue = Promise.resolve()
let backgroundPending = false
let stopRequested = false
let failures = 0
let nextAttempt = 0
let initializationError: string | undefined

function notify(): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(CHANNELS.syncChanged, status)
}

function serial<T>(run: () => Promise<T>): Promise<T> {
  const task = queue.then(run)
  queue = task.then(() => {}, () => {})
  return task
}

function validateRow(value: unknown): CloudDocument {
  const row = rowSchema.parse(value)
  return { ...row, payload: schemas[row.dataset].parse(row.payload) }
}

async function clearSession(): Promise<void> {
  // Supabase attempts token revocation even for a local sign-out. Losing the
  // connection must not prevent clearing credentials and stopping local sync.
  await client.auth.signOut({ scope: 'local' }).catch(() => {})
  await rm(sessionPath(), { force: true })
  client.auth.stopAutoRefresh()
}

async function save(value: SyncCheckpoint): Promise<void> {
  await atomicWrite(checkpointPath(), JSON.stringify(value, null, 2))
}

async function connect(): Promise<boolean> {
  const { data, error } = await client.auth.getSession()
  if (error) throw error
  if (!data.session) {
    status.email = null
    status.state = 'signedOut'
    return false
  }
  const user = data.session.user
  if (checkpoint && checkpoint.owner !== user.id) {
    await clearSession()
    status.email = null
    throw new Error('This PC’s saved data belongs to another sync account. Sign in with the original account to keep data separate.')
  }
  status.email = user.email ?? 'Signed in'
  if (!checkpoint) {
    checkpoint = { owner: user.id, bases: {} }
    await save(checkpoint)
  }
  if (!engine) engine = new SyncEngine(checkpoint, {
    read: (dataset) => dataset === 'cards' ? exportCards() : readSyncBook(dataset),
    async apply(dataset, payload, expected) {
      if (dataset === 'cards') await applySyncCards(payload, expected)
      else await applySyncBook(dataset, payload, expected)
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(CHANNELS.savedDataChanged, { domains: [dataset] })
      }
    },
    async fetch() {
      const { data, error } = await client.from('budget_terminal_sync').select('*').eq('user_id', user.id)
      if (error) throw error
      return (data ?? []).map(validateRow)
    },
    async push(dataset, payload, revision) {
      const { data, error } = await client.rpc('budget_terminal_sync_write', {
        p_dataset: dataset, p_payload: schemas[dataset].parse(payload), p_revision: revision,
      })
      if (error) throw error
      if (!Array.isArray(data) || data.length !== 1) throw new Error('The server did not acknowledge this edit. It remains pending locally.')
      return validateRow(data[0])
    },
    save,
  })
  return true
}

async function sync(resolution?: { dataset: SyncDataset; choice: 'local' | 'cloud'; token: string }): Promise<void> {
  if (!await connect()) { notify(); return }
  status.state = 'syncing'
  status.message = undefined
  notify()
  try {
    await engine!.run(resolution)
    failures = 0
    nextAttempt = 0
    status = {
      email: status.email,
      state: engine!.conflicts.length ? 'conflict' : 'ready',
      conflicts: engine!.conflicts, pending: engine!.pending,
      lastSyncedAt: checkpoint?.lastSyncedAt,
    }
  } finally {
    if (engine) {
      await engine.inspect()
      status.pending = engine.pending
      status.conflicts = engine.conflicts
    }
    notify()
  }
}

function report(error: unknown): Envelope<SyncStatus> {
  status.state = 'error'
  status.message = error instanceof Error ? error.message : 'Cloud sync failed. Your edits remain saved on this PC.'
  status.lastSyncedAt = checkpoint?.lastSyncedAt
  failures += 1
  nextAttempt = Date.now() + Math.min(300_000, 30_000 * 2 ** Math.min(failures - 1, 4))
  notify()
  return failed(structuredClone(status), status.message, 'personal sync')
}

export function syncStatus(): Envelope<SyncStatus> { return ok(structuredClone(status), 'personal sync') }

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('signIn'), email: z.email().max(320), password: z.string().min(1).max(1024) }).strict(),
  z.object({ type: z.literal('signUp'), email: z.email().max(320), password: z.string().min(8).max(1024) }).strict(),
  z.object({ type: z.literal('confirmEmail'), email: z.email().max(320), code: z.string().regex(/^\d{6,8}$/) }).strict(),
  z.object({ type: z.enum(['signOut', 'sync']) }).strict(),
  z.object({ type: z.literal('resolve'), dataset: z.enum(SYNC_DATASETS), choice: z.enum(['local', 'cloud']), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
])

export function syncAction(request: SyncAction): Promise<Envelope<SyncStatus>> {
  return serial(async () => {
    try {
      const action = actionSchema.parse(request)
      if (initializationError) throw new Error(initializationError)
      if (action.type === 'signOut') {
        await clearSession()
        engine = undefined
        status = { email: null, state: 'signedOut', pending: [], conflicts: [], lastSyncedAt: checkpoint?.lastSyncedAt }
        notify()
        return syncStatus()
      }
      if (action.type === 'signIn' || action.type === 'signUp' || action.type === 'confirmEmail') {
        requireEncryption()
        const result = action.type === 'signIn' ? await client.auth.signInWithPassword({ email: action.email, password: action.password })
          : action.type === 'signUp' ? await client.auth.signUp({ email: action.email, password: action.password })
          : await client.auth.verifyOtp({ email: action.email, token: action.code, type: 'signup' })
        if (result.error) throw result.error
        if (!result.data.session) {
          status.message = 'Check your email. Confirm using the email link or enter the confirmation code here, then sign in.'
          notify()
          return syncStatus()
        }
      }
      await sync(action.type === 'resolve' ? action : undefined)
      return syncStatus()
    } catch (error) { return report(error) }
  })
}

function background(force = false): void {
  if (stopRequested || backgroundPending) return
  backgroundPending = true
  void serial(async () => {
    try {
      if (engine) {
        await engine.inspect()
        status.pending = engine.pending
        notify()
      }
      if (force || Date.now() >= nextAttempt) await sync()
    } catch (error) { report(error) }
  }).finally(() => { backgroundPending = false })
}

export async function startPersonalSync(): Promise<() => void> {
  try {
    const parsed = z.object({
      owner: z.string().uuid(), bases: z.record(z.enum(SYNC_DATASETS), z.unknown()), lastSyncedAt: z.string().optional(),
    }).strict().parse(JSON.parse(await readFile(checkpointPath(), 'utf8')))
    checkpoint = { owner: parsed.owner, bases: {}, lastSyncedAt: parsed.lastSyncedAt }
    for (const dataset of SYNC_DATASETS) {
      if (parsed.bases[dataset]) {
        const row = validateRow({ ...(parsed.bases[dataset] as object), schema_version: 1 })
        if (row.dataset !== dataset) throw new Error('Invalid sync checkpoint')
        checkpoint.bases[dataset] = row
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      initializationError = 'Sync checkpoint is unreadable. Restore it from a backup before syncing; local data has been retained.'
      report(new Error(initializationError))
      return () => {}
    }
  }
  await mkdir(directory(), { recursive: true })
  let debounce: ReturnType<typeof setTimeout> | undefined
  let watcher: FSWatcher | undefined
  try {
    watcher = watch(directory(), (_event, filename) => {
      if (!['portfolio.json', 'strategies.json'].includes(String(filename))) return
      clearTimeout(debounce)
      debounce = setTimeout(() => background(), 750)
    })
    watcher.on('error', () => watcher?.close())
  } catch { /* Periodic inspection still recovers every saved edit. */ }
  const timer = setInterval(() => background(), 30_000)
  const focused = () => background(true)
  const resumed = () => background(true)
  // Network reconnects are discovered by periodic retry; focus provides an immediate retry.
  const { app, powerMonitor } = await import('electron')
  app.on('browser-window-focus', focused)
  powerMonitor.on('resume', resumed)
  background(true)
  return () => {
    stopRequested = true
    clearInterval(timer)
    clearTimeout(debounce)
    watcher?.close()
    app.removeListener('browser-window-focus', focused)
    powerMonitor.removeListener('resume', resumed)
    client.auth.stopAutoRefresh()
  }
}
