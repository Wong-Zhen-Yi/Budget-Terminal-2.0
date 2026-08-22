import type { NewsItem } from '../../shared/contract.js'
import { cache, TTL } from '../cache.js'
import { paced, yahoo } from './client.js'

const PER_TICKER_LIMIT = 2
const SEARCH_NEWS_COUNT = 10

/** Yahoo writes the same ticker as `BRK-B` and `BRK.B` depending on the endpoint. */
function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/\./g, '-')
}

/**
 * Only keep articles Yahoo itself associates with the ticker via `relatedTickers`.
 * A bare text search on a symbol returns a lot of unrelated market commentary, which
 * is why the PySide6 app filters the same way in `_search_portfolio_news_items`.
 */
async function fetchTickerNews(ticker: string): Promise<NewsItem[]> {
  const result = await paced(() =>
    yahoo.search(ticker, {
      newsCount: SEARCH_NEWS_COUNT,
      quotesCount: 0,
      enableCb: false,
      enableNavLinks: false,
    }),
  )
  const wanted = normalizeSymbol(ticker)
  const items: NewsItem[] = []
  for (const article of result.news ?? []) {
    const related = (article.relatedTickers ?? []).map(normalizeSymbol)
    if (!related.includes(wanted)) continue
    items.push({
      id: article.uuid,
      ticker: ticker.toUpperCase(),
      title: article.title,
      source: article.publisher,
      publishedAt: article.providerPublishTime?.getTime() ?? 0,
      url: article.link,
    })
  }
  return items.sort((a, b) => b.publishedAt - a.publishedAt)
}

export async function getNews(tickers: string[], force = false): Promise<NewsItem[]> {
  const unique = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))]
  const settled = await Promise.allSettled(
    unique.map((ticker) =>
      cache
        .resolve(`news:${ticker}`, TTL.news, () => fetchTickerNews(ticker), { force })
        .then((result) => result.value),
    ),
  )

  const seen = new Set<string>()
  const collected: NewsItem[] = []
  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') continue
    // At most the two newest per ticker, so one busy holding cannot fill the panel.
    for (const item of outcome.value.slice(0, PER_TICKER_LIMIT)) {
      const key = item.id || `${item.ticker}:${item.title}`
      if (seen.has(key)) continue
      seen.add(key)
      collected.push(item)
    }
  }
  return collected.sort((a, b) => b.publishedAt - a.publishedAt)
}
