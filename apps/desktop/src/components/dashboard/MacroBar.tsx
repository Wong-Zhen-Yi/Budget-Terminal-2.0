import type { MacroQuotes } from '@shared/contract'
import { MACRO_SYMBOLS } from '@shared/contract'
import { decimals, EM_DASH, percent } from '@/lib/format'

/** SPY, DXY, VIX, GLD and WTI across the top — the same five the reference app tracks. */
export function MacroBar({ macro, loading }: { macro: MacroQuotes; loading: boolean }) {
  return (
    <div className="flex shrink-0 gap-1">
      {MACRO_SYMBOLS.map((entry) => {
        const quote = macro[entry.label]
        const up = (quote?.change ?? 0) >= 0
        return (
          <div
            key={entry.label}
            className="flex flex-1 items-center justify-center border border-border bg-surface px-2 py-1"
            title={entry.symbol}
          >
            {quote ? (
              <span className={`num text-2xs ${up ? 'text-up' : 'text-down'}`}>
                {entry.label}: {decimals(quote.price, 2)} ({percent(quote.change)})
              </span>
            ) : (
              <span className="num text-2xs text-text-dim">
                {entry.label}: {loading ? '...' : EM_DASH}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
