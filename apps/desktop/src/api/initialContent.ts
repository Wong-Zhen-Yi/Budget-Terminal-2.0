import type { NewsArticle, YouTubeVideo } from '@shared/contract'
import { articleTickerSet, splitNewsGroups, type NewsFilter, type NewsSort } from '@shared/news'
import { normalizeYouTubePageSettings, sortYouTubeVideos } from '@shared/youtube'

export function newsQuoteTickers(articles: readonly NewsArticle[]): string[] {
  return [...new Set(articles.flatMap(article => [...articleTickerSet(article)]))].sort()
}

export function newsHero(articles: NewsArticle[], now = Date.now()): NewsArticle | null {
  const recent = articles.filter((article) => now - article.publishedAt < 24 * 60 * 60_000)
  return [...recent].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.publishedAt - a.publishedAt)[0] ?? null
}

/** Match the grid's initial 48-card batches, including its promoted hero. */
export function initialNewsImages(articles: NewsArticle[], filter: NewsFilter, sort: NewsSort): string[] {
  const groups = splitNewsGroups(articles, filter, '', sort)
  const hero = filter === 'all' ? newsHero(groups.market) : null
  const visible = [...(hero ? [hero] : []), ...groups.portfolio.slice(0, 48),
    ...groups.market.filter((article) => article.id !== hero?.id).slice(0, 48)]
  return [...new Set(visible.map((article) => article.imageUrl).filter(Boolean))]
}

export function initialYouTubeVideo(items: readonly YouTubeVideo[], settings: unknown): YouTubeVideo | null {
  const selection = normalizeYouTubePageSettings(settings)
  return sortYouTubeVideos(items, selection.sortColumn, selection.sortDescending)[0] ?? null
}
