/**
 * The Crypto page's constants, formatting and pure maths, ported from `CryptoMixin`
 * (`mixins/crypto.py`) and `CryptoMarketWorker` (`workers/crypto.py`).
 *
 * Everything here is imported by both the main process and the renderer, and by
 * `scripts/probe-crypto.ts`, so the tiles, the tables and the probe cannot disagree
 * about what a number reads as.
 */

import type { CryptoQuote, CryptoStage, CryptoStageStatus } from './contract.js'
import type { NewsFeedConfig } from './news.js'

/** `CryptoMarketWorker.CRYPTO_TICKERS`: label, Yahoo symbol, display name. */
export const CRYPTO_TICKERS: ReadonlyArray<{ label: string; symbol: string; name: string }> = [
  { label: 'BTC', symbol: 'BTC-USD', name: 'Bitcoin' },
  { label: 'ETH', symbol: 'ETH-USD', name: 'Ethereum' },
  { label: 'SOL', symbol: 'SOL-USD', name: 'Solana' },
  { label: 'XRP', symbol: 'XRP-USD', name: 'XRP' },
  { label: 'BNB', symbol: 'BNB-USD', name: 'BNB' },
]

/** `CryptoMarketWorker.PROXY_TICKERS`: the listed equities and ETFs that track crypto. */
export const PROXY_TICKERS: ReadonlyArray<{ label: string; symbol: string; name: string }> = [
  { label: 'COIN', symbol: 'COIN', name: 'Exchange' },
  { label: 'MSTR', symbol: 'MSTR', name: 'BTC treasury' },
  { label: 'BMNR', symbol: 'BMNR', name: 'Crypto treasury equity' },
  { label: 'IBIT', symbol: 'IBIT', name: 'Spot BTC ETF' },
  { label: 'ETHA', symbol: 'ETHA', name: 'Spot ETH ETF' },
  { label: 'BITQ', symbol: 'BITQ', name: 'Crypto equity ETF' },
]

/** `CryptoMarketWorker.COINGECKO_IDS`. The five coins the KPI strip and watchlist name. */
export const COINGECKO_IDS: Readonly<Record<string, string>> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  XRP: 'ripple',
  BNB: 'binancecoin',
}

/** `TOP_HEATMAP_LIMIT` / `P19_HEATMAP_LIMIT`. */
export const CRYPTO_HEATMAP_LIMIT = 30
/** `P19_HEATMAP_COLUMNS`: six across, five down. */
export const CRYPTO_HEATMAP_COLUMNS = 6
/** `P19_NEWS_LIMIT`. */
export const CRYPTO_NEWS_LIMIT = 10
/** `fetch_keyless_crypto_news(..., candidate_limit=80)`. */
export const CRYPTO_NEWS_CANDIDATE_LIMIT = 80

/** `_p19_update_watchlist`'s fixed order — ten rows, BITQ deliberately not among them. */
export const CRYPTO_WATCHLIST_ORDER: ReadonlyArray<string> = [
  'BTC',
  'ETH',
  'SOL',
  'XRP',
  'BNB',
  'COIN',
  'MSTR',
  'BMNR',
  'IBIT',
  'ETHA',
]

/**
 * `_p19_update_proxy_table`: five rows in this order, with the labels the table prints.
 *
 * These are not `PROXY_TICKERS`' names — that tuple carries BMNR, which the proxy table
 * leaves out, and the reference keeps a separate dict for exactly this reason.
 */
export const CRYPTO_PROXY_ROWS: ReadonlyArray<{ label: string; type: string }> = [
  { label: 'IBIT', type: 'Spot BTC ETF' },
  { label: 'ETHA', type: 'Spot ETH ETF' },
  { label: 'COIN', type: 'Exchange' },
  { label: 'MSTR', type: 'BTC treasury' },
  { label: 'BITQ', type: 'Crypto equity ETF' },
]

/** `KEYLESS_CRYPTO_NEWS_FEEDS` (`workers/news_sources.py:33-38`). */
export const CRYPTO_NEWS_FEEDS: ReadonlyArray<NewsFeedConfig> = [
  { source: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', scoreBonus: 3 },
  { source: 'Cointelegraph', url: 'https://cointelegraph.com/rss', scoreBonus: 3 },
  { source: 'Decrypt', url: 'https://decrypt.co/feed', scoreBonus: 2 },
  { source: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/.rss/full/', scoreBonus: 2 },
]

/** The universe `_fetch_news` tags crypto articles against. */
export const CRYPTO_NEWS_FOCUS_TICKERS: ReadonlyArray<string> = [
  'BTC',
  'ETH',
  'SOL',
  'COIN',
  'MSTR',
  'BMNR',
  'IBIT',
  'ETHA',
  'BITQ',
]

/** Independent data stages used by startup readiness and the page status. */
export const CRYPTO_STAGES: ReadonlyArray<CryptoStage> = ['heatmap', 'quotes', 'market', 'news', 'hyperliquid']

/* ------------------------------------------------------------------ numbers */

/** `_first_number`: the first argument that is a finite number, else null. */
export function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    const parsed = typeof value === 'string' ? Number(value) : value
    if (typeof parsed === 'number' && Number.isFinite(parsed)) return parsed
  }
  return null
}

/** `_p19_format_price`: four decimals under a dollar, none above a thousand. */
export function cryptoPrice(value: number | null | undefined): string {
  const number = firstNumber(value)
  if (number === null) return '--'
  const decimals = number >= 1000 ? 0 : number >= 1 ? 2 : 4
  return `$${number.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}

/**
 * `_p19_format_money`. `compact` only adds the thousands step — the T/B/M steps apply
 * either way, which is why a market cap and a volume in the same row read alike.
 */
export function cryptoMoney(value: number | null | undefined, compact = false): string {
  const number = firstNumber(value)
  if (number === null) return '--'
  const magnitude = Math.abs(number)
  if (magnitude >= 1e12) return `$${(number / 1e12).toFixed(2)}T`
  if (magnitude >= 1e9) return `$${(number / 1e9).toFixed(2)}B`
  if (magnitude >= 1e6) return `$${(number / 1e6).toFixed(1)}M`
  if (compact && magnitude >= 1e3) return `$${(number / 1e3).toFixed(1)}K`
  return `$${Math.round(number).toLocaleString('en-US')}`
}

/** `_p19_format_pct`: always signed, two decimals. */
export function cryptoPercent(value: number | null | undefined): string {
  const number = firstNumber(value)
  if (number === null) return '--'
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)}%`
}

export type CryptoTone = 'positive' | 'negative' | 'muted'

/** `_p19_status_for_change`: exactly zero counts as positive, as the reference has it. */
export function cryptoTone(value: number | null | undefined): CryptoTone {
  const number = firstNumber(value)
  if (number === null) return 'muted'
  return number >= 0 ? 'positive' : 'negative'
}

/** `_p19_heatmap_intensity`: |move| saturating at 5%. */
export function heatmapIntensity(value: number | null | undefined): number {
  const number = firstNumber(value)
  if (number === null) return 0
  return Math.max(0, Math.min(Math.abs(number) / 5, 1))
}

/** `_p19_rank_sort_value`: anything unparseable sorts to the end. */
export function rankSortValue(value: unknown): number {
  const number = firstNumber(value)
  return number === null ? 999 : Math.trunc(number)
}

/* -------------------------------------------------------------------- news */

export type CryptoNewsTone = 'Bullish' | 'Bearish' | 'Neutral'

const BULLISH_WORDS = ['surge', 'rally', 'gain', 'record', 'inflow', 'approves', 'breakout']
const BEARISH_WORDS = ['fall', 'drop', 'outflow', 'probe', 'hack', 'lawsuit', 'selloff']

/** `_p19_news_tone`: a headline keyword scan, bullish checked first. */
export function cryptoNewsTone(title: string): CryptoNewsTone {
  const lowered = String(title ?? '').toLowerCase()
  if (BULLISH_WORDS.some((word) => lowered.includes(word))) return 'Bullish'
  if (BEARISH_WORDS.some((word) => lowered.includes(word))) return 'Bearish'
  return 'Neutral'
}

/* ------------------------------------------------------------------ status */

/** Count ready stages, excluding unavailable data. */
export function loadedStageCount(progress: Record<CryptoStage, CryptoStageStatus>): number {
  return CRYPTO_STAGES.filter(
    (stage) => progress[stage] === 'loaded',
  ).length
}

/** `_p19_has_unavailable_stage`. */
export function hasUnavailableStage(progress: Record<CryptoStage, CryptoStageStatus>): boolean {
  return CRYPTO_STAGES.some((stage) => progress[stage] === 'unavailable')
}

/** The reference's `fetched_at[-8:]` — the `HH:MM:SS` tail of an ISO stamp. */
export function clockTail(isoStamp: string): string {
  const text = String(isoStamp ?? '').trim()
  return text ? text.slice(-8) : '--'
}

/** `datetime.now().isoformat(timespec='seconds')`, in local time as the reference is. */
export function localIsoSeconds(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  )
}

/** `datetime.fromtimestamp(ts).strftime('%b %d')`, for the Fear & Greed stamp. */
export function fearGreedStamp(value: unknown): string {
  const seconds = firstNumber(value)
  if (seconds === null) return ''
  const date = new Date(seconds * 1000)
  if (Number.isNaN(date.getTime())) return String(value ?? '')
  return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })
}

/* ------------------------------------------------------------------ export */

/** `_p19_export_snapshot`: the five lines the Export button puts on the clipboard. */
export function buildCryptoSnapshot(input: {
  fetchedAt: string
  quotes: Record<string, CryptoQuote>
}): string {
  const lines = [
    'Budget Terminal Crypto Market Snapshot',
    `Refreshed: ${input.fetchedAt || '--'}`,
  ]
  for (const label of ['BTC', 'ETH', 'SOL']) {
    const quote = input.quotes[label]
    lines.push(`${label}${quote?.source === 'Hyperliquid crypto perp' ? ' PERP' : ''} ${cryptoPrice(quote?.price)} ${cryptoPercent(quote?.changePct)}`)
  }
  return lines.join('\n')
}
