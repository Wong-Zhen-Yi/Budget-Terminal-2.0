import { mkdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Both hosts must resolve the same data directory before opening any stores. */
export function configureDataPaths(): void {
  process.env.APPDATA ??= process.platform === 'win32'
    ? join(homedir(), 'AppData', 'Roaming') : join(homedir(), '.budget-terminal', 'data')
  process.env.LOCALAPPDATA ??= process.platform === 'win32'
    ? join(homedir(), 'AppData', 'Local') : join(homedir(), '.budget-terminal', 'cache')
}

/**
 * Hold an OS-managed exclusive lock for the lifetime of a host. SQLite releases the
 * lock even after a crash; never delete this file, which could bypass another owner.
 * The database contains no user data. JSON remains the application storage format.
 */
export function acquireDataSession(): () => void {
  configureDataPaths()
  const directory = join(process.env.APPDATA!, 'BudgetTerminalElectron')
  mkdirSync(directory, { recursive: true })
  const database = new DatabaseSync(join(realpathSync(directory), '.session-lock.sqlite'))
  try {
    database.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE')
  } catch (error) {
    database.close()
    if (/locked|busy/i.test(error instanceof Error ? error.message : String(error))) {
      throw new Error('Budget Terminal is already using this data folder. Close the other desktop app or stop its browser server, then launch again.')
    }
    throw error
  }
  let closed = false
  return () => {
    if (closed) return
    closed = true
    try { database.exec('ROLLBACK') } finally { database.close() }
  }
}
