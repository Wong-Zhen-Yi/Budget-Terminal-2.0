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
 * empty map and every tile falls back to the issuer's own sector, then Unclassified.
 */

import { loadConstituents } from '../sp500Constituents.js'

export async function getSp500SectorMap(force = false): Promise<Record<string, string>> {
  try {
    const result = await loadConstituents(force)
    return Object.fromEntries(result.value.rows.flatMap((row) => [[row.symbol, row.sector], [row.symbol.replace(/\./g, '-'), row.sector]]))
  } catch { return {} }
}

/** `_resolve_sector`: the issuer's own value wins, then the map, then Unclassified. */
export function resolveSector(
  symbol: string,
  issuerSector: string,
  sectorMap: Record<string, string>,
): string {
  if (issuerSector) return issuerSector
  return sectorMap[symbol] ?? sectorMap[symbol.replace(/-/g, '.')] ?? ''
}
