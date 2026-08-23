import type { EnvelopeError, NewsArticle } from '../../shared/contract.js'
import { err } from '../../shared/envelope.js'
import {
  NEWS_FEED_STALE_FALLBACK_MS,
  NEWS_FEED_TIMEOUT_MS,
  NEWS_FEEDS,
  OTHER_NEWS_CANDIDATE_LIMIT,
  dedupeArticles,
  normalizeTickerUniverse,
  otherFocusTickers,
  type NewsFeedConfig,
} from '../../shared/news.js'
import { cache, TTL } from '../cache.js'
import { BROWSER_USER_AGENT } from '../userAgent.js'
import { parseFeed } from './rss.js'

/**
 * The six keyless market RSS feeds, ported from `fetch_keyless_trader_news_with_status`
 * (`workers/news_sources.py`).
 *
 * These deliberately do **not** go through `paced()`. The rate gate models Yahoo's 429
 * behaviour and halves its own budget on one, so putting six unrelated publisher hosts
 * behind it would let a slow CNBC edge throttle the whole app — the same reasoning that
 * keeps `services/fearGreed.ts` outside the gate. Six requests on a 4s timeout, fired
 * together, is one bounded burst per refresh.
 */

export interface FeedOutcome {
  feed: NewsFeedConfig
  articles: NewsArticle[]
  /** Items the parser saw, before the title filter. Printed by the probe. */
  parsed: number
  status: 'fresh' | 'stale' | 'failed'
  /** Age of a stale snapshot, in hours; the strip puts it in a tooltip. */
  staleHours: number
  reason: string
  /** What the server actually answered with, so an HTML interstitial is visible. */
  contentType: string
}

/** The reference's own agent, tried first out of politeness. */
const FEED_HEADERS = {
  'User-Agent': 'BudgetTerminal/1.0 (+https://local.app) keyless-market-news',
  Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
}

/** Statuses that mean "not this agent" rather than "not this URL". */
const AGENT_REJECTIONS = new Set([403, 406, 429])

interface FeedBody {
  xml: string
  contentType: string
}

async function requestFeed(url: string, userAgent: string): Promise<Response> {
  return fetch(url, {
    headers: { ...FEED_HEADERS, 'User-Agent': userAgent },
    signal: AbortSignal.timeout(NEWS_FEED_TIMEOUT_MS),
    redirect: 'follow',
  })
}

/**
 * One feed's body, with the two defences the reference does not need because `requests`
 * and a Python agent string do not attract the same refusals.
 */
async function fetchFeedBody(url: string): Promise<FeedBody> {
  let response = await requestFeed(url, FEED_HEADERS['User-Agent'])
  if (AGENT_REJECTIONS.has(response.status)) {
    response = await requestFeed(url, BROWSER_USER_AGENT)
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const contentType = response.headers.get('content-type') ?? ''
  const xml = await response.text()
  // A consent or paywall interstitial answers 200 with HTML. Parsing it would yield zero
  // items and look like an empty feed, so name the real problem instead.
  if (!contentType.toLowerCase().includes('xml') && !/^\s*<(\?xml|rss|feed)\b/i.test(xml)) {
    throw new Error('Feed returned HTML, not RSS.')
  }
  return { xml, contentType }
}

/**
 * One feed, cached and allowed to fall back to its last good snapshot.
 *
 * The explicit age check matters: `resolveWithStaleFallback` has no upper bound on
 * staleness, so without it a feed that broke last week would keep serving last week's
 * headlines with nothing on screen to say so. The reference caps the same fallback at
 * `NEWS_FEED_STALE_FALLBACK_SECONDS`.
 */
async function loadFeed(
  feed: NewsFeedConfig,
  universe: Set<string>,
  force: boolean,
): Promise<FeedOutcome> {
  const base: FeedOutcome = {
    feed,
    articles: [],
    parsed: 0,
    status: 'failed',
    staleHours: 0,
    reason: '',
    contentType: '',
  }

  try {
    const hit = await cache.resolveWithStaleFallback<FeedBody>(
      `news-feed:${feed.url}`,
      TTL.newsFeed,
      () => fetchFeedBody(feed.url),
      { force },
    )
    const ageMs = hit.ageSeconds * 1000
    if (hit.stale && ageMs > NEWS_FEED_STALE_FALLBACK_MS) {
      throw new Error('Last snapshot is over a day old.')
    }

    const { articles, parsed } = parseFeed(hit.value.xml, feed, universe)
    const staleHours = hit.stale ? Math.floor(ageMs / 3_600_000) : 0
    return {
      ...base,
      articles,
      parsed,
      status: hit.stale ? 'stale' : 'fresh',
      staleHours,
      reason: hit.stale ? `Serving a ${staleHours}h-old snapshot.` : '',
      contentType: hit.value.contentType,
    }
  } catch (error) {
    return { ...base, reason: error instanceof Error ? error.message : String(error) }
  }
}

export interface OtherLaneResult {
  /** Ranked and capped at `OTHER_NEWS_CANDIDATE_LIMIT`; the diversity pass narrows it. */
  candidates: NewsArticle[]
  outcomes: FeedOutcome[]
  errors: EnvelopeError[]
}

/**
 * Every feed at once, merged, deduped across feeds and ranked the way
 * `fetch_keyless_trader_news_with_status` ranks: score first, recency to break ties.
 */
async function collectFeeds(force: boolean): Promise<OtherLaneResult> {
  const universe = normalizeTickerUniverse(otherFocusTickers())
  const outcomes = await Promise.all(NEWS_FEEDS.map((feed) => loadFeed(feed, universe, force)))

  const merged: NewsArticle[] = []
  const errors: EnvelopeError[] = []
  for (const outcome of outcomes) {
    merged.push(...outcome.articles)
    if (outcome.status !== 'fresh') {
      errors.push(err(outcome.feed.source, outcome.reason, 'newsFeed', outcome.feed.source))
    }
  }

  const candidates = dedupeArticles(merged)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.publishedAt - a.publishedAt)
    .slice(0, OTHER_NEWS_CANDIDATE_LIMIT)

  return { candidates, outcomes, errors }
}

/**
 * The Market lane. Two cache levels, as the reference has: each feed keeps its own body,
 * and the merged candidate list is cached again so a page revisit inside the window costs
 * nothing at all.
 */
export function getOtherNews(force = false): Promise<OtherLaneResult> {
  return cache
    .resolve(`news-page:other`, TTL.newsPage, () => collectFeeds(force), { force })
    .then((result) => result.value)
}
