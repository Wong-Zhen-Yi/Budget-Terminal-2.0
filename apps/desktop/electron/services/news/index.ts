import type {
  EnvelopeError,
  NewsArticle,
  NewsLaneStatus,
  NewsPagePayload,
  NewsTickerSearchPayload,
} from '../../shared/contract.js'
import { err } from '../../shared/envelope.js'
import {
  TICKER_SEARCH_MAX_SYMBOLS,
  TICKER_SEARCH_PER_TICKER,
  dedupeArticles,
  selectDiverseOtherNews,
} from '../../shared/news.js'
import { MACRO_SYMBOLS, fetchMacroNews } from '../yahoo/newsPage.js'
import { getOtherNews, type FeedOutcome } from './feeds.js'
import { getTickerNews } from './tickers.js'

/**
 * The News page's three lanes, merged — `_collect_news_page_payload` in `workers/data.py`.
 *
 * The lanes run concurrently and fail independently: the RSS half usually settles in four
 * seconds while the Yahoo half queues behind the rate gate, and a dead publisher costs its
 * own section a warning dot rather than taking the page down.
 */

export const NEWS_SOURCE = 'TickerTick + Yahoo + RSS'

/** The section headings the page looks its warnings up by, via `warningOf`. */
export const PORTFOLIO_SECTION = 'Portfolio Spotlight'
export const MARKET_SECTION = 'Market & Macro'

interface LaneResult {
  articles: NewsArticle[]
  status: NewsLaneStatus
  errors: EnvelopeError[]
}

async function portfolioLane(symbols: string[], force: boolean): Promise<LaneResult> {
  const outcomes = await getTickerNews(symbols, force)
  return {
    articles: outcomes.flatMap(outcome => outcome.articles.slice(0, 8)),
    status: {
      lane: 'portfolio', label: PORTFOLIO_SECTION,
      fresh: outcomes.filter(outcome => !outcome.failed).map(outcome => outcome.symbol),
      stale: [], failed: outcomes.filter(outcome => outcome.failed).map(outcome => outcome.symbol),
    },
    errors: outcomes.flatMap(outcome => outcome.errors),
  }
}

/**
 * One Yahoo lane. `Promise.allSettled` over the symbols with no executor of our own —
 * `rateGate` already caps concurrency at four, and a second limiter here would only fight
 * it, the same reason `getNews` and `getTargets` fan out flat.
 */
async function yahooLane(
  lane: 'portfolio' | 'macro',
  label: string,
  symbols: ReadonlyArray<string>,
  fetchOne: (symbol: string, force: boolean) => Promise<NewsArticle[]>,
  force: boolean,
  operation: string,
): Promise<LaneResult> {
  const settled = await Promise.allSettled(symbols.map((symbol) => fetchOne(symbol, force)))

  const articles: NewsArticle[] = []
  const status: NewsLaneStatus = { lane, label, fresh: [], stale: [], failed: [] }
  const errors: EnvelopeError[] = []

  settled.forEach((outcome, index) => {
    const symbol = symbols[index] as string
    if (outcome.status === 'fulfilled') {
      articles.push(...outcome.value)
      status.fresh.push(symbol)
      return
    }
    status.failed.push(symbol)
    const reason = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
    errors.push(err('yahoo search', reason, operation, symbol))
  })

  return { articles, status, errors }
}

function otherLaneStatus(outcomes: FeedOutcome[]): NewsLaneStatus {
  const status: NewsLaneStatus = { lane: 'other', label: 'News Feeds', fresh: [], stale: [], failed: [] }
  for (const outcome of outcomes) status[outcome.status].push(outcome.feed.source)
  return status
}

export interface NewsPageResult {
  payload: NewsPagePayload
  errors: EnvelopeError[]
  /** Feeds and symbols that actually failed, excluding the per-section rollup errors. */
  unitFailures: number
}

export async function getNewsPage(tickers: string[], force = false): Promise<NewsPageResult> {
  const holdings = [...new Set(tickers.map((value) => value.trim().toUpperCase()).filter(Boolean))]

  const [portfolio, macro, other] = await Promise.all([
    portfolioLane(holdings, force),
    yahooLane('macro', MARKET_SECTION, MACRO_SYMBOLS, fetchMacroNews, force, 'newsMacro'),
    getOtherNews(force),
  ])

  // The merge order is the dedupe priority: a headline Yahoo returned for a holding stays
  // filed under that holding rather than reappearing as anonymous market news.
  const merged = dedupeArticles([...portfolio.articles, ...macro.articles])
  const diverse = selectDiverseOtherNews(other.candidates, merged)
  const articles = [...merged, ...diverse]

  const portfolioCount = articles.filter((article) => article.category === 'portfolio').length
  const macroCount = articles.filter((article) => article.category === 'macro').length

  const errors = [...portfolio.errors, ...macro.errors, ...other.errors]
  // A second error per degraded *section*, keyed by the label the page looks up. Pre-Market
  // established the convention; without it a failing feed has no dot to light.
  if (portfolio.errors.length) {
    errors.push(
      err(
        NEWS_SOURCE,
        `${portfolio.errors.length} portfolio news source(s) were unavailable.`,
        'newsLane',
        PORTFOLIO_SECTION,
      ),
    )
  }
  const marketDegraded = macro.status.failed.length + other.errors.length
  if (marketDegraded) {
    errors.push(
      err(NEWS_SOURCE, `${marketDegraded} market source(s) were unavailable.`, 'newsLane', MARKET_SECTION),
    )
  }

  // Only the unit-level errors are real failures; the two rollups above exist so a
  // section can find its own warning, and counting them would double-report one dead feed.
  const unitFailures = errors.filter((error) => error.operation !== 'newsLane').length

  return {
    unitFailures,
    payload: {
      articles,
      lanes: [portfolio.status, macro.status, otherLaneStatus(other.outcomes)],
      counts: { portfolio: portfolioCount, macro: macroCount, other: diverse.length },
      generatedAt: Date.now(),
    },
    errors,
  }
}

/**
 * `fetch_ticker_news_only(max_per_ticker=3)`: temporary news for symbols the user typed,
 * which never joins the portfolio lane or the store.
 *
 * It shares TickerTick batch and Yahoo fallback caches with the portfolio lane.
 * The only differences are the three-per-ticker cap and the `search` stamp.
 */
export async function getNewsTickerSearch(
  tickers: string[],
  force = false,
): Promise<{ payload: NewsTickerSearchPayload; errors: EnvelopeError[] }> {
  const queried = [...new Set(tickers.map((value) => value.trim().toUpperCase()).filter(Boolean))]
    .slice(0, TICKER_SEARCH_MAX_SYMBOLS)

  const outcomes = await getTickerNews(queried, force)

  const articles: NewsArticle[] = []
  const empty: string[] = []
  const failed: string[] = []
  const errors: EnvelopeError[] = []

  outcomes.forEach((outcome) => {
    const symbol = outcome.symbol
    errors.push(...outcome.errors)
    if (outcome.failed) {
      failed.push(symbol)
      return
    }
    if (!outcome.articles.length) {
      empty.push(symbol)
      return
    }
    for (const article of outcome.articles.slice(0, TICKER_SEARCH_PER_TICKER)) {
      articles.push({ ...article, category: 'search' })
    }
  })

  return {
    payload: {
      queried,
      articles: dedupeArticles(articles).sort((a, b) => b.publishedAt - a.publishedAt),
      empty,
      failed,
    },
    errors,
  }
}
