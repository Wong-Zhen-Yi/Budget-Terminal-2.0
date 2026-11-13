import type { NewsArticle } from '../../shared/contract.js'
import { dedupeArticles, formatNewsClock, normalizeNewsSymbol, scoreArticle } from '../../shared/news.js'
import { apiUsageTracker, trackApiRequest } from '../apiUsage.js'
import { cache, TTL } from '../cache.js'
import { publicNewsUrl } from './publicNetwork.js'
import { cleanText } from './rss.js'

export const TICKERTICK_SOURCE = 'TickerTick'
export const TICKERTICK_MARKET_FEED = {
  source: TICKERTICK_SOURCE,
  url: 'https://api.tickertick.com/feed?q=T:market&n=200',
  scoreBonus: 0,
}

/** One process-wide admission gate for both ticker and market feeds. Never bypass on force. */
export class TickerTickRateGate {
  private starts: number[] = []
  private until = 0
  private tail: Promise<void> = Promise.resolve()

  constructor(
    private readonly now = Date.now,
    private readonly sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
  ) {}

  cooldown(ms: number): void {
    this.until = Math.max(this.until, this.now() + Math.max(30_000, ms))
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    const requestedAt = this.now()
    const admission = this.tail.then(async () => {
      for (;;) {
        const now = this.now()
        if (now < this.until) throw new Error('TickerTick rate limit cooldown; using fallback news.')
        this.starts = this.starts.filter(time => time > now - 60_000)
        const recent = this.starts.filter(time => time > now - 30_000)
        const wait = Math.max(
          recent.length >= 5 ? recent[recent.length - 5]! + 30_001 - now : 0,
          this.starts.length >= 10 ? this.starts[this.starts.length - 10]! + 60_001 - now : 0,
        )
        // Keep startup/Agent reads bounded rather than queuing behind a whole minute of traffic.
        if (now + wait - requestedAt > 8_000) throw new Error('TickerTick request budget busy; using fallback news.')
        if (wait <= 0) { this.starts.push(now); return }
        await this.sleep(wait)
      }
    })
    this.tail = admission.catch(() => {})
    await admission
    return task()
  }
}

export const tickerTickRateGate = new TickerTickRateGate()

/** TickerTick covers US tickers. Do not turn Yahoo indices/futures/foreign suffixes into queries. */
export function tickerTickSymbol(value: string): string | null {
  const symbol = normalizeNewsSymbol(value)
  if (!/^[A-Z][A-Z0-9]{0,9}(?:-[A-Z])?$/.test(symbol)) return null
  return symbol.replace('-', '.').toLowerCase()
}

interface Story {
  id: string
  title: string
  url: string
  site: string
  time: number
  tickers: string[]
  description: string
}

/** Provider data stays untrusted: reject unsafe links, invalid dates and malformed feed bodies. */
export function parseTickerTickFeed(body: unknown): Story[] {
  const rows: unknown = Array.isArray(body) ? body
    : body && typeof body === 'object' ? (body as { stories?: unknown }).stories : undefined
  if (!Array.isArray(rows)) throw new Error('TickerTick returned an invalid news feed.')
  const stories: Story[] = []
  for (const row of rows.slice(0, 200)) {
    if (!row || typeof row !== 'object') continue
    const raw = row as Record<string, unknown>
    if (typeof raw.title !== 'string' || typeof raw.url !== 'string'
      || typeof raw.time !== 'number' || !Number.isFinite(raw.time)
      || raw.time <= 0 || raw.time > Date.now() + 3_600_000) continue
    let url: string
    try {
      const target = publicNewsUrl(raw.url)
      if (['localhost', 'localhost.localdomain'].includes(target.hostname) || target.hostname.endsWith('.localhost')) continue
      url = target.toString()
    } catch { continue }
    const title = cleanText(raw.title).slice(0, 2_000)
    if (!title) continue
    const tags = [raw.tickers, raw.tags].flatMap(value => Array.isArray(value) ? value : [])
    stories.push({
      // IDs are signed 64-bit strings. Never parse them through a JS number.
      id: typeof raw.id === 'string' && raw.id ? raw.id : url,
      title, url, time: raw.time,
      site: typeof raw.site === 'string' && raw.site.trim() ? cleanText(raw.site).slice(0, 200) : new URL(url).hostname,
      tickers: [...new Set(tags.filter((tag): tag is string => typeof tag === 'string').map(normalizeNewsSymbol))],
      description: typeof raw.description === 'string' ? cleanText(raw.description).slice(0, 8_000) : '',
    })
  }
  if (rows.length && !stories.length) throw new Error('TickerTick returned no valid news stories.')
  return stories.sort((a, b) => b.time - a.time)
}

function retryDelay(value: string | null): number {
  if (!value) return 30_000
  const seconds = Number(value)
  return Math.min(86_400_000, Math.max(30_000,
    Number.isFinite(seconds) ? seconds * 1000 : (Date.parse(value) || Date.now()) - Date.now()))
}

async function requestFeed(query: string): Promise<Story[]> {
  return tickerTickRateGate.run(() => trackApiRequest('tickertick', async () => {
    const url = new URL('https://api.tickertick.com/feed')
    url.searchParams.set('q', query)
    url.searchParams.set('n', '200')
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'BudgetTerminal/1.0' },
      signal: AbortSignal.timeout(6_000),
      redirect: 'error',
    })
    if (response.status === 429) {
      const delay = retryDelay(response.headers.get('retry-after'))
      tickerTickRateGate.cooldown(delay)
      apiUsageTracker.setCooldown('tickertick', Date.now() + delay)
    }
    if (!response.ok) throw new Error(`TickerTick HTTP ${response.status}`)
    return parseTickerTickFeed(await response.json())
  }))
}

function feed(query: string, force: boolean): Promise<Story[]> {
  return cache.resolve(`news:tickertick:v1:${query}`, TTL.newsPage, () => requestFeed(query), { force })
    .then(result => result.value)
}

function article(story: Story, ticker: string, category: 'portfolio' | 'other'): NewsArticle {
  const scoring = category === 'other' ? scoreArticle(story.title, story.description, 0, story.tickers) : { score: null, signals: [] }
  return {
    id: `tickertick:${story.id}`, ticker, title: story.title, source: story.site,
    time: formatNewsClock(story.time), publishedAt: story.time, url: story.url,
    category, ...scoring, summary: story.description,
    // favicon_url is a publisher icon, not an article photograph.
    imageUrl: '',
  }
}

/** One OR query per batch, shared by Dashboard, portfolio lane and ticker search. */
export async function fetchTickerTickNews(tickers: string[], force: boolean): Promise<Map<string, NewsArticle[]>> {
  const terms = [...new Set(tickers.map(tickerTickSymbol).filter((symbol): symbol is string => symbol !== null))].sort()
  const result = new Map(tickers.map(symbol => [symbol, [] as NewsArticle[]]))
  if (!terms.length) return result
  const query = terms.length === 1 ? `tt:${terms[0]}` : `(or ${terms.map(symbol => `tt:${symbol}`).join(' ')})`
  const stories = await feed(query, force)
  for (const symbol of tickers) {
    const wanted = normalizeNewsSymbol(symbol)
    result.set(symbol, dedupeArticles(stories.filter(story => story.tickers.includes(wanted))
      .map(story => article(story, symbol, 'portfolio'))).slice(0, 10))
  }
  return result
}

export async function fetchTickerTickMarket(force: boolean): Promise<NewsArticle[]> {
  return dedupeArticles((await feed('T:market', force)).map(story => article(story, story.tickers.join(',') || 'OTHER', 'other')))
}
