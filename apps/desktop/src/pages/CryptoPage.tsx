import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Candle, CryptoPayload, CryptoQuote, HyperliquidMarket } from '@shared/contract'
import {
  CRYPTO_HEATMAP_LIMIT, CRYPTO_TICKERS, PROXY_TICKERS,
  buildCryptoSnapshot, clockTail, cryptoMoney, cryptoPercent, cryptoPrice, cryptoTone, heatmapIntensity,
} from '@shared/crypto'
import { CRYPTO_CHART_INTERVALS, cryptoChartRequest } from '@shared/cryptoWorkspace'
import { FRESHNESS } from '@shared/freshness'
import { api } from '@/api/client'
import { useCrypto, useCryptoProviderUsage } from '@/api/cryptoQueries'
import { useChartsHistory } from '@/api/chartsQueries'
import { effectiveFreshness, useSnapshotClock } from '@/api/snapshotHealth'
import { useCryptoWorkspace } from '@/stores/crypto'
import { CryptoPriceChart } from '@/components/crypto/CryptoPriceChart'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'

const EMPTY_CANDLES: Candle[] = []
const changeClass = (value: number | null | undefined) => `crypto-${cryptoTone(value)}`
const perpQuote = (quote?: CryptoQuote) => Boolean(quote?.source?.startsWith('Hyperliquid'))
const ageText = (stamp: string | undefined, now: number) => {
  const age = stamp ? now - new Date(stamp).getTime() : NaN
  return Number.isFinite(age) ? age < 60_000 ? 'Updated just now' : `Updated ${Math.max(1, Math.floor(age / 60_000))}m ago` : 'Awaiting data'
}

function Section({ title, subtitle, badge, children, className = '' }: {
  title: string; subtitle?: string; badge?: ReactNode; children: ReactNode; className?: string
}) {
  return <section className={`crypto-panel ${className}`} aria-label={title}>
    <header className="crypto-panel-title"><h2>{title}</h2>{badge}</header>
    {subtitle && <div className="crypto-panel-subtitle">{subtitle}</div>}
    {children}
  </section>
}

export function CryptoPage({ onStatusChange }: { onStatusChange: (panels: PanelStatus[], sourcePath: string) => void }) {
  const query = useCrypto()
  const usage = useCryptoProviderUsage()
  const snapshotNow = useSnapshotClock()
  const now = Math.max(snapshotNow, Date.now())
  const { symbol, interval, selectSymbol, setInterval } = useCryptoWorkspace()
  const history = useChartsHistory(cryptoChartRequest(symbol, interval), 60)
  const refreshing = false
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const payload = query.data?.data
  const quotes = payload?.quotes ?? {}
  const loading = query.isFetching || refreshing
  const coinGecko = usage.data?.providers.find(provider => provider.id === 'coingecko')
  const cooldownSeconds = coinGecko?.throttled ? Math.max(0, Math.ceil(((usage.data?.sampledAt ?? now) + coinGecko.cooldownMs - now) / 1_000)) : 0
  const cooldown = cooldownSeconds > 0
  const wasCooling = useRef(false)
  const freshness = query.data ? effectiveFreshness(query.data, now, FRESHNESS.crypto) : 'unavailable'
  const spotWarning = query.data?.errors.some(error => /coingecko/i.test(`${error.source} ${error.reason}`))
  const errors = query.data?.errors.map(error => error.reason).join(' · ') ?? ''
  const market = payload?.hyperliquid?.markets.find(row => row.symbol === symbol)
  const venueAge = payload?.hyperliquid ? now - new Date(payload.hyperliquid.fetchedAt).getTime() : Infinity
  const venueRecent = venueAge >= -5_000 && venueAge <= 15_000
  const coverage = payload?.heatmap.coverage
  const breadthSources = [...new Set(payload?.heatmap.tiles.map(tile => tile.source).filter(Boolean) ?? [])].join(' + ')
  const chartCandles = history.data?.meta.freshness === 'failed' ? EMPTY_CANDLES : history.data?.data.candles ?? EMPTY_CANDLES
  const chartFailure = history.error?.message || (history.data?.meta.freshness === 'failed' ? history.data.meta.failureReason : '')
  const chartFreshness = history.data ? effectiveFreshness(history.data, now, FRESHNESS.chartIntraday) : 'loading'
  const chartSource = history.data?.data.stats?.source ?? 'Hyperliquid crypto perpetual'
  const status = notice || (query.error ? `Crypto data refresh failed: ${query.error.message}`
    : query.data?.meta.freshness === 'failed' ? `Crypto data refresh failed: ${query.data.meta.failureReason || errors || 'Provider unavailable'}`
    : loading && !payload ? 'Fetching crypto market data...'
    : !payload ? 'Loading crypto market data...'
    : errors)

  useEffect(() => {
    onStatusChange([
      { label: 'Crypto', envelope: query.data, error: query.error, loading, freshnessMs: FRESHNESS.crypto },
      { label: 'Crypto perpetual chart', envelope: history.data, error: history.error, loading: history.isFetching, freshnessMs: FRESHNESS.chartIntraday },
    ], '')
  }, [onStatusChange, query.data, query.error, loading, history.data, history.error, history.isFetching])

  useEffect(() => {
    if (wasCooling.current && !cooldown) void query.refetch()
    wasCooling.current = cooldown
  }, [cooldown, query.refetch])


  const onCopy = async () => {
    if (!payload) { setNotice('Load crypto market data before copying.'); return }
    try { await api.writeClipboard(buildCryptoSnapshot({ fetchedAt: payload.fetchedAt, quotes })); setNotice('Snapshot copied to clipboard') }
    catch (error) { setNotice(`Copy failed: ${error instanceof Error ? error.message : String(error)}`) }
  }

  const markets = useMemo(() => (payload?.hyperliquid?.markets ?? []).filter(row => row.symbol.toLowerCase().includes(search.trim().toLowerCase())), [payload?.hyperliquid, search])

  return <div className="crypto-workspace">
    <header className="crypto-heading">
      <div><div className="crypto-eyebrow">Market intelligence</div><h1>Crypto Workspace</h1><p>Price action, spot quotes and perpetual markets</p></div>
      <div className="crypto-actions"><span className="crypto-currency" title="Quotes and chart prices are shown in USD">USD</span>
        <Button onClick={() => void onCopy()} disabled={!payload}>Copy snapshot</Button>

      </div>
    </header>

    {(cooldown || status) && <div className="crypto-notice" role="status">
      <span>{cooldown ? `CoinGecko rate limited · ${payload ? 'Showing available snapshots and labelled fallback prices' : 'Spot data unavailable'}` : status}</span>
      {cooldown && <span className="num">Auto-retry in {cooldownSeconds}s</span>}
    </div>}

    <div className="crypto-ribbon" aria-label="Market overview">
      {['BTC', 'ETH', 'SOL'].map(label => <div className="crypto-ribbon-item" key={label} title={quotes[label]?.source ?? 'Awaiting quote'}>
        <strong>{label}{perpQuote(quotes[label]) ? ' PERP' : ''}</strong><span className="num">{cryptoPrice(quotes[label]?.price)}</span>
        <span className={`num ${changeClass(quotes[label]?.changePct)}`}>{cryptoPercent(quotes[label]?.changePct)}</span>
      </div>)}
      <div className="crypto-ribbon-item" title="CoinGecko global market snapshot"><span className="crypto-muted">Market cap</span><strong className="num">{cryptoMoney(payload?.global?.marketCap)}</strong></div>
      <div className="crypto-ribbon-item" title={payload?.fearGreed?.source ?? 'Alternative.me'}><span className="crypto-muted">Fear &amp; Greed</span><strong className="num crypto-warning">{payload?.fearGreed?.value ?? '--'}</strong><span className="crypto-warning">{payload?.fearGreed?.classification ?? '--'}</span></div>
    </div>

    <div className="crypto-layout">
      <aside className="crypto-left" aria-label="Symbol selection and proxies">
        <Section title="Spot watchlist" subtitle="Select an asset to chart its Hyperliquid perpetual. Fallback prices are labelled PERP.">
          <div className="crypto-watch-head"><span>Asset</span><span>Last</span><span>24h</span></div>
          {CRYPTO_TICKERS.map(entry => <button type="button" className="crypto-watch-row" key={entry.label}
            aria-label={`Chart ${entry.label} perpetual`} aria-pressed={symbol === entry.label} onClick={() => selectSymbol(entry.label)} title={quotes[entry.label]?.source ?? 'Quote unavailable'}>
            <strong>{entry.label}{perpQuote(quotes[entry.label]) && <small> PERP</small>}</strong>
            <span className="num">{cryptoPrice(quotes[entry.label]?.price)}</span>
            <span className={`num ${changeClass(quotes[entry.label]?.changePct)}`}>{cryptoPercent(quotes[entry.label]?.changePct)}</span>
          </button>)}
          <div className="crypto-chart-caption">Snapshot {payload ? clockTail(payload.fetchedAt) : '--'} · {freshness}</div>
        </Section>
        <Section title="Equity & ETF proxies" subtitle="Yahoo stock metadata · Perpetual marks labelled separately">
          {PROXY_TICKERS.map(entry => { const quote = quotes[entry.label]; return <div className="crypto-proxy" key={entry.label}>
            <strong>{entry.label}{perpQuote(quote) ? ' PERP' : ''}</strong><span className="num">{cryptoPrice(quote?.price)}</span>
            <small>{entry.name}</small><span className={`num ${changeClass(quote?.changePct)}`}>{cryptoPercent(quote?.changePct)}</span>
            <small className="crypto-proxy-source" title={quote?.source}>{quote?.source ?? 'Awaiting data'}</small>
            <small title={quote?.marketCapSource}>AUM / cap {cryptoMoney(quote?.marketCap, true)}</small>
            <small title={quote?.volumeSource}>{quote?.volumeSource?.includes('(shares)') ? `${new Intl.NumberFormat('en-US', { notation: 'compact' }).format(quote.volume ?? 0)} sh` : cryptoMoney(quote?.volume, true)}</small>
          </div> })}
        </Section>
      </aside>

      <section className="crypto-panel crypto-price-panel" aria-label="Perpetual price chart" aria-busy={history.isFetching}>
        <div className="crypto-chart-heading"><div><h2>{symbol}-PERP / USD</h2>
          <span className={`crypto-badge ${venueRecent ? 'crypto-positive' : 'crypto-muted'}`}>Hyperliquid perpetual · {venueRecent ? 'Live mark' : ageText(payload?.hyperliquid?.fetchedAt, now)}</span>
          <div className="crypto-mark num">{cryptoPrice(market?.markPrice)}<small className={changeClass(market?.changePct)}>{cryptoPercent(market?.changePct)} <span className="crypto-muted">24h</span></small></div>
        </div><div className="crypto-timeframes" aria-label="Candle interval">{CRYPTO_CHART_INTERVALS.map(choice =>
          <button type="button" key={choice.label} aria-pressed={interval === choice.interval} onClick={() => setInterval(choice.interval)}>{choice.label}</button>)}</div></div>
        {chartFailure && !chartCandles.length && <div className="crypto-chart-error" role="alert">{chartFailure} Chart history is unavailable. <button type="button" disabled={history.isFetching} onClick={() => void history.refetch()}>Retry chart</button></div>}
        {!chartCandles.length && !chartFailure && <div className="crypto-empty">{history.isFetching ? 'Loading perpetual candles...' : 'No candle history returned.'}</div>}
        <CryptoPriceChart candles={chartCandles} context={`${symbol}:${interval}`} />
        <div className="crypto-chart-caption"><span>{chartSource} · {chartFreshness} · {chartCandles.length} candles</span><span>UTC · Volume in base asset · Scroll to zoom, drag to pan</span></div>
      </section>

      <div className="crypto-right">
        <Section title="Market breadth" subtitle={`Snapshot coverage ${coverage?.loaded ?? 0}/${coverage?.total ?? 30} | ${freshness} | Updated ${payload ? clockTail(payload.heatmap.updatedAt) : '--'}`} className="crypto-breadth"
          badge={<span className="crypto-badge">Top 30 · {breadthSources || 'Awaiting data'}</span>}><Breadth payload={payload} /></Section>
        <Section title="Market context">
          <div className="crypto-context-row"><span>BTC dominance</span><strong className="num">{payload?.global?.btcDominance == null ? '--' : `${payload.global.btcDominance.toFixed(1)}%`}</strong></div>
          <div className="crypto-context-row"><span>24h spot volume</span><strong className="num">{cryptoMoney(payload?.global?.volume24h)}</strong></div>
          <div className="crypto-chart-caption">CoinGecko snapshot · {freshness}</div>
          <div className="crypto-context-row"><span>Fear &amp; Greed</span><strong className="crypto-warning">{payload?.fearGreed?.value ?? '--'} / 100</strong></div>
          <div className="crypto-chart-caption">Alternative.me · {payload?.fearGreed?.timestamp || 'Awaiting observation date'}</div>
        </Section>
      </div>

      <Section title="Perpetual markets" className="crypto-perps" subtitle="Hyperliquid · Hourly funding · Live feed with REST fallback"
        badge={<span className={`crypto-badge ${venueRecent ? 'crypto-positive' : 'crypto-muted'}`}>{ageText(payload?.hyperliquid?.fetchedAt, now)}</span>}>
        <div className="crypto-search-wrap"><label className="crypto-sr-only" htmlFor="crypto-market-search">Search perpetual markets</label><input id="crypto-market-search" className="crypto-search" placeholder="Search markets..." value={search} onChange={event => setSearch(event.target.value)} /></div>
        <PerpetualTable markets={markets} loading={loading} selected={symbol} select={selectSymbol} />
      </Section>
      <Section title="Latest news" className="crypto-news" badge={<span className="crypto-badge">{payload?.news.length ?? 0} headlines</span>}>
        <div className="crypto-news-list">{payload?.news.length ? payload.news.map(article => <button type="button" className="crypto-news-item" key={article.id}
          onClick={() => { if (article.url) void api.openExternal(article.url) }} title={article.title}>
          {article.title}<small>{article.source} · {article.time || (article.publishedAt ? new Date(article.publishedAt).toLocaleString() : 'Time unavailable')}</small>
        </button>) : <div className="crypto-empty">{loading ? 'Loading market news...' : 'No crypto news available.'}</div>}</div>
      </Section>
    </div>
    <footer className="crypto-footer"><div className="crypto-feed-states">
      <span className={`crypto-badge ${cooldown || spotWarning ? 'crypto-warning' : ''}`}>Spot: {cooldown ? 'rate limited' : freshness}</span>
      <span className={`crypto-badge ${venueRecent ? 'crypto-positive' : ''}`}>Perpetuals: {venueRecent ? 'live mark' : payload?.hyperliquid ? 'snapshot' : 'unavailable'}</span>
      <span className="crypto-badge">News: {payload?.news.length ? 'ready' : 'unavailable'}</span>
    </div><span title={status}>{status}</span></footer>
  </div>
}

function Breadth({ payload }: { payload?: CryptoPayload }) {
  const tiles = [...(payload?.heatmap.tiles ?? [])].sort((a, b) => a.rank - b.rank)
  return <div className="crypto-heatmap">{Array.from({ length: CRYPTO_HEATMAP_LIMIT }, (_, index) => {
    const tile = tiles[index]
    const tone = cryptoTone(tile?.changePct)
    const hue = tone === 'positive' ? '#26c281' : '#f0554e'
    return <div className="crypto-heatmap-cell" key={index} title={tile ? `Rank: #${tile.rank}\n${tile.name}\nPrice: ${cryptoPrice(tile.price)}\nMarket cap: ${cryptoMoney(tile.marketCap)}\nSource: ${tile.source}` : `Rank ${index + 1} unavailable`}
      style={{ background: tone === 'muted' ? '#121b2b' : `color-mix(in srgb, ${hue} ${18 + heatmapIntensity(tile?.changePct) * 32}%, #0d1420)` }}>
      <strong>{tile?.symbol ?? `#${index + 1}`}</strong><span className="num">{cryptoPercent(tile?.changePct)}</span>
    </div>
  })}</div>
}

function PerpetualTable({ markets, loading, selected, select }: { markets: HyperliquidMarket[]; loading: boolean; selected: string; select: (symbol: string) => void }) {
  const columns: Array<Column<HyperliquidMarket>> = [
    { key: 'market', header: 'Market', cell: row => <button type="button" aria-label={`Chart ${row.symbol} perpetual market`} onClick={() => select(row.symbol)}>{row.symbol}-PERP</button>, sortValue: row => row.symbol },
    { key: 'mark', header: 'Mark (USD)', numeric: true, align: 'right', cell: row => cryptoPrice(row.markPrice), sortValue: row => row.markPrice },
    { key: 'change', header: '24h', numeric: true, align: 'right', cell: row => <span className={changeClass(row.changePct)}>{cryptoPercent(row.changePct)}</span>, sortValue: row => row.changePct },
    { key: 'funding', header: <span title="Current hourly funding. Positive: longs pay shorts; negative: shorts pay longs.">Funding / 1h</span>, numeric: true, align: 'right', cell: row => `${row.fundingHourlyPct >= 0 ? '+' : ''}${row.fundingHourlyPct.toFixed(5)}%`, sortValue: row => row.fundingHourlyPct },
    { key: 'interest', header: 'Open interest', numeric: true, align: 'right', cell: row => cryptoMoney(row.openInterestUsd, true), sortValue: row => row.openInterestUsd },
    { key: 'volume', header: '24h volume', numeric: true, align: 'right', cell: row => cryptoMoney(row.volume24hUsd, true), sortValue: row => row.volume24hUsd },
  ]
  return <DataTable columns={columns} rows={markets} rowKey={row => row.symbol} defaultSort={{ key: 'volume', direction: 'desc' }}
    rowClassName={row => row.symbol === selected ? 'bg-accent-dim' : ''} minWidth="620px"
    empty={loading ? 'Loading Hyperliquid perpetual markets...' : 'No matching perpetual markets. Data may be unavailable.'} />
}
