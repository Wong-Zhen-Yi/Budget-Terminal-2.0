import { useEffect, useMemo, useState } from 'react'
import { MARKET_CAP_TIERS, marketCapInTier, marketCapSummary, marketCapTier } from '@shared/marketCap'
import type { MarketCapRow, MarketCapTier } from '@shared/contract'
import { formatPriceScreenMarketCap } from '@shared/priceScreen'
import { useMarketCap, useMarketCapSales } from '@/api/marketCapQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { BarCell } from '@/components/ui/BarCell'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Panel } from '@/components/ui/Panel'
import { SearchInput } from '@/components/ui/SearchInput'
import {
  EM_DASH,
  currency,
  directionClass,
  integer,
  plainPercent,
  thousands,
  timestampLabel,
} from '@/lib/format'

type MetricsRow = MarketCapRow & { priceToSales: number | null }

/** `12.40x`, the multiple form every ratio column on this page renders. */
const ratio = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? EM_DASH : `${thousands(value, 2)}x`

// Hoisted so DataTable's sort memo, which lists `rowKey` among its dependencies, is not
// invalidated on every render of this page.
const rowKey = (row: MetricsRow) => row.ticker

const toneClass = { muted: 'text-text-muted', warn: 'text-warn' } as const

/**
 * Percentages rather than pixels, matching the Gold page's tables. `layout="fixed"` needs
 * real CSS lengths — the widths here used to be Tailwind class names, which DataTable's
 * inline `style` silently dropped, leaving every column equal — and percentages keep the
 * proportions on a wide monitor instead of pooling the slack in one column. They have to
 * total 100 or the browser redistributes the remainder.
 */
function buildColumns(largestCap: number): Column<MetricsRow>[] {
  return [
    { key: 'rank', header: 'Rank', cell: (row) => row.rank, sortValue: (row) => row.rank, numeric: true, align: 'right', width: '6%' },
    { key: 'ticker', header: 'Ticker', cell: (row) => <span className="text-accent">{row.ticker}</span>, sortValue: (row) => row.ticker, width: '7%' },
    { key: 'name', header: 'Company', cell: (row) => <span title={row.name}>{row.name}</span>, sortValue: (row) => row.name, width: '20%' },
    {
      key: 'marketCap',
      header: 'Market Cap',
      // Scaled to the largest company in the range, not in the filtered view: a bar that
      // rescaled on every keystroke would make the column flicker, and would stop a
      // filtered reading from being comparable with an unfiltered one.
      cell: (row) => (
        <BarCell
          fraction={largestCap > 0 ? row.marketCap / largestCap : 0}
          title={`${currency(row.marketCap)} · ${plainPercent(largestCap > 0 ? (row.marketCap / largestCap) * 100 : null)} of the largest company in this range`}
        >
          {formatPriceScreenMarketCap(row.marketCap)}
        </BarCell>
      ),
      sortValue: (row) => row.marketCap,
      numeric: true,
      align: 'right',
      width: '13%',
    },
    { key: 'price', header: 'Price', cell: (row) => <span title={row.priceSource}>{currency(row.price)}{row.priceBasis === 'equity-perp-mark' ? ' PERP' : ''}</span>, sortValue: (row) => row.price, numeric: true, align: 'right', width: '9%' },
    {
      key: 'trailingEps',
      header: <span title="Reported earnings per share over the trailing twelve months">EPS (TTM)</span>,
      // The page carries no change %, so the sign of EPS is the only direction on it —
      // the one place a red earns its keep, and it pairs with the Profitable tile.
      cell: (row) => (
        <span className={directionClass(row.trailingEps, { up: 'text-text' })}>{thousands(row.trailingEps, 2)}</span>
      ),
      sortValue: (row) => row.trailingEps,
      numeric: true,
      align: 'right',
      width: '8%',
    },
    { key: 'trailingPe', header: <span title="Price divided by trailing twelve-month earnings per share">P/E (TTM)</span>, cell: (row) => ratio(row.trailingPe), sortValue: (row) => row.trailingPe, numeric: true, align: 'right', width: '8%' },
    { key: 'forwardPe', header: <span title="Yahoo Finance forward price-to-earnings estimate">Forward P/E</span>, cell: (row) => ratio(row.forwardPe), sortValue: (row) => row.forwardPe, numeric: true, align: 'right', width: '9%' },
    { key: 'priceToSales', header: <span title="Price-to-sales ratio using trailing twelve-month revenue">P/S (TTM)</span>, cell: (row) => ratio(row.priceToSales), sortValue: (row) => row.priceToSales, numeric: true, align: 'right', width: '8%' },
    { key: 'exchange', header: 'Exchange', cell: (row) => row.exchange, sortValue: (row) => row.exchange, width: '12%' },
  ]
}

/** The selected row, laid out like the Heatmap page's inspector strip. */
function DetailBar({ row, rankedCap }: { row: MetricsRow | null; rankedCap: number }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border border-border bg-surface px-3 py-1.5 text-2xs text-text">
      <span className="font-semibold text-accent">{row?.ticker ?? EM_DASH}</span>
      <span className="truncate text-text-muted">{row?.name ?? EM_DASH}</span>
      <span className="num">Rank {row ? row.rank : EM_DASH}</span>
      <span className="num">{row ? formatPriceScreenMarketCap(row.marketCap) : EM_DASH}</span>
      <span className="num" title="Share of the combined cap of the companies listed here">
        {plainPercent(row && rankedCap > 0 ? (row.marketCap / rankedCap) * 100 : null)} of ranked cap
      </span>
      <span className="num">EPS {row ? thousands(row.trailingEps, 2) : EM_DASH}</span>
      <span className="num">P/E {row ? ratio(row.trailingPe) : EM_DASH}</span>
      <span className="num">P/S {row ? ratio(row.priceToSales) : EM_DASH}</span>
      <span className="text-text-muted">{row?.exchange ?? EM_DASH}</span>
      <span className="ml-auto text-text-dim">
        Click a row to inspect it, double-click to open it in Stocks.
      </span>
    </div>
  )
}

export function MarketCapPage({ onStatusChange, onNavigate }: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate: (tabId: string, symbol?: string) => void
}) {
  const [tier, setTier] = useState<MarketCapTier>('all')
  const query = useMarketCap(tier)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const received = query.data?.data
  const mismatched = received?.rows.some((row) => !marketCapInTier(row.marketCap, tier)) ?? false
  const payload = mismatched ? undefined : received
  // The unfiltered tickers. Keying this on the filtered rows would mint a new query key on
  // every keystroke and re-fetch up to 100 symbols through the Yahoo rate gate.
  const sales = useMarketCapSales((payload?.rows ?? []).map((row) => row.ticker))
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (payload?.rows ?? []).filter((row) => `${row.ticker} ${row.name}`.toLowerCase().includes(needle))
      .map((row) => ({ ...row, priceToSales: sales.data?.data[row.ticker] ?? null }))
  }, [payload, search, sales.data])

  // Over the whole range, never the filter: the top-ten share of an arbitrary text search
  // is not a number that means anything, and a strip that moves while you type is noise.
  const summary = useMemo(() => marketCapSummary(payload?.rows ?? []), [payload])
  const columns = useMemo(() => buildColumns(summary.largestCap), [summary.largestCap])
  // Falling back to the first row keeps the inspector populated on load, the way the
  // reference's holdings tables open on their largest member.
  const active = useMemo(
    () => rows.find((row) => row.ticker === selected) ?? rows[0] ?? null,
    [rows, selected],
  )

  useEffect(() => {
    onStatusChange([{ label: 'Market Cap', envelope: query.data, error: query.error, enabled: query.isEnabled, loading: query.isFetching }, { label: 'P/S', envelope: sales.data, error: sales.error, enabled: sales.isEnabled, loading: sales.isFetching }], '')
  }, [onStatusChange, query.data, query.isFetching, sales.data, sales.isFetching])

  const warning = mismatched
    ? 'The cached ranking does not match this range. Refresh to load matching companies.'
    : query.error?.message ?? query.data?.meta.failureReason

  const salesDegraded = sales.isError || Boolean(sales.data?.errors.length)
  const status = useMemo(() => {
    if (query.isFetching && !payload) {
      return { text: `Loading the top 100 by market cap — ${marketCapTier(tier).label}...`, tone: 'muted' as const }
    }
    const parts = [
      `${rows.length} of ${summary.counted} shown`,
      payload?.source ?? 'Yahoo Finance',
      `updated ${timestampLabel(payload?.asOf ? Date.parse(payload.asOf) : null)}`,
      `${integer(payload?.candidateCount)} screened`,
    ]
    if (sales.isFetching) parts.push('P/S loading...')
    if (salesDegraded) parts.push('some P/S ratios could not be refreshed; cached values retained')
    return { text: parts.join(' · '), tone: salesDegraded ? ('warn' as const) : ('muted' as const) }
  }, [query.isFetching, payload, tier, rows.length, summary.counted, sales.isFetching, salesDegraded])

  const cells: Array<{ key: string; label: string; value: string; className: string; title: string }> = [
    {
      key: 'total',
      label: 'Ranked cap',
      value: summary.counted ? formatPriceScreenMarketCap(summary.rankedCap) : EM_DASH,
      className: 'text-text',
      title: 'Combined market cap of the companies listed here',
    },
    {
      key: 'top10',
      label: 'Top 10 share',
      value: plainPercent(summary.topTenShare === null ? null : summary.topTenShare * 100),
      className: 'text-accent-hover',
      title: 'Share of the ranked cap held by the ten largest',
    },
    {
      key: 'median',
      label: 'Median cap',
      value: summary.medianCap === null ? EM_DASH : formatPriceScreenMarketCap(summary.medianCap),
      className: 'text-text',
      title: 'Midpoint of the ranking',
    },
    {
      key: 'pe',
      label: 'Median P/E',
      value: ratio(summary.medianTrailingPe),
      className: 'text-text',
      title: 'Median trailing P/E across the companies reporting a positive one',
    },
    {
      key: 'profitable',
      label: 'Profitable',
      value: summary.counted ? `${summary.profitable} / ${summary.counted}` : EM_DASH,
      // Amber once the ranking is more loss-makers than earners, the way the Heatmap
      // page tints its coverage cell when the quotes thin out.
      className: summary.counted && summary.profitable * 2 < summary.counted ? 'text-warn' : 'text-up',
      title: 'Companies reporting positive trailing earnings per share',
    },
    {
      key: 'screened',
      label: 'Screened',
      value: integer(payload?.candidateCount),
      className: 'text-text',
      title: 'Companies the screener evaluated before the top 100 were taken',
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <h1
          className="pr-2 text-sm font-semibold text-text"
          title="Largest 100 US-listed equities in the selected range, in USD. Ranks, search and sorting all apply within the range."
        >
          Market Cap
        </h1>
        {MARKET_CAP_TIERS.map((range) => (
          <Button
            key={range.id}
            variant="toggle"
            active={range.id === tier}
            title={range.label}
            onClick={() => {
              setTier(range.id)
              setSearch('')
              setSelected(null)
            }}
          >
            {range.short}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <SearchInput
            aria-label="Search companies"
            placeholder="Filter ticker or company"
            value={search}
            onChange={setSearch}
            className="w-56"
          />
          <Button
            variant="accent"
            onClick={() => {
              void query.refresh()
              void sales.refresh()
            }}
            disabled={query.isFetching}
          >
            {query.isFetching ? 'Loading...' : 'Refresh'}
          </Button>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-6 divide-x divide-border border border-border bg-surface">
        {cells.map((cell) => (
          <div key={cell.key} title={cell.title} className="flex flex-col items-center px-2 py-1">
            <span className="text-2xs text-text-muted">{cell.label}</span>
            <span className={`num text-2xs font-semibold ${cell.className}`}>{cell.value}</span>
          </div>
        ))}
      </div>

      <p className={`shrink-0 truncate text-right text-2xs ${toneClass[status.tone]}`} title={status.text}>
        {status.text}
      </p>
      {warning ? (
        <p role="alert" className="shrink-0 truncate text-right text-2xs text-warn" title={warning}>
          {warning}
        </p>
      ) : null}

      <Panel
        className="min-h-0 flex-1"
        title={`Top 100 by market cap — ${marketCapTier(tier).label}`}
        warning={warning}
        actions={
          <Chip tone={search ? 'accent' : 'muted'}>
            {rows.length} / {summary.counted}
          </Chip>
        }
      >
        <DataTable
          key={tier}
          columns={columns}
          rows={rows}
          rowKey={rowKey}
          defaultSort={{ key: 'marketCap', direction: 'desc' }}
          layout="fixed"
          minWidth="1240px"
          onRowClick={(row) => setSelected(row.ticker)}
          rowClassName={(row) => (row.ticker === active?.ticker ? 'bg-accent-dim/60' : '')}
          onRowDoubleClick={(row) => onNavigate('stocks', row.ticker)}
          empty={
            query.isFetching
              ? 'Loading market-cap ranking...'
              : warning && !payload?.rows.length
                ? 'Ranking unavailable. Try Refresh.'
                : search
                  ? 'No matching companies in this range’s top 100.'
                  : 'No eligible companies returned in this range.'
          }
        />
      </Panel>

      <DetailBar row={active} rankedCap={summary.rankedCap} />
    </div>
  )
}
