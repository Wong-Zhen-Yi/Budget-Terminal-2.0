import { useEffect, useState } from 'react'
import { useNavigation } from '@/stores/navigation'
import { useStocksPage } from '@/stores/stocks'
import { useFundamentalsStore } from '@/stores/fundamentals'
import { useChartsStore } from '@/stores/charts'
import { useOptionsPage } from '@/stores/options'
import { useValuationPage } from '@/stores/valuation'

const targets = [
  ['stocks', 'Stocks'], ['fundamentals', 'Fundamentals'], ['charts', 'Charts'],
  ['options', 'Options'], ['valuation', 'Valuation'],
]

export function ResearchTicker({ activeTab, visibleIds, onNavigate }: {
  activeTab: string
  visibleIds: string[]
  onNavigate: (tab: string, symbol: string) => void
}) {
  const symbol = useNavigation((state) => state.symbol)
  const setSymbol = useNavigation((state) => state.setSymbol)
  const stocks = useStocksPage((state) => state.symbol)
  const fundamentals = useFundamentalsStore((state) => state.symbol)
  const charts = useChartsStore((state) => state.symbol)
  const options = useOptionsPage((state) => state.symbol)
  const valuation = useValuationPage((state) => state.ticker)
  const activeSymbol = ({ stocks, fundamentals, charts, options, valuation } as Record<string, string>)[activeTab]
  useEffect(() => { if (activeSymbol) setSymbol(activeSymbol) }, [activeSymbol, setSymbol])
  const [draft, setDraft] = useState(symbol)
  useEffect(() => setDraft(symbol), [symbol])
  const ticker = draft.trim().toUpperCase()
  const valid = /^[A-Z0-9^][A-Z0-9.^=/-]{0,31}$/.test(ticker)
  const available = targets.filter(([id]) => visibleIds.includes(id))
  if (!available.length) return null
  return (
    <form aria-label="Ticker research" onSubmit={(event) => {
      event.preventDefault()
      if (valid) onNavigate(available.find(([id]) => id === activeTab)?.[0] ?? available[0][0], ticker)
    }} className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-surface px-3 py-1">
      <label htmlFor="research-ticker" className="mr-1 text-2xs text-text-muted">Research</label>
      <input id="research-ticker" aria-label="Research ticker" value={draft} maxLength={32}
        onChange={(event) => setDraft(event.target.value.toUpperCase())} placeholder="Ticker" spellCheck={false}
        className="h-7 w-24 rounded border border-border-strong bg-bg px-2 text-2xs text-text focus:border-accent" />
      {available.map(([id, label]) => <button key={id} type="button" disabled={!valid}
        onClick={() => onNavigate(id, ticker)} title={valid ? `Research ${ticker} in ${label}` : 'Enter a ticker'}
        className="rounded px-2 py-1 text-2xs text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-40">{label}</button>)}
    </form>
  )
}
