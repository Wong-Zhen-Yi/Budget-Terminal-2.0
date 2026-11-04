import { CHANNELS } from '../shared/contract.js'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { AsyncLocalStorage } from 'node:async_hooks'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export interface LogEntry {
  time: string
  session: string
  pid: number
  level: LogLevel
  area: string
  event: string
  details: Record<string, string | number | boolean>
}
const FILE = /^session-[\dT-]+-[a-f0-9-]+-\d+\.jsonl$/
const MAX_FILE = 4 * 1024 * 1024
const MAX_TOTAL = 64 * 1024 * 1024
const MAX_AGE = 15 * 86400_000

/** Classify arbitrary provider text without retaining it, its URLs, or user data. */
export function faultCode(error: unknown): string {
  const text = error instanceof Error ? `${error.name} ${error.message}` : typeof error === 'string' ? error : ''
  const codes: [RegExp, string][] = [
    [/ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find (?:module|package)/i, 'module-unavailable'],
    [/already (?:open|running|in use|using this data folder)|data.*lock|lock.*data/i, 'data-locked'],
    [/429|rate.?limit|too many requests/i, 'rate-limited'], [/timeout|timed out|deadline/i, 'timeout'],
    [/401|403|unauthori|forbidden|sign.?in/i, 'access-denied'], [/404|not found/i, 'not-found'],
    [/certificate|CERT_|TLS|SSL/i, 'certificate'], [/ENOSPC|disk full/i, 'disk-full'],
    [/EACCES|EPERM|permission/i, 'permission-denied'], [/SQLITE|database/i, 'database'],
    [/network|fetch failed|ECONN|ENOTFOUND|socket|offline/i, 'network'],
    [/5\d\d|service unavailable/i, 'provider-unavailable'], [/SyntaxError|JSON|parse/i, 'invalid-data'],
    [/abort|cancel/i, 'cancelled'], [/TypeError/i, 'type-error'], [/ReferenceError/i, 'reference-error'],
  ]
  return codes.find(([pattern]) => pattern.test(text))?.[1] ?? 'unknown'
}

export function diagnosticDirectory(): string {
  // Local diagnostic storage; never inside the repo.
  // Match configureDataPaths' LOCALAPPDATA fallback before it mutates the environment.
  const local = process.env.LOCALAPPDATA || (process.platform === 'win32'
    ? join(homedir(), 'AppData', 'Local') : join(homedir(), '.budget-terminal', 'cache'))
  return join(local, 'BudgetTerminal', 'logs')
}

export class DiagnosticLog {
  readonly session = randomUUID()
  private file = ''
  private bytes = 0
  private part = 0
  private readonly stamp = new Date().toISOString().replace(/[:.Z]/g, '-')
  private failure = ''
  private dropped = 0
  private droppedDebug = 0
  private droppedImportant = 0
  private tokens = 200
  private importantTokens = 200
  private refill = Date.now()

  constructor(readonly directory: string, private readonly maxFile = MAX_FILE, private readonly maxTotal = MAX_TOTAL) {}

  status() { return { failure: this.failure, dropped: this.dropped, droppedDebug: this.droppedDebug, droppedImportant: this.droppedImportant } }

  /** Call sites supply fixed event names and explicitly selected technical metadata only. */
  write(level: LogLevel, area: string, event: string, details: LogEntry['details'] = {}): void {
    const now = Date.now()
    this.tokens = Math.min(200, this.tokens + (now - this.refill) / 10)
    this.importantTokens = Math.min(200, this.importantTokens + (now - this.refill) / 10)
    this.refill = now
    // Debug floods cannot consume the reserved budget for completions, failures,
    // lifecycle events and page transitions. Both lanes remain bounded.
    const important = level !== 'debug'
    if ((important ? this.importantTokens : this.tokens) < 1) {
      this.dropped++
      if (important) this.droppedImportant++
      else this.droppedDebug++
      return
    }
    if (important) this.importantTokens--
    else this.tokens--
    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 })
      const line = JSON.stringify({ time: new Date(now).toISOString(), session: this.session, pid: process.pid,
        level, area, event, details: { ...details, ...(this.dropped ? {
          dropped: this.dropped, droppedDebug: this.droppedDebug, droppedImportant: this.droppedImportant,
        } : {}) } } satisfies LogEntry) + '\n'
      if (!this.file || this.bytes + Buffer.byteLength(line) > this.maxFile) {
        this.file = join(this.directory, `session-${this.stamp}-${this.session}-${this.part++}.jsonl`)
        this.bytes = 0
        this.prune()
      }
      appendFileSync(this.file, line, { mode: 0o600 })
      this.bytes += Buffer.byteLength(line)
      this.failure = ''
    } catch { this.failure = 'Log storage is unavailable. Check disk space and folder permissions.' }
  }

  private prune(): void {
    const files = readdirSync(this.directory).filter(name => FILE.test(name)).map(name => {
      const path = join(this.directory, name)
      return { path, ...statSync(path) }
    }).sort((a, b) => b.mtimeMs - a.mtimeMs)
    let total = this.maxFile
    for (const file of files) {
      total += file.size
      if (file.path !== this.file && (total > this.maxTotal || Date.now() - file.mtimeMs > MAX_AGE)) {
        unlinkSync(file.path)
        total -= file.size
      }
    }
  }
}

export const diagnosticLog = new DiagnosticLog(diagnosticDirectory())

/** Bounded snapshot. Ignore partial trailing writes and tolerate rotation during a read. */
export function readDiagnosticLogs(directory: string): { entries: LogEntry[]; bytes: number; files: number } {
  if (!existsSync(directory)) return { entries: [], bytes: 0, files: 0 }
  const files = readdirSync(directory).filter(name => FILE.test(name)).sort().reverse()
  const entries: LogEntry[] = []
  let bytes = 0
  for (const name of files) {
    if (entries.length >= 5000 || bytes >= 12 * 1024 * 1024) break
    try {
      const path = join(directory, name)
      const size = statSync(path).size
      if (size > MAX_FILE + 65536) continue
      const content = readFileSync(path, 'utf8')
      bytes += size
      const lines = content.split('\n').slice(0, -1).reverse()
      for (const line of lines) {
        if (entries.length >= 5000) break
        try {
          const entry = JSON.parse(line) as LogEntry
          if (entry && typeof entry.time === 'string' && typeof entry.event === 'string' &&
            typeof entry.session === 'string' && ['debug', 'info', 'warn', 'error'].includes(entry.level) &&
            typeof entry.area === 'string' && entry.details && typeof entry.details === 'object') entries.push(entry)
        } catch { /* A damaged record must not hide other records. */ }
      }
    } catch { /* The writer may have rotated this file. */ }
  }
  entries.sort((a, b) => b.time.localeCompare(a.time))
  return { entries, bytes, files: files.length }
}

let requestId = 0
export const diagnosticRequestContext = new AsyncLocalStorage<number>()
const channels = new Set<string>(Object.values(CHANNELS))
/** Observe both renderer and MCP service reads without recording arguments or payloads. */
export async function diagnosticRequest<T>(channel: string, run: () => T | Promise<T>): Promise<T> {
  const id = ++requestId
  const started = performance.now()
  const operation = channels.has(channel) ? channel : 'unknown'
  diagnosticLog.write('debug', 'service', 'request-start', { id, operation })
  const slow = setTimeout(() => diagnosticLog.write('warn', 'service', 'request-still-running', { id, operation, durationMs: Math.round(performance.now() - started) }), 30_000)
  slow.unref()
  try {
    const result = await diagnosticRequestContext.run(id, run)
    const envelope = result as { meta?: { freshness?: unknown; failureReason?: unknown }; errors?: unknown[] } | null
    const freshness = typeof envelope?.meta?.freshness === 'string' && ['fresh', 'cached', 'stale', 'partial', 'failed'].includes(envelope.meta.freshness) ? envelope.meta.freshness : 'complete'
    const codes = Array.isArray(envelope?.errors) ? [...new Set(envelope.errors.slice(0, 20).map(error => faultCode((error as { reason?: unknown })?.reason)))].join(',') : ''
    diagnosticLog.write(freshness === 'failed' ? 'error' : ['partial', 'stale'].includes(freshness) ? 'warn' : 'info', 'service', 'request-complete', {
      id, operation, durationMs: Math.round(performance.now() - started), freshness, errors: envelope?.errors?.length ?? 0,
      ...(codes ? { codes } : {}), ...(freshness === 'failed' ? { code: faultCode(envelope?.meta?.failureReason) } : {}),
    })
    return result
  } catch (error) {
    diagnosticLog.write('error', 'service', 'request-failed', { id, operation, durationMs: Math.round(performance.now() - started), code: faultCode(error) })
    throw error
  } finally {
    clearTimeout(slow)
  }
}
