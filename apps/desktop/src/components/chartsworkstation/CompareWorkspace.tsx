import { useEffect, useMemo, useState } from 'react'

import type { ChartsComparePayload, Envelope, EnvelopeMeta } from '@shared/contract'
import { buildCompareModel } from '@shared/charts'
import { useChartsCompare } from '@/api/chartsQueries'
import { CompareChart, COMPARE_COLORS } from '@/components/chartsworkstation/CompareChart'
import { Button } from '@/components/ui/Button'
import { useChartsStore } from '@/stores/charts'

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
  const envelope = query.data && Object.keys(query.data.data.series).length ? query.data : snapshot
  const model = useMemo(() => envelope ? buildCompareModel(envelope.data) : null, [envelope])
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
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border border-border bg-surface px-2 py-1">
        <h2 className="mr-2 text-xs font-semibold text-text">Compare</h2>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') add() }} placeholder="Ticker" className="h-8 w-24 border border-border-strong bg-surface-raised px-2 text-2xs uppercase text-text" />
        <Button onClick={add}>Add</Button>
        <select value={interval} onChange={(event) => setInterval(event.target.value as '1 Day' | '1 Week')} className="h-8 border border-border-strong bg-surface-raised px-2 text-2xs text-text"><option>1 Day</option><option>1 Week</option></select>
        <select value={range} onChange={(event) => setRange(event.target.value as typeof range)} className="h-8 border border-border-strong bg-surface-raised px-2 text-2xs text-text">{(['5Y', '3Y', '1Y', 'YTD', '3M', '1M'] as const).map((value) => <option key={value}>{value}</option>)}</select>
        <Button variant="toggle" active={showLabels} onClick={() => setShowLabels(!showLabels)}>Interval %</Button>
        <Button variant="toggle" active={showCorrelation} onClick={() => setShowCorrelation(!showCorrelation)}>Correlation</Button>
        <select value={selectedPreset} onChange={(event) => loadPreset(event.target.value)} className="h-8 max-w-44 border border-border-strong bg-surface-raised px-2 text-2xs text-text"><option value="">Presets…</option>{presets.map((preset) => <option key={preset.name}>{preset.name}</option>)}</select>
        <Button onClick={createPreset}>New preset</Button><Button disabled={!selectedPreset} onClick={updatePreset}>Update</Button><Button disabled={!selectedPreset} variant="danger" onClick={deletePreset}>Delete</Button>
        <span className="ml-auto text-2xs text-text-muted">{query.isFetching ? 'Loading comparison…' : query.data?.meta.failureReason ?? (envelope ? `${model?.symbols.length ?? 0} series` : 'Add tickers to begin.')}</span>
      </div>
      <div className="flex shrink-0 flex-wrap gap-1">{symbols.map((symbol, index) => <button type="button" key={symbol} onClick={() => setSymbols(symbols.filter((entry) => entry !== symbol))} title={`${envelope?.data.sources?.[symbol] ?? 'Source unavailable'} · Remove ${symbol}`} className="border border-border bg-surface px-2 py-1 text-2xs" style={{ color: COMPARE_COLORS[index % COMPARE_COLORS.length] }}>{symbol}{envelope?.data.sources?.[symbol]?.startsWith('Hyperliquid') ? ' PERP' : ''} ×</button>)}</div>
      <section className="flex min-h-[260px] flex-1 flex-col border border-border bg-surface"><CompareChart payload={envelope?.data ?? null} showIntervalLabels={showLabels} /></section>
      {showCorrelation && model?.symbols.length ? <CorrelationMatrix model={model} /> : null}
    </div>
  )
}

function CorrelationMatrix({ model }: { model: ReturnType<typeof buildCompareModel> }) {
  return <section className="shrink-0 overflow-auto border border-border bg-surface p-2"><header className="mb-1 text-[10px] font-semibold uppercase text-text-muted">Pairwise interval-return correlation · minimum 10 shared observations</header><table className="w-full table-fixed text-center text-2xs"><thead><tr><th />{model.symbols.map((symbol) => <th key={symbol} className="px-2 py-1 text-text">{symbol}</th>)}</tr></thead><tbody>{model.symbols.map((symbol, row) => <tr key={symbol}><th className="px-2 py-1 text-left text-text">{symbol}</th>{model.symbols.map((column, col) => { const value = model.correlations[row][col]; const alpha = value == null ? 0 : Math.min(0.5, Math.abs(value) * 0.5); return <td key={column} title={`${model.observations[row][col]} observations`} className="border border-border px-2 py-1 text-text" style={{ backgroundColor: value == null ? undefined : value >= 0 ? `rgb(38 194 129 / ${alpha})` : `rgb(240 85 78 / ${alpha})` }}>{value == null ? 'n/a' : value.toFixed(3)}</td> })}</tr>)}</tbody></table></section>
}
