import { Chip } from '@/components/ui/Chip'
import { currency } from '@/lib/format'

export function NewsTickerBadge({ ticker, price }: { ticker: string; price?: number }) {
  if (!ticker || ticker.trim().toUpperCase() === 'OTHER') return null

  return (
    <Chip className="num gap-1 whitespace-nowrap" title={`${ticker} latest available price`}>
      {ticker} <span className="text-text">{currency(price)}</span>
    </Chip>
  )
}
