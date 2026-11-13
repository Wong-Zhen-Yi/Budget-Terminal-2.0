import { HOMEBUILDER_CATALOG, HOMEBUILDER_REVIEW_DATE } from '../../electron/shared/homebuilderCatalog.js'
import type { HomebuildersPayload } from '../../electron/shared/homebuilders.js'

export function homebuilderFixture(now = Date.now()): HomebuildersPayload {
  return { catalogReviewedAt: HOMEBUILDER_REVIEW_DATE, fetchedAt: now,
    rows: HOMEBUILDER_CATALOG.map((company, index) => ({ company,
      market: { price: 100 + index, dailyChange: index % 2 ? -1.5 : 2, marketCap: (100 - index) * 1e9, quoteTime: now,
        history: Array.from({ length: 400 }, (_, day) => ({ date: new Date(now - (399 - day) * 86_400_000).toISOString().slice(0, 10), close: 70 + index + day / 10 + Math.sin(day / 12) * 5 })) },
      profile: company.kind === 'benchmark' ? null : { description: `${company.name} develops ${company.focus.toLowerCase()}.`, trailingPe: 22 + index, forwardPe: 18 + index,
        revenue: 20e9, revenueGrowth: .12, grossMargin: .22, priceToBook: .8 + index * .3, returnOnEquity: .09 + index * .017, earningsDate: now + (index % 20 + 1) * 86_400_000 },
      news: [{ id: `news-${index}`, ticker: company.symbol, title: `${company.name} announces homebuilding update`, source: 'Company news fixture', time: '12:00',
        url: company.sourceUrl, category: 'portfolio', publishedAt: now - index * 60_000,
        score: null, signals: [], imageUrl: '', summary: '' }],
      progress: { market: 'loaded', profile: 'loaded', news: 'loaded' }, fetchedAt: { market: now, profile: now, news: now } })) }
}
