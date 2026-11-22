import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { NewsArticle } from '@shared/contract'
import { ageText, buildNewsExportText, parseSearchSymbols, signalText } from '@shared/news'
import { api } from '@/api/client'
import { useNewsPage, useNewsPreview, useNewsTickerSearch } from '@/api/newsQueries'
import { usePortfolio } from '@/api/queries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { groupNewsLiteStories, matchesNewsLiteText, type NewsLiteStory } from '@/components/news/newsLiteStories'
import { NewsSummaryButton } from '@/components/news/NewsSummaryButton'
import { isTextEntry } from '@/lib/shortcuts'
import { useNewsLiteReading } from '@/stores/newsLite'
import './NewsLitePage.css'

const VIEWS = [
  { id: 'all', label: 'All news' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'market', label: 'Market & macro' },
  { id: 'saved', label: 'Saved' },
] as const
type View = (typeof VIEWS)[number]['id']
const PAGE_SIZE = 4
const EMPTY_ARTICLES: NewsArticle[] = []
const EMPTY_TICKERS: string[] = []
const countLabel = (count: number) => count === 1 ? '1 story' : `${count} stories`

function storyLabel(story: NewsLiteStory): string {
  if (story.isPortfolio) return 'Portfolio'
  return story.lead.category === 'search' ? 'Ticker news' : 'Market & macro'
}

export function NewsLitePage({ onStatusChange }: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const portfolio = usePortfolio()
  const holdings = useMemo(() => new Set(portfolio.data?.data.portfolios.flatMap(book => book.tickers.map(ticker => ticker.toUpperCase()))), [portfolio.data])
  const holdingSymbols = useMemo(() => [...holdings], [holdings])
  const query = useNewsPage(holdingSymbols, !portfolio.isPending)
  const [view, setView] = useState<View>('all')
  const [text, setText] = useState('')
  const [ticker, setTicker] = useState('')
  const [lookup, setLookup] = useState<string[]>(EMPTY_TICKERS)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [portfolioFirst, setPortfolioFirst] = useState(false)
  const [page, setPage] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [reading, setReading] = useState(false)
  const [now, setNow] = useState(Date.now)
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')
  const rootRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const activeRowRef = useRef<HTMLButtonElement>(null)
  const saved = useNewsLiteReading(state => state.saved)
  const read = useNewsLiteReading(state => state.read)
  const toggleSaved = useNewsLiteReading(state => state.toggleSaved)
  const toggleRead = useNewsLiteReading(state => state.toggleRead)
  const search = useNewsTickerSearch(lookup)
  const base = query.data?.data.articles ?? EMPTY_ARTICLES
  const searched = lookup.length ? search.data?.data.articles ?? EMPTY_ARTICLES : EMPTY_ARTICLES

  const readSet = useMemo(() => new Set(read), [read])
  const feed = useMemo(() => groupNewsLiteStories([...base, ...searched], holdings), [base, searched, holdings])
  const savedFeed = useMemo(() => {
    const bookmarks = Object.values(saved).flat()
    if (!bookmarks.length) return []
    return groupNewsLiteStories([...bookmarks, ...base, ...searched], holdings).filter(story => saved[story.id])
  }, [base, searched, holdings, saved])
  const portfolioCount = feed.filter(story => story.isPortfolio).length
  const counts: Record<View, number> = { all: feed.length, portfolio: portfolioCount, market: feed.length - portfolioCount, saved: savedFeed.length }

  const results = useMemo(() => {
    const terms = text.trim().split(/[\s,;]+/).filter(Boolean).map(term => term.replace(/^\$/, ''))
    const pool = view === 'saved' ? savedFeed : feed
    const filtered = pool.filter(story => (
      (view !== 'portfolio' || story.isPortfolio) && (view !== 'market' || !story.isPortfolio)
      && (!unreadOnly || !readSet.has(story.id)) && (!ticker || story.tickers.includes(ticker))
      && (lookup.length ? lookup.some(symbol => story.tickers.includes(symbol)) : matchesNewsLiteText(story, terms))
    ))
    if (portfolioFirst) filtered.sort((a, b) => Number(b.isPortfolio) - Number(a.isPortfolio))
    return filtered
  }, [text, view, savedFeed, feed, unreadOnly, readSet, ticker, lookup, portfolioFirst])
  const currentPage = Math.min(page, Math.max(0, Math.ceil(results.length / PAGE_SIZE) - 1))
  const start = currentPage * PAGE_SIZE
  const visible = results.slice(start, start + PAGE_SIZE)
  const selected = visible.find(story => story.id === selectedId) ?? visible[0]
  const lookupSymbols = parseSearchSymbols(text.replace(/(^|[\s,;])\$/g, '$1'))
  const canLookUp = lookupSymbols.length > 0 && lookupSymbols.every(symbol => /^[\^]?[A-Z0-9][A-Z0-9.=-]{0,14}$/.test(symbol))

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    const panels: PanelStatus[] = ['Portfolio News', 'Market & Macro', 'News Feeds'].map(label => ({
      label, envelope: query.data, error: query.error, loading: query.isFetching,
    }))
    if (lookup.length) panels.push({ label: 'Ticker search', envelope: search.data, error: search.error, loading: search.isFetching })
    onStatusChange(panels, '')
  }, [onStatusChange, query.data, query.error, query.isFetching, search.data, search.error, search.isFetching, lookup.length])

  useLayoutEffect(() => {
    if (reading && backRef.current?.getClientRects().length) backRef.current.focus()
  }, [reading, selected?.id])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || isTextEntry(event.target)) return
      if (event.target !== document.body && event.target instanceof Node && !rootRef.current?.contains(event.target)) return
      if (event.key === '/') {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (event.key === 'Escape' && reading && backRef.current?.getClientRects().length) {
        event.preventDefault()
        setReading(false)
        requestAnimationFrame(() => activeRowRef.current?.focus())
      }
      const step = event.key === 'j' ? 1 : event.key === 'k' ? -1 : 0
      if (!step || !selected) return
      const index = Math.min(Math.max(results.indexOf(selected) + step, 0), results.length - 1)
      event.preventDefault()
      setPage(Math.floor(index / PAGE_SIZE))
      setSelectedId(results[index]!.id)
      setReading(true)
      requestAnimationFrame(() => {
        if (!backRef.current?.getClientRects().length) activeRowRef.current?.focus()
      })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected, results, reading])

  useEffect(() => {
    if (copied === 'idle') return
    const timer = window.setTimeout(() => setCopied('idle'), 3000)
    return () => window.clearTimeout(timer)
  }, [copied])

  function resetPage() {
    setPage(0)
    setReading(false)
  }

  function clearFilters() {
    setView('all')
    setText('')
    setTicker('')
    setLookup(EMPTY_TICKERS)
    setUnreadOnly(false)
    resetPage()
    searchRef.current?.focus()
  }

  function explainEmpty() {
    if (view === 'saved' && !savedFeed.length) return 'Save a story to start your reading queue.'
    if (lookup.length && search.isFetching) return 'Looking up ticker news…'
    if (!query.data && (query.isLoading || portfolio.isPending)) return 'Loading headlines…'
    if (text || ticker || unreadOnly) return 'No stories match these filters.'
    return 'No headlines available for this view.'
  }

  async function copyDigest() {
    const portfolio: NewsArticle[] = []
    const market: NewsArticle[] = []
    const searched: NewsArticle[] = []
    for (const article of results.flatMap(story => story.articles)) {
      if (article.category === 'search') searched.push(article)
      else (article.category === 'portfolio' ? portfolio : market).push(article)
    }
    try {
      await api.writeClipboard(buildNewsExportText({ portfolio, market, searched, searchedTickers: lookup, now }))
      setCopied('copied')
    } catch {
      setCopied('failed')
    }
  }

  return <section className="news-lite" ref={rootRef} aria-label="News Lite">
    <header className="news-lite-commands">
      <form className="news-lite-search" onSubmit={event => {
        event.preventDefault()
        if (!canLookUp) return
        setLookup(lookupSymbols)
        setTicker('')
        setView('all')
        resetPage()
      }}>
        <input ref={searchRef} type="search" aria-label="Search headlines, tickers, or sources"
          placeholder="Headlines, tickers, sources…" spellCheck={false} value={text}
          onChange={event => {
            setText(event.target.value)
            setLookup(EMPTY_TICKERS)
            resetPage()
          }} />
        <kbd aria-hidden="true">/</kbd>
        <button type="submit" disabled={!canLookUp} title="Look up news for symbols outside your portfolios">Look up tickers</button>
      </form>
      <button className="news-lite-control news-lite-copy" type="button" aria-label="Copy digest" disabled={!results.length}
        onClick={() => void copyDigest()}>{copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy digest'}</button>
      <span className="sr-only" role="status">{copied === 'copied' ? 'Digest copied to clipboard' : copied === 'failed' ? 'Could not copy digest' : ''}</span>
    </header>

    {holdingSymbols.length ? <section className="news-lite-watch" aria-label="Portfolio tickers">
      <h2>Portfolio tickers</h2>
      <div className="news-lite-tickers">
        {holdingSymbols.slice(0, 4).map(symbol => <button type="button" key={symbol} aria-pressed={ticker === symbol} onClick={() => {
          setTicker(ticker === symbol ? '' : symbol)
          setLookup(EMPTY_TICKERS)
          setView('all')
          resetPage()
        }}><strong>{symbol}</strong><span>{countLabel(feed.filter(story => story.tickers.includes(symbol)).length)}</span></button>)}
      </div>
    </section> : null}

    <div className={`news-lite-workspace${reading && selected ? ' is-reading' : ''}`}>
      <div className="news-lite-toolbar">
        <nav aria-label="News views">{VIEWS.map(option => <button type="button" key={option.id} aria-pressed={view === option.id}
          onClick={() => {
            setView(option.id)
            setTicker('')
            setLookup(EMPTY_TICKERS)
            resetPage()
          }}>{option.label} <span>{counts[option.id]}</span></button>)}</nav>
        <select className="news-lite-control" aria-label="Sort headlines" value={portfolioFirst ? 'portfolio' : 'newest'}
          onChange={event => {
            setPortfolioFirst(event.target.value === 'portfolio')
            resetPage()
          }}>
          <option value="newest">Newest</option><option value="portfolio">Portfolio first</option>
        </select>
      </div>

      <div className="news-lite-panes">
        <section className="news-lite-feed" aria-label="Headlines">
          <div className="news-lite-feedbar">
            <span role="status">{countLabel(results.length)}</span>
            <button type="button" className="news-lite-control" aria-pressed={unreadOnly}
              onClick={() => {
                setUnreadOnly(!unreadOnly)
                resetPage()
              }}>Unread only</button>
          </div>
          <div className="news-lite-feedbody">
            {visible.length ? <ul>{visible.map(story => {
              const { id, lead } = story
              const isSaved = Boolean(saved[id])
              const isRead = readSet.has(id)
              return <li key={id}>
                <button type="button" className="news-lite-story" ref={selected?.id === id ? activeRowRef : undefined}
                  aria-current={selected?.id === id} onClick={() => {
                    setSelectedId(id)
                    setReading(true)
                  }}>
                  <span className="news-lite-story-meta">
                    {!isRead ? <><i aria-hidden="true" /><span className="sr-only">Unread. </span></> : null}
                    {signalText(lead).split(' · ')[0] || storyLabel(story)} · {ageText(lead.publishedAt, now)}
                  </span>
                  <strong>{lead.title}</strong>
                  <span className="news-lite-story-meta">
                    {story.tickers.length ? <><b>{story.tickers.join(' · ')}</b><span aria-hidden="true"> / </span></> : null}
                    {lead.source || 'Unknown publisher'}{story.articles.length > 1 ? ` +${story.articles.length - 1}` : ''}
                  </span>
                </button>
                <button className="news-lite-star" type="button" aria-pressed={isSaved} aria-label={`Save story: ${lead.title}`}
                  onClick={() => toggleSaved(id, story.articles)}>{isSaved ? '★' : '☆'}</button>
              </li>
            })}</ul> : <div className="news-lite-empty">
              <p>{explainEmpty()}</p>
              {(view !== 'all' || text || ticker || unreadOnly) && !(lookup.length && search.isFetching) ? (
                <button type="button" className="news-lite-control" onClick={clearFilters}>Show all news</button>
              ) : null}
            </div>}
          </div>
          {results.length > PAGE_SIZE ? <div className="news-lite-pager">
            <span>{start + 1}–{start + visible.length} of {results.length}</span>
            <div><button type="button" className="news-lite-control" aria-label="Previous page" disabled={!currentPage}
              onClick={() => setPage(currentPage - 1)}>‹</button>
            <button type="button" className="news-lite-control" aria-label="Next page" disabled={start + PAGE_SIZE >= results.length}
              onClick={() => setPage(currentPage + 1)}>›</button></div>
          </div> : null}
        </section>
        <aside className="news-lite-reader" aria-label="Story brief">
          {selected ? <>
            <button ref={backRef} type="button" className="news-lite-control news-lite-back" onClick={() => {
              setReading(false)
              requestAnimationFrame(() => activeRowRef.current?.focus())
            }}>← Headlines</button>
            <NewsLiteReader key={selected.id} story={selected} now={now} holdings={holdings} isRead={readSet.has(selected.id)}
              isSaved={Boolean(saved[selected.id])} onRead={() => toggleRead(selected.id)} onSave={() => toggleSaved(selected.id, selected.articles)} />
          </> : <p className="news-lite-empty">Select a headline to read it here.</p>}
        </aside>
      </div>
    </div>
  </section>
}

function NewsLiteReader({ story, now, holdings, isRead, isSaved, onRead, onSave }: {
  story: NewsLiteStory
  now: number
  holdings: ReadonlySet<string>
  isRead: boolean
  isSaved: boolean
  onRead: () => void
  onSave: () => void
}) {
  const [sourceId, setSourceId] = useState('')
  const activeSource = story.articles.find(article => article.id === sourceId)
  const query = useNewsPreview(activeSource ?? null)
  const preview = query.data?.data
  const matchingHoldings = story.tickers.filter(ticker => holdings.has(ticker))
  const signals = signalText(story.lead)
  const briefing = story.articles.find(article => article.summary.trim())
  return <>
    <div className="news-lite-kicker"><span><b>{storyLabel(story)}</b> {ageText(story.lead.publishedAt, now)}</span>
      {story.tickers.length ? <strong>{story.tickers.join(' · ')}</strong> : null}</div>
    <h2>{story.lead.title}</h2>
    <div className="news-lite-actions">
      <button type="button" className="news-lite-control" aria-label="Save story" aria-pressed={isSaved} onClick={onSave}>{isSaved ? '★ Saved' : '☆ Save story'}</button>
      <button type="button" className="news-lite-control" onClick={onRead}>{isRead ? 'Mark unread' : 'Mark read'}</button>
    </div>
    {briefing ? <p className="news-lite-brief">{briefing.summary}</p> : null}
    {(matchingHoldings.length || signals) ? <section className="news-lite-context">
      <h3>Why it matters</h3>
      {matchingHoldings.length ? <p>In your portfolios · {matchingHoldings.join(', ')}</p> : null}
      {signals ? <p>Headline tags · {signals}</p> : null}
    </section> : null}
    <section className="news-lite-sources" aria-label="Source previews">
      <div className="news-lite-source-heading"><h3>Source previews</h3><span>{story.articles.length} {story.articles.length === 1 ? 'report' : 'reports'}</span></div>
      {story.articles.map(article => <div className="news-lite-source" key={article.id}>
        <button type="button" className="news-lite-source-toggle" aria-expanded={activeSource?.id === article.id}
          onClick={() => setSourceId(activeSource?.id === article.id ? '' : article.id)}>
          <strong>{article.source || 'Unknown publisher'}</strong><span>{ageText(article.publishedAt, now)}</span><span aria-hidden="true">›</span>
        </button>
        {activeSource?.id === article.id ? <div className="news-lite-source-preview">
          <p>{preview?.text?.trim() || article.summary || (query.isFetching ? 'Loading preview…' : 'No readable preview is available.')}</p>
          <div className="news-lite-actions">
            <NewsSummaryButton article={article} preview={preview} loading={query.isFetching} />
            <button type="button" className="news-lite-control" disabled={!article.url} onClick={() => void api.openExternal(article.url)}>Open original ↗</button>
          </div>
        </div> : null}
      </div>)}
    </section>
  </>
}
