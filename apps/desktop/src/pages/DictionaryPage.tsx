import { useEffect, useMemo, useRef, useState } from 'react'
import { CHART_PATTERN_CATALOG, type ChartPattern } from '@shared/chartPatterns'
import { DICTIONARY_CATEGORIES, DICTIONARY_ENTRIES, getDictionaryEntry, searchDictionaryEntries, type DictionaryEntry } from '@shared/dictionary'
import { PatternChart } from '@/components/charts/PatternChart'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { useDictionary } from '@/stores/dictionary'
import '@/styles/dictionary.css'

const ALL_CATEGORIES = 'All categories'
const PATTERN_BY_ID = new Map(CHART_PATTERN_CATALOG.map(pattern => [pattern.id, pattern]))

function Icon({ name }: { name: 'search' | 'bookmark' | 'copy' | 'arrow' | 'close' }) {
  const paths = {
    search: 'm21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    bookmark: 'M6 3h12v18l-6-4-6 4z',
    copy: 'M9 9h12v12H9zM5 15H3V3h12v2',
    arrow: 'm9 5 7 7-7 7',
    close: 'm6 6 12 12M18 6 6 18',
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}

export function DictionaryPage({ onStatusChange }: { onStatusChange: (panels: PanelStatus[], sourcePath: string) => void }) {
  const [query, setQuery] = useState('')
  const [savedOnly, setSavedOnly] = useState(false)
  const { category, selectedEntryId, savedEntryIds, recentEntryIds, visit, setCategory, toggleSaved } = useDictionary()
  const pageRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const entries = useMemo(() => searchDictionaryEntries(query, category)
    .filter(entry => !savedOnly || savedEntryIds.includes(entry.entryId)), [query, category, savedOnly, savedEntryIds])
  const selectedEntry = entries.find(entry => entry.entryId === selectedEntryId) ?? entries[0]

  useEffect(() => { onStatusChange([], '') }, [onStatusChange])
  useEffect(() => {
    if (selectedEntry) visit(selectedEntry.entryId)
  }, [selectedEntry, visit])

  useEffect(() => {
    // Reveal the active row inside each browser list without moving the article
    // or the application's outer scroll position.
    const lists = Array.from(pageRef.current?.querySelectorAll<HTMLElement>('.dictionary-categories, .dictionary-terms') ?? [])
    const revealCurrent = () => {
      for (const list of lists) {
        const active = list.querySelector<HTMLElement>('[aria-current]')
        if (!active) continue
        const row = active.getBoundingClientRect()
        const bounds = list.getBoundingClientRect()
        if (row.top < bounds.top) list.scrollTop += row.top - bounds.top - 4
        else if (row.bottom > bounds.bottom) list.scrollTop += row.bottom - bounds.bottom + 4
      }
    }
    revealCurrent()
    const observer = new ResizeObserver(revealCurrent)
    lists.forEach(list => observer.observe(list))
    return () => observer.disconnect()
  }, [category, selectedEntry?.entryId])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      // Cached hidden pages must not claim shortcuts from the visible workspace.
      if (!pageRef.current?.getClientRects().length) return
      event.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  const openTerm = (entryId: string) => {
    const entry = getDictionaryEntry(entryId)
    if (!entry) return
    setQuery('')
    setSavedOnly(false)
    setCategory(entry.category)
    visit(entry.entryId)
  }
  const resetFilters = () => {
    setQuery('')
    setSavedOnly(false)
    setCategory(ALL_CATEGORIES)
    searchRef.current?.focus()
  }
  const search = (value: string) => {
    setQuery(value)
    setCategory(ALL_CATEGORIES)
    // An exact term or alias should win over a previously open article that only
    // mentions the query in its body.
    const first = searchDictionaryEntries(value).find(entry => !savedOnly || savedEntryIds.includes(entry.entryId))
    if (value.trim() && first) visit(first.entryId)
  }

  return (
    <main ref={pageRef} className="dictionary-page" aria-label="Dictionary">
      <header className="dictionary-header">
        <div className="dictionary-title">
          <h1>Dictionary</h1>
          <p>{DICTIONARY_ENTRIES.length} entries <span aria-hidden="true">·</span> Available offline</p>
        </div>
        <div className="dictionary-search">
          <Icon name="search" />
          <input ref={searchRef} type="search" aria-label="Search Dictionary" aria-keyshortcuts="/"
            value={query} onChange={event => search(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape' && query) { event.stopPropagation(); setQuery('') }
            }} placeholder="Search terms, aliases, formulas or definitions" />
          {query ? <button type="button" aria-label="Clear dictionary search" onClick={() => { setQuery(''); searchRef.current?.focus() }}><Icon name="close" /></button> : <kbd title="Press / to search">/</kbd>}
        </div>
        <button type="button" className="dictionary-saved-toggle" aria-pressed={savedOnly}
          onClick={() => { setSavedOnly(value => !value); setCategory(ALL_CATEGORIES); setQuery('') }}>
          <Icon name="bookmark" /> Saved terms <span className="num">{savedEntryIds.length}</span>
        </button>
      </header>
      <div className="dictionary-workspace">
        <aside className="dictionary-browser" aria-label="Browse dictionary">
          <h2 className="dictionary-eyebrow">Categories</h2>
          <nav className="dictionary-categories" aria-label="Dictionary categories">
            {[ALL_CATEGORIES, ...DICTIONARY_CATEGORIES].map(value => <button key={value} type="button"
              aria-current={category === value ? 'true' : undefined}
              onClick={() => { setCategory(value); setSavedOnly(false); setQuery('') }}>
              {value === ALL_CATEGORIES ? 'All terms' : value}
            </button>)}
          </nav>
          <div className="dictionary-terms-heading">
            <h2 className="dictionary-eyebrow">{savedOnly ? 'Saved terms' : query.trim() ? 'Search results' : category === ALL_CATEGORIES ? 'All terms' : 'Terms in this topic'}</h2>
            <span className="num" aria-live="polite">{entries.length}</span>
          </div>
          <nav className="dictionary-terms" aria-label="Dictionary terms">
            {entries.map(entry => <button key={entry.entryId} type="button"
              aria-current={entry.entryId === selectedEntry?.entryId ? 'true' : undefined}
              title={[entry.term, entry.category, ...entry.aliases].join(' · ')} onClick={() => visit(entry.entryId)}>
              <span>{entry.term}</span>
              {savedEntryIds.includes(entry.entryId) && <Icon name="bookmark" />}
            </button>)}
            {!entries.length && <p className="dictionary-list-empty">{savedOnly ? 'No saved terms match.' : 'No matching terms.'}</p>}
          </nav>
        </aside>
        {selectedEntry ? <EntryDetail key={selectedEntry.entryId} entry={selectedEntry}
          saved={savedEntryIds.includes(selectedEntry.entryId)} onToggleSaved={() => toggleSaved(selectedEntry.entryId)}
          recentEntryIds={recentEntryIds} onOpenTerm={openTerm} /> : (
          <section className="dictionary-empty" aria-live="polite">
            <Icon name={savedOnly ? 'bookmark' : 'search'} />
            <h2>{savedOnly && !savedEntryIds.length ? 'Build your reference shelf' : 'No matching terms'}</h2>
            <p>{savedOnly && !savedEntryIds.length ? 'Save any term with its bookmark button to find it here.' : 'Try a shorter search, an alias such as P/E or RSI, or another category.'}</p>
            <button type="button" onClick={resetFilters}>Browse all terms</button>
          </section>
        )}
      </div>
      <footer className="dictionary-footer">Educational reference only; definitions and examples are not investment advice.</footer>
    </main>
  )
}

function EntryDetail({ entry, saved, onToggleSaved, recentEntryIds, onOpenTerm }: {
  entry: DictionaryEntry; saved: boolean; onToggleSaved: () => void
  recentEntryIds: string[]; onOpenTerm: (entryId: string) => void
}) {
  const readerRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const [activeSection, setActiveSection] = useState('overview')
  const pattern = entry.chartPatternId ? PATTERN_BY_ID.get(entry.chartPatternId) : undefined
  const related = entry.relatedEntryIds.flatMap(id => getDictionaryEntry(id) ?? [])
  const recent = recentEntryIds.filter(id => id !== entry.entryId).slice(0, 5).flatMap(id => getDictionaryEntry(id) ?? [])
  const outline = [
    { id: 'overview', label: 'Overview' },
    ...(pattern ? [{ id: 'pattern', label: 'Chart pattern' }] : []),
    { id: 'why-it-matters', label: 'Why it matters' },
    ...entry.sections.map((section, index) => ({ id: `section-${index}`, label: section.title === 'Interpretation and limitation' ? 'Limitations' : section.title })),
    ...(related.length ? [{ id: 'related', label: 'Related terms' }] : []),
  ]
  const jumpTo = (id: string) => {
    const reader = readerRef.current
    const target = articleRef.current?.querySelector<HTMLElement>(`[data-dictionary-section="${id}"]`)
    if (!reader || !target) return
    reader.scrollTo({ top: reader.scrollTop + target.getBoundingClientRect().top - reader.getBoundingClientRect().top - 24 })
    setActiveSection(id)
    target.focus({ preventScroll: true })
  }
  const trackSection = () => {
    const top = (readerRef.current?.getBoundingClientRect().top ?? 0) + 90
    const headings = Array.from(articleRef.current?.querySelectorAll<HTMLElement>('[data-dictionary-section]') ?? [])
    const visible = headings.filter(node => node.getBoundingClientRect().top <= top).at(-1)
    setActiveSection(visible?.dataset.dictionarySection ?? 'overview')
  }
  const outlineLinks = <nav aria-label="Article sections">{outline.map(section => <button type="button" key={section.id}
    aria-current={activeSection === section.id ? 'location' : undefined} onClick={() => jumpTo(section.id)}>{section.label}</button>)}</nav>

  return (
    <div className="dictionary-reader" ref={readerRef} onScroll={trackSection}>
      <article className="dictionary-article" ref={articleRef} aria-label={entry.term}>
        <header className="dictionary-entry-header" data-dictionary-section="overview" tabIndex={-1}>
          <p className="dictionary-breadcrumb">{entry.category}</p>
          <div className="dictionary-entry-title">
            <h2 aria-live="polite" aria-atomic="true">{entry.term}</h2>
            <button type="button" className="dictionary-bookmark" aria-label={saved ? `Unsave ${entry.term}` : `Save ${entry.term}`}
              aria-pressed={saved} title={saved ? 'Remove from saved terms' : 'Save term'} onClick={onToggleSaved}><Icon name="bookmark" /></button>
          </div>
          {entry.aliases.length > 0 && <p className="dictionary-aliases">{entry.aliases.map(alias => <span key={alias}>{alias}</span>)}</p>}
          <p className="dictionary-definition">{entry.definition}</p>
        </header>
        <details className="dictionary-mobile-outline"><summary>On this page</summary>{outlineLinks}</details>
        {pattern && <section className="dictionary-section" data-dictionary-section="pattern" tabIndex={-1}>
          <h3>Chart pattern</h3><PatternDiagram pattern={pattern} />
        </section>}
        <TextBlock id="why-it-matters" title="Why it matters" body={entry.whyItMatters} />
        {entry.sections.map((section, index) => <TextBlock key={index} id={`section-${index}`} title={section.title} body={section.body} />)}
        {related.length > 0 && <section className="dictionary-section dictionary-related" data-dictionary-section="related" tabIndex={-1}>
          <h3>Related terms</h3><TermLinks entries={related} onOpenTerm={onOpenTerm} />
        </section>}
      </article>
      <aside className="dictionary-context" aria-label="Reading tools">
        <section className="dictionary-desktop-outline"><h2 className="dictionary-eyebrow">On this page</h2>{outlineLinks}</section>
        {related.length > 0 && <section><h2 className="dictionary-eyebrow">Related terms</h2><TermLinks entries={related} onOpenTerm={onOpenTerm} /></section>}
        <section><h2 className="dictionary-eyebrow">Recently viewed</h2>
          {recent.length ? <TermLinks entries={recent} onOpenTerm={onOpenTerm} /> : <p className="dictionary-history-empty">Your reading history will appear here.</p>}
        </section>
      </aside>
    </div>
  )
}

function TermLinks({ entries, onOpenTerm }: { entries: DictionaryEntry[]; onOpenTerm: (entryId: string) => void }) {
  return <div className="dictionary-term-links">{entries.map(entry => <button type="button" key={entry.entryId} onClick={() => onOpenTerm(entry.entryId)}>
    <span>{entry.term}</span><Icon name="arrow" />
  </button>)}</div>
}

function TextBlock({ id, title, body }: { id: string; title: string; body: string }) {
  const [copyStatus, setCopyStatus] = useState('')
  const formula = title === 'Formula'
  const caution = /limitation|caution|risk|pitfall/i.test(title)
  const copy = async () => {
    try { await window.api.writeClipboard(body); setCopyStatus('Formula copied') }
    catch { setCopyStatus('Could not copy. Select the formula to copy it manually.') }
  }
  return (
    <section className={`dictionary-section${formula ? ' dictionary-formula' : ''}${caution ? ' dictionary-caution' : ''}${title === 'Worked example' ? ' dictionary-example' : ''}`}
      data-dictionary-section={id} tabIndex={-1}>
      <div className="dictionary-section-title"><h3>{title === 'Interpretation and limitation' ? 'Keep in mind' : title}</h3>
        {formula && <button type="button" aria-label="Copy formula" title="Copy formula" onClick={() => void copy()}><Icon name="copy" /></button>}
      </div>
      {formula ? <FormulaText body={body} /> : <p>{body}</p>}
      {formula && <span className="dictionary-copy-status" role="status">{copyStatus}</span>}
    </section>
  )
}

function FormulaText({ body }: { body: string }) {
  // Present the catalog's RSI formula as a readable fraction. Copying still uses
  // the original catalog text, and every other formula keeps its full notation.
  const rsi = /^RSI = 100 − 100\/\(1 \+ (.+)\)$/.exec(body)
  if (!rsi) return <p className="num">{body}</p>
  return <div className="dictionary-formula-math" role="math" aria-label={body}>
    <div className="dictionary-equation" aria-hidden="true">
      <span>RSI = 100 −</span>
      <span className="dictionary-fraction"><span>100</span><span>1 + RS</span></span>
    </div>
    <p className="dictionary-formula-variable" aria-hidden="true">RS = {rsi[1]}</p>
  </div>
}

function PatternDiagram({ pattern }: { pattern: ChartPattern }) {
  const [exampleId, setExampleId] = useState(pattern.examples[0].id)
  const example = pattern.examples.find(entry => entry.id === exampleId) ?? pattern.examples[0]
  return (
    <figure className="dictionary-pattern">
      <div className="dictionary-pattern-toolbar">
        <div aria-label="Chart pattern examples">{pattern.examples.map(entry => <button key={entry.id} type="button"
          aria-pressed={entry.id === example.id} onClick={() => setExampleId(entry.id)}>{entry.label}</button>)}</div>
        <span>{pattern.bias} · {pattern.family}</span>
      </div>
      <PatternChart example={example} className="h-64 w-full" ariaLabel={`${pattern.name} candlestick example, ${example.label}`} />
      <figcaption>{example.caption}</figcaption>
    </figure>
  )
}
