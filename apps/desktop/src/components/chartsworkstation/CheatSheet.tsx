import { useMemo, useState } from 'react'

import {
  CHART_PATTERN_BIASES,
  CHART_PATTERN_CATALOG,
  CHART_PATTERN_FAMILIES,
  type ChartPattern,
} from '@shared/chartPatterns'
import { PatternChart } from '@/components/charts/PatternChart'

export function CheatSheet() {
  const [search, setSearch] = useState('')
  const [family, setFamily] = useState('All')
  const [bias, setBias] = useState('All')
  const shown = useMemo(() => {
    const query = search.trim().toLowerCase()
    return CHART_PATTERN_CATALOG.filter((pattern) => {
      const matchesSearch = !query || [pattern.name, ...pattern.aliases, pattern.recognition, pattern.confirmation].join(' ').toLowerCase().includes(query)
      return matchesSearch && (family === 'All' || pattern.family === family) && (bias === 'All' || pattern.bias === bias)
    })
  }, [search, family, bias])
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border border-border bg-surface px-2 py-1">
        <h2 className="mr-2 text-xs font-semibold text-text">Chart Pattern Cheat Sheet</h2>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search patterns" className="h-8 min-w-52 border border-border-strong bg-surface-raised px-2 text-2xs text-text outline-none focus:border-accent" />
        <select value={family} onChange={(event) => setFamily(event.target.value)} className="h-8 border border-border-strong bg-surface-raised px-2 text-2xs text-text"><option>All</option>{CHART_PATTERN_FAMILIES.map((value) => <option key={value}>{value}</option>)}</select>
        <select value={bias} onChange={(event) => setBias(event.target.value)} className="h-8 border border-border-strong bg-surface-raised px-2 text-2xs text-text"><option>All</option>{CHART_PATTERN_BIASES.map((value) => <option key={value}>{value}</option>)}</select>
        <span className="ml-auto text-2xs text-text-muted">{shown.length} of {CHART_PATTERN_CATALOG.length} patterns · Offline reference</span>
      </div>
      <p className="shrink-0 border border-warning/30 bg-warning/5 px-2 py-1 text-2xs text-text-muted">Patterns are probabilistic context, not standalone trade signals. Require confirmation and define invalidation before acting.</p>
      <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-[repeat(auto-fit,minmax(380px,1fr))] gap-2 overflow-auto pr-1">
        {shown.map((pattern) => <PatternCard key={pattern.id} pattern={pattern} />)}
        {!shown.length ? <p className="col-span-full py-12 text-center text-2xs text-text-dim">No chart patterns match these filters.</p> : null}
      </div>
    </div>
  )
}

function PatternCard({ pattern }: { pattern: ChartPattern }) {
  const [exampleId, setExampleId] = useState(pattern.examples[0].id)
  const example = pattern.examples.find((entry) => entry.id === exampleId) ?? pattern.examples[0]
  const color = pattern.bias === 'Bullish' ? '#26c281' : pattern.bias === 'Bearish' ? '#f0554e' : '#e0a34a'
  return (
    <article className="overflow-hidden border border-border bg-surface">
      <header className="flex items-center gap-2 border-b border-border bg-surface-raised px-2 py-1.5"><h3 className="text-2xs font-semibold text-text">{pattern.name}</h3><span className="ml-auto text-[10px] text-text-dim">{pattern.family}</span><span className="text-[10px] font-semibold" style={{ color }}>{pattern.bias}</span></header>
      <div className="flex items-center gap-1 border-b border-border bg-[#0d1420] px-2 py-1">
        {pattern.examples.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setExampleId(entry.id)}
            className={`h-5 border px-1.5 text-[10px] ${entry.id === example.id ? 'border-accent bg-accent-dim text-text' : 'border-border-strong text-text-muted hover:text-text'}`}
          >
            {entry.label}
          </button>
        ))}
        <span className="ml-auto truncate text-[10px] text-text-dim" title={example.caption}>{example.caption}</span>
      </div>
      <PatternChart
        example={example}
        className="h-40 w-full border-b border-border bg-[#0d1420]"
        ariaLabel={`${pattern.name} candlestick example, ${example.label}`}
      />
      <dl className="grid grid-cols-[78px_1fr] gap-x-2 gap-y-1 p-2 text-[10px] leading-4"><dt className="text-text-dim">Recognition</dt><dd className="text-text-muted">{pattern.recognition}</dd><dt className="text-text-dim">Confirmation</dt><dd className="text-text-muted">{pattern.confirmation}</dd><dt className="text-text-dim">Invalidation</dt><dd className="text-text-muted">{pattern.invalidation}</dd><dt className="text-text-dim">Target</dt><dd className="text-text-muted">{pattern.target}</dd></dl>
    </article>
  )
}
