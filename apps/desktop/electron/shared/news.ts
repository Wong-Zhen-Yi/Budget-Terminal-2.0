import type { NewsArticle, NewsCategory } from './contract.js'
import { SECTOR_DATA } from './sectors.js'

/**
 * The News page's maths and text handling, ported from `workers/news_sources.py`, the
 * news half of `workers/data.py`, `services/news_analysis.py` and the presentation
 * helpers in `mixins/news.py`.
 *
 * Pure by design, and for once that matters in three directions rather than two: the RSS
 * service scores articles with it, the page filters and sorts with it, and
 * `probe-news.ts` prints from it. A second copy of the signal heuristic in the renderer
 * would drift from the one the probe checks within a week.
 */

/* ---------------------------------------------------------------- constants */

/** `MACRO_TICKERS` (`workers/data.py:39`). */
export const NEWS_MACRO_TICKERS = ['SPY', 'QQQ', 'GLD', 'CL=F', '^VIX', '^TNX', 'DX-Y.NYB'] as const

export interface NewsFeedConfig {
  source: string
  url: string
  /** Added before the phrase points, per `NewsFeed.score_bonus`. */
  scoreBonus: number
}

/** `KEYLESS_TRADER_NEWS_FEEDS` (`workers/news_sources.py:24-31`). */
export const NEWS_FEEDS: ReadonlyArray<NewsFeedConfig> = [
  { source: 'Seeking Alpha', url: 'https://seekingalpha.com/market_currents.xml', scoreBonus: 2 },
  {
    source: 'MarketWatch MarketPulse',
    url: 'https://feeds.content.dowjones.io/public/rss/mw_marketpulse',
    scoreBonus: 2,
  },
  {
    source: 'MarketWatch',
    url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories',
    scoreBonus: 1,
  },
  {
    source: 'CNBC Market Insider',
    url: 'https://www.cnbc.com/id/20409666/device/rss/rss.html',
    scoreBonus: 1,
  },
  {
    source: 'Nasdaq Markets',
    url: 'https://www.nasdaq.com/feed/rssoutbound?category=Markets',
    scoreBonus: 1,
  },
  { source: 'Investing.com', url: 'https://www.investing.com/rss/news_25.rss', scoreBonus: 1 },
]

/** `OTHER_NEWS_FOCUS_TICKERS` (`workers/data.py:41`). */
const OTHER_NEWS_FOCUS_TICKERS = [
  'AAPL', 'MSFT', 'NVDA', 'AVGO', 'AMD', 'ORCL',
  'JPM', 'BAC', 'GS', 'MS',
  'LLY', 'UNH', 'JNJ', 'MRK',
  'AMZN', 'TSLA', 'HD', 'MCD',
  'XOM', 'CVX', 'COP', 'SLB',
  'GOOGL', 'META', 'NFLX', 'DIS',
  'GE', 'CAT', 'BA', 'RTX',
  'WMT', 'COST', 'PG', 'KO',
  'NEE', 'DUK', 'PLD', 'AMT',
  'LIN', 'FCX', 'NEM',
  'COIN', 'MSTR',
]

/** `OTHER_NEWS_SECTOR_TICKERS`. */
const OTHER_NEWS_SECTOR_TICKERS = [
  'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLI', 'XLP', 'XLU', 'XLB', 'XLRE',
]

export const OTHER_NEWS_LIMIT = 36
export const OTHER_NEWS_CANDIDATE_LIMIT = 80
export const PORTFOLIO_NEWS_SEARCH_LIMIT = 8
export const MACRO_NEWS_LIMIT = 5
export const TICKER_SEARCH_MAX_SYMBOLS = 10
export const TICKER_SEARCH_PER_TICKER = 3
export const NEWS_FEED_TIMEOUT_MS = 4_000
/** `NEWS_FEED_STALE_FALLBACK_SECONDS`. Enforced in `services/news/feeds.ts`. */
export const NEWS_FEED_STALE_FALLBACK_MS = 24 * 60 * 60_000

/** `SIGNAL_PHRASES` (`workers/news_sources.py:51-63`), points and phrases unchanged. */
export const SIGNAL_PHRASES: ReadonlyArray<{
  tag: string
  points: number
  phrases: readonly string[]
}> = [
  {
    tag: 'earnings',
    points: 6,
    phrases: ['earnings', 'results', 'revenue', 'profit', 'eps', 'sales', 'quarterly'],
  },
  {
    tag: 'guidance',
    points: 6,
    phrases: ['guidance', 'outlook', 'forecast', 'raises forecast', 'cuts forecast'],
  },
  {
    tag: 'beat/miss',
    points: 5,
    phrases: [
      'beats estimates',
      'beat estimates',
      'misses estimates',
      'missed estimates',
      'better than expected',
      'worse than expected',
    ],
  },
  {
    tag: 'analyst',
    points: 5,
    phrases: [
      'upgrade',
      'upgraded',
      'downgrade',
      'downgraded',
      'price target',
      'overweight',
      'underweight',
      'buy rating',
      'sell rating',
      'initiates',
    ],
  },
  {
    tag: 'm&a',
    points: 5,
    phrases: ['merger', 'acquisition', 'acquire', 'takeover', 'buyout', 'deal talks'],
  },
  {
    tag: 'capital returns',
    points: 4,
    phrases: ['buyback', 'repurchase', 'dividend', 'stock split', 'special dividend'],
  },
  {
    tag: 'capital raise',
    points: 4,
    phrases: ['offering', 'secondary', 'share sale', 'convertible notes', 'debt offering'],
  },
  {
    tag: 'regulatory',
    points: 4,
    phrases: [
      'sec',
      'doj',
      'ftc',
      'fda',
      'antitrust',
      'lawsuit',
      'probe',
      'investigation',
      'subpoena',
      'approval',
    ],
  },
  {
    tag: 'macro',
    points: 4,
    phrases: [
      'fed',
      'fomc',
      'inflation',
      'cpi',
      'pce',
      'jobs report',
      'payrolls',
      'unemployment',
      'gdp',
      'treasury yields',
      'interest rates',
      'tariff',
    ],
  },
  {
    tag: 'market move',
    points: 4,
    phrases: [
      'jumps',
      'jump',
      'surges',
      'soars',
      'rallies',
      'rises',
      'gains',
      'plunges',
      'slides',
      'slumps',
      'sinks',
      'falls',
      'tumbles',
      'record high',
      'record low',
    ],
  },
  {
    tag: 'sector',
    points: 3,
    phrases: [
      'sector rotation',
      'semiconductor',
      'chip',
      'ai',
      'oil',
      'crude',
      'banks',
      'crypto',
      'bitcoin',
      'retail sales',
    ],
  },
]

/** The `NEWS_AI_PROMPT` header of the export, verbatim from `mixins/news.py:16-29`. */
export const NEWS_AI_PROMPT =
  'You are a skeptical market-intelligence analyst. Treat this export as a lead set, not verified truth. ' +
  'Start with the user’s portfolio exposures, then search the broader market for the highest-alpha opportunities ' +
  'and risks, including bullish, bearish, relative-value, and watchlist ideas. Cross-reference every material ' +
  'claim against current independent sources and prioritize primary evidence such as company investor-relations ' +
  'releases and filings, regulators, government data, and original transcripts. Verify exact event and publication ' +
  'dates; separate confirmed facts from interpretation and forecasts; compare developments with prior expectations ' +
  'and what may already be priced in; assess the economic channel, likely magnitude, time horizon, catalysts, ' +
  'crowding, and portfolio read-throughs. Test at least one credible alternative explanation and seek disconfirming ' +
  'evidence. Rank ideas by potential impact, timing, evidence quality, confidence, and clear invalidation conditions. ' +
  'Cite the sources used, state unresolved evidence gaps, never treat syndicated repetition as independent ' +
  'confirmation, and do not invent missing facts. Existing signal scores and tags are heuristic discovery aids, ' +
  'not verified alpha. This is research assistance, not financial advice.'

/* ------------------------------------------------------------ symbols, keys */

/** Yahoo writes `BRK.B` and `BRK-B` depending on the endpoint (`normalize_news_symbol`). */
export function normalizeNewsSymbol(value: string): string {
  return String(value ?? '')
    .toUpperCase()
    .trim()
    .replace(/\./g, '-')
}

/**
 * `article_dedupe_key` and `_p34_article_key` in one function: the url identifies an
 * article when it has one, and a syndicated copy without a link falls back to its headline.
 */
export function articleKey(article: {
  url?: string
  title?: string
  source?: string
  time?: string
}): string {
  const url = String(article.url ?? '')
    .trim()
    .toLowerCase()
  if (url) return `url:${url}`
  const title = String(article.title ?? '')
    .trim()
    .toLowerCase()
  if (!title) return ''
  return `title:${title}|${String(article.source ?? '').trim()}|${String(article.time ?? '').trim()}`
}

/**
 * `dedupe_articles`. `existing` seeds the seen set, so callers get the reference's
 * priority for free by passing the higher-ranked list: portfolio beats macro beats other.
 */
export function dedupeArticles<T extends { url?: string; title?: string }>(
  articles: T[],
  existing: ReadonlyArray<{ url?: string; title?: string }> = [],
): T[] {
  const seen = new Set<string>()
  for (const article of existing) {
    const key = articleKey(article)
    if (key) seen.add(key)
  }
  const unique: T[] = []
  for (const article of articles) {
    const key = articleKey(article)
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    unique.push(article)
  }
  return unique
}

/** `article_ticker_set`: the comma-joined field back to a set, without the `OTHER` filler. */
export function articleTickerSet(article: { ticker?: string }): Set<string> {
  const found = new Set<string>()
  for (const part of String(article.ticker ?? '').split(',')) {
    const symbol = part.trim().toUpperCase()
    if (symbol && symbol !== 'OTHER') found.add(symbol)
  }
  return found
}

/** `_normalize_ticker_universe`: indices and futures cannot appear in prose, so drop them. */
export function normalizeTickerUniverse(values: ReadonlyArray<string>): Set<string> {
  const universe = new Set<string>()
  for (const value of values ?? []) {
    const text = String(value ?? '')
      .toUpperCase()
      .trim()
    if (text && !text.includes('^') && !text.includes('=')) universe.add(text)
  }
  return universe
}

/** `_other_focus_tickers`: the universe the RSS lane tags articles against. */
export function otherFocusTickers(): string[] {
  const sectorSymbols: string[] = []
  for (const symbols of Object.values(SECTOR_DATA)) sectorSymbols.push(...symbols.slice(0, 3))

  const seen = new Set<string>()
  const ordered: string[] = []
  for (const symbol of [
    ...OTHER_NEWS_FOCUS_TICKERS,
    ...sectorSymbols,
    ...OTHER_NEWS_SECTOR_TICKERS,
  ]) {
    const value = symbol.toUpperCase().trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    ordered.push(value)
  }
  return ordered
}

/* -------------------------------------------------------- ticker extraction */

const CASHTAG_PATTERN = /(?<![A-Z0-9])\$([A-Z][A-Z0-9.]{0,5})(?![A-Z0-9])/g
const EXCHANGE_TICKER_PATTERN =
  /\b(?:NASDAQ|NYSE|AMEX|OTC|CBOE|TSX|LON):\s*([A-Z][A-Z0-9.]{0,5})\b/g
const PAREN_TICKER_PATTERN = /\(([A-Z][A-Z0-9.]{1,5})\)/g
const METADATA_TOKEN_PATTERN = /\b[A-Z][A-Z0-9.]{1,5}\b/g

/** Symbols that are also ordinary English, so they need their company named nearby. */
const AMBIGUOUS_TICKER_CONTEXT: Record<string, readonly string[]> = {
  AI: ['c3.ai', 'c3 ai'],
  COST: ['costco', 'costco wholesale'],
  NOW: ['servicenow', 'service now'],
  T: ['at&t', 'at & t', 'at and t'],
}

/** Assets the press names in words rather than by symbol. */
const DESCRIPTIVE_TICKER_CONTEXT: Record<string, readonly string[]> = {
  BNB: ['bnb', 'binance coin', 'binancecoin'],
  BTC: ['bitcoin'],
  COIN: ['coinbase'],
  ETH: ['ethereum', 'ether'],
  ETHA: ['etha', 'ishares ethereum trust'],
  IBIT: ['ibit', 'ishares bitcoin trust'],
  MSTR: ['microstrategy', 'strategy inc', 'strategy shares'],
  SOL: ['solana'],
  XRP: ['xrp', 'ripple'],
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasContext(
  map: Record<string, readonly string[]>,
  ticker: string,
  evidence: string,
): boolean {
  const contexts = map[ticker]
  if (!contexts?.length) return false
  const text = evidence.toLowerCase()
  return contexts.some((context) => text.includes(context))
}

/** `_add_ticker`: never invent a symbol outside the universe, never repeat one. */
function addTicker(
  found: string[],
  value: string,
  universe: Set<string>,
  { evidence = '', strong = false }: { evidence?: string; strong?: boolean } = {},
): void {
  const ticker = String(value ?? '')
    .toUpperCase()
    .trim()
    .replace(/^\.+|\.+$/g, '')
  if (!universe.has(ticker) || found.includes(ticker)) return
  if (
    ticker in AMBIGUOUS_TICKER_CONTEXT &&
    !strong &&
    !hasContext(AMBIGUOUS_TICKER_CONTEXT, ticker, evidence)
  ) {
    return
  }
  found.push(ticker)
}

function matchGroups(pattern: RegExp, text: string): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1] ?? '')
}

/**
 * `_extract_tickers`, in the reference's order — strongest evidence first, so a cashtag
 * admits an ambiguous symbol that a bare word scan would refuse.
 *
 * The Python signature takes a `url` it never reads (a test asserts tickers must not be
 * inferred from URLs), so the parameter is dropped here rather than passed and ignored;
 * `noUnusedParameters` would reject it either way.
 */
export function extractTickers(
  title: string,
  description: string,
  categories: ReadonlyArray<string>,
  universe: Set<string>,
): string[] {
  const found: string[] = []
  const combined = `${title} ${description} ${categories.join(' ')}`
  const upper = combined.toUpperCase()

  for (const pattern of [EXCHANGE_TICKER_PATTERN, CASHTAG_PATTERN]) {
    for (const match of matchGroups(pattern, upper)) {
      addTicker(found, match, universe, { strong: true })
    }
  }
  for (const match of matchGroups(PAREN_TICKER_PATTERN, upper)) {
    addTicker(found, match, universe, { evidence: combined })
  }
  for (const value of categories) {
    for (const token of matchGroups(METADATA_TOKEN_PATTERN, String(value ?? '').toUpperCase())) {
      addTicker(found, token, universe, { evidence: combined })
    }
  }
  // Longest first, so GOOGL is claimed before a shorter symbol nested inside it can be.
  const scanned = [...universe].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0))
  for (const ticker of scanned) {
    // Two-letter symbols are far more often ordinary words than tickers.
    if (ticker.length < 3) continue
    if (new RegExp(`(?<![A-Z0-9])${escapeRegExp(ticker)}(?![A-Z0-9])`).test(upper)) {
      addTicker(found, ticker, universe, { evidence: combined })
    }
  }
  for (const ticker of Object.keys(AMBIGUOUS_TICKER_CONTEXT).sort()) {
    if (universe.has(ticker) && hasContext(AMBIGUOUS_TICKER_CONTEXT, ticker, combined)) {
      addTicker(found, ticker, universe, { strong: true })
    }
  }
  for (const ticker of Object.keys(DESCRIPTIVE_TICKER_CONTEXT).sort()) {
    if (universe.has(ticker) && hasContext(DESCRIPTIVE_TICKER_CONTEXT, ticker, combined)) {
      addTicker(found, ticker, universe, { strong: true })
    }
  }
  return found
}

/* ------------------------------------------------------------------ scoring */

/**
 * `_score_article`. The `?` penalty is the reference's one piece of taste: a headline
 * posed as a question is usually commentary rather than news.
 */
export function scoreArticle(
  title: string,
  description: string,
  feedBonus: number,
  tickers: ReadonlyArray<string>,
): { score: number; signals: string[] } {
  const text = `${title} ${description}`.toLowerCase()
  let score = Math.trunc(feedBonus) || 0
  const tags: string[] = []
  for (const { tag, points, phrases } of SIGNAL_PHRASES) {
    if (phrases.some((phrase) => text.includes(phrase))) {
      score += points
      tags.push(tag)
    }
  }
  if (tickers.length) {
    score += 2
    tags.push('ticker')
  }
  if (title.includes('?')) score -= 1
  return { score: Math.max(score, 0), signals: [...new Set(tags)].sort() }
}

/* --------------------------------------------------------------- timestamps */

const BARE_ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/

/**
 * `_parse_timestamp`, in **milliseconds**.
 *
 * The first branch is the one that matters. Python's `fromisoformat` with the
 * `replace(tzinfo=utc)` fallback treats a stamp carrying no zone as **UTC**; JavaScript's
 * `new Date('2025-08-12T14:03:00')` treats the same string as **local**. Left alone that
 * silently shifts every affected article by the machine's offset and surfaces only as
 * slightly wrong ages, so a bare stamp gets an explicit `Z`. `_parse_investing_datetime`
 * (`%Y-%m-%d %H:%M:%S`, declared UTC) is the same case and the same branch handles it.
 */
export function parseNewsTimestamp(value: string): number {
  const text = String(value ?? '').trim()
  if (!text) return 0

  if (BARE_ISO.test(text)) {
    const parsed = Date.parse(`${text.replace(' ', 'T')}Z`)
    return Number.isFinite(parsed) ? parsed : 0
  }
  // RFC-822/2822 ("Tue, 12 Aug 2025 14:03:00 GMT") and zoned ISO both parse natively.
  const parsed = Date.parse(text)
  if (Number.isFinite(parsed)) return parsed
  // A zoned stamp written with a space rather than a T, which `fromisoformat` accepts.
  const retry = Date.parse(text.replace(' ', 'T'))
  return Number.isFinite(retry) ? retry : 0
}

/** `_format_time`: the absolute clock stamp the card and the export both print. */
export function formatNewsClock(timestamp: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '--:--'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '--:--'
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** `_p34_article_age_text`: the relative badge, `<1m` through `Ny`. */
export function ageText(timestamp: number, now: number = Date.now()): string {
  if (!timestamp || timestamp <= 0) return '--'
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 60) return '<1m'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`
  if (seconds < 31536000) return `${Math.floor(seconds / 604800)}w`
  return `${Math.floor(seconds / 31536000)}y`
}

/* ------------------------------------------------------- diversity selection */

/**
 * `_select_diverse_other_news`. Ranking alone would hand the whole Market section to
 * whichever mega-cap had a busy morning, so the ranked list is bucketed by first ticker
 * (or by source, when an article named none) and drained round-robin.
 */
export function selectDiverseOtherNews(
  articles: NewsArticle[],
  existing: ReadonlyArray<{ url?: string; title?: string }> = [],
): NewsArticle[] {
  const candidates = dedupeArticles(articles, existing)
  const ranked = [...candidates].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0) || b.publishedAt - a.publishedAt,
  )

  const buckets = new Map<string, NewsArticle[]>()
  for (const article of ranked) {
    const tickers = [...articleTickerSet(article)].sort()
    const key = tickers[0] ?? String(article.source || 'OTHER')
    const bucket = buckets.get(key)
    if (bucket) bucket.push(article)
    else buckets.set(key, [article])
  }

  const selected: NewsArticle[] = []
  while (selected.length < OTHER_NEWS_LIMIT && buckets.size) {
    for (const key of [...buckets.keys()]) {
      if (selected.length >= OTHER_NEWS_LIMIT) break
      const bucket = buckets.get(key)
      if (!bucket?.length) {
        buckets.delete(key)
        continue
      }
      selected.push(bucket.shift() as NewsArticle)
      if (!bucket.length) buckets.delete(key)
    }
  }
  return selected
}

/* ------------------------------------------------------ presentation helpers */

const CATEGORY_LABELS: Record<NewsCategory, string> = {
  portfolio: 'Portfolio',
  macro: 'Macro',
  other: 'Market',
  search: 'Ticker Search',
}

/** The theme tokens the reference's colour names map onto. */
export type NewsTone = 'up' | 'warn' | 'accent-dim' | 'accent'

/**
 * `_p34_category_token`. The reference's palette has an `info` blue this theme does not,
 * so Market takes `accent-dim` — the same role, and the token already used elsewhere for
 * a filled-but-not-focused state:
 *
 *   Portfolio      accent_positive -> up
 *   Macro          warning         -> warn
 *   Market         info            -> accent-dim
 *   Ticker Search  accent          -> accent
 */
const CATEGORY_TONES: Record<NewsCategory, NewsTone> = {
  portfolio: 'up',
  macro: 'warn',
  other: 'accent-dim',
  search: 'accent',
}

export function categoryLabel(article: { category?: string }): string {
  return CATEGORY_LABELS[(article.category ?? '') as NewsCategory] ?? 'Market'
}

export function categoryTone(article: { category?: string }): NewsTone {
  return CATEGORY_TONES[(article.category ?? '') as NewsCategory] ?? 'accent-dim'
}

/** `_p34_signal_text`: `['guidance','macro']` becomes `Guidance · Macro`. */
export function signalText(article: { signals?: ReadonlyArray<string> }): string {
  return (article.signals ?? [])
    .filter((tag) => String(tag).trim())
    .map((tag) => String(tag).replace(/\b\w/g, (character) => character.toUpperCase()))
    .join(' · ')
}

/** `_p34_article_matches_text_filter`: one box over headline, ticker, source and signals. */
export function matchesNewsFilter(article: NewsArticle, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const haystack = [
    article.title,
    article.ticker,
    article.source,
    categoryLabel(article),
    signalText(article),
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(needle)
}

export type NewsSort = 'newest' | 'signal'
export type NewsFilter = 'all' | 'portfolio' | 'market_macro'

/**
 * The Signal ordering from `_p34_filtered_groups`. The first comparison is on *whether* an
 * article carries a score, not on its value — the Yahoo lanes are unscored, and collapsing
 * their `null` to zero would sort them above genuinely low-scoring RSS articles.
 */
export function sortNewsArticles(articles: NewsArticle[], mode: NewsSort): NewsArticle[] {
  const sorted = [...articles]
  if (mode === 'signal') {
    sorted.sort(
      (a, b) =>
        Number(b.score !== null) - Number(a.score !== null) ||
        (b.score ?? 0) - (a.score ?? 0) ||
        b.publishedAt - a.publishedAt,
    )
  } else {
    sorted.sort((a, b) => b.publishedAt - a.publishedAt)
  }
  return sorted
}

/**
 * `_p34_filtered_groups`. Portfolio Spotlight is always newest-first whatever the sort
 * combo says — the reference applies Signal only to the market half, because a holding's
 * own news is wanted in the order it broke.
 */
export function splitNewsGroups(
  articles: NewsArticle[],
  filter: NewsFilter,
  query: string,
  sort: NewsSort,
): { portfolio: NewsArticle[]; market: NewsArticle[] } {
  const portfolio: NewsArticle[] = []
  const market: NewsArticle[] = []
  for (const article of articles) {
    if (filter === 'portfolio' && article.category !== 'portfolio') continue
    if (filter === 'market_macro' && article.category !== 'macro' && article.category !== 'other') {
      continue
    }
    if (!matchesNewsFilter(article, query)) continue
    if (article.category === 'portfolio') portfolio.push(article)
    else market.push(article)
  }
  return {
    portfolio: sortNewsArticles(portfolio, 'newest'),
    market: sortNewsArticles(market, sort),
  }
}

/** `_p34_columns_for_width`. */
export function columnsForWidth(width: number): number {
  if (width >= 1050) return 3
  if (width >= 700) return 2
  return 1
}

/** `_p34_parse_ticker_search_symbols`: commas, spaces or newlines, capped at ten. */
export function parseSearchSymbols(text: string): string[] {
  const seen = new Set<string>()
  const symbols: string[] = []
  for (const token of String(text ?? '').split(/[\s,;]+/)) {
    const symbol = token.toUpperCase().trim()
    if (!symbol || seen.has(symbol)) continue
    seen.add(symbol)
    symbols.push(symbol)
    if (symbols.length >= TICKER_SEARCH_MAX_SYMBOLS) break
  }
  return symbols
}

/* ------------------------------------------------------------------- export */

/**
 * `datetime.astimezone().isoformat(timespec='seconds')` — a local stamp carrying its
 * offset, `2026-08-23T14:03:00+08:00`. `toISOString` would print UTC and lose the reader's
 * sense of when "this morning" was.
 */
function localIsoSeconds(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  const pad = (value: number) => String(value).padStart(2, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes < 0 ? '-' : '+'
  const offset = `${sign}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(
    Math.abs(offsetMinutes) % 60,
  )}`
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`
  )
}

/** `_p34_export_section_lines`. */
function exportSection(heading: string, articles: NewsArticle[], now: number): string[] {
  const lines = [`=== ${heading.toUpperCase()} ===`, '']
  const ordered = sortNewsArticles(articles, 'newest')
  if (!ordered.length) return [...lines, '(No articles loaded.)', '']

  ordered.forEach((article, index) => {
    const signals = signalText(article)
    lines.push(
      `${index + 1}. [${categoryLabel(article)}] [${article.ticker || '--'}] ${article.title || 'N/A'}`,
    )
    lines.push(`   Source: ${article.source || '--'}`)
    lines.push(
      `   Published: ${article.publishedAt > 0 ? localIsoSeconds(article.publishedAt) : 'Unknown'}`,
    )
    lines.push(`   Age: ${ageText(article.publishedAt, now)}`)
    if (signals) lines.push(`   Signals: ${signals}`)
    // `if '_trader_score' in article` — present at all, not merely non-zero.
    if (article.score !== null) lines.push(`   Heuristic score: ${article.score}`)
    if (article.url) lines.push(`   URL: ${article.url}`)
    lines.push('')
  })
  return lines
}

/**
 * `_p34_build_export_text`. Exports the whole loaded set, ignoring the filter buttons and
 * the search box, so the file is the same brief however the page happens to be filtered.
 */
export function buildNewsExportText(input: {
  portfolio: NewsArticle[]
  /** macro and other together, as the reference's Market & Macro section is. */
  market: NewsArticle[]
  searched?: NewsArticle[]
  searchedTickers?: string[]
  now?: number
}): string {
  const now = input.now ?? Date.now()
  const searched = input.searched ?? []
  const searchedTickers = input.searchedTickers ?? []
  const total = searched.length + input.portfolio.length + input.market.length

  const coverage =
    searchedTickers.length || searched.length
      ? `Coverage: ${searched.length} ticker search article(s); ${input.portfolio.length} portfolio article(s); ` +
        `${input.market.length} market and macro article(s); ${total} total.`
      : `Coverage: ${input.portfolio.length} portfolio article(s); ${input.market.length} market and macro article(s); ` +
        `${total} total.`

  const lines = [NEWS_AI_PROMPT, '', `Generated at: ${localIsoSeconds(now)}`, coverage, '']
  if (searchedTickers.length || searched.length) {
    lines.push(`Searched tickers: ${searchedTickers.join(', ') || '--'}`, '')
    lines.push(...exportSection('Ticker Search Results', searched, now))
  }
  lines.push(...exportSection('Portfolio News', input.portfolio, now))
  lines.push(...exportSection('Market & Macro News', input.market, now))
  return `${lines.join('\n').replace(/\s+$/, '')}\n`
}
