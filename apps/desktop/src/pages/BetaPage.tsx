import { useEffect, useMemo, useState } from 'react'
import { TRADING_VOLUME_INTERVALS, type TradingVolumeInterval } from '@shared/contract'
import { rankRows, TRADING_VOLUME_METRICS } from '@shared/tradingVolumes'
import { useRefreshTradingVolumes, useTradingVolumes } from '@/api/tradingVolumeQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { BetaDotPlot } from '@/components/tradingvolumes/BetaDotPlot'
import { Button } from '@/components/ui/Button'

export function BetaPage({ onStatusChange }: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  // Share the expensive history query while keeping this page's controls independent.
  const query = useTradingVolumes()
  const refresh = useRefreshTradingVolumes()
  const [interval, setInterval] = useState<TradingVolumeInterval>('30d')
  const [search, setSearch] = useState('')
  const [excluded, setExcluded] = useState('')
  const rows = useMemo(() => {
    const ranked = rankRows(query.data?.data.rows ?? [], interval)
    const tickers = search.toUpperCase().split(/[\s,]+/).filter(Boolean)
    const excludedTickers = new Set(excluded.toUpperCase().split(/[\s,]+/).filter(Boolean))
    return ranked.filter((row) => !excludedTickers.has(row.ticker) &&
      (!tickers.length || tickers.some((ticker) => row.ticker.includes(ticker))))
  }, [query.data, interval, search, excluded])
  useEffect(() => {
    onStatusChange([{ label: 'Beta', envelope: query.data, loading: query.isFetching }], '')
  }, [onStatusChange, query.data, query.isFetching])
  return <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <h1 className="pr-2 text-sm font-semibold text-text">Beta</h1>
      <input aria-label="Filter Beta tickers" placeholder="Filter tickers, e.g. AAPL, MSFT" value={search} onChange={(event) => setSearch(event.target.value)} className="h-8 w-60 border border-border-strong bg-surface-raised px-2 text-2xs text-text" />
      <label className="flex items-center gap-2 text-2xs text-text-muted">
        Exclude tickers
        <input aria-label="Exclude Beta tickers" placeholder="e.g. BNC, AAPL" title="Hide exact ticker symbols, separated by commas or spaces. The plot rescales automatically." value={excluded} onChange={(event) => setExcluded(event.target.value)} className="h-8 w-44 border border-border-strong bg-surface-raised px-2 text-2xs text-text" />
      </label>
      {excluded && <Button onClick={() => setExcluded('')}>Clear exclusions</Button>}
      <Button disabled={query.isFetching} onClick={() => void refresh()}>{query.isFetching ? 'Refreshing...' : 'Refresh'}</Button>
      <span className="ml-auto text-2xs text-text-muted">{query.isFetching ? 'Loading Beta history...' : query.data?.meta.freshness === 'failed' ? 'Beta history unavailable. Try Refresh.' : `${rows.length} stocks shown`}</span>
    </div>
    <div className="flex min-h-0 flex-1 flex-col border border-border bg-surface">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border p-2">
        <span className="mr-auto text-2xs text-text-muted">Rolling 60-session Beta vs S&P 500 • Top 100 stocks by daily dollar volume</span>
        {TRADING_VOLUME_INTERVALS.map((key) => <Button key={key} variant="toggle" active={key === interval} onClick={() => setInterval(key)}>{TRADING_VOLUME_METRICS[key].label}</Button>)}
      </div>
      <BetaDotPlot rows={rows} interval={interval} />
    </div>
  </div>
}
