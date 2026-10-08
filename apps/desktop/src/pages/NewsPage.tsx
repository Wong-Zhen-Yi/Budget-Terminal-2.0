import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Envelope, NewsArticle } from '@shared/contract'
import { buildNewsExportText, parseSearchSymbols, splitNewsGroups } from '@shared/news'
import { api } from '@/api/client'
import {
  useNewsPage,
  useNewsPreview,
  useNewsTickerSearch,
  useRefreshNewsPage,
} from '@/api/newsQueries'
import { usePortfolio, useQuotes } from '@/api/queries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { useCardColumns, useProgressiveCount } from '@/components/news/hooks'
import { NewsHero } from '@/components/news/NewsHero'
import { NewsReader } from '@/components/news/NewsReader'
import { NewsSection } from '@/components/news/NewsSection'
import { NewsSourceStrip } from '@/components/news/NewsSourceStrip'
import { NewsTickerSearchBar } from '@/components/news/NewsTickerSearchBar'
import { NewsToolbar, type Tone } from '@/components/news/NewsToolbar'
import { Splitter } from '@/components/ui/Splitter'
import { isTextEntry } from '@/lib/shortcuts'
import { useNewsPageStore } from '@/stores/news'
import { newsHero, newsQuoteTickers } from '@/api/initialContent'

/**
 * The News page, ported from `NewsMixin` (`mixins/news.py`).
 *
 * Three lanes of articles as a reflowing card grid — Portfolio Spotlight from Yahoo's
 * per-holding search, Market & Macro from Yahoo's per-symbol headline feeds and six keyless
 * publisher RSS feeds — with a reader rail, a signal heuristic and an outside-portfolio
 * ticker search.
 *
 * Two departures from the reference, both deliberate and both noted where they happen: the
 * reader is a right rail rather than a strip above the cards (`NewsReader`), and the
 * highest-scoring recent story is promoted to a hero above the grid (`NewsHero`).
 */

/** The section labels the envelope's per-block errors are keyed by, from the orchestrator. */
const PORTFOLIO_SECTION = 'Portfolio Spotlight'
const MARKET_SECTION = 'Market & Macro'

/** Keeps both panes usable however far the divider is dragged. */
const MIN_GRID = 420
const MIN_READER = 300

/** A story older than this is never promoted to the hero, whatever it scored. */
/** `warningOf` from `PreMarketPage`: the per-block error a panel looks itself up by. */
function warningOf(envelope: Envelope<unknown> | undefined, block: string): string | undefined {
  if (!envelope) return undefined
  const failed = envelope.errors.find((entry) => entry.symbol === block)
  if (failed) return failed.reason
  const { freshness, failureReason } = envelope.meta
  if (freshness === 'failed') return failureReason || freshness
  return undefined
}

export function NewsPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const portfolioQuery = usePortfolio()
  // Every saved portfolio's holdings, not just the active one — `_get_fetch_tickers`.
  const holdings = useMemo(() => {
    const seen = new Set<string>()
    for (const portfolio of portfolioQuery.data?.data.portfolios ?? []) {
      for (const ticker of portfolio.tickers) seen.add(ticker.toUpperCase())
    }
    return [...seen]
  }, [portfolioQuery.data])

  const query = useNewsPage(holdings)
  const refresh = useRefreshNewsPage(holdings)

  const filter = useNewsPageStore((state) => state.filter)
  const sort = useNewsPageStore((state) => state.sort)
  const showImages = useNewsPageStore((state) => state.showImages)
  const readerOpen = useNewsPageStore((state) => state.readerOpen)
  const readerWidth = useNewsPageStore((state) => state.readerWidth)
  const setFilter = useNewsPageStore((state) => state.setFilter)
  const setSort = useNewsPageStore((state) => state.setSort)
  const toggleImages = useNewsPageStore((state) => state.toggleImages)
  const setReaderOpen = useNewsPageStore((state) => state.setReaderOpen)
  const setReaderWidth = useNewsPageStore((state) => state.setReaderWidth)

  const [queryText, setQueryText] = useState('')
  const [searchTickers, setSearchTickers] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: Tone } | null>(null)

  const gridRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const columns = useCardColumns(gridRef)

  const searchQuery = useNewsTickerSearch(searchTickers)
  const payload = query.data?.data

  /**
   * One clock for every age badge on the page. The reference never updates its ages at all;
   * a minute tick costs one re-render and keeps `<1m` from sitting there for an hour.
   */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  /* ------------------------------------------------------------- selection */

  const articles = useMemo(() => payload?.articles ?? [], [payload])
  const searchArticles = useMemo(
    () => searchQuery.data?.data.articles ?? [],
    [searchQuery.data],
  )

  const quoteTickers = useMemo(
    () => newsQuoteTickers([...articles, ...searchArticles]),
    [articles, searchArticles],
  )
  const quotesQuery = useQuotes(quoteTickers)
  const quotes = quotesQuery.data?.data.holdings

  const groups = useMemo(
    () => splitNewsGroups(articles, filter, queryText, sort),
    [articles, filter, queryText, sort],
  )
  const visibleSearch = useMemo(
    () =>
      queryText
        ? splitNewsGroups(searchArticles, 'all', queryText, 'newest').market
        : searchArticles,
    [searchArticles, queryText],
  )

  /** The flattened reading order, which is what the keyboard walks. */
  const ordered = useMemo(
    () => [...visibleSearch, ...groups.portfolio, ...groups.market],
    [visibleSearch, groups],
  )

  const selected = useMemo(
    () => ordered.find((article) => article.id === selectedId) ?? null,
    [ordered, selectedId],
  )
  const preview = useNewsPreview(selected)

  /**
   * The top story: highest score, recency breaking ties, but only from the last day —
   * several of the publisher feeds carry months-old items, and a hero is a claim about
   * right now. Hidden while a filter is active so it cannot contradict the list under it.
   */
  const hero = useMemo(() => {
    if (queryText || filter !== 'all') return null
    return newsHero(groups.market, now)
  }, [groups.market, queryText, filter, now])

  const heroId = hero?.id ?? ''
  const marketBody = useMemo(
    () => groups.market.filter((article) => article.id !== heroId),
    [groups.market, heroId],
  )

  const portfolioVisible = useProgressiveCount(groups.portfolio.length)
  const marketVisible = useProgressiveCount(marketBody.length)

  /* ---------------------------------------------------------------- status */

  useEffect(() => {
    const loading = query.isFetching
    onStatusChange(
      [
        { label: 'Portfolio News', envelope: query.data, error: query.error, enabled: query.isEnabled, loading },
        { label: 'Market & Macro', envelope: query.data, error: query.error, enabled: query.isEnabled, loading },
        { label: 'News Feeds', envelope: query.data, error: query.error, enabled: query.isEnabled, loading },
      ],
      '',
    )
  }, [onStatusChange, query.data, query.isFetching])

  const feedErrors = useMemo(() => {
    const map = new Map<string, string>()
    for (const error of query.data?.errors ?? []) {
      if (error.operation === 'newsFeed' && error.symbol) map.set(error.symbol, error.reason)
    }
    return map
  }, [query.data])

  const counts = useMemo(() => {
    const portfolio = articles.filter((article) => article.category === 'portfolio').length
    return { all: articles.length, portfolio, market_macro: articles.length - portfolio }
  }, [articles])

  const status = useMemo<{ text: string; tone: Tone }>(() => {
    if (notice) return notice
    if (query.isFetching) {
      return { text: payload ? 'Refreshing news...' : 'Loading news...', tone: 'muted' }
    }
    if (!holdings.length) return { text: 'Add a holding to load portfolio news.', tone: 'warning' }
    const meta = query.data?.meta
    if (meta?.freshness === 'failed') {
      return { text: `News failed: ${meta.failureReason ?? 'unknown error'}`, tone: 'negative' }
    }
    if (!payload) return { text: 'Ready', tone: 'muted' }

    const shown = visibleSearch.length + groups.portfolio.length + groups.market.length
    const base = `${shown} visible of ${articles.length + searchArticles.length} article(s)`
    const degraded = query.data?.errors.filter((error) => error.operation === 'newsFeed').length ?? 0
    return degraded
      ? { text: `${base} — ${degraded} source(s) unavailable`, tone: 'warning' }
      : { text: base, tone: 'positive' }
  }, [
    notice,
    query.isFetching,
    query.data,
    payload,
    holdings,
    visibleSearch,
    groups,
    articles,
    searchArticles,
  ])

  const searchStatus = useMemo(() => {
    if (!searchTickers.length) {
      return 'Searches are temporary and do not change your portfolio.'
    }
    if (searchQuery.isFetching) return `Searching ${searchTickers.join(', ')}...`
    const data = searchQuery.data?.data
    if (!data) return `Searching ${searchTickers.join(', ')}...`
    const parts = [`Queried: ${data.queried.join(', ')}`, `${data.articles.length} article(s)`]
    if (data.empty.length) parts.push(`No articles: ${data.empty.join(', ')}`)
    if (data.failed.length) parts.push(`Failed: ${data.failed.join(', ')}`)
    return parts.join(' · ')
  }, [searchTickers, searchQuery.data, searchQuery.isFetching])

  /* --------------------------------------------------------------- actions */

  const openArticle = useCallback((article: NewsArticle) => {
    if (!article.url) {
      setNotice({ text: 'That article has no link to open.', tone: 'warning' })
      return
    }
    void api.openExternal(article.url)
  }, [])

  const selectArticle = useCallback(
    (article: NewsArticle) => {
      setNotice(null)
      setSelectedId(article.id)
      if (!readerOpen) setReaderOpen(true)
    },
    [readerOpen, setReaderOpen],
  )

  const onRefresh = useCallback(async () => {
    setNotice(null)
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }, [refresh])

  const onExport = useCallback(async () => {
    const total = articles.length + searchArticles.length
    if (!total) {
      setNotice({ text: 'No News articles to export.', tone: 'warning' })
      return
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const path = await api.saveText(
      `BudgetTerminal_News_${stamp}.txt`,
      buildNewsExportText({
        portfolio: articles.filter((article) => article.category === 'portfolio'),
        market: articles.filter(
          (article) => article.category === 'macro' || article.category === 'other',
        ),
        searched: searchArticles,
        searchedTickers: searchTickers,
      }),
    )
    setNotice(
      path ? { text: `Exported ${total} News article(s) to ${path}`, tone: 'positive' } : null,
    )
  }, [articles, searchArticles, searchTickers])

  const onDrag = useCallback(
    (clientX: number) => {
      const width = window.innerWidth - clientX
      setReaderWidth(Math.min(Math.max(width, MIN_READER), window.innerWidth - MIN_GRID))
    },
    [setReaderWidth],
  )

  /* -------------------------------------------------------------- keyboard */

  /**
   * `j`/`k` and the arrows walk the reading order, Enter opens, `/` jumps to the filter.
   *
   * Every one of these is a bare key, so they all defer to `isTextEntry` — the app-wide
   * rule that a shortcut must not fire while something is being typed into. Left and Right
   * are never bound here: `App.tsx` steps the tab strip with them, as does the backtick the
   * tab picker owns. These stay off `SHORTCUTS` in `lib/shortcuts.ts` too, which is the
   * app-wide table the Settings page renders.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return
      if (isTextEntry(event.target)) return

      if (event.key === '/') {
        event.preventDefault()
        filterRef.current?.focus()
        return
      }
      if (event.key === 'Enter') {
        if (selected) openArticle(selected)
        return
      }
      const step = event.key === 'j' || event.key === 'ArrowDown' ? 1 : event.key === 'k' || event.key === 'ArrowUp' ? -1 : 0
      if (!step || !ordered.length) return

      event.preventDefault()
      const index = ordered.findIndex((article) => article.id === selectedId)
      const next = ordered[Math.min(Math.max(index + step, 0), ordered.length - 1)]
      if (!next) return
      selectArticle(next)
      document
        .querySelector(`[data-article-id="${CSS.escape(next.id)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [ordered, selectedId, selected, selectArticle, openArticle])

  /* ----------------------------------------------------------------- render */

  const busy = refreshing || query.isFetching
  const loading = query.isLoading

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <NewsToolbar
        ref={filterRef}
        counts={counts}
        filter={filter}
        onFilter={setFilter}
        query={queryText}
        onQuery={setQueryText}
        sort={sort}
        onSort={setSort}
        showImages={showImages}
        onToggleImages={toggleImages}
        readerOpen={readerOpen}
        onToggleReader={() => setReaderOpen(!readerOpen)}
        onRefresh={() => void onRefresh()}
        onExport={() => void onExport()}
        busy={busy}
        status={status}
      />

      <NewsTickerSearchBar
        onSearch={(raw) => {
          setNotice(null)
          setSearchTickers(parseSearchSymbols(raw))
        }}
        onClear={() => {
          setSearchTickers([])
          if (selected?.category === 'search') setSelectedId('')
        }}
        status={searchStatus}
        busy={searchQuery.isFetching}
        active={searchTickers.length > 0}
      />

      {payload ? <NewsSourceStrip lanes={payload.lanes} errors={feedErrors} /> : null}

      <div className="flex min-h-0 flex-1 gap-2">
        <div
          ref={gridRef}
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto pr-1"
        >
          {hero ? (
            <NewsHero
              article={hero}
              price={quotes?.[hero.ticker.trim().toUpperCase()]?.price}
              currency={quotes?.[hero.ticker.trim().toUpperCase()]?.currency}
              selected={hero.id === selectedId}
              onSelect={selectArticle}
              onOpen={openArticle}
              showImages={showImages}
              now={now}
            />
          ) : null}

          {searchTickers.length ? (
            <NewsSection
              title="Ticker Search"
              subtitle={searchTickers.join(', ')}
              articles={visibleSearch}
              quotes={quotes}
              visible={visibleSearch.length}
              columns={columns}
              selectedId={selectedId}
              onSelect={selectArticle}
              onOpen={openArticle}
              showImages={showImages}
              empty={searchQuery.isFetching ? 'Searching...' : 'No articles for those tickers.'}
              now={now}
            />
          ) : null}

          <NewsSection
            title="Portfolio Spotlight"
            articles={groups.portfolio}
            quotes={quotes}
            visible={portfolioVisible}
            columns={columns}
            selectedId={selectedId}
            onSelect={selectArticle}
            onOpen={openArticle}
            showImages={showImages}
            warning={warningOf(query.data, PORTFOLIO_SECTION)}
            empty={
              loading
                ? 'Loading portfolio news...'
                : holdings.length
                  ? 'No headlines Yahoo associates with your holdings right now.'
                  : 'Add a holding to see its news here.'
            }
            now={now}
          />

          <NewsSection
            title="Market & Macro"
            articles={marketBody}
            quotes={quotes}
            visible={marketVisible}
            columns={columns}
            selectedId={selectedId}
            onSelect={selectArticle}
            onOpen={openArticle}
            showImages={showImages}
            warning={warningOf(query.data, MARKET_SECTION)}
            empty={loading ? 'Loading market news...' : 'No market headlines matched.'}
            now={now}
          />
        </div>

        {readerOpen ? (
          <>
            <Splitter onDrag={onDrag} />
            <div className="flex min-h-0 shrink-0 flex-col" style={{ width: readerWidth }}>
              <NewsReader
                article={selected}
                preview={preview.data?.data}
                loading={preview.isFetching}
                onOpen={openArticle}
                onClose={() => setReaderOpen(false)}
                now={now}
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
