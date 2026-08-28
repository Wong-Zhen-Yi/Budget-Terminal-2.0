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

import { cache } from '../cache.js'

const URL = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies'

/** `_SP500_SECTOR_TTL_SECONDS`. */
const SECTOR_TTL_MS = 24 * 60 * 60 * 1000

function decode(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

/** `cell.get_text(" ", strip=True)`: tags out, whitespace collapsed. */
function cellText(html: string): string {
  return decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

async function fetchSectorMap(): Promise<Record<string, string>> {
  const response = await fetch(URL, {
    headers: { 'User-Agent': 'BudgetTerminal/1.0' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Wikipedia returned HTTP ${response.status}.`)
  const html = await response.text()

  const table = /<table[^>]*id="constituents"[^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1]
  if (!table) throw new Error('The constituents table was not found on the page.')

  const headers = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((match) =>
    cellText(match[1]).toLowerCase(),
  )
  const symbolIndex = headers.indexOf('symbol')
  const sectorIndex = headers.indexOf('gics sector')
  if (symbolIndex < 0 || sectorIndex < 0) throw new Error('The constituents table changed shape.')

  const mapping: Record<string, string> = {}
  for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) =>
      cellText(match[1]),
    )
    if (cells.length <= Math.max(symbolIndex, sectorIndex)) continue
    const symbol = cells[symbolIndex].toUpperCase()
    const sector = cells[sectorIndex]
    if (!symbol || !sector) continue
    // Wikipedia spells BRK.B with a dot, Yahoo and the issuer files with a hyphen.
    mapping[symbol] = sector
    mapping[symbol.replace(/\./g, '-')] = sector
  }
  return mapping
}

export function getSp500SectorMap(force = false): Promise<Record<string, string>> {
  return cache
    .resolveWithStaleFallback('etf-heatmap:sectors', SECTOR_TTL_MS, fetchSectorMap, { force })
    .then((result) => result.value)
    .catch(() => ({}))
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
