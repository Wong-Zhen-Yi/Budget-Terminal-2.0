import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { PriceScreenPayload, PriceScreenRow } from '@shared/contract'
import { formatPriceScreenMarketCap } from '@shared/priceScreen'
import { usePriceScreen } from '@/api/priceQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { PriceScatterPlot } from '@/components/price/PriceScatterPlot'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { NumberInput } from '@/components/ui/NumberInput'
import { Splitter } from '@/components/ui/Splitter'

type Tone = 'muted' | 'positive' | 'warning' | 'negative'
type RankedPriceRow = PriceScreenRow & { rank: number }

const toneClass: Record<Tone, string> = {
  muted: 'text-text-muted',
  positive: 'text-up',
  warning: 'text-warn',
  negative: 'text-down',
}

const PRICE_INPUT = 'h-8 w-32 border border-border-strong bg-surface-raised px-1'
const MINIMUM_PRICE = 0.01
const MAXIMUM_PRICE = 1_000_000
const MIN_TABLE_WIDTH = 320
const MIN_PLOT_WIDTH = 360

function preciseCurrency(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function PricePage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const screen = usePriceScreen()
  const [minimumPrice, setMinimumPrice] = useState(100)
  const [maximumPrice, setMaximumPrice] = useState(200)
  const [payload, setPayload] = useState<PriceScreenPayload | null>(null)
  const [notice, setNotice] = useState<{ text: string; tone: Tone } | null>(null)
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null)
  const [tableWidth, setTableWidth] = useState(600)
  const tickerElements = useRef(new Map<string, HTMLSpanElement>())

  const rankedRows = useMemo<RankedPriceRow[]>(
    () => (payload?.rows ?? []).map((row, index) => ({ ...row, rank: index + 1 })),
    [payload],
  )

  useEffect(() => {
    onStatusChange(
      [{ label: 'Price', envelope: screen.data, loading: screen.isPending }],
      '',
    )
  }, [onStatusChange, screen.data, screen.isPending])

  useEffect(() => {
    if (selectedTicker && !rankedRows.some((row) => row.ticker === selectedTicker)) {
      setSelectedTicker(null)
    }
  }, [rankedRows, selectedTicker])

  useEffect(() => {
    if (!selectedTicker) return
    tickerElements.current.get(selectedTicker)?.scrollIntoView({ block: 'nearest' })
  }, [selectedTicker])

  const status = useMemo<{ text: string; tone: Tone }>(() => {
    if (notice) return notice
    if (screen.isPending) {
      return {
        text: `Loading ${preciseCurrency(minimumPrice)} to ${preciseCurrency(maximumPrice)}...`,
        tone: 'muted',
      }
    }
    if (screen.data?.meta.freshness === 'failed') {
      return {
        text: `Error: ${screen.data.meta.failureReason ?? 'Price screen unavailable'}`,
        tone: 'negative',
      }
    }
    if (!payload) return { text: 'Enter a price range and select Fetch.', tone: 'muted' }
    if (!payload.rows.length) {
      return { text: 'No qualifying companies found in this price range.', tone: 'warning' }
    }
    const candidate = payload.candidateCount
      ? ` from ${payload.candidateCount.toLocaleString('en-US')} candidates`
      : ''
    const suffix = `${payload.source ? ` via ${payload.source}` : ''}${payload.asOf ? ` at ${payload.asOf}` : ''}`
    return {
      text: `Showing ${payload.rows.length} largest matching companies${candidate}${suffix}`,
      tone: 'positive',
    }
  }, [notice, screen.isPending, screen.data, minimumPrice, maximumPrice, payload])

  const fetchRange = useCallback(async () => {
    setNotice(null)
    if (minimumPrice > maximumPrice) {
      setNotice({ text: 'Minimum price cannot exceed maximum price.', tone: 'negative' })
      return
    }
    const result = await screen.mutateAsync({ minimumPrice, maximumPrice })
    if (result.meta.freshness !== 'failed') setPayload(result.data)
  }, [minimumPrice, maximumPrice, screen])

  const columns = useMemo<Array<Column<RankedPriceRow>>>(
    () => [
      {
        key: 'rank',
        header: '#',
        cell: (row) => row.rank,
        sortValue: (row) => row.rank,
        align: 'right',
        numeric: true,
        width: '48px',
      },
      {
        key: 'ticker',
        header: 'Ticker',
        cell: (row) => (
          <span
            ref={(element) => {
              if (element) tickerElements.current.set(row.ticker, element)
              else tickerElements.current.delete(row.ticker)
            }}
          >
            {row.ticker}
          </span>
        ),
        sortValue: (row) => row.ticker,
        width: '90px',
      },
      {
        key: 'name',
        header: 'Company',
        cell: (row) => row.name,
        sortValue: (row) => row.name,
      },
      {
        key: 'exchange',
        header: 'Exchange',
        cell: (row) => row.exchange,
        sortValue: (row) => row.exchange,
        width: '120px',
      },
      {
        key: 'price',
        header: 'Price',
        cell: (row) => preciseCurrency(row.price),
        sortValue: (row) => row.price,
        align: 'right',
        numeric: true,
        width: '105px',
      },
      {
        key: 'marketCap',
        header: 'Market Cap',
        cell: (row) => formatPriceScreenMarketCap(row.marketCap),
        sortValue: (row) => row.marketCap,
        align: 'right',
        numeric: true,
        width: '135px',
      },
    ],
    [],
  )

  const onDrag = useCallback((clientX: number) => {
    const maximum = Math.max(MIN_TABLE_WIDTH, window.innerWidth - MIN_PLOT_WIDTH)
    setTableWidth(Math.min(Math.max(clientX, MIN_TABLE_WIDTH), maximum))
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <h1 className="shrink-0 text-sm font-semibold text-text">Price</h1>

      <section className="flex min-h-0 flex-1 flex-col gap-2 border border-border bg-surface p-2">
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <span className="px-1 text-2xs text-text-muted">Minimum price</span>
          <NumberInput
            value={minimumPrice}
            onCommit={(value) => {
              setMinimumPrice(value)
              setNotice(null)
            }}
            decimals={2}
            prefix="$"
            min={MINIMUM_PRICE}
            max={MAXIMUM_PRICE}
            disabled={screen.isPending}
            className={PRICE_INPUT}
            aria-label="Minimum stock price"
          />
          <span className="pl-2 text-2xs text-text-muted">Maximum price</span>
          <NumberInput
            value={maximumPrice}
            onCommit={(value) => {
              setMaximumPrice(value)
              setNotice(null)
            }}
            decimals={2}
            prefix="$"
            min={MINIMUM_PRICE}
            max={MAXIMUM_PRICE}
            disabled={screen.isPending}
            className={PRICE_INPUT}
            aria-label="Maximum stock price"
          />
          <Button variant="accent" onClick={() => void fetchRange()} disabled={screen.isPending}>
            {screen.isPending ? 'Fetching...' : 'Fetch'}
          </Button>
          <span className={`ml-auto px-1 text-right text-2xs ${toneClass[status.tone]}`}>
            {status.text}
          </span>
        </div>

        <div className="flex min-h-0 flex-1">
          <div
            className="flex min-h-0 shrink-0 flex-col overflow-hidden border border-border"
            style={{ width: tableWidth }}
          >
            <DataTable
              columns={columns}
              rows={rankedRows}
              rowKey={(row) => row.ticker}
              layout="fixed"
              defaultSort={{ key: 'marketCap', direction: 'desc' }}
              onRowClick={(row) => setSelectedTicker(row.ticker)}
              rowClassName={(row) =>
                row.ticker === selectedTicker ? 'bg-accent-dim/60' : ''
              }
              empty={payload ? 'No qualifying companies found.' : 'Fetch a price range to load companies.'}
            />
          </div>

          <Splitter onDrag={onDrag} />

          <div className="flex min-h-0 min-w-0 flex-1 flex-col pl-2">
            <h2 className="shrink-0 pb-1 text-2xs font-semibold text-text">
              Price vs Market Cap
            </h2>
            <PriceScatterPlot
              rows={payload?.rows ?? []}
              loaded={payload !== null}
              selectedTicker={selectedTicker}
              onSelectTicker={setSelectedTicker}
            />
          </div>
        </div>
      </section>
    </div>
  )
}

