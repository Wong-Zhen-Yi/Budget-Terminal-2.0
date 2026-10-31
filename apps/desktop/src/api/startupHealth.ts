import type { QueryKey } from '@tanstack/react-query'
import { MACRO_SYMBOLS, TABS, type Envelope } from '@shared/contract'
import { useDataHealth } from '@/stores/dataHealth'
import { queryFreshness } from './queryPersistence'

const pageLabels = new Map(TABS.map(tab => [tab.id, tab.label]))
const labels: Record<string, string[]> = {
  portfolio: ['Holdings'], personalFinance: ['Finance'], quotes: ['Quotes'],
  targets: ['Targets'], news: ['News'], chart: ['Chart'], stocks: ['Stocks'],
  chartsHistory: ['Charts'], options: ['Options'], optionQuotes: ['Option marks'],
  optionsExpirations: ['Options expirations'], optionsChain: ['Options chain'],
  fundamentals: ['Fundamentals'], fundamentalsPage: ['Fundamentals'], fx: ['FX'],
  calendarMonth: ['Company Events', 'Economic Events', 'Market Holidays'], earningsCalendar: ['Earnings Calendar'],
  newsPage: ['Portfolio News', 'Market & Macro', 'News Feeds'],
  preMarket: ['Futures', 'DXY', '10Y', 'VIX', 'Fear & Greed', 'Momentum'],
  forexQuotes: ['Forex rates'], forexHistory: ['Forex chart'], forexNews: ['Forex news'],
  etfAum: ['ETF directory'], etfHoldings: ['ETF holdings'],
  upDown: ['Up/Down', 'Price Targets'],
  ipoUpcoming: ['Upcoming IPOs'], ipoCompleted: ['Completed IPOs'],
  quant: ['Quant scan'], technicalScreen: ['Technical Indicators'],
  marketCap: ['Market Cap'], marketCapSales: ['P/S'],
  sofi: ['SOFI market', 'SOFI reported quarters'],
}

function panelLabels(page: string, key: QueryKey): string[] {
  const root = String(key[0])
  if (root === 'newsThumbnail' || root === 'youtubeThumbnail' || root === 'newsPreview') return []
  if (root === 'fundamentalsPage' && page === 'scorecard') return [`Scorecard ${key[1]}`]
  if (root === 'chartsHistory' && (page === 'agents' || page === 'dashboard-2')) return [`Agent chart ${key[1]}`]
  if (root === 'agents') return ['Agents']
  if (root === 'cardsPerformance') {
    try { return [`Cards ${JSON.parse(String(key[1])).interval}`] } catch { return ['Cards performance'] }
  }
  if (root === 'upDownTargets') return [`Price Targets · ${key[1]}`]
  if (root === 'defeatbetaTerminal') return [`DefeatBeta ${key[2]}`]
  if (root === 'sp500') return [`S&P500 ${String(key[1]).replace(/^./, letter => letter.toUpperCase())}`]
  if (root === 'portfolio' && page === 'calendar') return ['Options Expirations']
  if (root === 'chart' && page === 'dashboard') {
    const macro = MACRO_SYMBOLS.find(entry => entry.symbol === key[1])
    if (macro) return [`${macro.label} history`]
  }
  if (root === 'economic' && page === 'bonds') return ['Bonds']
  return labels[root] ?? [pageLabels.get(page) ?? page]
}

/** Startup is a real observation even when the user has never mounted the page. */
export function recordStartupSnapshot(page: string, key: QueryKey, result: unknown, error?: unknown): void {
  const envelope = result as Envelope<unknown> | undefined
  if (!envelope?.meta && !error) return
  useDataHealth.getState().record(page, panelLabels(page, key).map(label => ({
    label, envelope: envelope?.meta ? envelope : undefined, error, loading: false,
    freshnessMs: queryFreshness(key),
  })))
  if (page === 'trading-volumes' && key[0] === 'tradingVolumes') recordStartupSnapshot('beta', ['beta'], result, error)
}

/** Revalidate prepared pages at dependency expiry, with bounded outage retries. */
export function startupRefreshDelay(snapshots: Array<{ key: QueryKey; result: unknown }>, failed = false, now = Date.now()): number {
  if (failed) return 60_000
  let delay = Infinity
  for (const { key, result } of snapshots) {
    const envelope = result as Envelope<unknown> | undefined
    if (!envelope?.meta) continue
    if (['partial', 'stale', 'failed'].includes(envelope.meta.freshness)) return 60_000
    const lifetime = queryFreshness(key)
    // Local queries are driven by change events, not timers.
    if (!Number.isFinite(lifetime)) continue
    const expiry = envelope.meta.expiresAt ?? envelope.meta.fetchedAt + lifetime
    delay = Math.min(delay, Math.max(10_000, Math.min(lifetime, expiry - now + 250)))
  }
  return delay
}
