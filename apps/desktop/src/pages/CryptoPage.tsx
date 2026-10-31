import { useCallback, useEffect, useMemo, useState } from 'react'

import type { CryptoQuote, Envelope, HyperliquidMarket, NewsArticle } from '@shared/contract'
import {
  CRYPTO_HEATMAP_LIMIT,
  CRYPTO_PROXY_ROWS,
  CRYPTO_STAGES,
  CRYPTO_WATCHLIST_ORDER,
  buildCryptoSnapshot,
  clockTail,
  cryptoMoney,
  cryptoNewsTone,
  cryptoPercent,
  cryptoPrice,
  cryptoTone,
  hasUnavailableStage,
  loadedStageCount,
  type CryptoNewsTone,
  type CryptoTone,
} from '@shared/crypto'
import { api } from '@/api/client'
import { useCrypto, useRefreshCrypto } from '@/api/cryptoQueries'
import { effectiveFreshness, useSnapshotClock } from '@/api/snapshotHealth'
import { FRESHNESS } from '@shared/freshness'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { CryptoHeatmap } from '@/components/crypto/CryptoHeatmap'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Panel } from '@/components/ui/Panel'

/**
 * The Crypto page, ported from `CryptoMixin.init_page19`.
 *
 * The reference's KPI strip, heatmap, watchlist, news and proxies, plus a separately
 * labelled Hyperliquid perpetuals panel so venue derivatives never replace spot quotes.
 *
 * One structural departure. The reference's worker emits a `partial` signal after each of
 * its stages and the Qt page fills in as they land; an IPC request/response cannot,
 * so all stages run concurrently in the main process and the payload carries the
 * same `progress` map. The stage readiness line reports incomplete data alongside
 * the provider errors, while healthy panels remain available.
 */

const toneClass: Record<CryptoTone, string> = {
  positive: 'text-up',
  negative: 'text-down',
  muted: 'text-text-muted',
}

const newsToneClass: Record<CryptoNewsTone, string> = {
  Bullish: 'text-up',
  Bearish: 'text-down',
  Neutral: 'text-text-muted',
}

/** The dot on a panel whose stage is degraded, as every other multi-panel page reports one. */
function warningOf(envelope: Envelope<unknown> | undefined, block: string, now: number): string | undefined {
  if (!envelope) return undefined
  const failed = envelope.errors.find((entry) => entry.symbol === block)
  if (failed) return failed.reason
  const freshness = effectiveFreshness(envelope, now, FRESHNESS.crypto)
  if (freshness === 'failed') return envelope.meta.failureReason || freshness
  return undefined
}

export function CryptoPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const query = useCrypto()
  const refresh = useRefreshCrypto()
  const now = useSnapshotClock()
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState('')

  const payload = query.data?.data
  const loading = query.isFetching || refreshing

  useEffect(() => {
    // No file behind this page, so the status bar's path slot stays empty.
    onStatusChange([{ label: 'Crypto', envelope: query.data, error: query.error, enabled: query.isEnabled, loading }], '')
  }, [onStatusChange, query.data, loading])

  // A notice describes the action that produced it; a refresh replaces the page under it.
  useEffect(() => {
    if (loading) setNotice('')
  }, [loading])

  const quotes = useMemo<Record<string, CryptoQuote>>(() => payload?.quotes ?? {}, [payload])

  /** `_p19_set_refresh_status`, in the same order of precedence the reference writes it. */
  const status = useMemo(() => {
    if (notice) return notice
    if (loading) return 'Fetching crypto market data...'
    if (query.isError) return `Crypto data refresh failed: ${query.error.message}`
    if (!payload) return 'Loading crypto market data...'
    const meta = query.data?.meta
    if (meta?.freshness === 'failed') {
      return `Crypto data refresh failed: ${meta.failureReason ?? 'unknown error'}`
    }
    const stamp = clockTail(payload.fetchedAt)
    const freshness = query.data ? effectiveFreshness(query.data, now, FRESHNESS.crypto) : 'failed'
    if (freshness === 'stale') return `Snapshot updated at ${stamp}`
    if (hasUnavailableStage(payload.progress) || query.data?.errors.length) {
      return `Partial data at ${stamp} — ${loadedStageCount(payload.progress)}/${CRYPTO_STAGES.length} stages ready. ${query.data?.errors.map(error => error.reason).join(' ') ?? ''}`
    }
    return `Snapshot updated at ${stamp} · ${freshness}`
  }, [notice, loading, payload, query.data, query.isError, query.error, now])

  const coverage = payload?.heatmap.coverage
  const heatmapStatus = loading
    ? `Snapshot coverage --/${CRYPTO_HEATMAP_LIMIT} | Loading...`
    : `Snapshot coverage ${coverage ? `${coverage.loaded}/${coverage.total}` : `--/${CRYPTO_HEATMAP_LIMIT}`} | ${query.data ? effectiveFreshness(query.data, now, FRESHNESS.crypto) : 'unavailable'} | Updated ${
        payload ? clockTail(payload.heatmap.updatedAt) : '--'
      }`

  const onRefresh = useCallback(async () => {
    setNotice('')
    setRefreshing(true)
    try {
      await refresh()
    } catch (error) {
      setNotice(`Crypto refresh failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setRefreshing(false)
    }
  }, [refresh])

  /** `_p19_export_snapshot`: the reference copies, it does not write a file. */
  const onExport = useCallback(async () => {
    if (!payload) {
      setNotice('Load crypto market data before exporting.')
      return
    }
    await api.writeClipboard(buildCryptoSnapshot({ fetchedAt: payload.fetchedAt, quotes }))
    setNotice('Snapshot copied to clipboard')
  }, [payload, quotes])

  const fearGreed = payload?.fearGreed
  const globalMarket = payload?.global

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <h1 className="pr-2 text-sm font-semibold text-text">Crypto Market</h1>
        <span className="ml-auto px-2 text-2xs text-text-muted">{status}</span>
        <Button variant="accent" onClick={() => void onRefresh()} disabled={refreshing || loading}>
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
        <Button onClick={() => void onExport()}>Export</Button>
      </div>

      <div className="grid shrink-0 grid-cols-6 gap-2">
        <MetricTile
          label="BTC"
          value={cryptoPrice(quotes.BTC?.price)}
          change={cryptoPercent(quotes.BTC?.changePct)}
          tone={cryptoTone(quotes.BTC?.changePct)}
        />
        <MetricTile
          label="ETH"
          value={cryptoPrice(quotes.ETH?.price)}
          change={cryptoPercent(quotes.ETH?.changePct)}
          tone={cryptoTone(quotes.ETH?.changePct)}
        />
        <MetricTile
          label="SOL"
          value={cryptoPrice(quotes.SOL?.price)}
          change={cryptoPercent(quotes.SOL?.changePct)}
          tone={cryptoTone(quotes.SOL?.changePct)}
        />
        <MetricTile
          label="Total Market Cap"
          value={cryptoMoney(globalMarket?.marketCap)}
          change={cryptoPercent(globalMarket?.changePct)}
          tone={cryptoTone(globalMarket?.changePct)}
        />
        <MetricTile
          label="Fear & Greed"
          value={fearGreed?.value == null ? '--' : fearGreed.value.toFixed(0)}
          change={
            fearGreed?.value == null
              ? '--'
              : `${fearGreed.classification || '--'} - ${fearGreed.source}`
          }
          // The reference paints this one amber whatever the reading is: the classification
          // already names the direction, so a green "Extreme Greed" would read as good news.
          tone={fearGreed?.value == null ? 'muted' : 'warning'}
        />
        <MetricTile
          label="24h Volume"
          value={cryptoMoney(globalMarket?.volume24h)}
          change="CoinGecko global"
          tone="muted"
        />
      </div>

      <Panel
        className="min-h-0 flex-[3]"
        title="Top 30 Cryptocurrencies"
        warning={warningOf(query.data, 'Top 30 Cryptocurrencies', now)}
        actions={<span className="text-2xs text-text-muted">{heatmapStatus}</span>}
      >
        <CryptoHeatmap tiles={payload?.heatmap.tiles ?? []} />
      </Panel>

      <Panel
        className="min-h-0 flex-[2]"
        title="Hyperliquid Perpetuals"
        warning={warningOf(query.data, 'Hyperliquid Perpetuals', now)}
        actions={
          <span className="text-2xs text-text-muted">
            {payload?.hyperliquid ? `${payload.hyperliquid.markets.length} markets | Updated ${clockTail(payload.hyperliquid.fetchedAt)}` : loading ? 'Loading...' : 'Unavailable'}
            {' | 60s snapshots'}
          </span>
        }
      >
        <HyperliquidTable markets={payload?.hyperliquid?.markets ?? []} loading={loading} />
      </Panel>

      <div className="flex min-h-0 flex-[2] gap-2">
        <Panel
          className="min-h-0 flex-1"
          title="Watchlist / Movers"
          warning={warningOf(query.data, 'Watchlist / Movers', now)}
        >
          <WatchlistTable quotes={quotes} loading={loading} />
        </Panel>

        <Panel
          className="min-h-0 flex-[2]"
          title="Crypto News Feed"
          warning={warningOf(query.data, 'Crypto News Feed', now)}
        >
          <NewsTable articles={payload?.news ?? []} loading={loading} />
        </Panel>

        {/* Proxies and the watchlist are the same quote stage, so they share its warning. */}
        <Panel
          className="min-h-0 flex-1"
          title="ETF / Equity Proxies"
          warning={warningOf(query.data, 'Watchlist / Movers', now)}
        >
          <ProxyTable quotes={quotes} loading={loading} />
        </Panel>
      </div>
    </div>
  )
}

function HyperliquidTable({ markets, loading }: { markets: HyperliquidMarket[]; loading: boolean }) {
  const columns: Array<Column<HyperliquidMarket>> = [
    { key: 'symbol', header: 'Perpetual', cell: row => `${row.symbol} PERP`, sortValue: row => row.symbol },
    { key: 'mark', header: 'Mark (USD)', numeric: true, align: 'right', cell: row => cryptoPrice(row.markPrice), sortValue: row => row.markPrice },
    { key: 'change', header: '24h', numeric: true, align: 'right',
      cell: row => <span className={toneClass[cryptoTone(row.changePct)]}>{cryptoPercent(row.changePct)}</span>, sortValue: row => row.changePct },
    { key: 'funding', header: <span title="Current hourly rate. Positive: longs pay shorts. Negative: shorts pay longs.">Funding / 1h</span>, numeric: true, align: 'right',
      cell: row => `${row.fundingHourlyPct >= 0 ? '+' : ''}${row.fundingHourlyPct.toFixed(5)}%`, sortValue: row => row.fundingHourlyPct },
    { key: 'interest', header: <span title="Base-asset open interest multiplied by the mark price.">Open interest (USD)</span>, numeric: true, align: 'right',
      cell: row => cryptoMoney(row.openInterestUsd, true), sortValue: row => row.openInterestUsd },
    { key: 'volume', header: '24h volume (USD)', numeric: true, align: 'right', cell: row => cryptoMoney(row.volume24hUsd, true), sortValue: row => row.volume24hUsd },
  ]
  return <DataTable columns={columns} rows={markets} rowKey={row => row.symbol}
    defaultSort={{ key: 'volume', direction: 'desc' }}
    empty={loading ? 'Loading Hyperliquid perpetual markets...' : 'Hyperliquid unavailable. Refresh to retry; other crypto data remains available.'} />
}

/** `_p19_metric_tile`: label over a large value over the coloured change line. */
function MetricTile({
  label,
  value,
  change,
  tone,
}: {
  label: string
  value: string
  change: string
  tone: CryptoTone | 'warning'
}) {
  const changeClass = tone === 'warning' ? 'text-warn' : toneClass[tone]
  return (
    <div className="flex flex-col items-center justify-center border border-border bg-surface px-2 py-1">
      <span className="truncate text-2xs text-text-muted">{label}</span>
      <span className="num truncate text-sm font-bold text-text">{value}</span>
      <span className={`truncate text-2xs font-bold ${changeClass}`}>{change}</span>
    </div>
  )
}

interface WatchRow {
  label: string
  quote: CryptoQuote | undefined
}

function WatchlistTable({
  quotes,
  loading,
}: {
  quotes: Record<string, CryptoQuote>
  loading: boolean
}) {
  const rows = CRYPTO_WATCHLIST_ORDER.map((label) => ({ label, quote: quotes[label] }))
  const columns: Array<Column<WatchRow>> = [
    { key: 'symbol', header: 'Symbol', cell: (row) => row.label },
    {
      key: 'last',
      header: 'Last',
      numeric: true,
      align: 'right',
      cell: (row) => <span title={row.quote?.source}>{cryptoPrice(row.quote?.price)}{row.quote?.source?.startsWith('Hyperliquid') ? ' PERP' : ''}</span>,
    },
    {
      key: 'change',
      header: '24h',
      numeric: true,
      align: 'right',
      cell: (row) => (
        <span className={toneClass[cryptoTone(row.quote?.changePct)]}>
          {cryptoPercent(row.quote?.changePct)}
        </span>
      ),
    },
    {
      key: 'volume',
      header: 'Vol',
      numeric: true,
      align: 'right',
      cell: (row) => cryptoMoney(row.quote?.volume, true),
    },
    {
      key: 'marketCap',
      header: 'Mkt Cap',
      numeric: true,
      align: 'right',
      cell: (row) => cryptoMoney(row.quote?.marketCap, true),
    },
  ]
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.label}
      empty={loading ? 'Loading...' : 'No quote data'}
    />
  )
}

function NewsTable({ articles, loading }: { articles: NewsArticle[]; loading: boolean }) {
  const columns: Array<Column<NewsArticle>> = [
    { key: 'time', header: 'Time', width: '4.5rem', cell: (row) => row.time || '--' },
    {
      key: 'title',
      header: 'Headline',
      width: '100%',
      cell: (row) => (
        <button
          type="button"
          title={`${row.source} — ${row.title}`}
          onClick={() => row.url && void api.openExternal(row.url)}
          className="block w-full truncate text-left hover:text-accent-hover hover:underline"
        >
          {row.title}
        </button>
      ),
    },
    {
      key: 'tone',
      header: 'Tone',
      width: '5rem',
      cell: (row) => {
        const tone = cryptoNewsTone(row.title)
        return <span className={newsToneClass[tone]}>{tone}</span>
      },
    },
  ]
  return (
    <DataTable
      columns={columns}
      rows={articles}
      rowKey={(row) => row.id}
      layout="fixed"
      empty={loading ? 'Loading live market news...' : 'No crypto news feed articles returned yet.'}
    />
  )
}

interface ProxyRow {
  label: string
  type: string
  quote: CryptoQuote | undefined
}

function ProxyTable({
  quotes,
  loading,
}: {
  quotes: Record<string, CryptoQuote>
  loading: boolean
}) {
  const rows = CRYPTO_PROXY_ROWS.map((entry) => ({ ...entry, quote: quotes[entry.label] }))
  const columns: Array<Column<ProxyRow>> = [
    { key: 'ticker', header: 'Ticker', cell: (row) => row.label },
    { key: 'type', header: 'Type', cell: (row) => row.type },
    {
      key: 'size',
      header: 'AUM / Mkt Cap',
      numeric: true,
      align: 'right',
      cell: (row) => cryptoMoney(row.quote?.marketCap, true),
    },
    {
      key: 'change',
      header: '1D',
      numeric: true,
      align: 'right',
      cell: (row) => (
        <span className={toneClass[cryptoTone(row.quote?.changePct)]}>
          {cryptoPercent(row.quote?.changePct)}
        </span>
      ),
    },
  ]
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.label}
      empty={loading ? 'Loading...' : 'No proxy data'}
    />
  )
}
