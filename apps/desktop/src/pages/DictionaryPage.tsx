import { useEffect, useMemo, useRef, useState } from 'react'

import { CHART_PATTERN_CATALOG, type ChartPattern } from '@shared/chartPatterns'
import {
  DICTIONARY_CATEGORIES,
  DICTIONARY_ENTRIES,
  getDictionaryEntry,
  searchDictionaryEntries,
  type DictionaryEntry,
} from '@shared/dictionary'
import { PatternChart } from '@/components/charts/PatternChart'
import type { PanelStatus } from '@/components/chrome/StatusBar'

const ALL_CATEGORIES = 'All categories'
const PATTERN_BY_ID = new Map(CHART_PATTERN_CATALOG.map((pattern) => [pattern.id, pattern]))

export function DictionaryPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(ALL_CATEGORIES)
  const [selectedEntryId, setSelectedEntryId] = useState(
    DICTIONARY_ENTRIES[0]?.entryId ?? '',
  )
  const detailRef = useRef<HTMLDivElement>(null)
  const entries = useMemo(
    () => searchDictionaryEntries(query, category),
    [query, category],
  )
  const selectedEntry = entries.find((entry) => entry.entryId === selectedEntryId)
    ?? entries[0]

  useEffect(() => onStatusChange([], ''), [onStatusChange])

  useEffect(() => {
    if (selectedEntry && selectedEntry.entryId !== selectedEntryId) {
      setSelectedEntryId(selectedEntry.entryId)
    }
  }, [selectedEntry, selectedEntryId])

  useEffect(() => {
    detailRef.current?.scrollTo({ top: 0 })
  }, [selectedEntry?.entryId])

  const openRelated = (entryId: string) => {
    if (!getDictionaryEntry(entryId)) return
    setQuery('')
    setCategory(ALL_CATEGORIES)
    setSelectedEntryId(entryId)
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-2 p-2.5">
      <header className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold text-text">Dictionary</h1>
          <p className="text-2xs text-text-muted">
            Stock-market, trading, investing, analysis, formula, chart-pattern, and economic-event reference
          </p>
        </div>
        <p className="text-right text-2xs text-text-muted">
          {DICTIONARY_ENTRIES.length} entries · Offline reference
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 min-[820px]:flex-row">
        <aside className="flex h-[260px] min-h-[220px] shrink-0 flex-col gap-2 border border-border bg-surface p-2.5 min-[820px]:h-auto min-[820px]:w-[300px] min-[820px]:max-w-[380px]">
          <input
            type="search"
            aria-label="Search Dictionary"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search terms, aliases, formulas, or definitions..."
            className="h-9 shrink-0 border border-border-strong bg-surface-raised px-2 text-2xs text-text outline-none placeholder:text-text-dim focus:border-accent"
          />
          <select
            aria-label="Dictionary category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="h-9 shrink-0 border border-border-strong bg-surface-raised px-2 text-2xs text-text outline-none focus:border-accent"
          >
            <option>{ALL_CATEGORIES}</option>
            {DICTIONARY_CATEGORIES.map((value) => <option key={value}>{value}</option>)}
          </select>
          <p className="shrink-0 text-2xs text-text-muted">
            {entries.length} of {DICTIONARY_ENTRIES.length} terms
          </p>
          <div
            role="listbox"
            aria-label="Dictionary terms"
            className="min-h-0 flex-1 overflow-y-auto border border-border"
          >
            {entries.map((entry, index) => {
              const selected = entry.entryId === selectedEntry?.entryId
              return (
                <button
                  key={entry.entryId}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  title={[entry.category, entry.aliases.length ? `Also: ${entry.aliases.join(', ')}` : ''].filter(Boolean).join('\n')}
                  onClick={() => setSelectedEntryId(entry.entryId)}
                  className={`block w-full border-b border-border px-2 py-1.5 text-left text-2xs last:border-b-0 ${
                    selected
                      ? 'bg-accent-dim text-text'
                      : index % 2
                        ? 'bg-surface-raised text-text-muted hover:bg-surface-hover hover:text-text'
                        : 'bg-surface text-text-muted hover:bg-surface-hover hover:text-text'
                  }`}
                >
                  {entry.term}
                </button>
              )
            })}
          </div>
        </aside>

        <section
          ref={detailRef}
          aria-live="polite"
          className="min-h-[360px] min-w-0 flex-1 overflow-y-auto border border-border bg-surface px-3.5 py-2"
        >
          {selectedEntry
            ? <EntryDetail entry={selectedEntry} onOpenRelated={openRelated} />
            : <EmptyDetail query={query} category={category} />}
        </section>
      </div>
    </main>
  )
}

function EntryDetail({
  entry,
  onOpenRelated,
}: {
  entry: DictionaryEntry
  onOpenRelated: (entryId: string) => void
}) {
  const pattern = entry.chartPatternId ? PATTERN_BY_ID.get(entry.chartPatternId) : undefined
  const relatedEntries = entry.relatedEntryIds.flatMap((entryId) => {
    const related = getDictionaryEntry(entryId)
    return related ? [related] : []
  })

  return (
    <div className="flex min-h-full flex-col gap-2.5">
      <div className="flex items-start gap-3">
        <h2 className="min-w-0 flex-1 select-text text-sm font-semibold text-text">{entry.term}</h2>
        <span className="max-w-[45%] rounded-full border border-accent px-2 py-0.5 text-center text-[10px] font-bold text-accent">
          {entry.category}
        </span>
      </div>
      {entry.aliases.length ? (
        <p className="select-text text-2xs text-text-muted">
          Also known as: {entry.aliases.join(', ')}
        </p>
      ) : null}
      {pattern ? <PatternDiagram pattern={pattern} /> : null}
      <TextBlock title="Definition" body={entry.definition} />
      <TextBlock title="Why it matters" body={entry.whyItMatters} />
      {entry.sections.map((section) => (
        <TextBlock
          key={section.title}
          title={section.title}
          body={section.body}
          formula={section.title === 'Formula'}
        />
      ))}
      {relatedEntries.length ? (
        <section className="border border-border bg-surface-raised p-2.5">
          <h3 className="mb-1.5 text-xs font-semibold text-text">Related terms</h3>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {relatedEntries.map((related) => (
              <button
                key={related.entryId}
                type="button"
                title={`Open ${related.term}`}
                onClick={() => onOpenRelated(related.entryId)}
                className="border border-border-strong bg-surface px-2 py-1.5 text-left text-2xs text-text-muted hover:border-accent hover:text-text"
              >
                {related.term}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <p className="pb-1 text-2xs text-text-muted">
        Educational reference only; definitions and examples are not investment advice.
      </p>
    </div>
  )
}

function TextBlock({
  title,
  body,
  formula = false,
}: {
  title: string
  body: string
  formula?: boolean
}) {
  return (
    <section className="border border-border bg-surface-raised px-2.5 py-2">
      <h3 className="mb-1 text-xs font-semibold text-text">{title}</h3>
      <p className={`select-text whitespace-pre-wrap text-2xs leading-6 text-text-muted ${formula ? 'num' : ''}`}>
        {body}
      </p>
    </section>
  )
}

function EmptyDetail({ query, category }: { query: string; category: string }) {
  const help = !query && category === ALL_CATEGORIES
    ? 'The Dictionary catalog is unavailable.'
    : 'Try a shorter search, an alias such as P/E or RSI, or another category.'
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 text-center">
      <h2 className="text-sm font-semibold text-text">No matching Dictionary terms</h2>
      <p className="text-2xs text-text-muted">{help}</p>
    </div>
  )
}

function PatternDiagram({ pattern }: { pattern: ChartPattern }) {
  const [exampleId, setExampleId] = useState(pattern.examples[0].id)
  const example =
    pattern.examples.find((entry) => entry.id === exampleId) ?? pattern.examples[0]

  return (
    <figure className="border border-border bg-[#0d1420]">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1">
        {pattern.examples.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setExampleId(entry.id)}
            className={`h-5 border px-1.5 text-[10px] ${
              entry.id === example.id
                ? 'border-accent bg-accent-dim text-text'
                : 'border-border-strong text-text-muted hover:text-text'
            }`}
          >
            {entry.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-text-dim">{pattern.bias} · {pattern.family}</span>
      </div>
      <PatternChart
        example={example}
        className="h-48 w-full"
        ariaLabel={`${pattern.name} candlestick example, ${example.label}`}
      />
      <figcaption className="select-text border-t border-border px-2 py-1 text-[10px] text-text-muted">
        {example.caption}
      </figcaption>
    </figure>
  )
}
