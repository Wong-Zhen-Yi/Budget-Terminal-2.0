import { useMemo } from 'react'
import type { Candle, FundamentalsPagePayload, StocksPayload } from '@shared/contract'
import type { PltrQuarter } from '@shared/pltr'
import type { FundamentalsChartModel } from '@shared/fundamentalsPage'
import { seriesBarGeometry } from '@shared/fundamentalsPage'
import { api } from '@/api/client'
import { LineChart } from '@/components/charts/LineChart'
import { colorForIndex } from '@/components/charts/Donut'
import { FundamentalsBarChart, FundamentalsChartLegend } from '@/components/fundamentals/FundamentalsBarChart'
import { FilingsTable } from '@/components/fundamentals/FilingsTable'
import { Button } from '@/components/ui/Button'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import { compactCurrency, compactNumber, percent, thousands } from '@/lib/format'

export function VolumeChart({ candles }: { candles: Candle[] }) {
  const maximum = Math.max(1, ...candles.map(candle => candle.volume))
  if (!candles.length) return <PanelMessage>Volume unavailable.</PanelMessage>
  const slot = 1000 / candles.length
  return <svg className="h-full min-h-0 w-full" viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label="PLTR daily trading volume in shares">
    {candles.map((candle, index) => <rect key={candle.time} x={index * slot} y={100 - candle.volume / maximum * 96} width={Math.max(slot * 0.72, 0.1)} height={candle.volume / maximum * 96} fill={candle.close >= candle.open ? 'var(--color-up)' : 'var(--color-down)'} opacity={0.5}><title>{new Date(candle.time * 1000).toISOString().slice(0, 10)} · {compactNumber(candle.volume)} shares</title></rect>)}
  </svg>
}

export function ValuationPanel({ market, financials, warning, onOpen }: {
  market: StocksPayload | undefined
  financials: FundamentalsPagePayload | null
  warning: string
  onOpen: () => void
}) {
  return <Panel title="Valuation & estimates" warning={warning} className="pltr-valuation" actions={<Button onClick={onOpen} aria-label="Open PLTR valuation">↗</Button>}>
    <dl className="min-h-0 flex-1 overflow-auto px-3">
      {[
        ['Trailing P/E', market?.metrics.pe], ['Forward P/E', market?.metrics.forwardPe],
        ['Price / sales', financials?.facts.priceToSales == null ? null : `${financials.facts.priceToSales.toFixed(2)}x`],
        ['Analyst target · mean', market?.targets.mean], ['Upside to mean', percent(market?.targets.upsidePct)],
        ['Analyst coverage', market?.targets.analysts], ['Next earnings', market?.metrics.earningsDate],
      ].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 border-b border-border/60 py-2 text-2xs last:border-0"><dt className="text-text-muted">{label}</dt><dd className="num text-right">{value || '—'}</dd></div>)}
    </dl>
    <p className="shrink-0 border-t border-border p-2 text-2xs text-text-muted">Provider estimates · latest available snapshot.</p>
  </Panel>
}

export function RevenueChart({ history, financials, loading, warning, onOpen }: {
  history: PltrQuarter[]
  financials: FundamentalsPagePayload | null
  loading: boolean
  warning: string
  onOpen: () => void
}) {
  const model = useMemo<FundamentalsChartModel>(() => {
    const metrics = ['revenue', 'freeCashFlow'] as const
    const geometry = seriesBarGeometry(metrics.length)
    const labels = history.map(row => `${row.endDate.slice(0, 4)} Q${Math.ceil(Number(row.endDate.slice(5, 7)) / 3)}`)
    return { title: 'Revenue & cash generation', labels, availablePeriods: history.length, indexed: false, growthBasis: 'year_ago',
      series: metrics.map((metric, index) => ({ metric, name: metric === 'revenue' ? 'Revenue' : 'Free cash flow',
        legendName: metric === 'revenue' ? 'Revenue' : 'Free cash flow', filled: true, ...geometry[index],
        points: history.flatMap((row, slot) => {
          const point = financials?.quarterly[metric].find(point => point.endDate === row.endDate)
          return point && row[metric] !== null ? [{ ...point, rawValue: point.value, growth: null, growthBaseline: '', indexed: false, indexedBaseLabel: '', slot }] : []
        }) })) }
  }, [history, financials])
  return <Panel title="Revenue & cash generation" warning={warning} className="pltr-overview-panel" actions={<Button onClick={onOpen} aria-label="Show PLTR financial performance">↗</Button>}>
    <div className="flex min-h-0 flex-1 flex-col p-2">{model.series.some(series => series.points.length)
      ? <FundamentalsBarChart model={model} />
      : <PanelMessage>{loading ? 'Loading financial history…' : 'Financial history unavailable.'}</PanelMessage>}</div>
    <FundamentalsChartLegend model={model} />
    <p className="shrink-0 px-2 pb-2 text-2xs text-text-muted">Quarterly USD · latest eight available periods</p>
  </Panel>
}

export function FinancialHistory({ history, loading, warning, source, compact = false, onOpen }: {
  history: PltrQuarter[]
  loading: boolean
  warning: string
  source: string
  compact?: boolean
  onOpen?: () => void
}) {
  const rows = compact ? history.slice(-4).reverse() : history
  const headers = compact ? ['Quarter ended', 'Revenue', 'Net income', 'FCF'] : ['Quarter ended', 'Revenue · USD', 'Y/Y', 'Net income · USD', 'FCF · USD', 'R&D · USD', 'Period-end shares', 'Shares Y/Y']
  return <Panel title={compact ? 'Quarterly statements' : 'Financial history · latest eight quarters'} warning={warning} className={compact ? 'pltr-overview-panel' : 'shrink-0'} actions={onOpen ? <Button onClick={onOpen} aria-label="Show all PLTR quarterly statements">↗</Button> : undefined}>
    <div className="min-h-0 flex-1 overflow-auto"><table className="w-full whitespace-nowrap text-2xs"><thead className="bg-surface-raised text-text-muted"><tr>{headers.map(label => <th key={label} className="p-2 text-right font-normal first:text-left">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.endDate} className="num border-t border-border/50 text-right hover:bg-surface-hover"><td className="p-2 text-left">{row.endDate}</td><td className="p-2">{compactCurrency(row.revenue)}</td>{!compact ? <td className="p-2">{percent(row.revenueGrowth)}</td> : null}<td className="p-2">{compactCurrency(row.netIncome)}</td><td className="p-2">{compactCurrency(row.freeCashFlow)}</td>{!compact ? <><td className="p-2">{compactCurrency(row.researchDevelopment)}</td><td className="p-2">{thousands(row.sharesOutstanding)}</td><td className="p-2">{percent(row.shareGrowth)}</td></> : null}</tr>)}</tbody></table>{!rows.length ? <PanelMessage>{loading ? 'Loading statements…' : 'Quarterly statements unavailable.'}</PanelMessage> : null}</div>
    <p className="shrink-0 border-t border-border p-2 text-2xs text-text-muted">{compact ? `USD · quarter ended ${history.at(-1)?.endDate ?? 'unavailable'}` : `${source || 'SEC EDGAR with Yahoo fallback'} · USD · gaps indicate unavailable data. FCF = operating cash flow less capital expenditure, distinct from adjusted FCF. Shares are period-end outstanding; Y/Y compares matching fiscal dates.`}</p>
  </Panel>
}

export function LatestSources({ market, financials, loading, warning, onOpen }: {
  market: StocksPayload | undefined
  financials: FundamentalsPagePayload | null
  loading: boolean
  warning: string
  onOpen: () => void
}) {
  const filing = [...financials?.sec.filings ?? []].sort((a, b) => b.filedDate.localeCompare(a.filedDate))[0]
  const news = market?.news[0]
  return <Panel title="Latest sources" warning={warning} className="pltr-overview-panel" actions={<Button onClick={onOpen}>News & filings ↗</Button>}>
    <div className="min-h-0 flex-1 overflow-auto">
      {filing ? <button className="block w-full border-b border-border p-3 text-left text-2xs hover:bg-surface-hover" onClick={() => { void api.openExternal(filing.documentUrl) }}><div className="mb-1 text-text-muted">SEC filing · {filing.form}</div><div>{filing.description || 'Company filing'} ↗</div><div className="mt-1 text-text-muted">Filed {filing.filedDate || 'date unavailable'}</div></button> : <PanelMessage>{loading ? 'Loading filings…' : 'SEC filings unavailable.'}</PanelMessage>}
      {news ? <button className="block w-full p-3 text-left text-2xs hover:bg-surface-hover" onClick={() => { void api.openExternal(news.url) }}><div className="mb-1 text-text-muted">Company news</div><div>{news.title} ↗</div><div className="mt-1 text-text-muted">{news.source} · {news.publishedAt ? new Date(news.publishedAt).toLocaleDateString() : 'Date unavailable'}</div></button> : <PanelMessage>{loading ? 'Loading headlines…' : 'No headlines available.'}</PanelMessage>}
    </div>
  </Panel>
}

export function FinancialCharts({ history, loading, warning }: { history: PltrQuarter[]; loading: boolean; warning: string }) {
  return <div className="grid gap-3 xl:grid-cols-2">{[
    { title: 'Revenue and GAAP net income · quarterly USD', keys: ['revenue', 'netIncome'] as const, labels: ['Revenue', 'GAAP net income'], offset: 0 },
    { title: 'Cash generation · quarterly USD', keys: ['operatingCashFlow', 'freeCashFlow'] as const, labels: ['Operating cash flow', 'Free cash flow'], offset: 2 },
  ].map(({ title, keys, labels, offset }) => <Panel key={title} title={title} warning={warning} className="h-[300px]">
    <div className="flex min-h-0 flex-1 p-2"><LineChart labels={history.map(row => row.endDate)} series={keys.map((key, index) => ({ label: labels[index], values: history.map(row => row[key]), color: colorForIndex(index + offset) }))} format={compactCurrency} empty={loading ? 'Loading financial history…' : 'Financial history unavailable.'} /></div>
    <div className="flex shrink-0 flex-wrap gap-3 px-3 pb-2 text-2xs text-text-muted">{labels.map((label, index) => <span key={label} className="flex items-center gap-1"><span className="inline-block h-0.5 w-3" style={{ backgroundColor: colorForIndex(index + offset) }} />{label}</span>)}</div>
  </Panel>)}</div>
}

export function SourcePanels({ market, financials, marketLoading, financialLoading, marketWarning, financialWarning }: {
  market: StocksPayload | undefined
  financials: FundamentalsPagePayload | null
  marketLoading: boolean
  financialLoading: boolean
  marketWarning: string
  financialWarning: string
}) {
  return <div className="grid gap-3 xl:grid-cols-2">
    <Panel title="PLTR news" warning={marketWarning} className="h-[520px]"><div className="overflow-auto">{market?.news.length ? market.news.map(row => <button key={row.id || row.url} className="block w-full border-b border-border/50 p-3 text-left text-2xs hover:bg-surface-hover" onClick={() => { void api.openExternal(row.url) }}><div>{row.title} ↗</div><div className="mt-1 text-text-muted">{row.source} · {row.publishedAt ? new Date(row.publishedAt).toLocaleString() : 'Date unavailable'}</div></button>) : <PanelMessage>{marketLoading ? 'Loading headlines…' : 'No headlines available.'}</PanelMessage>}</div></Panel>
    <Panel title="SEC filings · PLTR" warning={financialWarning} className="h-[520px]">{financialLoading && !financials ? <PanelMessage>Loading filings…</PanelMessage> : <FilingsTable filings={financials?.sec.filings ?? []} />}</Panel>
  </div>
}

export function OwnershipPanels({ market, loading, warning }: { market: StocksPayload | undefined; loading: boolean; warning: string }) {
  return <div className="grid gap-3">
    <Panel title="Institutional ownership" warning={warning} className="min-h-[180px]"><div className="overflow-auto"><table className="w-full whitespace-nowrap text-2xs"><thead className="bg-surface-raised text-text-muted"><tr>{['Holder', '% held', 'Shares', 'Value', 'Change', 'Reported'].map(label => <th key={label} className="p-2 text-left font-normal">{label}</th>)}</tr></thead><tbody>{market?.institutional.map((row, index) => <tr key={`${row.holder}:${index}`} className="border-t border-border/50"><td className="p-2">{row.holder}</td>{[row.pctHeld, row.shares, row.value, row.pctChange, row.reported].map((value, index) => <td key={index} className="num p-2">{value || '—'}</td>)}</tr>)}</tbody></table>{!market?.institutional.length ? <PanelMessage>{loading ? 'Loading holders…' : 'Institutional ownership unavailable.'}</PanelMessage> : null}</div></Panel>
    <Panel title="Insider transactions" warning={warning} className="min-h-[180px]"><div className="overflow-auto"><table className="w-full whitespace-nowrap text-2xs"><thead className="bg-surface-raised text-text-muted"><tr>{['Date', 'Insider', 'Title', 'Transaction', 'Shares', 'Value'].map(label => <th key={label} className="p-2 text-left font-normal">{label}</th>)}</tr></thead><tbody>{market?.insiders.map((row, index) => <tr key={`${row.date}:${index}`} className="border-t border-border/50">{[row.date, row.insider, row.title, row.transaction, row.shares, row.value].map((value, index) => <td key={index} className="p-2">{value || '—'}</td>)}</tr>)}</tbody></table>{!market?.insiders.length ? <PanelMessage>{loading ? 'Loading transactions…' : 'Insider transactions unavailable.'}</PanelMessage> : null}</div></Panel>
  </div>
}
