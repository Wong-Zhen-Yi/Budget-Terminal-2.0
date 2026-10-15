import { effectiveFreshness, feedErrorText, useSnapshotClock } from '@/api/snapshotHealth'
import { FRESHNESS } from '@shared/freshness'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LogicalRange } from 'lightweight-charts'
import { STOCKS_RANGE_PRESETS } from '@shared/contract'
import type { StocksRangePreset } from '@shared/contract'
import { AVGO_BLOCKS, avgoHistory, buildAvgoSnapshot } from '@shared/avgo'
import type { AvgoBlock, AvgoMetric } from '@shared/avgo'
import type { FundamentalsChartModel } from '@shared/fundamentalsPage'
import { seriesBarGeometry } from '@shared/fundamentalsPage'
import { api } from '@/api/client'
import { useAvgo, useRefreshAvgo } from '@/api/avgoQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Donut, colorForIndex } from '@/components/charts/Donut'
import { FundamentalsBarChart, FundamentalsChartLegend } from '@/components/fundamentals/FundamentalsBarChart'
import { StocksChart } from '@/components/stocks/StocksChart'
import { FilingsTable } from '@/components/fundamentals/FilingsTable'
import { DataTable } from '@/components/ui/DataTable'
import { Button } from '@/components/ui/Button'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import { compactCurrency, currency, percent, plainPercent, signedCurrencyPrecise } from '@/lib/format'
import '@/styles/avgo.css'

const SECTIONS = ['Overview', 'AI & segments', 'Financials', 'Guidance', 'News & filings'] as const
type Section = (typeof SECTIONS)[number]

function metricText(metric: AvgoMetric | undefined): string {
  if (!metric || metric.value === null) return 'Not disclosed'
  const value = metric.unit === 'USD' ? compactCurrency(metric.value) : metric.unit === 'USD/share' ? currency(metric.value)
    : metric.unit === '%' ? plainPercent(metric.value, 1) : metric.value.toLocaleString('en-US')
  return metric.text && (metric.basis === 'outlook' || /^(over|approximately|about)$/i.test(metric.text)) ? `${metric.text} ${value}` : value
}
function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="avgo-kpi"><div className="text-2xs text-text-muted">{label}</div><div className="num my-1 text-xl font-semibold text-text" title={value}>{value}</div><div className="text-2xs text-text-muted" title={sub}>{sub}</div></div>
}
function Metrics({ rows, empty }: { rows: AvgoMetric[]; empty: string }) {
  return <DataTable columns={[
    { key: 'label', header: 'Metric', cell: row => row.label, width: '45%', wrap: true },
    { key: 'basis', header: 'Basis', cell: row => row.basis, width: '20%', wrap: true },
    { key: 'value', header: 'Value', align: 'right', numeric: true, cell: row => <div className="flex justify-end gap-2"><span title={row.text}>{metricText(row)}</span><button className="shrink-0 text-accent hover:underline" title={row.sourceUrl} onClick={() => void api.openExternal(row.sourceUrl)}>Source</button></div>, wrap: true },
  ]} rows={rows} rowKey={row => row.id} layout="fixed" empty={empty} />
}

export function AvgoPage({ onStatusChange, onNavigate }: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate: (tabId: string, symbol?: string) => void
}) {
  const query = useAvgo()
  const now = useSnapshotClock()
  const freshness = query.data ? effectiveFreshness(query.data, now, FRESHNESS.avgo) : 'unavailable'
  const refresh = useRefreshAvgo()
  const [notice, setNotice] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [range, setRange] = useState<StocksRangePreset>('1Y')
  const [logicalRange, setLogicalRange] = useState<LogicalRange | null>(null)
  const [section, setSection] = useState<Section>('Overview')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const payload = query.data?.data
  const market = payload?.market
  const earnings = payload?.earnings
  const busy = query.isFetching || refreshing
  const history = useMemo(() => avgoHistory(payload?.financials ?? null), [payload?.financials])
  const cashModel = useMemo<FundamentalsChartModel>(() => {
    const metrics = ['revenue', 'operatingCashFlow', 'freeCashFlow'] as const
    const names = ['Revenue', 'Operating cash flow', 'Free cash flow']
    // Keep actual fiscal end dates rather than assuming calendar-quarter labels.
    const dates = history.dates.slice(-8)
    const geometry = seriesBarGeometry(metrics.length)
    return { title: 'Revenue & cash generation', labels: dates, availablePeriods: dates.length, indexed: false, growthBasis: 'year_ago',
      series: metrics.map((key, index) => ({ metric: key, name: names[index], legendName: names[index], filled: true, ...geometry[index],
        points: dates.flatMap((date, slot) => {
          const point = payload?.financials?.quarterly[key].find(point => point.endDate === date)
          return point && Number.isFinite(point.value) ? [{ ...point, rawValue: point.value, growth: null, growthBaseline: '', indexed: false, indexedBaseLabel: '', slot }] : []
        }) })) }
  }, [history, payload?.financials])
  useEffect(() => onStatusChange([{ label: 'AVGO', envelope: query.data, error: query.error, enabled: query.isEnabled, loading: busy }], ''), [onStatusChange, query.data, query.error, query.isEnabled, busy])
  const warning = (block: AvgoBlock) => query.data?.errors.filter(error => error.symbol === block).map(error => error.reason).join(' · ') || undefined
  const empty = (block: AvgoBlock) => busy ? 'Loading Broadcom data...' : warning(block) || query.error?.message || `${block} data unavailable`
  const metric = (id: string) => earnings?.metrics.find(row => row.id === id)
  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    setNotice('')
    try { await refresh() } catch (error) { setNotice(`Refresh failed: ${error instanceof Error ? error.message : String(error)}`) }
    finally { setRefreshing(false) }
  }, [refresh])
  const onExport = async () => {
    if (!payload) return
    try {
      await api.writeClipboard(buildAvgoSnapshot(payload))
      setNotice('AVGO snapshot copied to clipboard.')
    }
    catch (error) { setNotice(`Export failed: ${error instanceof Error ? error.message : String(error)}`) }
  }
  const laneStatus = (block: AvgoBlock) => <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-muted">
    {block} · {payload?.progress[block] ?? (busy ? 'loading' : 'unavailable')}{payload?.laneFetchedAt[block] ? ` · fetched ${new Date(payload.laneFetchedAt[block]).toLocaleString()}` : ''}
  </div>
  const source = earnings ? <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-t border-border px-2 py-1 text-2xs text-text-muted">
    <button className="text-accent hover:underline" onClick={() => void api.openExternal(earnings.sourceUrl)}>Earnings release</button>
    <span>{earnings.period} · ended {earnings.periodEnd || '--'} · published {earnings.publishedAt || '--'}</span>
  </div> : null
  const status = notice || (busy ? 'Loading AVGO...' : query.error ? `AVGO load failed: ${query.error.message}` : query.data ? `${freshness} · ${earnings?.period ?? 'earnings unavailable'}` : 'AVGO data unavailable')
  const mix = earnings?.segments.map((segment, index) => ({ label: segment.name, value: segment.revenue, color: colorForIndex(index) })) ?? []

  const price = market?.chart.stats
  const detailAction = (target: Section) => <Button aria-label={`Show AVGO ${target}`} onClick={() => setSection(target)}>↗</Button>
  const cashChart = <Panel title="Revenue & cash generation" className={section === 'Overview' ? 'avgo-overview-panel' : 'h-[420px]'} warning={warning('financials')} actions={section === 'Overview' ? detailAction('Financials') : undefined}>
    <FundamentalsChartLegend model={cashModel} />
    <div className="flex min-h-0 flex-1 flex-col p-2" data-avgo-cash-chart>
      {cashModel.series.some(series => series.points.length) ? <FundamentalsBarChart model={cashModel} /> : <PanelMessage>{empty('financials')}</PanelMessage>}
    </div>
    <p className="shrink-0 px-3 pb-2 text-2xs text-text-muted">Quarterly USD · fiscal period ends · FCF = operating cash flow − capex</p>
  </Panel>
  const revenueMix = <Panel title="Revenue mix" className={section === 'Overview' ? 'avgo-overview-panel' : 'h-[390px]'} warning={warning('earnings')} actions={section === 'Overview' ? detailAction('AI & segments') : undefined}>
    <div className="flex h-[150px] shrink-0 overflow-hidden" data-avgo-mix-chart><Donut compact slices={mix} centerSubtext="Revenue" centerText={earnings ? compactCurrency(metric('revenue')?.value) : '--'} empty={empty('earnings')} /></div>
    <DataTable columns={[
      { key: 'name', header: 'Segment', cell: (row, index) => <span><span className="mr-1 inline-block size-2" style={{ background: colorForIndex(index) }} />{row.name}</span>, width: '48%', wrap: true },
      { key: 'revenue', header: 'Revenue', cell: row => compactCurrency(row.revenue), align: 'right', numeric: true },
      { key: 'share', header: 'Mix', cell: row => plainPercent(row.share, 0), align: 'right', numeric: true },
      { key: 'growth', header: 'YoY', cell: row => plainPercent(row.growth, 0), align: 'right', numeric: true },
    ]} rows={earnings?.segments ?? []} rowKey={row => row.name} layout="fixed" empty={empty('earnings')} />
    <div className="shrink-0 px-2 py-1 text-2xs text-text-muted">{earnings?.period ?? 'Period unavailable'} · earnings release</div>
  </Panel>
  const guidance = <Panel title={`Next-quarter guidance · ${earnings?.guidancePeriod ?? '--'}`} className="h-[390px]" warning={warning('earnings')}>
    <Metrics rows={earnings?.guidance ?? []} empty={empty('earnings')} /><p className="shrink-0 p-3 text-2xs text-text-muted">Management outlook as of the release date; approximate and lower-bound disclosures retain their wording.</p>{source}{laneStatus('earnings')}
  </Panel>
  const news = <Panel title="AVGO news" className="h-[420px]" warning={warning('market')}>
    <DataTable columns={[
      { key: 'title', header: 'Headline', cell: row => <button className="text-left text-accent hover:underline" onClick={() => void api.openExternal(row.url)}>{row.title}</button>, wrap: true, width: '70%' },
      { key: 'source', header: 'Source / date', cell: row => `${row.source} · ${new Date(row.publishedAt).toLocaleDateString()}`, wrap: true },
    ]} rows={market?.news ?? []} rowKey={row => row.id} layout="fixed" empty={market ? 'No recent AVGO headlines.' : empty('market')} />{laneStatus('market')}
  </Panel>
  const filings = <Panel title="Broadcom SEC filings" className="h-[420px]" warning={warning('financials')}>{payload?.financials ? <FilingsTable filings={payload.financials.sec.filings} compact /> : <PanelMessage>{empty('financials')}</PanelMessage>}{laneStatus('financials')}</Panel>
  const latestFiling = [...payload?.financials?.sec.filings ?? []].sort((a, b) => b.filedDate.localeCompare(a.filedDate))[0]

  return <div className="avgo-page flex min-h-0 min-w-0 flex-1 flex-col overflow-auto" data-avgo-page data-avgo-section={section}>
    <header className="avgo-heading">
      <div>
        <h1 className="text-xl font-semibold text-text">AVGO — Broadcom</h1>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-text-muted">
          <span>{market?.company.exchange || 'Exchange unavailable'}</span><span>{market?.company.industry || 'Semiconductors & infrastructure software'}</span><span>USD</span>
        </div>
      </div>
      <div className="avgo-quote">
        <div className="num text-3xl font-semibold">{currency(price?.price)}</div>
        <div className={`num text-2xs ${price ? price.change >= 0 ? 'text-up' : 'text-down' : 'text-text-muted'}`}>{signedCurrencyPrecise(price?.absChange)} ({percent(price?.change)}) daily</div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="accent" disabled={busy} onClick={() => void onRefresh()}>{busy ? 'Refreshing...' : 'Refresh'}</Button>
        <Button disabled={!payload || AVGO_BLOCKS.every(block => payload.progress[block] === 'unavailable')} onClick={() => void onExport()}>Export snapshot</Button>
      </div>
    </header>
    <nav className="avgo-navigation" aria-label="AVGO research navigation">
      <div className="flex flex-wrap gap-x-5" role="tablist" aria-label="AVGO sections">
        {SECTIONS.map((item, index) => <button key={item} ref={element => { tabRefs.current[index] = element }} id={`avgo-tab-${index}`} role="tab" aria-selected={section === item} aria-controls="avgo-section-panel" tabIndex={section === item ? 0 : -1} className="avgo-tab text-2xs" onClick={() => setSection(item)} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % SECTIONS.length : event.key === 'ArrowLeft' ? (index + SECTIONS.length - 1) % SECTIONS.length : event.key === 'Home' ? 0 : event.key === 'End' ? SECTIONS.length - 1 : null
          if (next !== null) { event.preventDefault(); setSection(SECTIONS[next]); tabRefs.current[next]?.focus() }
        }}>{item}</button>)}
      </div>
      <div className="ml-auto flex flex-wrap gap-1 pb-1">
        <Button onClick={() => onNavigate('charts', 'AVGO')}>Charts</Button><Button onClick={() => onNavigate('fundamentals', 'AVGO')}>Fundamentals</Button>
        <Button onClick={() => void api.openExternal('https://investors.broadcom.com/')}>Investor relations</Button>
      </div>
    </nav>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-2xs text-text-muted">
      <span role="status">{status}</span>
      <div className="flex flex-wrap gap-2" aria-label="AVGO data status">{AVGO_BLOCKS.map(block => {
        const progress = payload?.progress[block] ?? (busy ? 'loading' : 'unavailable')
        return <span key={block} className="border border-border bg-surface px-2 py-1" title={payload?.laneFetchedAt[block] ? `Fetched ${new Date(payload.laneFetchedAt[block]).toLocaleString()}` : 'Not fetched'}>
          <span className={progress === 'loaded' && freshness !== 'stale' ? 'text-up' : progress === 'unavailable' ? 'text-down' : 'text-warn'}>● </span><span className="capitalize">{block}</span> · {progress === 'loaded' ? freshness : progress}
        </span>
      })}</div>
    </div>
    {query.data?.errors.length ? <div role="alert" className="shrink-0 border border-warn/40 bg-surface px-2 py-1 text-2xs text-warn">{query.data.errors.map(feedErrorText).join(' · ')}</div> : null}
    <div className="avgo-kpis shrink-0" aria-label="AVGO financial snapshot">
      <Tile label="Market cap" value={market?.metrics.marketCap ?? '--'} sub="Yahoo Finance · market" />
      <Tile label="Forward P/E" value={market?.metrics.forwardPe ?? '--'} sub="Yahoo Finance · estimate" />
      <Tile label="Quarterly revenue" value={earnings ? metricText(metric('revenue')) : '--'} sub={`${earnings?.period ?? '--'} · GAAP`} />
      <Tile label="AI semiconductor revenue" value={earnings ? metricText(metric('aiRevenue')) : '--'} sub={`${earnings?.period ?? '--'} · reported`} />
      <Tile label="Diluted EPS" value={earnings ? metricText(metric('nonGaapEps')) : '--'} sub={`${earnings?.period ?? '--'} · non-GAAP`} />
    </div>
    <div id="avgo-section-panel" role="tabpanel" aria-labelledby={`avgo-tab-${SECTIONS.indexOf(section)}`} className="flex shrink-0 flex-col gap-3">
      {section === 'Overview' ? <>
        <div className="avgo-market-grid">
          <Panel title="AVGO stock performance" className="avgo-market-panel" warning={warning('market')} actions={<div className="flex gap-1">{STOCKS_RANGE_PRESETS.map(preset => <Button key={preset} variant="toggle" active={range === preset} onClick={() => { setLogicalRange(null); setRange(preset) }}>{preset}</Button>)}</div>}>
            {market ? <StocksChart payload={market.chart} mfiEnabled={false} volumeEnabled autoFollow={false} rangePreset={range} logicalRange={logicalRange} onLogicalRangeChange={setLogicalRange} onManualRange={() => setRange('')} onHoverCandle={() => {}} /> : <PanelMessage>{empty('market')}</PanelMessage>}
            <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-muted">USD · daily bars · volume in shares · Yahoo Finance</div>
          </Panel>
          <Panel title="Market & balance sheet" className="avgo-market-panel" warning={warning('financials') || warning('market')}>
            <dl className="min-h-0 flex-1 overflow-auto px-3 text-2xs">{[
              ['Next earnings · estimate', market?.metrics.earningsDate], ['Analyst target · low', market?.targets.low], ['Analyst target · mean', market?.targets.mean], ['Analyst target · high', market?.targets.high], ['Upside to mean', market?.targets.upsideToMean], ['Analyst coverage', market?.targets.analysts],
              ['Cash · latest snapshot', compactCurrency(payload?.financials?.facts.totalCash)], ['Debt · latest snapshot', compactCurrency(payload?.financials?.facts.totalDebt)],
            ].map(([label, value]) => <div key={label} className="flex justify-between gap-3 border-b border-border/60 py-2 last:border-0"><dt className="text-text-muted">{label}</dt><dd className="num text-right">{value || '--'}</dd></div>)}</dl>
            <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-text-muted">Yahoo Finance · latest available snapshots</div>
          </Panel>
        </div>
        <div className="avgo-overview-grid">
          <Panel title="AI semiconductor business" className="avgo-overview-panel" warning={warning('earnings')} actions={detailAction('AI & segments')}>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <div className="num text-3xl font-semibold text-accent-hover">{earnings ? metricText(metric('aiRevenue')) : '--'}</div>
              <p className="mt-1 text-2xs text-text-muted">Reported · {earnings?.period ?? 'Period unavailable'}</p>
              <p className="mt-2 text-2xs">Custom accelerators & AI networking</p>
              <p className="mt-2 text-2xs text-text-muted">{earnings?.commentary[0] || (earnings ? 'Custom accelerator and networking commentary not disclosed.' : empty('earnings'))}</p>
              <p className="mt-2 text-2xs text-text-muted">Included in Semiconductor solutions.</p>
            </div>
            {earnings ? <button className="shrink-0 border-t border-border px-3 py-2 text-left text-2xs text-accent hover:underline" onClick={() => void api.openExternal(earnings.sourceUrl)}>Earnings release ↗</button> : null}
          </Panel>
          {revenueMix}
          {cashChart}
        </div>
        <div className="avgo-source-grid">
          <div className="avgo-source-card"><button className="mb-2 text-2xs font-semibold hover:text-accent-hover" onClick={() => setSection('News & filings')}>Latest news ↗</button>
            {market?.news.length ? market.news.slice(0, 2).map(row => <button key={row.id} className="block w-full truncate py-1 text-left text-2xs text-accent hover:underline" title={row.title} onClick={() => void api.openExternal(row.url)}>{row.title}</button>) : <p className="text-2xs text-text-muted">{market ? 'No recent AVGO headlines.' : empty('market')}</p>}
          </div>
          <div className="avgo-source-card"><button className="mb-2 text-2xs font-semibold hover:text-accent-hover" onClick={() => setSection('News & filings')}>SEC filings ↗</button>
            {latestFiling ? <button className="block text-left text-2xs text-accent hover:underline" onClick={() => void api.openExternal(latestFiling.documentUrl)}>{latestFiling.form} · {latestFiling.filedDate}<span className="mt-1 block text-text-muted">{latestFiling.description || 'Company filing'}</span></button> : <p className="text-2xs text-text-muted">{empty('financials')}</p>}
          </div>
          <div className="avgo-source-card"><button className="mb-2 text-2xs font-semibold text-warn hover:underline" onClick={() => setSection('Guidance')}>Guidance · management outlook ↗</button>
            <p className="text-2xs text-text-muted">{earnings?.guidancePeriod ?? 'Period unavailable'}</p><p className="num mt-1 text-2xs">{earnings ? metricText(earnings.guidance.find(row => row.id === 'revenueGuidance')) : empty('earnings')}</p>
          </div>
        </div>
      </> : section === 'AI & segments' ? <div className="avgo-detail-grid">
        <Panel title={`AI semiconductor business · ${earnings?.period ?? '--'}`} className="h-[480px]" warning={warning('earnings')}>
          <Metrics rows={earnings?.metrics.filter(row => /^ai/.test(row.id)) ?? []} empty={empty('earnings')} />
          <div className="min-h-0 flex-1 overflow-auto p-3 text-2xs text-text-muted">{earnings?.commentary.map(paragraph => <p key={paragraph} className="pb-3">{paragraph}</p>)}<p>AI revenue is included in Semiconductor solutions.</p></div>{source}
        </Panel>{revenueMix}
      </div> : section === 'Financials' ? <>
        {cashChart}
        <Panel title={`Results, cash flow & dividend · ${earnings?.period ?? '--'}`} className="h-[430px]" warning={warning('earnings')}>
          <Metrics rows={earnings?.metrics.filter(row => !/^ai/.test(row.id)) ?? []} empty={empty('earnings')} />{source}{laneStatus('earnings')}
        </Panel>
      </> : section === 'Guidance' ? guidance : <div className="avgo-detail-grid">{news}{filings}</div>}
    </div>
    <footer className="flex shrink-0 flex-wrap justify-between gap-2 border-t border-border pt-2 text-2xs text-text-muted">
      <span>{earnings ? `${earnings.period} · ended ${earnings.periodEnd || '--'} · published ${earnings.publishedAt || '--'}` : 'Earnings period unavailable'}</span>
      <details><summary>Source details</summary><div className="mt-2 flex flex-col gap-1">{AVGO_BLOCKS.map(block => <div key={block}>{laneStatus(block)}</div>)}</div></details>
    </footer>
  </div>
}
