import { effectiveFreshness, useSnapshotClock } from '@/api/snapshotHealth'
import { FRESHNESS } from '@shared/freshness'
import { useEffect, useState } from 'react'
import type { Envelope } from '@shared/contract'
import { FOREX_PAIRS, FOREX_RANGES, forexNumber, type ForexPair } from '@shared/forex'
import { api } from '@/api/client'
import { useForex } from '@/api/forexQueries'
import { useForexStore } from '@/stores/forex'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { LineChart } from '@/components/charts/LineChart'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import { directionClass, percent } from '@/lib/format'

function warning(envelope: Envelope<unknown> | undefined, error: Error | null): string | undefined {
  return error?.message || envelope?.meta.failureReason || envelope?.errors.map((entry) => entry.reason).join(' · ') || undefined
}

function Freshness({ envelope, error, freshnessMs }: { envelope?: Envelope<unknown>; error: Error | null; freshnessMs: number }) {
  const now = useSnapshotClock()
  return <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-dim">
    {envelope ? `${envelope.meta.source} · ${effectiveFreshness(envelope, now, freshnessMs)} · collected ${new Date(envelope.meta.fetchedAt).toLocaleTimeString()}` : 'Waiting for source'}
    {warning(envelope, error) ? <span className="ml-2 text-warn">{warning(envelope, error)}</span> : null}
  </div>
}

export function ForexPage({ onStatusChange }: { onStatusChange: (panels: PanelStatus[], path: string) => void }) {
  const { pair, range, setPair, setRange } = useForexStore()
  const { quotes, history, news, refresh } = useForex(pair, range)
  const now = useSnapshotClock()
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    onStatusChange([
      { label: 'Forex rates', envelope: quotes.data, error: quotes.error, enabled: quotes.isEnabled, loading: quotes.isFetching },
      { label: 'Forex chart', envelope: history.data, error: history.error, enabled: history.isEnabled, loading: history.isFetching },
      { label: 'Forex news', envelope: news.data, error: news.error, enabled: news.isEnabled, loading: news.isFetching },
    ], '')
  }, [onStatusChange, quotes.data, quotes.isFetching, history.data, history.isFetching, news.data, news.isFetching])

  const rows = FOREX_PAIRS.map((entry) => ({ ...entry, row: quotes.data?.data.rows.find((row) => row.pair === entry.id) }))
  type Row = typeof rows[number]
  const signed = (id: ForexPair, value: number | undefined) => value === undefined ? '—' : `${value > 0 ? '+' : ''}${forexNumber(id, value)}`
  const rowFreshness = (entry: Row) => entry.row ? effectiveFreshness({ data: null, errors: [], meta: { source: 'Forex quote', freshness: entry.row.freshness, fetchedAt: entry.row.fetchedAt } }, now, FRESHNESS.quotes) : undefined
  const columns: Column<Row>[] = [
    { key: 'pair', header: 'Pair', cell: (entry) => <button className="font-semibold text-text hover:text-accent" onClick={() => setPair(entry.id)} aria-pressed={pair === entry.id}>{entry.id}</button> },
    { key: 'rate', header: 'Rate', numeric: true, align: 'right', cell: (entry) => forexNumber(entry.id, entry.row?.quote?.price) },
    { key: 'change', header: 'Daily change', numeric: true, align: 'right', cell: (entry) => <span className={directionClass(entry.row?.quote?.absChange)}>{signed(entry.id, entry.row?.quote?.absChange)}</span> },
    { key: 'percent', header: 'Daily %', numeric: true, align: 'right', cell: (entry) => <span className={directionClass(entry.row?.quote?.change)}>{entry.row?.quote ? percent(entry.row.quote.change, 2) : '—'}</span> },
    { key: 'status', header: 'Status', cell: (entry) => <span className={rowFreshness(entry) === 'stale' || rowFreshness(entry) === 'failed' ? 'text-warn' : 'text-text-dim'}>{rowFreshness(entry) ?? (quotes.isFetching ? 'loading' : 'unavailable')}</span> },
  ]
  const points = history.data?.data.points ?? []
  const articles = news.data?.data.articles ?? []
  const current = rows.find((entry) => entry.id === pair)?.row?.quote
  return <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
    <div className="flex shrink-0 flex-wrap items-center gap-3">
      <h1 className="text-sm font-bold text-text">Forex</h1>
      <span className="text-2xs text-text-dim">Rates & chart · 1 min / News · 5 min</span>
      <span className="text-2xs text-warn" role="status">{notice}</span>
      <Button className="ml-auto" disabled={refreshing || quotes.isFetching || history.isFetching || news.isFetching} onClick={() => {
        setRefreshing(true)
        setNotice('')
        void refresh().catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error))).finally(() => setRefreshing(false))
      }}>{refreshing ? 'Refreshing…' : 'Refresh'}</Button>
    </div>
    <div className="flex shrink-0 flex-col gap-2 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex shrink-0 flex-col gap-2 lg:min-h-0">
        <Panel title="Currency pairs" warning={warning(quotes.data, quotes.error)} className="min-h-[280px] shrink-0">
          <DataTable rows={rows} columns={columns} rowKey={(entry) => entry.id} onRowClick={(entry) => setPair(entry.id)} rowClassName={(entry) => entry.id === pair ? 'bg-accent/10' : ''} />
          <Freshness envelope={quotes.data} error={quotes.error} freshnessMs={FRESHNESS.quotes} />
        </Panel>
        <Panel title={`${pair} · ${forexNumber(pair, current?.price)}`} warning={warning(history.data, history.error)} className="min-h-[280px] flex-1" actions={<div className="flex gap-1">{FOREX_RANGES.map((entry) => <button key={entry} aria-pressed={range === entry} className={`rounded px-2 py-1 text-2xs ${range === entry ? 'bg-accent/20 text-accent' : 'text-text-dim hover:text-text'}`} onClick={() => setRange(entry)}>{entry}</button>)}</div>}>
          <p className="px-2 pt-2 text-2xs text-text-dim">1 {pair.split('/')[0]} = {forexNumber(pair, current?.price)} {pair.split('/')[1]}</p>
          <LineChart baseline="auto" labels={points.map((point) => new Date(point.time).toLocaleString(undefined, range === '1W' ? { month: 'short', day: 'numeric', hour: '2-digit' } : { month: 'short', day: 'numeric' }))} series={[{ label: pair, color: '#38bdf8', values: points.map((point) => point.value) }]} format={(value) => forexNumber(pair, value)} empty={history.isFetching ? 'Loading chart…' : 'Chart unavailable'} />
          <Freshness envelope={history.data} error={history.error} freshnessMs={FRESHNESS.chartDaily} />
        </Panel>
      </div>
      <Panel title={`${pair} news`} warning={warning(news.data, news.error)} className="h-[420px] shrink-0 lg:h-auto lg:min-h-0">
        <p className="shrink-0 border-b border-border px-2 py-2 text-2xs text-text-dim">Currency and central-bank headlines for {pair.split('/').join(' & ')}</p>
        {articles.length ? <div key={pair} className="min-h-0 flex-1 overflow-y-auto">{articles.map((article) => <button key={article.id} className="block w-full border-b border-border p-3 text-left hover:bg-surface-raised" onClick={() => { void api.openExternal(article.url).catch(() => setNotice('Could not open the article.')) }}>
          <span className="mb-1 block text-2xs text-text-dim">{article.source} · {article.publishedAt ? new Date(article.publishedAt).toLocaleString() : 'Time unavailable'}</span>
          <span className="text-xs leading-relaxed text-text">{article.title}</span>
        </button>)}</div> : <PanelMessage>{news.isFetching ? 'Loading related headlines…' : news.data?.meta.freshness === 'failed' || news.error ? 'News unavailable. Try Refresh.' : 'No relevant headlines available for this pair.'}</PanelMessage>}
        <Freshness envelope={news.data} error={news.error} freshnessMs={FRESHNESS.forexNews} />
      </Panel>
    </div>
  </div>
}
