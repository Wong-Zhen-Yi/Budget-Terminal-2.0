import { gicsSectorFor, normalizeSectorName, normalizeSectorSymbol, sectorFor, toGicsSector, UNCLASSIFIED_SECTOR } from '../shared/sectors.js'
import { cache } from './cache.js'
import { paced, yahoo } from './yahoo/client.js'

const SECTOR_TTL_MS = 7 * 24 * 60 * 60_000

export interface SectorProfile {
  sector?: string
  quoteType?: string
}

export function sectorFromProfile(profile: SectorProfile): string {
  const sector = normalizeSectorName(profile.sector)
  if (sector) return sector
  switch (profile.quoteType?.toUpperCase()) {
    case 'ETF':
    case 'MUTUALFUND': return 'Funds'
    case 'CRYPTOCURRENCY': return 'Crypto'
    case 'INDEX': return 'Indices'
    case 'CURRENCY': return 'Currencies'
    case 'FUTURE': return 'Commodities'
    default: return ''
  }
}

async function loadProfile(symbol: string): Promise<SectorProfile> {
  const summary = await paced(() => yahoo.quoteSummary(symbol, { modules: ['assetProfile', 'price'] }))
  return { sector: summary.assetProfile?.sector, quoteType: summary.price?.quoteType }
}

async function cachedProfileSector(symbol: string): Promise<string> {
  const key = `holding-sector:v1:${symbol}`
  if (cache.get<boolean>(`${key}:missing`)) return cache.get<string>(key, { allowStale: true })?.value ?? ''
  const result = await cache.resolveWithStaleFallback(key, SECTOR_TTL_MS, async () => {
    const sector = sectorFromProfile(await loadProfile(symbol))
    // An unresolved symbol gets a short negative cache, not a week-long success.
    if (!sector) {
      cache.set(`${key}:missing`, true, 60 * 60_000)
      throw new Error(`No sector or instrument classification published for ${symbol}.`)
    }
    return sector
  })
  return result.value
}

const GICS_SECTORS = new Set(['Information Technology', 'Health Care', 'Financials',
  'Consumer Discretionary', 'Consumer Staples', 'Communication Services', 'Industrials',
  'Energy', 'Utilities', 'Real Estate', 'Materials'])

/** Only unresolved index constituents need metadata; never apply portfolio themes here. */
export async function getIndexSectors(symbols: string[], profileSector = cachedProfileSector): Promise<Record<string, string>> {
  const unique = [...new Set(symbols.map(symbol => symbol.trim().toUpperCase()).filter(Boolean))]
  const entries = await Promise.all(unique.map(async symbol => {
    let sector = gicsSectorFor(symbol)
    if (!sector) {
      try { sector = toGicsSector(await profileSector(normalizeSectorSymbol(symbol))) }
      catch { /* Keep unknowns explicit without losing prices or other sectors. */ }
    }
    return [symbol, GICS_SECTORS.has(sector) ? sector : ''] as const
  }))
  return Object.fromEntries(entries)
}

/**
 * Run as part of the existing holdings quote load (including startup warming). Most
 * symbols resolve offline. Only unknowns need a paced profile lookup, coalesced and
 * persisted independently of fast-changing quotes. Never send a universe-wide sweep.
 */
export async function getHoldingSectors(symbols: string[], profileSector = cachedProfileSector): Promise<{
  sectors: Record<string, string>
  missing: string[]
}> {
  const unique = [...new Set(symbols.map(symbol => symbol.trim().toUpperCase()).filter(Boolean))]
  const entries = await Promise.all(unique.map(async symbol => {
    let sector = sectorFor(symbol)
    if (sector === UNCLASSIFIED_SECTOR) {
      try { sector = sectorFor(symbol, await profileSector(normalizeSectorSymbol(symbol))) }
      catch { /* Quotes remain usable; unresolved classification stays visible. */ }
    }
    return [symbol, sector] as const
  }))
  return {
    sectors: Object.fromEntries(entries),
    missing: entries.filter(([, sector]) => sector === UNCLASSIFIED_SECTOR).map(([symbol]) => symbol),
  }
}
