/**
 * GICS sectors for the S&P 500 constituents, scraped from Wikipedia.
 *
 * A port of `_load_sp500_sector_map`. It exists because the issuer files are unreliable
 * about sectors: SSGA publishes a literal `-` in DIA's Sector column, and Invesco's QQQ
 * feed omits `sectorName` entirely — without this the whole map collapses into one
 * "Unclassified" box and the page's only structure is gone.
 *
 * One documented departure from `EtfHeatmapWorker.fetch`, which consults this map for
 * SPY alone: it is applied to all three ETFs here. The reference leaves QQQ and DIA
 * grouped under a single Unclassified rectangle, which is a treemap with nothing to say;
 * the map is fetched once a day either way, and the Nasdaq-100 and Dow constituents are
 * almost entirely S&P 500 members, so it costs nothing and covers nearly all of them.
 *
 * Not behind `paced()` — Wikipedia is not Yahoo. A failure is not fatal: it returns an
 * empty map. Resolution still uses the bundled broad sector universe before leaving a
 * genuinely unknown symbol Unclassified.
 */

import { loadConstituents } from '../sp500Constituents.js'
import { normalizeSector } from '../../shared/heatmap.js'
import { gicsSectorFor, toGicsSector } from '../../shared/sectors.js'

export async function getSp500SectorMap(force = false): Promise<Record<string, string>> {
  try {
    const result = await loadConstituents(force)
    return Object.fromEntries(result.value.rows.flatMap((row) => [[row.symbol, row.sector], [row.symbol.replace(/\./g, '-'), row.sector]]))
  } catch { return {} }
}

/** Issuer first, live constituents second, offline GICS fallback last. */
export function resolveSector(
  symbol: string,
  issuerSector: string,
  sectorMap: Record<string, string>,
): string {
  const key = symbol.trim().toUpperCase()
  const sector = normalizeSector(issuerSector)
    || normalizeSector(sectorMap[key])
    || normalizeSector(sectorMap[key.replace(/-/g, '.')])
    || normalizeSector(sectorMap[key.replace(/\./g, '-')])
  return sector ? toGicsSector(sector) : gicsSectorFor(key)
}
