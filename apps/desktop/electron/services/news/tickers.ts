import type { EnvelopeError, NewsArticle, NewsItem } from '../../shared/contract.js'
import { describeError, err } from '../../shared/envelope.js'
import { dedupeArticles } from '../../shared/news.js'
import { fetchPortfolioNews } from '../yahoo/newsPage.js'
import { fetchTickerTickNews, tickerTickSymbol, TICKERTICK_SOURCE } from './tickerTick.js'

export const TICKER_NEWS_SOURCE = 'TickerTick + Yahoo search'

export interface TickerNewsOutcome {
  symbol: string
  articles: NewsArticle[]
  failed: boolean
  errors: EnvelopeError[]
}

/** Batch US symbols to conserve the IP budget; unsupported/empty/failed coverage uses Yahoo. */
export async function getTickerNews(tickers: string[], force = false): Promise<TickerNewsOutcome[]> {
  const symbols = [...new Set(tickers.map(value => value.trim().toUpperCase()).filter(Boolean))].sort()
  const supported = symbols.filter(symbol => tickerTickSymbol(symbol) !== null)
  const primary = new Map<string, NewsArticle[]>()
  const failures = new Map<string, string>()
  await Promise.all(Array.from({ length: Math.ceil(supported.length / 25) }, async (_, index) => {
    const batch = supported.slice(index * 25, (index + 1) * 25)
    try {
      for (const [symbol, articles] of await fetchTickerTickNews(batch, force)) primary.set(symbol, articles)
    } catch (error) {
      for (const symbol of batch) failures.set(symbol, describeError(error))
    }
  }))
  return Promise.all(symbols.map(async symbol => {
    const errors = failures.has(symbol) ? [err(TICKERTICK_SOURCE, failures.get(symbol)!, 'newsTicker', symbol)] : []
    const articles = primary.get(symbol) ?? []
    if (articles.length) return { symbol, articles, failed: false, errors }
    try {
      return { symbol, articles: await fetchPortfolioNews(symbol, force), failed: false, errors }
    } catch (error) {
      errors.push(err('yahoo search', describeError(error), 'newsTicker', symbol))
      return { symbol, articles: [], failed: true, errors }
    }
  }))
}

/** Dashboard keeps two articles per holding, independent of the full News page's cap. */
export async function getNews(tickers: string[], force = false): Promise<{ items: NewsItem[]; errors: EnvelopeError[] }> {
  const outcomes = await getTickerNews(tickers, force)
  const items = dedupeArticles(outcomes.flatMap(outcome => outcome.articles.slice(0, 2)))
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .map(({ id, ticker, title, source, publishedAt, url }) => ({ id, ticker, title, source, publishedAt, url }))
  return { items, errors: outcomes.flatMap(outcome => outcome.errors) }
}
