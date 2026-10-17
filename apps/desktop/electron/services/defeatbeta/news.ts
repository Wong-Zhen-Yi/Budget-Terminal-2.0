import type { NewsArticle } from '../../shared/contract.js'
import { formatNewsClock } from '../../shared/news.js'
import { defeatBeta } from './client.js'
import { publishedObservation, requireRecentPublication } from './data.js'

export async function publishedNews(symbol: string): Promise<NewsArticle[]> {
  const result = await defeatBeta.rows('stock_news', symbol)
  requireRecentPublication(result.updatedAt)
  const articles = result.rows.flatMap((row): NewsArticle[] => {
    const publishedAt = Date.parse(String(row.report_date))
    const url = String(row.link ?? '')
    if (!Number.isFinite(publishedAt) || !/^https?:\/\//.test(url) || typeof row.title !== 'string') return []
    return [{ id: String(row.uuid ?? url), ticker: symbol.toUpperCase(), title: row.title,
      source: String(row.publisher ?? 'DefeatBeta'), time: formatNewsClock(publishedAt), url,
      category: 'portfolio', publishedAt, score: null, signals: [], imageUrl: '', summary: '' }]
  }).sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 20)
  publishedObservation(result.updatedAt)
  return articles
}
