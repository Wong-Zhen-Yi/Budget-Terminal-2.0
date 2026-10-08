import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { EconomicPoint, Envelope } from '../shared/contract.js'
import { MONEY_SERIES, moneyWindow, normalizeMoney } from '../shared/money.js'
import type { MoneyPayload, MoneyRequest, MoneySeries } from '../shared/money.js'
import { describeError, meta } from '../shared/envelope.js'
import { fetchSeriesCsv } from './fred.js'

const FRESH_MS = 6 * 60 * 60_000
const STALE_MS = 7 * 24 * 60 * 60_000
const cachePath = () => join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'), 'BudgetTerminalElectron', 'money-cache', 'payload.json')
type Download = (id: string, startDate?: string) => Promise<EconomicPoint[]>

function mergeHistory(existing: EconomicPoint[], incoming: EconomicPoint[]): EconomicPoint[] {
  return [...new Map([...existing, ...incoming]).entries()].sort(([left], [right]) => left.localeCompare(right))
}

async function readCache(): Promise<MoneySeries[]> {
  try {
    const document = JSON.parse(await readFile(cachePath(), 'utf8'))
    if (document.version !== 1 || !Array.isArray(document.rows)) return []
    return document.rows.filter((row: MoneySeries) => Number.isFinite(row.fetchedAt) && Array.isArray(row.history)
      && row.history.every((point) => Array.isArray(point) && /^\d{4}-\d{2}-\d{2}$/.test(point[0]) && Number.isFinite(point[1])))
  } catch { return [] }
}

export async function clearMoneyCache(): Promise<void> {
  await rm(cachePath(), { force: true })
}

/** Injectable clock and download keep persistence/failure probes isolated and deterministic. */
export async function loadMoney(
  request: MoneyRequest = {},
  download: Download = (id, startDate) => fetchSeriesCsv(id, 15_000, startDate),
  now = Date.now(),
): Promise<Envelope<MoneyPayload>> {
  const cached = await readCache()
  const rows = await Promise.all(MONEY_SERIES.map(async (definition): Promise<MoneySeries> => {
    const prior = cached.find((row) => row.seriesId === definition.seriesId && row.history.length && row.fetchedAt !== null && row.fetchedAt <= now && now - row.fetchedAt <= STALE_MS)
    if (!request.force && !prior?.error && prior?.fetchedAt != null && now - prior.fetchedAt <= FRESH_MS) {
      return { ...prior, ...definition, status: 'cached', error: null }
    }
    try {
      // Re-fetch three observations so revised releases replace their cached values.
      const overlapDate = !request.force && prior?.history.length
        ? prior.history[Math.max(0, prior.history.length - 3)][0]
        : undefined
      const downloaded = await download(definition.seriesId, overlapDate)
      const normalized = normalizeMoney(downloaded, definition.sourceUnits)
      const history = moneyWindow(mergeHistory(prior?.history ?? [], normalized), 11)
      if (!history.length) throw new Error('No observations returned')
      return { ...definition, history, fetchedAt: now, status: 'fresh', error: null }
    } catch (error) {
      return { ...definition, history: prior?.history ?? [], fetchedAt: prior?.fetchedAt ?? null, status: prior ? 'stale' : 'unavailable', error: describeError(error) }
    }
  }))
  const target = cachePath()
  const temporary = `${target}.${process.pid}.${now}.tmp`
  try {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(temporary, JSON.stringify({ version: 1, rows }), 'utf8')
    await rename(temporary, target)
  } catch { await rm(temporary, { force: true }).catch(() => {}) }
  const errors = rows.filter((row) => row.error).map((row) => ({ source: 'FRED', operation: 'money', symbol: row.seriesId, reason: row.error! }))
  const available = rows.some((row) => row.history.length)
  const freshness = !available ? 'failed' : errors.length ? 'partial' : rows.every((row) => row.status === 'cached') ? 'cached' : 'fresh'
  const collected = rows.flatMap(row => row.history.length && row.fetchedAt !== null ? [row.fetchedAt] : [])
  const observations = rows.flatMap(row => row.history.length ? [Date.parse(row.history.at(-1)![0])] : [])
  const fetchedAt = collected.length ? Math.min(...collected) : now
  return { data: { generatedAt: new Date(now).toISOString(), rows }, meta: meta('FRED · Federal Reserve', freshness, {
    fetchedAt, cacheAgeSeconds: Math.max(0, now - fetchedAt) / 1000,
    ...(collected.length ? { expiresAt: fetchedAt + FRESH_MS } : {}),
    ...(observations.length ? { asOf: Math.min(...observations) } : {}),
    ...(errors.length ? { failureReason: errors.map((error) => `${error.symbol}: ${error.reason}`).join('; ') } : {}),
  }), errors }
}

let pending: Promise<Envelope<MoneyPayload>> | null = null
export function getMoney(request: MoneyRequest = {}): Promise<Envelope<MoneyPayload>> {
  if (pending) return pending
  pending = loadMoney(request).finally(() => { pending = null })
  return pending
}
