import type { BackgroundRequest, Envelope, NewsArticle, Quote } from './contract.js'
import { dedupeArticles } from './news.js'

export const FOREX_PAIRS = [
  { id: 'EUR/USD', symbol: 'EURUSD=X' },
  { id: 'GBP/USD', symbol: 'GBPUSD=X' },
  { id: 'USD/JPY', symbol: 'JPY=X' },
  { id: 'USD/CHF', symbol: 'CHF=X' },
  { id: 'AUD/USD', symbol: 'AUDUSD=X' },
  { id: 'USD/CAD', symbol: 'CAD=X' },
  { id: 'NZD/USD', symbol: 'NZDUSD=X' },
  { id: 'USD/SGD', symbol: 'SGD=X' },
  { id: 'EUR/SGD', symbol: 'EURSGD=X' },
  { id: 'SGD/JPY', symbol: 'SGDJPY=X' },
] as const
export type ForexPair = typeof FOREX_PAIRS[number]['id']
export const FOREX_RANGES = ['1W', '1M', '3M', '6M', '1Y'] as const
export type ForexRange = typeof FOREX_RANGES[number]
export const FOREX_DAYS: Record<ForexRange, number> = { '1W': 7, '1M': 31, '3M': 93, '6M': 186, '1Y': 366 }
export const FOREX_MARKET_MS = 60_000
export const FOREX_NEWS_MS = 300_000
export interface ForexRequest extends BackgroundRequest { force?: boolean }
export interface ForexPairRequest extends ForexRequest { pair: ForexPair }
export interface ForexHistoryRequest extends ForexPairRequest { range: ForexRange }
export interface ForexQuoteRow { pair: ForexPair; quote: Quote | null; freshness: Envelope<unknown>['meta']['freshness']; fetchedAt: number }
export interface ForexQuotesPayload { rows: ForexQuoteRow[] }
export interface ForexHistoryPayload { pair: ForexPair; range: ForexRange; points: Array<{ time: number; value: number }> }
export interface ForexNewsPayload { pair: ForexPair; articles: NewsArticle[] }

export function forexPair(pair: string) {
  const found = FOREX_PAIRS.find((entry) => entry.id === pair)
  if (!found) throw new Error(`Unsupported forex pair: ${pair}`)
  return found
}

export function forexPrecision(pair: ForexPair): number { return pair.endsWith('/JPY') ? 3 : 5 }
export function forexNumber(pair: ForexPair, value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(forexPrecision(pair)) : '—'
}
export function usableForexQuote(quote: Quote): boolean {
  return Number.isFinite(quote.price) && quote.price > 0 && Number.isFinite(quote.change) && Number.isFinite(quote.absChange)
}

const CURRENCY_NEWS: Record<string, RegExp> = {
  EUR: /\b(eur|euro|euros|ecb|european central bank)\b/i,
  USD: /\b(usd|us dollar|u\.s\. dollar|greenback|federal reserve|fed|fomc|dollar index)\b/i,
  GBP: /\b(gbp|sterling|british pound|pound sterling|boe|bank of england)\b/i,
  JPY: /\b(jpy|yen|boj|bank of japan)\b/i,
  CHF: /\b(chf|swiss franc|snb|swiss national bank)\b/i,
  AUD: /\b(aud|australian dollar|aussie|rba|reserve bank of australia)\b/i,
  CAD: /\b(cad|canadian dollar|loonie|boc|bank of canada)\b/i,
  NZD: /\b(nzd|new zealand dollar|kiwi|rbnz|reserve bank of new zealand)\b/i,
  SGD: /\b(sgd|singapore dollar|monetary authority of singapore|mas policy)\b/i,
}

export function selectForexNews(pair: ForexPair, articles: NewsArticle[]): NewsArticle[] {
  const currencies = pair.split('/')
  return dedupeArticles(articles.filter((article) => {
    if (!/^https?:\/\//i.test(article.url)) return false
    const text = `${article.title} ${article.summary}`
    return text.toUpperCase().includes(pair) || currencies.some((currency) => CURRENCY_NEWS[currency]?.test(text))
  })).sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 20)
}
