import { Chip } from '@/components/ui/Chip'
import type { NewsCategory } from '@shared/contract'
import { quotePrice } from '@/lib/format'

export function NewsTickerBadge({ ticker, price, currency, category = 'other' }: { ticker: string; price?: number; currency?: string; category?: NewsCategory }) {
  if (!ticker || ticker.trim().toUpperCase() === 'OTHER') return null

  const relation = category === 'portfolio' || category === 'search' ? 'Related' : category === 'macro' ? 'Feed' : 'Mentioned'
  const explanation = relation === 'Related' ? `Yahoo associates this article with ${ticker}; the headline may concern another company.`
    : relation === 'Feed' ? `Returned by the ${ticker} headline feed; this does not identify the article's main company.`
      : `${ticker} was extracted from the article text.`
  return (
    <Chip className="num gap-1 whitespace-nowrap" title={`${explanation}${price === undefined ? '' : ` ${ticker} latest available price.`}`}>
      {relation} {ticker}{price === undefined ? null : <span className="text-text">{quotePrice(price, currency)}</span>}
    </Chip>
  )
}
