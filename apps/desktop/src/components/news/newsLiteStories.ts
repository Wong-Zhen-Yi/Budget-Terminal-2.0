import type { NewsArticle } from '@shared/contract'
import { articleTickerSet, dedupeArticles, matchesNewsFilter, sortNewsArticles } from '@shared/news'

export interface NewsLiteStory {
  id: string
  lead: NewsArticle
  articles: NewsArticle[]
  tickers: string[]
  isPortfolio: boolean
}

export function groupNewsLiteStories(articles: NewsArticle[], holdings: ReadonlySet<string>): NewsLiteStory[] {
  const groups = new Map<string, NewsArticle[]>()
  for (const article of sortNewsArticles(dedupeArticles(articles), 'newest')) {
    // Combine matching headlines from different feeds on the same publication day.
    // Similar wording alone can conflate separate or opposing news events.
    const title = article.title.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ')
    const day = Math.floor(article.publishedAt / 86_400_000)
    const id = JSON.stringify(title && article.publishedAt > 0 ? [title, day] : [article.id])
    const group = groups.get(id)
    if (group) group.push(article)
    else groups.set(id, [article])
  }
  return [...groups].map(([id, articles]) => {
    const tickers = [...new Set(articles.flatMap(article => [...articleTickerSet(article)]))]
    return { id, lead: articles[0]!, articles, tickers, isPortfolio: tickers.some(ticker => holdings.has(ticker)) }
  })
}

export function matchesNewsLiteText(story: NewsLiteStory, terms: string[]): boolean {
  return terms.every(term => story.articles.some(article => matchesNewsFilter(article, term)))
}
