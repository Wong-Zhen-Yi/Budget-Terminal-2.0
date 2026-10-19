import type { EtfAumPayload, EtfAumRow } from '../../shared/contract.js'
import { FRESHNESS } from '../../shared/freshness.js'
import { parseTables } from './html.js'
import { resolveEtfSnapshot } from './snapshot.js'

export const ETF_DIRECTORY_URL = 'https://stockanalysis.com/etf/?count=10000'

export function parseEtfAssets(text: string): number | null {
  const match = /^\$?([\d,.]+)\s*([TBMK])?$/i.exec(text.trim())
  if (!match) return null
  const scale: Record<string, number> = { T: 1e12, B: 1e9, M: 1e6, K: 1e3 }
  const value = Number(match[1].replace(/,/g, '')) * (scale[match[2]?.toUpperCase()] ?? 1)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** Parse the public, server-rendered directory; never execute the site's scripts. */
export function parseEtfDirectory(html: string): EtfAumPayload {
  const table = parseTables(html).find(table => table.headers.includes('fund name') && table.headers.includes('symbol'))
  if (!table) throw new Error('ETF directory did not contain a fund table.')
  const symbol = table.headers.indexOf('symbol')
  const name = table.headers.indexOf('fund name')
  const assets = table.headers.indexOf('assets')
  const category = table.headers.indexOf('asset class')
  const rows = new Map<string, EtfAumRow>()
  for (const cells of table.rows) {
    const ticker = cells[symbol]?.trim().toUpperCase() ?? ''
    if (!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(ticker) || !cells[name]) continue
    rows.set(ticker, {
      ticker, name: cells[name], category: cells[category] || 'Other',
      netAssets: parseEtfAssets(cells[assets] ?? ''),
    })
  }
  if (!rows.size) throw new Error('ETF directory returned no usable funds.')
  return {
    rows: [...rows.values()].sort((a, b) => (b.netAssets ?? -1) - (a.netAssets ?? -1)),
    totalCount: rows.size,
    missingCount: [...rows.values()].filter(row => row.netAssets === null).length,
    fetchedAt: Date.now(),
    source: 'Stock Analysis ETF directory',
    sourceUrl: ETF_DIRECTORY_URL,
  }
}

export async function fetchEtfHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'BudgetTerminal/2.0', Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`ETF source returned HTTP ${response.status}.`)
  return response.text()
}

/** One non-Yahoo request per day, with persisted last-good data on provider outages. */
export function getEtfDirectory(force = false): Promise<EtfAumPayload> {
  return resolveEtfSnapshot('etf-directory:v1', FRESHNESS.etfAum,
    async () => parseEtfDirectory(await fetchEtfHtml(ETF_DIRECTORY_URL)), { force })
}
