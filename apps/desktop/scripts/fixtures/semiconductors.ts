import { SEMICONDUCTOR_CATALOG, SEMICONDUCTOR_REVIEW_DATE } from '../../electron/shared/semiconductorCatalog.js'
import type { SemiconductorsPayload } from '../../electron/shared/semiconductors.js'

export function semiconductorFixture(now = Date.now()): SemiconductorsPayload {
  return { catalogReviewedAt: SEMICONDUCTOR_REVIEW_DATE, fetchedAt: now,
    rows: SEMICONDUCTOR_CATALOG.map((company, index) => ({ company,
      market: { price: 100 + index, dailyChange: index % 2 ? -1.5 : 2, marketCap: (100 - index) * 1e9, quoteTime: now,
        history: Array.from({ length: 400 }, (_, day) => ({ date: new Date(now - (399 - day) * 86_400_000).toISOString().slice(0, 10), close: 70 + index + day / 10 + Math.sin(day / 12) * 5 })) },
      profile: { description: `${company.name} develops ${company.rationale.toLowerCase()}.`, trailingPe: 22 + index, forwardPe: 18 + index,
        revenue: 20e9, revenueGrowth: .12, grossMargin: .55, earningsDate: now + (index % 20 + 1) * 86_400_000 },
      news: [{ id: `news-${index}`, ticker: company.symbol, title: `${company.name} announces semiconductor update`, source: 'Company news fixture', time: '12:00',
        url: `https://www.sec.gov/edgar/browse/?CIK=${Number(company.cik)}`, category: 'portfolio', publishedAt: now - index * 60_000,
        score: null, signals: [], imageUrl: '', summary: '' }],
      progress: { market: 'loaded', profile: 'loaded', news: 'loaded' }, fetchedAt: { market: now, profile: now, news: now } })) }
}
