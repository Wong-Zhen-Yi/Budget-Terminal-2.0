import { memo, useMemo, useState } from 'react'

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
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pt-2 pb-3">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5">
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search patterns" placeholder="Search patterns" className="h-8 min-w-44 rounded border border-border-strong bg-surface-raised px-2 text-[12px] text-text outline-none focus:border-accent" />
        <select value={family} aria-label="Pattern family" onChange={(event) => setFamily(event.target.value)} className="h-8 rounded border border-border-strong bg-surface-raised px-2 text-[12px] text-text"><option value="All">All families</option>{CHART_PATTERN_FAMILIES.map((value) => <option key={value}>{value}</option>)}</select>
        <select value={bias} aria-label="Pattern bias" onChange={(event) => setBias(event.target.value)} className="h-8 rounded border border-border-strong bg-surface-raised px-2 text-[12px] text-text"><option value="All">All biases</option>{CHART_PATTERN_BIASES.map((value) => <option key={value}>{value}</option>)}</select>
        <span className="ml-auto pr-1 text-[12px] tabular-nums text-text-muted">{shown.length} of {CHART_PATTERN_CATALOG.length} patterns</span>
      </div>
      <p className="shrink-0 px-1 text-[12px] text-text-muted">Patterns are probabilistic context, not standalone trade signals. Require confirmation and define invalidation before acting.</p>
      <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] gap-2 overflow-y-auto">
        {shown.map((pattern) => <PatternCard key={pattern.id} pattern={pattern} />)}
        {!shown.length ? <p className="col-span-full py-12 text-center text-2xs text-text-dim">No chart patterns match these filters.</p> : null}
      </div>
    </div>
  )
}

const PatternCard = memo(function PatternCard({ pattern }: { pattern: ChartPattern }) {
  const [exampleId, setExampleId] = useState(pattern.examples[0].id)
  const example = pattern.examples.find((entry) => entry.id === exampleId) ?? pattern.examples[0]
  const color = pattern.bias === 'Bullish' ? '#26c281' : pattern.bias === 'Bearish' ? '#f0554e' : '#e0a34a'
  return (
    <article className="overflow-hidden rounded-md border border-border bg-surface">
      <header className="flex items-center gap-2 border-b border-border bg-surface-raised px-2.5 py-2"><h3 className="text-[14px] font-semibold text-text">{pattern.name}</h3><span className="ml-auto text-[11px] text-text-muted">{pattern.family}</span><span className="text-[11px] font-semibold" style={{ color }}>{pattern.bias}</span></header>
      <div className="flex items-center gap-1 border-b border-border bg-surface px-2.5 py-1.5">
        {pattern.examples.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={entry.id === example.id}
            onClick={() => setExampleId(entry.id)}
            className={`h-6 shrink-0 rounded border px-1.5 text-[11px] ${entry.id === example.id ? 'border-accent bg-accent-dim text-text' : 'border-border-strong text-text-muted hover:text-text'}`}
          >
            {entry.label}
          </button>
        ))}
        <span className="ml-auto truncate text-[11px] text-text-muted" title={example.caption}>{example.caption}</span>
      </div>
      <PatternChart
        example={example}
        className="h-36 w-full border-b border-border bg-surface"
        ariaLabel={`${pattern.name} candlestick example, ${example.label}`}
      />
      <dl className="grid grid-cols-[78px_1fr] gap-x-2 gap-y-1 p-2.5 text-[11px] leading-4 text-text-muted"><dt className="font-medium text-text">Recognition</dt><dd>{pattern.recognition}</dd><dt className="font-medium text-text">Confirmation</dt><dd>{pattern.confirmation}</dd><dt className="font-medium text-text">Invalidation</dt><dd>{pattern.invalidation}</dd><dt className="font-medium text-text">Target</dt><dd>{pattern.target}</dd></dl>
    </article>
  )
})
