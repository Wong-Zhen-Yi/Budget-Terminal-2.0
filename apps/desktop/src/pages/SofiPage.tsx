import { useEffect, useMemo, useState } from 'react'
import { SOFI_METRICS } from '@shared/sofi'
import type { SofiMetric, SofiQuarter, SofiUnit } from '@shared/sofi'
import { STOCKS_RANGE_PRESETS } from '@shared/contract'
import type { StocksRangePreset } from '@shared/contract'
import { useSofi, useRefreshSofi } from '@/api/sofiQueries'
import { api } from '@/api/client'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { LineChart } from '@/components/charts/LineChart'
import { colorForIndex } from '@/components/charts/Donut'
import { Button } from '@/components/ui/Button'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import { compactCurrency, compactNumber, currency, decimals, EM_DASH, percent } from '@/lib/format'

const quarterLabel = (date: string) => `Q${Math.ceil(Number(date.slice(5, 7)) / 3)} ${date.slice(0, 4)}`
const ratio = (value: number | null | undefined) => value === null || value === undefined ? EM_DASH : `${decimals(value, 2)}x`
const metricFormat = (value: number | null, unit: SofiUnit) => unit === 'USD' ? compactCurrency(value) : unit === 'USD/share' ? currency(value)
  : unit === 'ratio' ? decimals(value, 2) : compactNumber(value)

function Tile({ label, value, sub, title }: { label: string; value: string; sub: string; title?: string }) {
  return <div className="flex min-w-0 flex-col gap-1 border border-border bg-surface px-3 py-2" title={title}>
    <span className="truncate text-2xs text-text-muted">{label}</span>
    <span className="num truncate text-lg font-bold text-text">{value}</span>
    <span className="truncate text-2xs text-text-dim">{sub}</span>
  </div>
}

function Trend({ title, quarters, metrics, unit, warning, loading }: {
  title: string; quarters: SofiQuarter[]; metrics: SofiMetric[]; unit: SofiUnit; warning?: string; loading: boolean
}) {
  const series = metrics.map((metric, index) => ({ label: SOFI_METRICS.find(([key]) => key === metric)![1],
    color: colorForIndex(index), values: quarters.map(quarter => quarter.values[metric]) }))
  return <Panel title={title} warning={warning} className="h-[245px]">
    <div className="flex flex-wrap gap-x-3 gap-y-1 px-2 pt-2 text-2xs text-text-muted">
      {series.map(item => <span key={item.label}><span style={{ color: item.color }}>●</span> {item.label}</span>)}
    </div>
    <div className="flex min-h-0 flex-1 flex-col p-2"><LineChart labels={quarters.map(quarter => quarterLabel(quarter.endDate))}
      series={series} format={value => metricFormat(value, unit)} baseline="auto"
      empty={loading ? 'Loading reported quarters...' : 'Reported metrics unavailable'} /></div>
  </Panel>
}

export function SofiPage({ onStatusChange }: { onStatusChange: (panels: PanelStatus[], sourcePath: string) => void }) {
  const query = useSofi()
  const refresh = useRefreshSofi()
  const [range, setRange] = useState<StocksRangePreset>('1Y')
  const [notice, setNotice] = useState('')
  const payload = query.data?.data
  const reports = payload?.reports
  const quarters = reports?.quarters ?? []
  const latest = quarters.at(-1)
  const loading = query.isFetching
  const reportWarning = query.data?.errors.filter(error => error.symbol === 'reports').map(error => error.reason).join(' · ') || undefined
  const marketWarning = query.data?.errors.filter(error => error.symbol === 'market').map(error => error.reason).join(' · ') || undefined

  useEffect(() => {
    const panels: PanelStatus[] = ['market', 'reports'].map(block => {
      const errors = query.data?.errors.filter(error => error.symbol === block) ?? []
      const progress = payload?.progress[block as 'market' | 'reports']
      return { label: block === 'market' ? 'SOFI market' : 'SOFI reported quarters', loading,
        envelope: query.data ? { ...query.data, errors, meta: { ...query.data.meta,
          freshness: progress === 'unavailable' ? 'failed' : progress === 'stale' ? 'stale' : progress === 'partial' ? 'partial' : query.data.meta.freshness === 'cached' ? 'cached' : 'fresh',
          failureReason: errors.map(error => error.reason).join(' · ') || undefined } } : undefined }
    })
    onStatusChange(panels, '')
  }, [query.data, payload, loading, onStatusChange])

  const candles = useMemo(() => {
    const all = payload?.market?.chart.candles ?? []
    const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '3Y': 36 }
    const end = all.at(-1)?.time
    if (!end) return []
    const start = new Date(end * 1000)
    start.setUTCMonth(start.getUTCMonth() - (months[range as keyof typeof months] ?? 12))
    return all.filter(candle => candle.time * 1000 >= start.getTime())
  }, [payload?.market?.chart.candles, range])

  const onRefresh = async () => {
    setNotice('')
    try { await refresh() } catch (error) { setNotice(`Refresh failed: ${error instanceof Error ? error.message : String(error)}`) }
  }
  const sourceTitle = (metric: SofiMetric, quarter: SofiQuarter | undefined) => {
    const source = quarter?.sources[metric]
    return source ? `Period ended ${quarter!.endDate}\nPublished ${source.publishedAt || 'date unavailable'}\n${source.url}` : 'Reported value unavailable'
  }
  const bookDate = payload?.valuation.bookAsOf
  const quoteTime = payload?.priceAsOf ? new Date(payload.priceAsOf).toLocaleString('en-US', { hour12: false }) : 'unavailable'
  const status = loading ? 'Loading SOFI dashboard...' : query.isError ? `SOFI load failed: ${query.error.message}`
    : !payload ? 'SOFI data unavailable' : `Market ${payload.progress.market} · Reports ${payload.progress.reports} · ${quarters.length}/8 quarters`

  return <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <h1 className="text-sm font-semibold text-text">SOFI — SoFi Technologies</h1>
      <span className="ml-auto text-2xs text-text-muted">{status}</span>
      <Button variant="accent" onClick={() => void onRefresh()} disabled={loading}>{loading ? 'Refreshing...' : 'Refresh'}</Button>
    </div>
    {notice || query.isError || query.data?.errors.length ? <div role="status" className="shrink-0 border border-warn/40 bg-surface p-2 text-2xs text-warn">
      {notice || (query.isError ? query.error.message : query.data?.meta.failureReason)}
    </div> : null}
    <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      <Tile label="Share price" value={currency(payload?.price)} sub={`Daily change ${percent(payload?.changePct)}`} title={`Yahoo Finance · quote retrieved ${quoteTime}`} />
      <Tile label="Market capitalization" value={payload?.market?.metrics.marketCap && payload.market.metrics.marketCap !== 'N/A' ? `$${payload.market.metrics.marketCap}` : EM_DASH} sub="Yahoo Finance · USD" />
      <Tile label="P/E" value={payload?.market?.metrics.pe ?? EM_DASH} sub="Trailing · Yahoo Finance" />
      <Tile label="Price-to-book (P/B)" value={ratio(payload?.valuation.priceToBook)} sub={bookDate ? `GAAP book · ${quarterLabel(bookDate)}` : 'Book value unavailable'} title={`Share price ÷ reported book value per share\nQuote retrieved ${quoteTime}\n${sourceTitle('bookValuePerShare', latest)}`} />
      <Tile label="Price-to-tangible-book" value={ratio(payload?.valuation.priceToTangibleBook)} sub={bookDate ? `Non-GAAP book · ${quarterLabel(bookDate)}` : 'Tangible book unavailable'} title={`Share price ÷ reported tangible book value per share\nQuote retrieved ${quoteTime}\n${sourceTitle('tangibleBookValuePerShare', latest)}`} />
      <Tile label="Technology Platform accounts" value={compactNumber(latest?.values.technologyAccounts)} sub={latest ? `Reported · ${quarterLabel(latest.endDate)}` : 'Reported accounts unavailable'} title={sourceTitle('technologyAccounts', latest)} />
    </div>
    <Panel title={`Book valuation · ${bookDate ?? 'report date unavailable'}`} warning={reportWarning} className="shrink-0">
      <div className="grid grid-cols-2 gap-2 p-2 lg:grid-cols-4">
        <Tile label="Book value per share" value={currency(latest?.values.bookValuePerShare)} sub="GAAP · period-end common shares" title={sourceTitle('bookValuePerShare', latest)} />
        <Tile label="Tangible book per share" value={currency(latest?.values.tangibleBookValuePerShare)} sub="Non-GAAP · SoFi reported basis" title={sourceTitle('tangibleBookValuePerShare', latest)} />
        <Tile label="Members" value={compactNumber(latest?.values.members)} sub={latest ? `At ${latest.endDate}` : 'Unavailable'} title={sourceTitle('members', latest)} />
        <Tile label="Products per member" value={decimals(latest?.values.productsPerMember, 2)} sub={`Products ${compactNumber(latest?.values.products)}`} title="Reported total products ÷ reported total members" />
      </div>
      <p className="px-2 pb-2 text-2xs text-text-muted">P/B = share price ÷ book value per share. Price-to-tangible-book uses SoFi’s reported non-GAAP tangible book per share. Quote retrieved {quoteTime}; book values are as of {bookDate ?? 'unavailable'}.</p>
      <details className="border-t border-border p-2 text-2xs text-text-muted"><summary className="cursor-pointer text-accent">Reported tangible book reconciliation</summary>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
          {SOFI_METRICS.filter(([key]) => ['equity', 'goodwill', 'intangibles', 'deferredTaxes', 'tangibleEquity', 'commonShares'].includes(key)).map(([key, label, unit]) =>
            <div key={key} className="flex flex-wrap justify-between gap-1" title={sourceTitle(key, latest)}><dt>{label}</dt><dd className="num text-text">{metricFormat(latest?.values[key] ?? null, unit)}</dd></div>)}
        </dl>
        <p className="mt-2">Tangible book = permanent equity less goodwill and intangible assets, plus related deferred tax liabilities. Ratios are unavailable for missing or nonpositive book values.</p>
      </details>
    </Panel>
    <Panel title="SOFI price · USD" warning={marketWarning} className="h-[300px] shrink-0"
      actions={<div className="flex gap-1">{STOCKS_RANGE_PRESETS.map(preset => <Button key={preset} variant="toggle" active={range === preset} onClick={() => setRange(preset)}>{preset}</Button>)}</div>}>
      <div className="flex min-h-0 flex-1 flex-col p-2"><LineChart labels={candles.map(candle => new Date(candle.time * 1000).toISOString().slice(0, 10))}
        series={[{ label: 'SOFI', color: colorForIndex(0), values: candles.map(candle => candle.close) }]}
        format={value => currency(value)} baseline="auto" empty={loading ? 'Loading SOFI price history...' : 'SOFI price history unavailable'} /></div>
    </Panel>
    <div className="grid shrink-0 grid-cols-1 gap-2 lg:grid-cols-2">
      <Trend title="Members & products" quarters={quarters} metrics={['members', 'products']} unit="count" warning={reportWarning} loading={loading} />
      <Trend title="Deposits · period-end USD" quarters={quarters} metrics={['deposits']} unit="USD" warning={reportWarning} loading={loading} />
      <Trend title="Loan originations · quarterly USD" quarters={quarters} metrics={['personalOriginations', 'studentOriginations', 'homeOriginations']} unit="USD" warning={reportWarning} loading={loading} />
      <Trend title="Revenue & profit · quarterly USD" quarters={quarters} metrics={['revenue', 'netIncome', 'adjustedEbitda']} unit="USD" warning={reportWarning} loading={loading} />
      <Trend title="Segment net revenue · quarterly USD" quarters={quarters} metrics={['lendingRevenue', 'financialServicesRevenue', 'technologyRevenue']} unit="USD" warning={reportWarning} loading={loading} />
      <Trend title="Segment contribution profit · quarterly USD" quarters={quarters} metrics={['lendingProfit', 'financialServicesProfit', 'technologyProfit']} unit="USD" warning={reportWarning} loading={loading} />
      <Trend title="Diluted EPS · GAAP" quarters={quarters} metrics={['eps']} unit="USD/share" warning={reportWarning} loading={loading} />
      <Trend title="Technology Platform accounts" quarters={quarters} metrics={['technologyAccounts']} unit="count" warning={reportWarning} loading={loading} />
    </div>
    <Panel title="Eight reported quarters" warning={reportWarning} className="shrink-0">
      {!quarters.length ? <PanelMessage>{loading ? 'Loading quarterly operating metrics...' : 'SoFi quarterly reports unavailable'}</PanelMessage> :
        <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-2xs">
          <thead><tr className="border-b border-border bg-surface-raised"><th className="p-2 text-left text-text-muted">Metric · USD unless stated</th>
            {[...quarters].reverse().map(quarter => <th key={quarter.endDate} className="px-2 py-2 text-right text-text-muted" title={quarter.endDate}>{quarterLabel(quarter.endDate)}</th>)}</tr></thead>
          <tbody>{SOFI_METRICS.filter(([key]) => !['equity', 'goodwill', 'intangibles', 'deferredTaxes', 'tangibleEquity', 'commonShares'].includes(key)).map(([metric, label, unit]) =>
            <tr key={metric} className="border-b border-border/50 hover:bg-surface-hover"><th className="px-2 py-1 text-left font-normal text-text-muted">{label}</th>
              {[...quarters].reverse().map(quarter => <td key={quarter.endDate} className="num px-2 py-1 text-right text-text" title={sourceTitle(metric, quarter)}>
                {quarter.sources[metric] ? <button className="cursor-pointer hover:text-accent" aria-label={`${label} source for ${quarterLabel(quarter.endDate)}`} onClick={() => void api.openExternal(quarter.sources[metric]!.url)}>{metricFormat(quarter.values[metric], unit)}</button> : EM_DASH}
              </td>)}
            </tr>)}</tbody>
        </table></div>}
    </Panel>
    <div className="grid shrink-0 grid-cols-1 gap-2 lg:grid-cols-2">
      <Panel title="Earnings releases & definitions" warning={reportWarning}>
        <div className="space-y-2 p-2 text-2xs text-text-muted">
          {reports?.releases.map(release => <button key={release.url} className="block cursor-pointer text-left text-accent hover:underline" onClick={() => void api.openExternal(release.url)}>
            {quarterLabel(release.endDate)} earnings release · published {release.publishedAt || 'date unavailable'}
          </button>)}
          {!reports?.releases.length ? <p>{loading ? 'Loading source releases...' : 'Earnings releases unavailable'}</p> : null}
          <p>Deposits, members, products and accounts are period-end figures. Revenue, profit and originations cover the quarter. Products per member is calculated from reported totals. Gaps indicate unavailable data.</p>
          {reports?.notes.map(note => <p key={note}>{note}</p>)}
        </div>
      </Panel>
      <Panel title="Recent SEC filings">
        <div className="space-y-2 p-2 text-2xs">
          {reports?.filings.map(filing => <button key={filing.accessionNumber} className="block cursor-pointer text-left text-accent hover:underline" onClick={() => void api.openExternal(filing.documentUrl)}>
            {filing.form} · {filing.filedDate} · {filing.reportPeriod || filing.description}
          </button>)}
          {!reports?.filings.length ? <p className="text-text-muted">{loading ? 'Loading filing links...' : 'SEC filing links unavailable'}</p> : null}
        </div>
      </Panel>
    </div>
  </div>
}
