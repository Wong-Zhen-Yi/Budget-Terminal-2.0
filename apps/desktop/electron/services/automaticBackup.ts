import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import type { AutomaticBackupStatus, Envelope } from '../shared/contract.js'
import { describeError, err, partial } from '../shared/envelope.js'
import { exportUserData } from './portfolioStore.js'
import { exportSettings } from './settingsStore.js'
import { exportCards } from './cardsStore.js'

export const AUTOMATIC_BACKUP_FILENAME = 'budget-terminal-backup.json'

let downloads: string | undefined
let status: AutomaticBackupStatus | undefined
let queue: Promise<void> = Promise.resolve()
let pending = 0

/** The desktop supplies its actual Downloads folder; standalone probes opt in explicitly. */
export function configureAutomaticBackup(directory: string): void {
  downloads = directory
  status = { path: join(directory, AUTOMATIC_BACKUP_FILENAME) }
}

export function automaticBackupStatus(): AutomaticBackupStatus | undefined {
  return status ? { ...status } : undefined
}

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  pending += 1
  const task = queue.then(run)
  queue = task.then(() => {}, () => {}).finally(() => { pending -= 1 })
  return task
}

async function writeSnapshot(target: string): Promise<void> {
  const directory = dirname(target)
  const temporary = join(directory, `.${basename(target)}.${process.pid}.tmp`)
  try {
    const bundle = {
      app: 'budget-terminal-electron',
      version: 1,
      exportedAt: new Date().toISOString(),
      userData: await exportUserData(),
      settings: await exportSettings(),
      cards: await exportCards(),
    }
    await mkdir(directory, { recursive: true })
    await writeFile(temporary, JSON.stringify(bundle, null, 2), 'utf8')
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}

async function save(): Promise<void> {
  if (!status) return
  try {
    await writeSnapshot(status.path)
    status = { path: status.path, savedAt: Date.now() }
  } catch (error) {
    status = { ...status, error: describeError(error) }
    throw error
  }
}

/** Manual exports share the queue so they cannot overwrite a newer automatic snapshot. */
export function writeUserDataBackup(target: string): Promise<void> {
  return enqueue(() => target === status?.path ? save() : writeSnapshot(target))
}

export function writeAutomaticBackup(): Promise<void> {
  return enqueue(save)
}

/** Preserve the last backup on launch, including when a local store has gone missing. */
export function initializeAutomaticBackup(): Promise<void> {
  return enqueue(async () => {
    if (!status) return
    try {
      const existing = JSON.parse(await readFile(status.path, 'utf8')) as { app?: string; version?: number; userData?: unknown }
      if (existing.app !== 'budget-terminal-electron' || existing.version !== 1 || !existing.userData) {
        throw new Error('The existing automatic backup is not a valid Budget Terminal backup.')
      }
      status = { path: status.path, savedAt: (await stat(status.path)).mtimeMs }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        await save()
      } else {
        status = { ...status, error: describeError(error) }
        throw error
      }
    }
  })
}

/** Serialize edits and their complete snapshots, including multi-store import and clear. */
export function withAutomaticBackup<T>(run: () => Promise<Envelope<T>>): Promise<Envelope<T>> {
  if (!downloads) return run()
  return enqueue(async () => {
    const result = await run()
    if (result.errors.length) return result
    try {
      await save()
      return result
    } catch (error) {
      const reason = `Saved locally, but the automatic backup could not be updated: ${describeError(error)}`
      return partial(result.data, [err('automatic backup', reason, 'backup')], result.meta.source, reason)
    }
  })
}

export function automaticBackupPending(): boolean {
  return pending > 0
}

export async function flushAutomaticBackup(): Promise<void> {
  let current: Promise<void>
  do {
    current = queue
    await current
  } while (current !== queue)
}
