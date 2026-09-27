import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Resolve the data directory before opening any stores. */
export function configureDataPaths(): void {
  process.env.APPDATA ??= process.platform === 'win32'
    ? join(homedir(), 'AppData', 'Roaming') : join(homedir(), '.budget-terminal', 'data')
  process.env.LOCALAPPDATA ??= process.platform === 'win32'
    ? join(homedir(), 'AppData', 'Local') : join(homedir(), '.budget-terminal', 'cache')
}

type StoredBook = {
  order: string[]
  portfolios: Record<string, {
    id: string
    name: string
    tickers: string[]
    holdings: Record<string, unknown>
    cashBalance: number
    marginDebt: number
    options: unknown[]
  }>
  personalFinance?: unknown
}

function book(raw: string): StoredBook | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const entry = value as Partial<StoredBook>
    if (!Array.isArray(entry.order) || !entry.portfolios || typeof entry.portfolios !== 'object') return null
    if (!entry.order.every((id) => {
      const portfolio = entry.portfolios?.[id]
      return typeof id === 'string' && portfolio?.id === id &&
        typeof portfolio.name === 'string' && Array.isArray(portfolio.tickers) &&
        portfolio.holdings && typeof portfolio.holdings === 'object' &&
        typeof portfolio.cashBalance === 'number' && typeof portfolio.marginDebt === 'number' &&
        Array.isArray(portfolio.options)
    })) return null
    return entry as StoredBook
  } catch {
    return null
  }
}

function hasPositions(document: StoredBook): boolean {
  return document.order.some((id) => document.portfolios[id]?.tickers.length > 0)
}

function isEmptySeed(document: StoredBook): boolean {
  if (document.order.length !== 1 || document.order[0] !== 'portfolio_1') return false
  const portfolio = document.portfolios.portfolio_1
  return portfolio.name === 'Portfolio 1' && portfolio.tickers.length === 0 &&
    Object.keys(portfolio.holdings).length === 0 && portfolio.options.length === 0 &&
    portfolio.cashBalance === 0 && portfolio.marginDebt === 0
}

/** Recover the source checkout's old data folder once, without replacing a populated book. */
function recoverLegacyPortfolio(directory: string, legacyAppPath: string): void {
  const marker = join(directory, '.legacy-portfolio-checked')
  if (existsSync(marker)) return
  const legacyPath = join(legacyAppPath, 'AppData', 'Roaming', 'BudgetTerminalElectron', 'portfolio.json')
  if (!existsSync(legacyPath)) return
  const legacyRaw = readFileSync(legacyPath, 'utf8')
  const legacy = book(legacyRaw)
  if (!legacy || !hasPositions(legacy)) return
  const target = join(directory, 'portfolio.json')
  const currentRaw = existsSync(target) ? readFileSync(target, 'utf8') : null
  const current = currentRaw === null ? null : book(currentRaw)
  if (currentRaw !== null && !current) return // Preserve a damaged file for manual recovery.
  if (!current || isEmptySeed(current)) {
    const recovered = current?.personalFinance === undefined
      ? legacyRaw
      : JSON.stringify({ ...legacy, personalFinance: current.personalFinance }, null, 2)
    if (currentRaw !== null) copyFileSync(target, `${target}.before-legacy-recovery`)
    const temporary = `${target}.${process.pid}.migration.tmp`
    writeFileSync(temporary, recovered, 'utf8')
    renameSync(temporary, target)
  }
  writeFileSync(marker, '', { flag: 'wx' })
}

/**
 * Hold an OS-managed exclusive lock for the lifetime of a host. SQLite releases the
 * lock even after a crash; never delete this file, which could bypass another owner.
 * The database contains no user data. JSON remains the application storage format.
 */
export function acquireDataSession(legacyAppPath?: string): () => void {
  configureDataPaths()
  const directory = join(process.env.APPDATA!, 'BudgetTerminalElectron')
  mkdirSync(directory, { recursive: true })
  const database = new DatabaseSync(join(realpathSync(directory), '.session-lock.sqlite'))
  try {
    database.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE')
  } catch (error) {
    database.close()
    if (/locked|busy/i.test(error instanceof Error ? error.message : String(error))) {
      throw new Error('Budget Terminal is already using this data folder. Close the other desktop app, then launch again.')
    }
    throw error
  }
  try {
    if (legacyAppPath) recoverLegacyPortfolio(directory, legacyAppPath)
  } catch (error) {
    database.exec('ROLLBACK')
    database.close()
    throw error
  }
  let closed = false
  return () => {
    if (closed) return
    closed = true
    try { database.exec('ROLLBACK') } finally { database.close() }
  }
}
