import type { SearchNews } from 'yahoo-finance2/modules/search'

import type { NewsArticle, NewsCategory } from '../../shared/contract.js'
import {
  MACRO_NEWS_LIMIT,
  NEWS_MACRO_TICKERS,
  PORTFOLIO_NEWS_SEARCH_LIMIT,
  articleKey,
  formatNewsClock,
  normalizeNewsSymbol,
  parseNewsTimestamp,
} from '../../shared/news.js'
import { cache, TTL } from '../cache.js'
import { parseRssItems } from '../news/rss.js'
import { BROWSER_USER_AGENT } from '../userAgent.js'
import { paced, yahoo } from './client.js'

/**
 * The News page's two Yahoo lanes — Portfolio Spotlight and the macro half of Market &
 * Macro — ported from `_search_portfolio_news_items` and `_fetch_macro_news`
 * (`workers/data.py`).
 *
 * Separate from `yahoo/news.ts`, which feeds the Dashboard panel, because the two ask
 * Yahoo for different things: the panel wants ten results and keeps two per ticker, the
 * page wants eight and keeps all of them. They share `searchNews` and nothing else, and
 * deliberately do not share a cache key.
 */

/** The one call both news paths make. Inside `paced()`, like every other Yahoo request. */
export async function searchNews(symbol: string, newsCount: number): Promise<SearchNews[]> {
  const result = await paced(() =>
    yahoo.search(symbol, {
      newsCount,
      quotesCount: 0,
      enableCb: false,
      enableNavLinks: false,
    }),
  )
  return result.news ?? []
}

/**
 * The smallest thumbnail wide enough for a card, falling back to the largest on offer.
 *
 * Picking at the source is the only sizing lever there is: the proxy that inlines these
 * as `data:` URIs cannot resample without a native image library, so asking Yahoo for the
 * right resolution is what keeps a hundred cards from carrying a hundred full-size images.
 */
function pickThumbnail(article: SearchNews): string {
  const resolutions = article.thumbnail?.resolutions ?? []
  if (!resolutions.length) return ''
  const wideEnough = resolutions
    .filter((entry) => entry.url && entry.width >= 320)
    .sort((a, b) => a.width - b.width)
  if (wideEnough.length) return wideEnough[0]!.url
  const largest = [...resolutions].sort((a, b) => b.width - a.width)[0]
  return largest?.url ?? ''
}

/**
 * Yahoo's search payload as a page article. `score` stays null: the reference scores only
 * the RSS lane, and the Signal sort reads the null to keep unscored articles below scored
 * ones rather than treating them as a zero.
 */
function toArticle(item: SearchNews, ticker: string, category: NewsCategory): NewsArticle {
  const publishedAt = item.providerPublishTime?.getTime() ?? 0
  const article: NewsArticle = {
    id: item.uuid || '',
    ticker: ticker.toUpperCase(),
    title: item.title ?? '',
    source: item.publisher ?? '',
    time: formatNewsClock(publishedAt),
    url: item.link ?? '',
    category,
    publishedAt,
    score: null,
    signals: [],
    imageUrl: pickThumbnail(item),
    summary: '',
  }
  // A uuid is the better key when Yahoo sends one, but syndicated items sometimes repeat a
  // url under two uuids, and the dedupe pass keys on url. Fall back only when it is absent.
  if (!article.id) article.id = articleKey(article)
  return article
}

/**
 * `_search_portfolio_news_items`: only articles Yahoo itself associates with the ticker.
 *
 * A bare text search on a symbol returns a lot of unrelated market commentary, so the
 * `relatedTickers` gate is what makes this a portfolio lane rather than a keyword lane.
 * Unlike the Dashboard panel there is **no per-ticker cap** here — `_collect_portfolio_news_page`
 * keeps everything the gate returns, and only `fetch_ticker_news_only` trims.
 */
export function fetchPortfolioNews(ticker: string, force = false): Promise<NewsArticle[]> {
  return cache
    .resolve(
      `news-page:portfolio:${ticker.toUpperCase()}`,
      TTL.newsPage,
      async () => {
        const news = await searchNews(ticker, PORTFOLIO_NEWS_SEARCH_LIMIT)
        const wanted = normalizeNewsSymbol(ticker)
        const kept: NewsArticle[] = []
        for (const item of news) {
          const related = (item.relatedTickers ?? []).map(normalizeNewsSymbol)
          if (!related.includes(wanted)) continue
          kept.push(toArticle(item, ticker, 'portfolio'))
        }
        return kept.sort((a, b) => b.publishedAt - a.publishedAt)
      },
      { force },
    )
    .then((result) => result.value)
}

/**
 * Yahoo's per-symbol headline feed — what `Ticker.news` reads underneath.
 *
 * `yahoo-finance2@4` ships no news module (its `modules/` directory has search, quote,
 * chart and the rest, but nothing per-ticker), and `search` is a poor stand-in for a macro
 * symbol: searching the literal string `DX-Y.NYB` returns generic retirement listicles
 * rather than dollar stories, because there is no company name for the query to match.
 * This endpoint is the same feed the reference gets and it answers with real macro
 * coverage, so the lane is worth one hand-rolled fetch.
 *
 * It is a Yahoo host, so it goes through `paced()` like every other Yahoo request, even
 * though it is a plain `fetch` rather than a `yahoo-finance2` call.
 */
const HEADLINE_FEED = 'https://feeds.finance.yahoo.com/rss/2.0/headline'
const HEADLINE_TIMEOUT_MS = 6_000

async function fetchHeadlineFeed(symbol: string): Promise<NewsArticle[]> {
  const url = `${HEADLINE_FEED}?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`
  const response = await paced(() =>
    fetch(url, {
      headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'application/rss+xml, application/xml' },
      signal: AbortSignal.timeout(HEADLINE_TIMEOUT_MS),
      redirect: 'follow',
    }),
  )
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  return parseRssItems(await response.text())
    .slice(0, MACRO_NEWS_LIMIT)
    .map((item) => {
      const publishedAt = parseNewsTimestamp(item.published)
      const article: NewsArticle = {
        id: '',
        ticker: symbol.toUpperCase(),
        title: item.title,
        source: item.source || 'Yahoo Finance',
        time: formatNewsClock(publishedAt),
        url: item.link,
        category: 'macro',
        publishedAt,
        // Unscored, like the portfolio lane: the reference scores only the RSS market feeds.
        score: null,
        signals: [],
        imageUrl: item.imageUrl,
        summary: item.description,
      }
      article.id = articleKey(article)
      return article
    })
    .filter((article) => Boolean(article.title))
}

/** `_fetch_macro_news`: the top five headlines for each of the seven macro symbols. */
export function fetchMacroNews(symbol: string, force = false): Promise<NewsArticle[]> {
  return cache
    .resolve(`news-page:macro:${symbol.toUpperCase()}`, TTL.newsPage, () => fetchHeadlineFeed(symbol), {
      force,
    })
    .then((result) => result.value)
}

export const MACRO_SYMBOLS: ReadonlyArray<string> = NEWS_MACRO_TICKERS
