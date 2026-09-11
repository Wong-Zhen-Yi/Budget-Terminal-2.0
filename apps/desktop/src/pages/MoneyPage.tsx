import { useEffect, useState } from 'react'
import type { MoneySeries } from '@shared/money'
import { MONEY_SERIES, moneyGrowth, moneyValue, moneyWindow } from '@shared/money'
import { useMoney, useRefreshMoney } from '@/api/moneyQueries'
import { LineChart } from '@/components/charts/LineChart'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import type { PanelStatus } from '@/components/chrome/StatusBar'

const percent = (value: number | null | undefined) => value == null ? '—' : `${value.toFixed(2)}%`
const liquidityIds = ['WALCL', 'WRESBAL', 'WTREGEN', 'RRPONTSYD']

function Chart({ row, years, growth, loading }: {
  row: MoneySeries
  years: number
  growth?: 1 | 12
  loading: boolean
}) {
  const points = moneyWindow(growth ? moneyGrowth(row.history, growth) : row.history, years)
  return <Panel title={`${row.label}${growth ? ` · ${growth === 12 ? 'YoY' : 'MoM'} growth` : ' · USD billions'}`} className="h-[280px]" warning={row.error ?? undefined}>
    <p className="px-2 pt-2 text-2xs text-text-muted">{row.frequency} · {row.seasonalAdjustment} · {row.status} · {row.history.at(-1)?.[0] ?? 'No observation'}
      {row.seriesId === 'WALCL' ? ' · Wednesday level' : ['WRESBAL', 'WTREGEN'].includes(row.seriesId) ? ' · Week average' : ''}</p>
    <div className="flex min-h-0 flex-1 flex-col p-2">
      <LineChart
        labels={points.map(([date]) => date)}
        series={[{ values: points.map(([, value]) => value), label: row.label, color: 'var(--color-accent)' }]}
        baseline="auto"
        format={growth ? percent : (value) => `${value.toLocaleString('en-US', { maximumFractionDigits: Math.abs(value) < 10 ? 2 : 0 })}B`}
        empty={loading ? 'Loading observations…' : 'Observations unavailable'}
      />
    </div>
  </Panel>
}

export function MoneyPage({ onStatusChange }: { onStatusChange: (panels: PanelStatus[], sourcePath: string) => void }) {
  const query = useMoney(true)
  const { refresh, refreshing } = useRefreshMoney()
  const [years, setYears] = useState(5)
  const [growth, setGrowth] = useState<1 | 12>(12)
  const [selected, setSelected] = useState('M1SL')
  const [refreshError, setRefreshError] = useState('')
  const busy = query.isFetching || refreshing
  const rows: MoneySeries[] = MONEY_SERIES.map((definition) => query.data?.data.rows.find((row) => row.seriesId === definition.seriesId) ?? { ...definition, history: [], fetchedAt: null, status: 'unavailable', error: null })
  const byId = (id: string) => rows.find((row) => row.seriesId === id)!
  const m2 = byId('M2SL')
  const selectedRow = byId(selected)
  const change = (row: MoneySeries) => row.history.length < 2 ? null : row.history.at(-1)![1] - row.history.at(-2)![1]
  const doRefresh = async (force: boolean) => {
    setRefreshError('')
    try { await refresh(force) } catch (error) { setRefreshError(error instanceof Error ? error.message : String(error)) }
  }
  useEffect(() => {
    onStatusChange([{ label: 'Money', envelope: query.data, loading: query.isFetching }], '')
  }, [onStatusChange, query.data, query.isFetching])

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-auto p-2">
    <div className="flex flex-wrap items-center gap-2">
      <h1 className="text-sm font-semibold text-text">Money</h1>
      <p className="flex-1 text-2xs text-text-muted">US money supply and Federal Reserve liquidity</p>
      <label className="text-2xs text-text-muted">History <select aria-label="History range" className="border border-border bg-surface p-1 text-text" value={years} onChange={(event) => setYears(Number(event.target.value))}>{[1, 3, 5, 10].map((year) => <option key={year} value={year}>{year}Y</option>)}</select></label>
      <Button variant="accent" disabled={busy} onClick={() => void doRefresh(false)}>{busy ? 'Fetching…' : 'Refresh'}</Button>
      <Button disabled={busy} onClick={() => void doRefresh(true)}>Force refresh</Button>
    </div>
    <p role="status" className="text-2xs text-text-muted">{refreshError || query.error?.message || (busy ? 'Loading FRED observations…' : query.data?.meta.failureReason || 'FRED · Federal Reserve · Monetary values in USD billions. Dates refer to observations, not download time.')}</p>
    <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6">
      {['M2SL', 'M2YoY', 'BOGMBASE', 'WALCL', 'WRESBAL', 'RRPONTSYD'].map((id) => {
        const row = id === 'M2YoY' ? m2 : byId(id)
        const yoy = moneyGrowth(row.history, 12)
        const latest = id === 'M2YoY' ? percent(yoy.at(-1)?.[1]) : moneyValue(row.history.at(-1)?.[1])
        return <Panel key={id} title={id === 'M2YoY' ? 'M2 YoY growth' : row.label} warning={row.error ?? undefined}>
          <div className="p-3 text-text"><div className={`text-xl font-semibold tabular-nums ${busy && !row.history.length ? 'animate-pulse' : ''}`}>{latest}</div>
            <p className="mt-1 text-2xs text-text-muted">{id === 'M2YoY' ? 'Change from same month last year' : `Δ ${moneyValue(change(row))} vs previous observation`}</p>
            <p className="mt-1 text-2xs text-text-dim">{row.history.at(-1)?.[0] ?? 'No observation'} · {row.status}</p></div>
        </Panel>
      })}
    </div>
    <div className="flex items-center gap-2 text-2xs text-text-muted"><h2 className="font-semibold text-text">M2 money supply</h2><label>Growth <select aria-label="M2 growth measure" className="border border-border bg-surface p-1 text-text" value={growth} onChange={(event) => setGrowth(Number(event.target.value) as 1 | 12)}><option value={12}>YoY</option><option value={1}>MoM</option></select></label></div>
    <div className="grid shrink-0 grid-cols-1 gap-2 xl:grid-cols-2"><Chart row={m2} years={years} loading={busy} /><Chart row={m2} years={years} growth={growth} loading={busy} /></div>
    <h2 className="text-2xs font-semibold text-text">Federal Reserve liquidity</h2>
    <div className="grid shrink-0 grid-cols-1 gap-2 lg:grid-cols-2">{liquidityIds.map((id) => <Chart key={id} row={byId(id)} years={years} loading={busy} />)}</div>
    <div className="grid shrink-0 grid-cols-1 gap-2 xl:grid-cols-2">
      <Panel title="Indicator explorer · USD billions">
        <div className="overflow-auto"><table className="w-full whitespace-nowrap text-left text-2xs text-text"><thead className="text-text-muted"><tr>{['Indicator', 'Latest', 'Δ previous', 'Observation', 'Frequency', 'Source / status'].map((label) => <th key={label} className="p-2 font-normal">{label}</th>)}</tr></thead><tbody>
          {rows.map((row) => <tr key={row.seriesId} className={`border-t border-border ${selected === row.seriesId ? 'bg-surface-raised' : ''}`}><td className="p-2"><button className="text-left hover:text-accent" aria-pressed={selected === row.seriesId} onClick={() => setSelected(row.seriesId)}>{row.label}</button></td><td className="p-2 tabular-nums">{moneyValue(row.history.at(-1)?.[1])}</td><td className="p-2 tabular-nums">{moneyValue(change(row))}</td><td className="p-2">{row.history.at(-1)?.[0] ?? '—'}</td><td className="p-2">{row.frequency} · {row.seasonalAdjustment}</td><td className="p-2"><button className="hover:underline" onClick={() => void window.api.openExternal(`https://fred.stlouisfed.org/series/${row.seriesId}`)}>FRED {row.seriesId}</button> · {row.status}</td></tr>)}
        </tbody></table></div>
      </Panel>
      <div className="min-w-0"><Chart row={selectedRow} years={years} loading={busy} /><p className="p-2 text-2xs text-text-muted">{selectedRow.definition} Source units: USD {selectedRow.sourceUnits}. {selectedRow.fetchedAt ? `Downloaded ${new Date(selectedRow.fetchedAt).toLocaleString()}.` : ''}</p></div>
    </div>
    <p className="pb-2 text-2xs text-text-dim">SA = seasonally adjusted · NSA = not seasonally adjusted. Each series follows its own release schedule; observations may be revised.</p>
  </div>
}
