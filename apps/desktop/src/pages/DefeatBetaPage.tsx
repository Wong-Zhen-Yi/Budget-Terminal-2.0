import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { DEFEATBETA_SECTIONS, TERMINAL_TABS, statementPeriods, statementValue, terminalDcf, terminalLabel, terminalNumber, terminalYoY } from '@shared/defeatbetaTerminal'
import type { DefeatBetaSection, TerminalRow, TerminalValue } from '@shared/defeatbetaTerminal'
import { api, queryKeys } from '@/api/client'
import { useDefeatBetaSections } from '@/api/defeatbetaQueries'
import { useDefeatBetaTerminal } from '@/stores/defeatbeta'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { DefeatBetaPriceChart } from '@/components/defeatbeta/DefeatBetaPriceChart'
import { isTextEntry } from '@/lib/shortcuts'

const button = 'rounded border border-border-strong bg-surface-raised px-3 py-1.5 text-2xs text-text hover:bg-surface-hover disabled:opacity-50'
const field = 'rounded border border-border-strong bg-bg px-2 py-1.5 text-xs text-text outline-none focus:border-accent'
const box = 'rounded border border-border bg-surface p-4'
const num = terminalNumber
const format = (value: number | null | undefined, digits = 2): string => value === null || value === undefined || !Number.isFinite(value) ? '—' : Intl.NumberFormat('en-US', { maximumFractionDigits: digits, notation: Math.abs(value) >= 1e6 ? 'compact' : 'standard' }).format(value)
const pct = (value: number | null) => value === null ? '—' : `${format(value)}%`
const text = (value: TerminalValue | undefined): string => value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)
const metrics = ['total_revenue', 'operating_income', 'ebitda', 'net_income_common_stockholders', 'free_cash_flow', 'diluted_eps']
const marginMetrics = ['gross_profit', 'operating_income', 'ebitda', 'net_income_common_stockholders', 'free_cash_flow']
const dependencies: DefeatBetaSection[][] = [
  ['prices', 'dividends', 'splits', 'earnings'], ['profile', 'officers'], ['statements', 'profile'],
  ['prices', 'shares', 'statements', 'profile'], ['statements'], ['statements'], ['statements', 'shares', 'profile'],
  ['news', 'transcripts'], ['filings'], ['breakdown'],
]

export function DefeatBetaPage({ active, onStatusChange, onNavigate }: {
  active: boolean
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate: (tab: string, symbol?: string) => void
}) {
  const { symbol, setSymbol } = useDefeatBetaTerminal()
  const [draft, setDraft] = useState(symbol)
  const [tab, setTab] = useState(0)
  const [period, setPeriod] = useState('annual')
  const [statement, setStatement] = useState('income_statement')
  const [selectedMetric, setSelectedMetric] = useState('total_revenue')
  const [range, setRange] = useState(252)
  const [feed, setFeed] = useState('news')
  const [important, setImportant] = useState(true)
  const [breakdown, setBreakdown] = useState('')
  const [notice, setNotice] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const queries = useDefeatBetaSections(symbol)
  const client = useQueryClient()
  const query = (section: DefeatBetaSection) => queries[DEFEATBETA_SECTIONS.indexOf(section)]
  const rows = (section: DefeatBetaSection): TerminalRow[] => query(section).data?.data.rows ?? []
  const statements = rows('statements')
  const dates = statementPeriods(statements, period).slice(0, 8)
  const prices = useMemo(() => [...(queries[0].data?.data.rows ?? [])].filter(row => num(row.close) !== null && /^\d{4}-\d{2}-\d{2}$/.test(text(row.report_date))).sort((a, b) => text(a.report_date).localeCompare(text(b.report_date))), [queries[0].data])
  const latest = prices.at(-1)
  const close = num(latest?.close)
  const previous = num(prices.at(-2)?.close)
  const change = close !== null && previous !== null && previous > 0 ? (close / previous - 1) * 100 : null
  const profile = query('profile').data?.data
  const financialCurrency = profile?.financialCurrency
  const sharesRow = rows('shares').filter(row => !latest || text(row.report_date) <= text(latest.report_date))[0]
  const shares = num(sharesRow?.shares_outstanding)
  const value = (item: string) => statementValue(statements, item, 'TTM', 'quarterly')
  const annualDate = statementPeriods(statements, 'annual')[0]
  const latestBalanceDate = statementPeriods(statements.filter(row => row.finance_type === 'balance_sheet'), 'quarterly')[0] ?? annualDate
  const balancePeriod = statementPeriods(statements.filter(row => row.finance_type === 'balance_sheet'), 'quarterly').length ? 'quarterly' : 'annual'
  const balance = (item: string) => statementValue(statements, item, latestBalanceDate ?? '', balancePeriod)
  const marketCap = shares !== null && close !== null ? shares * close : null
  const cash = balance('cash_cash_equivalents_and_short_term_investments')
  const debt = balance('total_debt')
  const enterprise = marketCap !== null && cash !== null && debt !== null && financialCurrency === 'USD' ? marketCap + debt - cash : null
  const divide = (a: number | null, b: number | null) => a !== null && b !== null && b > 0 ? a / b : null
  const pe = financialCurrency === 'USD' ? divide(close, value('diluted_eps')) : null
  const epsGrowth = annualDate ? terminalYoY(statements, 'diluted_eps', annualDate, 'annual') : null
  const busy = queries.some(entry => entry.isFetching)
  const settled = queries.filter(entry => !entry.isPending).length
  const [g1, setG1] = useState(10)
  const [g2, setG2] = useState(5)
  const [discount, setDiscount] = useState(10)
  const [terminal, setTerminal] = useState(2.5)
  const dcf = terminalDcf(value('free_cash_flow'), shares, g1, g2, discount, terminal)

  // Depend on query results, not useQueries' fresh wrapper array.
  const status = JSON.stringify(queries.map(entry => [entry.dataUpdatedAt, entry.errorUpdatedAt, entry.isFetching, entry.status]))
  useEffect(() => {
    onStatusChange(DEFEATBETA_SECTIONS.map((section, index) => ({ label: `DefeatBeta ${section}`,
      envelope: queries[index].data, error: queries[index].error, loading: queries[index].isFetching, freshnessMs: 60 * 60_000 })), '')
  }, [onStatusChange, status])
  useEffect(() => setDraft(symbol), [symbol])
  useEffect(() => {
    if (!active) return
    const handle = (event: KeyboardEvent) => {
      if (isTextEntry(event.target) || event.ctrlKey || event.altKey || event.metaKey) return
      if (event.key === '/' || event.key === ':') { event.preventDefault(); input.current?.focus(); input.current?.select() }
      if (/^[0-9]$/.test(event.key)) { event.preventDefault(); setTab(event.key === '0' ? 9 : Number(event.key) - 1) }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [active])
  const search = () => {
    const next = draft.trim().toUpperCase()
    if (!/^[A-Z][A-Z0-9-]{0,14}$/.test(next)) { setNotice('Enter a US equity ticker, for example AAPL, NVDA or BRK-B.'); return }
    setNotice(''); setBreakdown(''); setSymbol(next)
  }
  const refresh = async () => {
    setNotice('')
    const results = await Promise.allSettled(DEFEATBETA_SECTIONS.map(section => client.fetchQuery({
      queryKey: queryKeys.defeatbetaTerminal(symbol, section), staleTime: 0,
      queryFn: async () => {
        const result = await api.defeatbetaTerminal({ symbol, section, force: true })
        if (result.meta.freshness === 'failed') throw new Error(result.meta.failureReason || 'Section unavailable')
        return result
      },
    })))
    const failures = results.filter(result => result.status === 'rejected').length
    if (failures) setNotice(`Refresh failed for ${failures} section(s). Previously loaded data remains visible.`)
  }
  const sectionState = (section: DefeatBetaSection) => {
    const entry = query(section)
    const publication = entry.data?.data.publishedAt
    return <div key={section} className={`text-2xs ${entry.error || entry.data?.meta.freshness === 'stale' ? 'text-warning' : 'text-text-muted'}`}>
      {terminalLabel(section)}: {entry.isFetching ? 'Loading…' : entry.error ? `Unavailable · ${entry.error.message}` : entry.isPending ? 'Waiting for dataset…' : entry.data?.meta.freshness === 'stale' ? 'Stale publication' : `${rows(section).length.toLocaleString()} records`}
      {publication ? ` · published ${new Date(publication).toLocaleDateString()}` : ''}
    </div>
  }
  const metricItems = tab === 5 ? marginMetrics : tab === 4 ? metrics : [...new Set(statements.filter(row => row.finance_type === statement && row.period_type === period && row.report_date !== 'TTM').map(row => text(row.item_name)))]
  const cellValue = (item: string, date: string) => {
    if (tab === 4) return terminalYoY(statements, item, date, period)
    if (tab === 5) { const ratio = divide(statementValue(statements, item, date, period), statementValue(statements, 'total_revenue', date, period)); return ratio === null ? null : ratio * 100 }
    return statementValue(statements, item, date, period)
  }
  const metric = metricItems.includes(selectedMetric) ? selectedMetric : metricItems[0]
  const breakdowns = [...new Set(rows('breakdown').map(row => text(row.breakdown)))]
  const chosenBreakdown = breakdowns.includes(breakdown) ? breakdown : breakdowns[0]
  const breakdownRows = rows('breakdown').filter(row => row.breakdown === chosenBreakdown && row.period_type === (period === 'annual' ? 'trailing' : 'quarterly'))

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-defeatbeta-terminal>
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-3">
      <div className="mr-2"><p className="font-mono text-sm font-semibold tracking-wide text-accent">DEFEAT BETA</p><p className="text-2xs text-text-dim">Equity research terminal</p></div>
      <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); search() }}>
        <input ref={input} aria-label="DefeatBeta ticker" className={`${field} w-28 font-mono uppercase`} value={draft} onChange={event => setDraft(event.target.value)} maxLength={15} />
        <button className={button} type="submit">Load ticker</button>
      </form>
      <button type="button" className={button} disabled={busy} onClick={() => void refresh()}>{busy ? `Loading ${settled}/12` : 'Refresh dataset'}</button>
      <button type="button" className={button} onClick={() => onNavigate('charts', symbol)}>Open charts ↗</button>
      <div className="ml-auto text-right"><p className="text-xs text-text">{symbol} <span className="text-text-muted">{profile?.companyName}</span></p><p className="text-2xs text-text-dim">Published data · / ticker · 1–9, 0 tabs</p></div>
    </div>
    <div className="flex flex-wrap border-b border-border bg-bg px-2" role="tablist" aria-label="DefeatBeta research tabs">
      {TERMINAL_TABS.map((name, index) => <button key={name} id={`defeatbeta-tab-${index}`} type="button" role="tab" aria-selected={tab === index} aria-controls="defeatbeta-panel" className={`border-b-2 px-3 py-3 text-2xs ${tab === index ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text'}`} onClick={() => setTab(index)}><span className="mr-1 text-text-dim">{(index + 1) % 10}</span>{name}</button>)}
    </div>
    <div className="min-h-0 flex-1 overflow-auto p-4" id="defeatbeta-panel" role="tabpanel" aria-labelledby={`defeatbeta-tab-${tab}`}>
      {notice ? <p role="status" className="mb-3 text-xs text-warning">{notice}</p> : null}
      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1">{dependencies[tab].map(sectionState)}</div>
      {tab === 0 ? <>
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Daily close · USD" value={format(close)} detail={text(latest?.report_date)} />
          <Metric label="Daily change" value={pct(change)} detail="Compared with previous published close" />
          <Metric label="Volume" value={format(num(latest?.volume), 0)} detail="Shares traded" />
          <Metric label="Published sessions" value={format(prices.length, 0)} detail="Split-adjusted · cash dividends excluded" />
        </div>
        <DefeatBetaPriceChart key={symbol} symbol={symbol} rows={prices} count={range} onCount={setRange} />
        <div className="mt-4 grid gap-4 lg:grid-cols-3">{(['earnings', 'dividends', 'splits'] as const).map(section => <section key={section} className={box}><h2 className="mb-3 text-xs font-semibold text-text">{terminalLabel(section)} events</h2><RecordTable rows={rows(section)} pageSize={5} /></section>)}</div>
      </> : null}
      {tab === 1 ? <div className="space-y-4"><section className={box}><h2 className="mb-4 text-sm font-semibold text-text">{profile?.companyName ?? symbol} · company profile</h2><dl className="grid gap-4 md:grid-cols-2">{Object.entries(rows('profile')[0] ?? {}).filter(([key]) => key !== 'symbol').map(([key, value]) => <div key={key} className={key.includes('summary') ? 'md:col-span-2' : ''}><dt className="mb-1 text-2xs text-text-muted">{terminalLabel(key)}</dt><dd className="text-xs leading-relaxed text-text"><Value value={value} /></dd></div>)}</dl>{!rows('profile').length ? <Empty /> : null}</section><section className={box}><h2 className="mb-3 text-xs font-semibold text-text">Key executives</h2><RecordTable rows={rows('officers')} /></section></div> : null}
      {[2, 4, 5].includes(tab) ? <section className={box}>
        <div className="mb-4 flex flex-wrap items-center gap-3"><h2 className="mr-auto text-xs font-semibold text-text">{TERMINAL_TABS[tab]} · {tab === 2 ? financialCurrency ?? 'Reporting currency unavailable' : 'Percent'}</h2>
          {tab === 2 ? <select aria-label="Financial statement" className={field} value={statement} onChange={event => setStatement(event.target.value)}><option value="income_statement">Income statement</option><option value="balance_sheet">Balance sheet</option><option value="cash_flow">Cash flow</option></select> : null}
          <Period value={period} onChange={setPeriod} />
        </div>
        {dates.length && metric ? <>
          <MiniChart values={[...dates].reverse().map(date => ({ label: date, value: cellValue(metric, date) }))} label={`${terminalLabel(metric)}${tab === 2 ? '' : ' · %'}`} />
          <div className="mt-4 overflow-auto"><table className="w-full whitespace-nowrap text-2xs"><thead><tr className="border-b border-border text-text-muted"><th className="p-2 text-left">Metric · click to chart</th>{dates.map(date => <th key={date} className="p-2 text-right">{date}</th>)}</tr></thead><tbody>{metricItems.map(item => <tr key={item} className={`border-b border-border ${metric === item ? 'bg-accent-dim' : ''}`}><td className="p-2"><button type="button" onClick={() => setSelectedMetric(item)} className="text-left text-accent">{terminalLabel(item)}</button></td>{dates.map(date => <td key={date} className="num p-2 text-right text-text">{tab === 2 ? format(cellValue(item, date)) : pct(cellValue(item, date))}</td>)}</tr>)}</tbody></table></div>
          <p className="mt-3 text-2xs text-text-dim">{tab === 4 ? 'YoY compares the same fiscal period a year earlier. Growth is unavailable when the prior value is zero or negative.' : tab === 5 ? 'Each metric divided by revenue for the same period. Industry comparisons are not included.' : 'Reported values in the company financial currency; EPS is per share. No currency conversion.'}</p>
        </> : <Empty />}
      </section> : null}
      {tab === 3 ? <section className={box}><h2 className="mb-4 text-sm font-semibold text-text">Valuation · latest published close</h2><div className="grid gap-3 md:grid-cols-3">
        {[
          ['P/E · TTM', pe], ['P/S · TTM', financialCurrency === 'USD' ? divide(marketCap, value('total_revenue')) : null],
          ['P/B', financialCurrency === 'USD' ? divide(marketCap, balance('stockholders_equity')) : null], ['PEG · annual EPS YoY', divide(pe, epsGrowth)],
          ['EV / EBITDA · TTM', divide(enterprise, value('ebitda'))], ['EV / Revenue · TTM', divide(enterprise, value('total_revenue'))],
        ].map(([label, multiple]) => <Metric key={String(label)} label={String(label)} value={multiple === null ? '—' : `${format(Number(multiple))}x`} />)}
      </div><p className="mt-4 text-2xs leading-relaxed text-text-muted">Market cap: {format(marketCap)} USD · shares reported {text(sharesRow?.report_date)} · balance sheet {latestBalanceDate ?? 'unavailable'}. Market cap uses the latest reported shares before the price date. EV = market cap + debt − cash and short-term investments. Multiples require positive denominators. Cross-currency multiples are unavailable unless the reporting currency is USD. Industry overlays are not included.</p></section> : null}
      {tab === 6 ? <section className={box}><h2 className="text-sm font-semibold text-text">Three-stage cash-flow valuation</h2><p className="mt-2 text-xs text-text-muted">Projects TTM free cash flow for five years at each growth rate, then a perpetual terminal value. Treats reported FCF as a proxy for equity cash flow; discount at your required equity return. No separate debt or cash adjustment.</p>
        <div className="my-5 grid gap-4 md:grid-cols-4">{[
          { label: 'Years 1–5 growth (%)', value: g1, set: setG1 }, { label: 'Years 6–10 growth (%)', value: g2, set: setG2 },
          { label: 'Discount rate (%)', value: discount, set: setDiscount }, { label: 'Terminal growth (%)', value: terminal, set: setTerminal },
        ].map(item => <label key={item.label} className="text-2xs text-text-muted">{item.label}<input aria-label={item.label} type="number" step="0.5" className={`${field} mt-2 w-full`} value={Number.isNaN(item.value) ? '' : item.value} onChange={event => item.set(event.target.value === '' ? NaN : Number(event.target.value))} /></label>)}</div>
        <div className="grid gap-3 md:grid-cols-3"><Metric label={`TTM FCF · ${financialCurrency ?? 'currency unavailable'}`} value={format(value('free_cash_flow'))} /><Metric label="Reported shares" value={format(shares)} /><Metric label={`Model value per share · ${financialCurrency ?? 'currency unavailable'}`} value={financialCurrency ? format(dcf?.perShare) : '—'} detail={financialCurrency === 'USD' && close !== null && close > 0 && dcf ? `${pct((dcf.perShare / close - 1) * 100)} vs published close` : 'Model assumptions, not a price target'} /></div>
        {!dcf ? <p role="status" className="mt-4 text-xs text-warning">Requires positive TTM FCF and shares, valid growth rates above −100%, and a positive discount rate above terminal growth.</p> : <><div className="mt-4"><MiniChart values={dcf.years.map(year => ({ label: `Y${year.year}`, value: year.cash }))} label="Projected free cash flow" /></div><p className="mt-3 text-2xs text-text-muted">Value/share = [Σ FCFₜ / (1+r)ᵗ + FCF₁₀ × (1+g) / (r−g) / (1+r)¹⁰] / shares. Terminal value is {pct(dcf.terminalValue / (dcf.terminalValue + dcf.presentValue) * 100)} of model value.</p></>}
      </section> : null}
      {tab === 7 ? <section className={box}><div className="mb-4 flex gap-2">{['news', 'transcripts'].map(mode => <button key={mode} type="button" className={`${button} ${feed === mode ? 'text-accent' : ''}`} onClick={() => setFeed(mode)}>{mode === 'news' ? 'Financial news' : 'Earnings transcripts'}</button>)}</div>{feed === 'news' ? <RecordTable rows={rows('news')} pageSize={15} /> : <TranscriptList key={symbol} rows={rows('transcripts')} />}</section> : null}
      {tab === 8 ? <section className={box}><div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold text-text">SEC filings</h2><label className="text-xs text-text-muted"><input type="checkbox" checked={important} onChange={event => setImportant(event.target.checked)} /> Important forms only</label></div><RecordTable rows={rows('filings').filter(row => !important || /^(10-K|10-Q|8-K|DEF 14A|20-F|40-F|6-K)(\/A)?$/.test(text(row.form ?? row.form_type ?? row.type)))} pageSize={15} /></section> : null}
      {tab === 9 ? <section className={box}><div className="mb-4 flex flex-wrap items-center gap-3"><h2 className="mr-auto text-sm font-semibold text-text">Revenue breakdown</h2><select aria-label="Revenue breakdown" className={field} value={chosenBreakdown ?? ''} onChange={event => setBreakdown(event.target.value)}>{breakdowns.map(item => <option key={item} value={item}>{text(rows('breakdown').find(row => row.breakdown === item)?.breakdown_name ?? item)}</option>)}</select><Period value={period} onChange={setPeriod} trailing /></div><RecordTable rows={breakdownRows} pageSize={25} /><p className="mt-3 text-2xs text-text-dim">Values retain each source row’s currency and value type. Breakdown categories can overlap; they are not summed.</p></section> : null}
      <p className="mt-5 text-2xs text-text-dim">GUI adaptation inspired by <button type="button" className="text-accent hover:underline" onClick={() => void api.openExternal('https://github.com/defeat-beta/defeatbeta-terminal')}>defeat-beta/defeatbeta-terminal ↗</button> · DefeatBeta / Yahoo Finance / SEC EDGAR mirror · Published snapshots, not live quotes.</p>
    </div>
  </div>
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className={box}><p className="text-2xs text-text-muted">{label}</p><p className="num mt-2 text-xl font-semibold text-text">{value}</p>{detail ? <p className="mt-2 text-2xs text-text-dim">{detail}</p> : null}</div>
}
function Empty() { return <p className="p-6 text-center text-xs text-text-muted">No published records available for this selection. See section status above.</p> }
function Period({ value, onChange, trailing = false }: { value: string; onChange: (value: string) => void; trailing?: boolean }) {
  return <select aria-label="Reporting period" className={field} value={value} onChange={event => onChange(event.target.value)}><option value="annual">{trailing ? 'Trailing' : 'Annual'}</option><option value="quarterly">Quarterly</option></select>
}
function Value({ value }: { value: TerminalValue | undefined }): ReactNode {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return <button type="button" className="break-all text-left text-accent hover:underline" onClick={() => void api.openExternal(value)}>Open source ↗</button>
  if (Array.isArray(value)) return <div className="space-y-2">{value.map((entry, index) => <div key={index}><Value value={entry} /></div>)}</div>
  if (value && typeof value === 'object') return <dl>{Object.entries(value).map(([key, entry]) => <div key={key}><dt className="text-text-muted">{terminalLabel(key)}</dt><dd><Value value={entry} /></dd></div>)}</dl>
  return <>{typeof value === 'number' ? format(value) : text(value)}</>
}
function RecordTable({ rows, pageSize = 10 }: { rows: TerminalRow[]; pageSize?: number }) {
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: string; direction: number } | null>(null)
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))].filter(key => key !== 'symbol' && key !== 'uuid')
  const filtered = rows.filter(row => !search || Object.values(row).some(value => text(value).toLowerCase().includes(search.toLowerCase())))
  if (sort) filtered.sort((a, b) => (typeof a[sort.key] === 'number' && typeof b[sort.key] === 'number' ? Number(a[sort.key]) - Number(b[sort.key]) : text(a[sort.key]).localeCompare(text(b[sort.key]))) * sort.direction)
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, pages - 1)
  if (!rows.length) return <Empty />
  return <><div className="mb-3 flex items-center gap-3"><input aria-label="Filter records" className={`${field} min-w-0 flex-1`} placeholder="Filter records…" value={search} onChange={event => { setPage(0); setSearch(event.target.value) }} /><span className="text-2xs text-text-muted">{filtered.length} records</span></div><div className="overflow-auto"><table className="w-full text-2xs"><thead><tr className="border-b border-border">{columns.map(key => <th key={key} className="whitespace-nowrap p-2 text-left font-medium text-text-muted"><button type="button" onClick={() => setSort({ key, direction: sort?.key === key ? -sort.direction : 1 })}>{terminalLabel(key)}{sort?.key === key ? sort.direction > 0 ? ' ↑' : ' ↓' : ''}</button></th>)}</tr></thead><tbody>{filtered.slice(current * pageSize, (current + 1) * pageSize).map((row, index) => <tr key={index} className="border-b border-border">{columns.map(key => <td key={key} className="min-w-24 max-w-xl p-2 align-top leading-relaxed text-text"><Value value={row[key]} /></td>)}</tr>)}</tbody></table></div>{!filtered.length ? <p className="p-4 text-xs text-text-muted">No matching records.</p> : null}<div className="mt-3 flex items-center justify-end gap-3 text-2xs text-text-muted"><button type="button" className={button} disabled={!current} onClick={() => setPage(current - 1)}>Previous</button>{current + 1} / {pages}<button type="button" className={button} disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>Next</button></div></>
}
function TranscriptList({ rows }: { rows: TerminalRow[] }) {
  const [selected, setSelected] = useState(0)
  const row = rows[selected]
  return !row ? <Empty /> : <><select aria-label="Earnings transcript" className={`${field} mb-4`} value={selected} onChange={event => setSelected(Number(event.target.value))}>{rows.map((entry, index) => <option key={index} value={index}>FY {text(entry.fiscal_year)} · Q{text(entry.fiscal_quarter)} · {text(entry.report_date)}</option>)}</select><div className="max-w-5xl space-y-4 text-xs leading-relaxed text-text"><Value value={row.transcripts} /></div></>
}
function MiniChart({ values, label }: { values: { label: string; value: number | null }[]; label: string }) {
  const finite = values.flatMap(point => point.value === null ? [] : [point.value])
  if (!finite.length) return <p className="text-2xs text-text-dim">{label}: no chart data</p>
  const max = Math.max(...finite, 0)
  const min = Math.min(...finite, 0)
  const y = (value: number) => 155 - (value - min) / (max - min || 1) * 130
  const width = 720 / values.length
  return <div><p className="mb-2 text-2xs text-text-muted">{label}</p><svg role="img" aria-label={label} viewBox="0 0 800 185" className="h-48 w-full"><line x1="55" x2="790" y1={y(0)} y2={y(0)} stroke="var(--color-border)" /><text x="3" y="24" fontSize="11" fill="var(--color-text-muted)">{format(max)}</text><text x="3" y="158" fontSize="11" fill="var(--color-text-muted)">{format(min)}</text>{values.map((point, index) => <g key={point.label}>{point.value !== null ? <rect x={60 + index * width} y={Math.min(y(0), y(point.value))} width={width * 0.65} height={Math.max(1, Math.abs(y(0) - y(point.value)))} fill="var(--color-accent)"><title>{point.label}: {format(point.value)}</title></rect> : null}<text x={60 + index * width} y="179" fontSize="10" fill="var(--color-text-muted)">{point.label}</text></g>)}</svg></div>
}
