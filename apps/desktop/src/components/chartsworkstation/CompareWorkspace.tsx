import { memo, useEffect, useMemo, useState } from 'react'

import type { ChartsComparePayload, Envelope, EnvelopeMeta } from '@shared/contract'
import { buildCompareModel, type CompareModel } from '@shared/charts'
import { useChartsCompare } from '@/api/chartsQueries'
import { CompareChart, COMPARE_COLORS } from '@/components/chartsworkstation/CompareChart'
import { Button } from '@/components/ui/Button'
import { useChartsStore } from '@/stores/charts'

const FIELD = 'h-8 rounded border border-border-strong bg-surface-raised px-2 text-[12px] text-text'
const CONTROL = 'rounded text-[12px]'

export function CompareWorkspace({ onStatus }: { onStatus: (meta: EnvelopeMeta | undefined, loading: boolean, error?: unknown) => void }) {
  const symbols = useChartsStore((state) => state.compareSymbols)
  const interval = useChartsStore((state) => state.compareInterval)
  const range = useChartsStore((state) => state.compareRange)
  const showLabels = useChartsStore((state) => state.compareIntervalLabels)
  const showCorrelation = useChartsStore((state) => state.compareCorrelation)
  const presets = useChartsStore((state) => state.comparePresets)
  const setSymbols = useChartsStore((state) => state.setCompareSymbols)
  const setInterval = useChartsStore((state) => state.setCompareInterval)
  const setRange = useChartsStore((state) => state.setCompareRange)
  const setShowLabels = useChartsStore((state) => state.setCompareIntervalLabels)
  const setShowCorrelation = useChartsStore((state) => state.setCompareCorrelation)
  const setPresets = useChartsStore((state) => state.setComparePresets)
  const [draft, setDraft] = useState('')
  const [selectedPreset, setSelectedPreset] = useState('')
  const query = useChartsCompare({ symbols, interval, range })
  const [snapshot, setSnapshot] = useState<Envelope<ChartsComparePayload> | null>(null)
  useEffect(() => { if (query.data && Object.keys(query.data.data.series).length) setSnapshot(query.data) }, [query.data])
  useEffect(() => onStatus(query.data?.meta, query.isFetching, query.error), [onStatus, query.data?.meta, query.isFetching, query.error])
  const payload = symbols.length ? (query.data && Object.keys(query.data.data.series).length ? query.data : snapshot)?.data : undefined
  const model = useMemo(() => payload ? buildCompareModel(payload) : null, [payload])
  const add = () => {
    const symbol = draft.trim().toUpperCase()
    if (!symbol || symbols.includes(symbol)) return
    setSymbols([...symbols, symbol])
    setDraft('')
  }
  const createPreset = () => {
    if (!symbols.length) return
    const name = window.prompt('Preset name')?.trim()
    if (!name) return
    const next = { name, symbols, interval, range }
    setPresets([...presets.filter((entry) => entry.name.toLowerCase() !== name.toLowerCase()), next])
    setSelectedPreset(name)
  }
  const updatePreset = () => {
    if (!selectedPreset) return
    setPresets(presets.map((entry) => entry.name === selectedPreset ? { ...entry, symbols, interval, range } : entry))
  }
  const loadPreset = (name: string) => {
    setSelectedPreset(name)
    const preset = presets.find((entry) => entry.name === name)
    if (!preset) return
    setSymbols(preset.symbols)
    setInterval(preset.interval)
    setRange(preset.range)
  }
  const deletePreset = () => {
    if (!selectedPreset || !window.confirm(`Delete preset “${selectedPreset}”?`)) return
    setPresets(presets.filter((entry) => entry.name !== selectedPreset))
    setSelectedPreset('')
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pt-2 pb-3">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5">
        <form className="mr-2 flex gap-1" onSubmit={(event) => { event.preventDefault(); add() }}>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Comparison ticker" placeholder="Ticker" className={`${FIELD} w-24 uppercase`} />
          <Button className={CONTROL} type="submit" variant="accent">Add</Button>
        </form>
        <select value={interval} aria-label="Comparison interval" onChange={(event) => setInterval(event.target.value as '1 Day' | '1 Week')} className={FIELD}><option>1 Day</option><option>1 Week</option></select>
        <select value={range} aria-label="Comparison range" onChange={(event) => setRange(event.target.value as typeof range)} className={FIELD}>{(['5Y', '3Y', '1Y', 'YTD', '3M', '1M'] as const).map((value) => <option key={value}>{value}</option>)}</select>
        <Button className={CONTROL} variant="toggle" active={showLabels} onClick={() => setShowLabels(!showLabels)}>Interval %</Button>
        <Button className={CONTROL} variant="toggle" active={showCorrelation} onClick={() => setShowCorrelation(!showCorrelation)}>Correlation</Button>
        <div className="ml-auto flex flex-wrap gap-1.5" role="group" aria-label="Comparison presets">
          <select value={selectedPreset} aria-label="Preset" onChange={(event) => loadPreset(event.target.value)} className={`${FIELD} max-w-44`}><option value="">Presets…</option>{presets.map((preset) => <option key={preset.name}>{preset.name}</option>)}</select>
          <Button className={CONTROL} disabled={!symbols.length} onClick={createPreset}>New preset</Button>
          <Button className={CONTROL} disabled={!selectedPreset} onClick={updatePreset}>Update</Button>
          <Button className={CONTROL} disabled={!selectedPreset} onClick={deletePreset}>Delete</Button>
        </div>
      </div>
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-surface">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-border bg-surface-raised px-3 py-2">
          <h2 className="text-[14px] font-semibold text-text">Normalized performance</h2>
          <div className="flex flex-wrap gap-1.5" aria-label="Compared symbols">
            {symbols.map((symbol) => {
              const index = model?.symbols.indexOf(symbol) ?? -1
              const last = model?.normalized[symbol]?.at(-1)
              const source = payload?.sources?.[symbol]
              return (
                <button type="button" key={symbol} aria-label={`Remove ${symbol}`} onClick={() => setSymbols(symbols.filter((entry) => entry !== symbol))} title={source ? `${source} · Remove ${symbol}` : `Remove ${symbol}`} className="flex items-center gap-1.5 rounded border border-border-strong bg-surface px-2 py-1 text-[11px] tabular-nums text-text hover:bg-surface-hover">
                  {index >= 0 ? <span className="size-2 rounded-full" style={{ backgroundColor: COMPARE_COLORS[index % COMPARE_COLORS.length] }} /> : null}
                  <span className="font-semibold">{symbol}{source?.startsWith('Hyperliquid') ? ' PERP' : ''}</span>
                  {last ? <span className="text-text-muted">{last.value >= 0 ? '+' : ''}{last.value.toFixed(1)}%</span> : null}
                  <span aria-hidden="true" className="text-text-muted">×</span>
                </button>
              )
            })}
          </div>
        </header>
        <CompareChart model={model} showIntervalLabels={showLabels} emptyMessage={!symbols.length ? 'Add tickers to compare their performance.' : query.isFetching ? 'Loading comparison…' : 'Comparison unavailable.'} />
      </section>
      {showCorrelation && model?.symbols.length ? <CorrelationMatrix model={model} /> : null}
    </div>
  )
}

const CorrelationMatrix = memo(function CorrelationMatrix({ model }: { model: CompareModel }) {
  return (
    <section className="max-h-[36%] shrink-0 overflow-auto rounded-md border border-border bg-surface">
      <header className="sticky top-0 flex items-baseline gap-2 border-b border-border bg-surface-raised px-3 py-1.5">
        <h3 className="text-[13px] font-semibold text-text">Interval-return correlation</h3>
        <span className="text-[11px] text-text-muted">Minimum 10 shared observations</span>
      </header>
      <table className="w-full text-center text-[12px] tabular-nums">
        <thead><tr><th />{model.symbols.map((symbol) => <th key={symbol} scope="col" className="px-2 py-1 text-text">{symbol}</th>)}</tr></thead>
        <tbody>
          {model.symbols.map((symbol, row) => (
            <tr key={symbol}>
              <th scope="row" className="px-3 py-1 text-left text-text">{symbol}</th>
              {model.symbols.map((column, col) => {
                const value = model.correlations[row][col]
                const alpha = value == null ? 0 : Math.min(0.5, Math.abs(value) * 0.5)
                return <td key={column} title={`${model.observations[row][col]} observations`} className="border border-border px-2 py-1 text-text" style={{ backgroundColor: value == null ? undefined : value >= 0 ? `rgb(38 194 129 / ${alpha})` : `rgb(240 85 78 / ${alpha})` }}>{value == null ? 'n/a' : value.toFixed(3)}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
})
