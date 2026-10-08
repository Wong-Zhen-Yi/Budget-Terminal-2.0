import { useEffect, useMemo, useState } from 'react'
import type { Envelope } from '@shared/contract'
import { alignedComparison, diversification, movingAverage, riskStats, SP500_SECTORS, symbolKey, windowPoints,
  type Sp500Constituent, type Sp500Data, type Sp500Window } from '@shared/sp500'
import { api } from '@/api/client'
import { useSp500 } from '@/api/sp500Queries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { LineChart } from '@/components/charts/LineChart'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Panel } from '@/components/ui/Panel'

const number = (value: number | null | undefined, suffix = '') => value == null || !Number.isFinite(value) ? '—' : `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}${suffix}`
const pct = (value: number | null | undefined) => number(value, '%')
const inputClass = 'h-8 min-w-0 border border-border bg-surface px-2 text-2xs text-text'
const windows: Sp500Window[] = ['1M', '3M', 'YTD', '1Y', '5Y']
const EMPTY_ROWS: Sp500Constituent[] = []

function Source({ envelope, loading }: { envelope?: Envelope<Sp500Data>; loading?: boolean }) {
  const data = envelope?.data
  return <div className="shrink-0 border-b border-border px-2 py-1 text-[10px] text-text-muted">
    {loading ? 'Loading · ' : ''}{data?.asOf || 'Date unavailable'} · {data?.source?.startsWith('https://')
      ? <a className="text-accent underline" href={data.source} target="_blank" rel="noreferrer">Source</a> : data?.source || 'Waiting for source'}
    {envelope?.errors.map((error, i) => <div key={i} className="text-warn">{error.reason}</div>)}
  </div>
}
function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="min-w-0 border border-border bg-surface px-3 py-2">
    <div className="text-2xs text-text-muted">{label}</div><div className="num text-lg font-semibold text-text">{value}</div>
    {sub && <div className="text-[10px] text-text-muted">{sub}</div>}
  </div>
}
function Breakdown({ rows }: { rows: ReturnType<typeof diversification>['sectors'] }) {
  return <div className="overflow-auto p-2 text-2xs">
    <div className="mb-2 text-text-muted">Count share <span className="text-accent">━</span> · SPY weight <span className="text-up">━</span> (proxy)</div>
    {rows.map((row) => <div key={row.label} className="mb-2">
      <div className="flex justify-between gap-3"><span>{row.label}</span><span className="num shrink-0">{row.count} · {pct(row.countPct)} / {row.matched ? pct(row.weight) : '—'}</span></div>
      <div className="mt-1 h-1 bg-surface-raised"><div className="h-1 bg-accent" style={{ width: `${row.countPct}%` }} /></div>
      <div className="mt-0.5 h-1 bg-surface-raised"><div className="h-1 bg-up" style={{ width: `${Math.min(100, row.weight)}%` }} /></div>
    </div>)}
    {!rows.length && <p>No constituents available.</p>}
  </div>
}

export function Sp500Page({ onStatusChange }: { onStatusChange: (panels: PanelStatus[], sourcePath: string) => void }) {
  const { queries, breadth, refresh, scan } = useSp500()
  const [constituentsQ, marketQ, historyQ, holdingsQ, valuationQ] = queries
  const [window, setWindow] = useState<Sp500Window>('1Y')
  const [search, setSearch] = useState('')
  const [sector, setSector] = useState('')
  const [industry, setIndustry] = useState('')
  const [notice, setNotice] = useState('')
  const [scanBusy, setScanBusy] = useState(false)
  const rows = constituentsQ.data?.data.constituents ?? EMPTY_ROWS
  const holdings = holdingsQ.data?.data.holdings
  const history = historyQ.data?.data.history
  const index = history?.['^GSPC'] ?? []
  const chart = windowPoints(index, window)
  const stats = riskStats(chart)
  const ma50 = movingAverage(index, 50).slice(index.length - chart.length)
  const ma200 = movingAverage(index, 200).slice(index.length - chart.length)
  const mix = useMemo(() => diversification(rows, holdings?.rows ?? [], holdings?.partial ?? true), [rows, holdings])
  const comparison = alignedComparison(history?.SPY ?? [], history?.RSP ?? [], window)
  const quote = marketQ.data?.data.market?.find((row) => row.symbol === '^GSPC')
  const vix = marketQ.data?.data.market?.find((row) => row.symbol === '^VIX')
  const last = index.at(-1)
  const high52 = index.length >= 252 ? Math.max(...index.slice(-252).map((row) => row.close)) : null
  const filtered = useMemo(() => rows.filter((row) => (!sector || row.sector === sector) && (!industry || row.industry === industry)
    && Object.values(row).join(' ').toLowerCase().includes(search.trim().toLowerCase())), [rows, sector, industry, search])
  const weights = useMemo(() => new Map(holdings?.rows.map((row) => [symbolKey(row.symbol), row.weight]) ?? []), [holdings])
  const scanState = breadth.data?.data
  const result = scanState?.result
  const running = scanState?.state === 'running'
  const busy = queries.some((query) => query.isFetching)
  const values = valuationQ.data?.data.valuation ?? []
  const forward = values.find((row) => row.label === 'Forward P/E (FY1)')
  const labels = ['Constituents', 'Market', 'History', 'Holdings', 'Valuation']
  useEffect(() => {
    onStatusChange(queries.map((query, i) => ({ label: `S&P500 ${labels[i]}`, envelope: query.data, error: query.error, enabled: query.isEnabled, loading: query.isFetching })), '')
  }, [onStatusChange, constituentsQ.data, marketQ.data, historyQ.data, holdingsQ.data, valuationQ.data, busy])
  // Capture F5 before the application-wide refresh so an explicit breadth action stays separate.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'F5') { event.preventDefault(); event.stopImmediatePropagation(); void refresh() }
    }
    globalThis.window.addEventListener('keydown', handler, true)
    return () => globalThis.window.removeEventListener('keydown', handler, true)
  }, [refresh])
  const scanAction = async (action: 'start' | 'cancel') => {
    setScanBusy(true)
    try { await scan({ action, id: scanState?.id, force: action === 'start' && scanState?.state !== 'idle' }); setNotice('') }
    catch (error) { setNotice(String(error)) } finally { setScanBusy(false) }
  }
  const copy = async () => {
    const snapshot = [
      '# S&P500 snapshot', `Copied: ${new Date().toISOString()}`, `Index: ${number(quote?.price)}; daily ${pct(quote?.change)}`,
      `YTD price return: ${pct(riskStats(windowPoints(index, 'YTD')).returnPct)}; 1Y price return: ${pct(riskStats(windowPoints(index, '1Y')).returnPct)}`,
      `${window} risk: return ${pct(stats.returnPct)}; maximum drawdown ${pct(stats.drawdown)}; annualized daily volatility ${pct(stats.volatility)}`,
      `VIX: ${number(vix?.price)}; SPY/RSP ${window} return difference: ${number((comparison.b.at(-1) ?? NaN) - (comparison.a.at(-1) ?? NaN), ' pp')}`,
      `Securities: ${rows.length}; companies: ${mix.companies}; matched weights ${mix.matched}/${rows.length}; covered SPY weight ${pct(mix.coveredWeight)}`,
      `Top 5/10/20 SPY weight proxy: ${mix.concentration.map(pct).join(' / ')}`,
      ...values.map((value) => `${value.label}: ${number(value.value, value.unit === 'percent' ? '%' : 'x')} · ${value.basis} · ${value.asOf || 'date unavailable'}`),
      ...mix.sectors.map((row) => `${row.label}: ${row.count} securities (${pct(row.countPct)}); matched SPY weight ${pct(row.weight)}`),
      `Breadth: ${scanState?.state ?? 'idle'}; completed ${scanState?.completedAt || 'not completed'}; ${JSON.stringify(result)}`,
      ...queries.map((query, i) => `${labels[i]}: ${query.data?.data.source ?? 'unavailable'} · ${query.data?.data.asOf || 'date unavailable'} · ${query.data?.errors.map((error) => error.reason).join('; ') || query.error?.message || 'no reported errors'}`),
    ].join('\n')
    try { await api.writeClipboard(snapshot); setNotice('S&P500 snapshot copied.') } catch (error) { setNotice(String(error)) }
  }
  const columns: Column<Sp500Constituent>[] = [
    { key: 'symbol', header: 'Symbol', cell: (row) => row.symbol, sortValue: (row) => row.symbol, width: '85px' },
    { key: 'security', header: 'Security', cell: (row) => row.security, sortValue: (row) => row.security, wrap: true, width: '210px' },
    { key: 'sector', header: 'GICS Sector', cell: (row) => row.sector, sortValue: (row) => row.sector, wrap: true, width: '170px' },
    { key: 'industry', header: 'GICS Sub-Industry', cell: (row) => row.industry, sortValue: (row) => row.industry, wrap: true, width: '210px' },
    { key: 'headquarters', header: 'Headquarters Location', cell: (row) => row.headquarters, sortValue: (row) => row.headquarters, wrap: true, width: '190px' },
    { key: 'dateAdded', header: 'Date added', cell: (row) => row.dateAdded ?? '—', sortValue: (row) => row.dateAdded, width: '130px' },
    { key: 'cik', header: 'CIK', cell: (row) => row.cik, sortValue: (row) => row.cik, width: '130px' },
    { key: 'founded', header: 'Founded', cell: (row) => row.founded, sortValue: (row) => row.founded, wrap: true, width: '130px' },
    { key: 'weight', header: 'SPY Weight', cell: (row) => pct(weights.get(symbolKey(row.symbol)) == null ? null : weights.get(symbolKey(row.symbol))! * 100),
      sortValue: (row) => weights.get(symbolKey(row.symbol)) ?? null, numeric: true, width: '100px' },
  ]
  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-2 text-text">
    <div className="flex shrink-0 flex-wrap items-center gap-2"><h1 className="text-sm font-semibold">S&P500 — Index dashboard</h1>
      <span className="ml-auto text-2xs text-text-muted">{notice || 'Price returns · SPY weights are an index exposure proxy'}</span>
      <Button variant="accent" onClick={() => void refresh()} disabled={busy}>{busy ? 'Loading…' : 'Refresh'}</Button>
      <Button onClick={() => void copy()}>Copy Snapshot</Button>
    </div>
    {queries.some((query) => query.error) && <p className="text-2xs text-warn">{queries.flatMap((query) => query.error ? [query.error.message] : []).join(' · ')}</p>}
    <Source envelope={marketQ.data} loading={marketQ.isFetching} />
    <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      <Metric label="S&P 500" value={number(quote?.price)} sub={`Daily ${pct(quote?.change)}`} />
      <Metric label="YTD price return" value={pct(riskStats(windowPoints(index, 'YTD')).returnPct)} sub={last?.date} />
      <Metric label="1Y price return" value={pct(riskStats(windowPoints(index, '1Y')).returnPct)} sub={last?.date} />
      <Metric label="From 52-week closing high" value={pct(last && high52 ? (last.close / high52 - 1) * 100 : null)} sub={last?.date} />
      <Metric label="VIX" value={number(vix?.price)} sub={vix?.asOf} />
      <Metric label="Top 10 holdings weight" value={pct(mix.concentration[1])} sub="SPY proxy · separate share classes" />
    </div>
    <Panel title="Performance & risk — S&P 500 price index" className="h-[420px] shrink-0" actions={windows.map((span) =>
      <Button key={span} variant={span === window ? 'accent' : 'default'} onClick={() => setWindow(span)}>{span}</Button>)}>
      <Source envelope={historyQ.data} loading={historyQ.isFetching} />
      <div className="flex flex-wrap gap-4 px-3 py-2 text-2xs"><span>Return {pct(stats.returnPct)}</span><span>Maximum drawdown {pct(stats.drawdown)}</span><span>Annualized volatility {pct(stats.volatility)}</span><span className="text-text-muted">Completed daily sessions · selected window</span></div>
      <div className="flex gap-4 px-3 pb-1 text-[10px]"><span style={{ color: '#60a5fa' }}>━ S&P 500</span><span style={{ color: '#fbbf24' }}>━ 50-day SMA</span><span style={{ color: '#a78bfa' }}>━ 200-day SMA</span></div>
      <div className="flex min-h-0 flex-1 flex-col"><LineChart labels={chart.map((row) => row.date)} baseline="auto" format={number} series={[
        { label: 'S&P 500', values: chart.map((row) => row.close), color: '#60a5fa' },
        { label: '50-day SMA', values: ma50, color: '#fbbf24' }, { label: '200-day SMA', values: ma200, color: '#a78bfa' },
      ]} /></div>
    </Panel>
    <Panel title="Valuation & income" className="shrink-0">
      <Source envelope={valuationQ.data} loading={valuationQ.isFetching} />
      <div className="grid gap-2 p-2 md:grid-cols-4">{['Forward P/E (FY1)', 'Price / book', 'Index dividend yield'].map((label) => {
        const value = values.find((row) => row.label === label)
        return <div key={label} title={value?.definition}><Metric label={label} value={number(value?.value, value?.unit === 'percent' ? '%' : 'x')} sub={`${value?.basis ?? 'Unavailable'} · ${value?.asOf || 'date unavailable'}`} /></div>
      })}<Metric label="Implied forward earnings yield" value={pct(forward?.value && forward.value > 0 ? 100 / forward.value : null)} sub="1 / published FY1 P/E · same basis and date" /></div>
    </Panel>
    <div className="grid shrink-0 gap-3 xl:grid-cols-2">
      <Panel title={`Participation — equal vs cap weight · ${window}`} className="h-[360px]">
        <Source envelope={historyQ.data} loading={historyQ.isFetching} />
        <p className="px-2 py-1 text-2xs text-text-muted">Adjusted-close ETF proxies, rebased to 100 · RSP less SPY: {number((comparison.b.at(-1) ?? NaN) - (comparison.a.at(-1) ?? NaN), ' pp')}</p>
        <div className="flex gap-4 px-2 pb-1 text-[10px]"><span style={{ color: '#60a5fa' }}>━ SPY · cap weight</span><span style={{ color: '#34d399' }}>━ RSP · equal weight</span></div>
        <div className="flex min-h-0 flex-1 flex-col"><LineChart labels={comparison.dates} baseline="auto" format={number} series={[
          { label: 'SPY · cap weight', values: comparison.a, color: '#60a5fa' }, { label: 'RSP · equal weight', values: comparison.b, color: '#34d399' },
        ]} /></div>
      </Panel>
      <Panel title="Sector leadership — Select Sector SPDR proxies" className="h-[360px]">
        <Source envelope={historyQ.data} loading={historyQ.isFetching} />
        <DataTable rows={SP500_SECTORS.map(([symbol, name]) => ({ symbol, name }))} rowKey={(row) => row.symbol} defaultSort={{ key: 'YTD', direction: 'desc' }} columns={[
          { key: 'sector', header: 'Sector / ETF', cell: (row) => `${row.name} (${row.symbol})`, wrap: true },
          ...(['1M', '3M', 'YTD', '1Y'] as Sp500Window[]).map((span) => ({ key: span, header: span, numeric: true,
            cell: (row: { symbol: string }) => pct(riskStats(windowPoints(history?.[row.symbol] ?? [], span)).returnPct),
            sortValue: (row: { symbol: string }) => riskStats(windowPoints(history?.[row.symbol] ?? [], span)).returnPct })),
        ]} />
      </Panel>
    </div>
    <div className="shrink-0"><Source envelope={constituentsQ.data} loading={constituentsQ.isFetching} /><Source envelope={holdingsQ.data} loading={holdingsQ.isFetching} />
      <p className="p-2 text-2xs text-text-muted">{rows.length} securities · {mix.companies} companies · {mix.sectors.length} sectors · Matched {mix.matched}/{rows.length} securities · Covered SPY weight {pct(mix.coveredWeight)}. Count shares and matched weights use the full constituent list; missing weights are not rescaled.</p>
    </div>
    <div className="grid shrink-0 gap-3 lg:grid-cols-2"><Panel title="Sector diversification" className="h-[430px]"><Breakdown rows={mix.sectors} /></Panel>
      <Panel title="Sub-industry diversification" className="h-[430px]"><Breakdown rows={mix.industries} /></Panel></div>
    <Panel title="Largest holdings & concentration — SPY proxy" className="h-[350px] shrink-0">
      <div className="flex flex-wrap gap-5 p-2 text-2xs">{[5, 10, 20].map((n, i) => <span key={n}>Top {n}: <strong>{pct(mix.concentration[i])}</strong></span>)}
        {mix.concentration[0] == null && <span className="text-warn">Complete matched holdings required for concentration totals.</span>}</div>
      <DataTable rows={mix.ranked.slice(0, 20)} rowKey={(row) => row.symbol} columns={[
        { key: 'symbol', header: 'Symbol', cell: (row) => row.symbol }, { key: 'name', header: 'Security', cell: (row) => row.name, wrap: true },
        { key: 'weight', header: 'SPY weight', cell: (row) => pct(row.weight == null ? null : row.weight * 100), numeric: true },
      ]} />
    </Panel>
    <Panel title="Constituent breadth — current-constituent snapshot" className="shrink-0" actions={<>
      <Button onClick={() => void scanAction('start')} disabled={running || scanBusy}>{scanState?.state === 'idle' || !scanState ? 'Load Breadth' : 'Refresh Breadth'}</Button>
      {running && <Button onClick={() => void scanAction('cancel')} disabled={scanBusy}>Cancel</Button>}</>}>
      <p className="px-3 py-2 text-2xs text-text-muted">{scanState?.state ?? 'idle'} · {scanState?.completed ?? 0}/{scanState?.total ?? 0} processed · {scanState?.failed ?? 0} fetch failures · Session {result?.session || '—'} · Completed {scanState?.completedAt || '—'} · Yahoo Finance / Wikipedia</p>
      {running && <progress className="mx-3 mb-2 h-2" max={scanState.total || 1} value={scanState.completed} aria-label="Breadth scan progress" />}
      {(scanState?.error || breadth.error) && <p className="p-2 text-2xs text-warn">{scanState?.error || breadth.error?.message}</p>}
      <div className="grid gap-2 p-2 md:grid-cols-5">
        <Metric label="Advancing / declining / unchanged" value={result ? `${result.advancing} / ${result.declining} / ${result.unchanged}` : '—'} sub={`${result?.valid ?? 0}/${result?.total ?? 0} eligible`} />
        <Metric label="Above 50-day SMA" value={pct(result?.eligible50 ? result.above50 / result.eligible50 * 100 : null)} sub={`${result?.eligible50 ?? 0} eligible`} />
        <Metric label="Above 200-day SMA" value={pct(result?.eligible200 ? result.above200 / result.eligible200 * 100 : null)} sub={`${result?.eligible200 ?? 0} eligible`} />
        <Metric label="252-session closing highs" value={result?.eligible252 ? number(result.highs) : '—'} sub={`${result?.eligible252 ?? 0} eligible`} />
        <Metric label="252-session closing lows" value={result?.eligible252 ? number(result.lows) : '—'} sub={`${result?.eligible252 ?? 0} eligible`} />
      </div><p className="px-3 pb-2 text-[10px] text-text-muted">Adjusted closes anchored to the latest completed index session. Stale and insufficient histories excluded per metric. Running/cancelled scans show partial coverage.</p>
    </Panel>
    <Panel title={`Constituents — ${filtered.length} / ${rows.length}`} className="h-[600px] shrink-0">
      <Source envelope={constituentsQ.data} loading={constituentsQ.isFetching} />
      <div className="flex flex-wrap gap-2 p-2"><input className={inputClass} aria-label="Search constituents" placeholder="Search companies, symbols…" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select className={inputClass} aria-label="Sector filter" value={sector} onChange={(event) => { setSector(event.target.value); setIndustry('') }}><option value="">All sectors</option>{[...new Set(rows.map((row) => row.sector))].sort().map((value) => <option key={value}>{value}</option>)}</select>
        <select className={`${inputClass} max-w-[300px]`} aria-label="Sub-industry filter" value={industry} onChange={(event) => setIndustry(event.target.value)}><option value="">All sub-industries</option>{[...new Set(rows.filter((row) => !sector || row.sector === sector).map((row) => row.industry))].sort().map((value) => <option key={value}>{value}</option>)}</select>
        <Button onClick={() => { setSearch(''); setSector(''); setIndustry('') }}>Clear filters</Button>
      </div>
      <DataTable rows={filtered} columns={columns} rowKey={(row) => row.symbol} defaultSort={{ key: 'dateAdded', direction: 'desc' }} layout="fixed" minWidth="1355px" />
    </Panel>
  </div>
}
