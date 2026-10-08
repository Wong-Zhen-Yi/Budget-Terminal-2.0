import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import {
  BACKTEST_INTERVALS,
  BACKTEST_RANGES,
  type BacktestInterval,
  type BacktestPageSettings,
  type BacktestPayload,
  type BacktestRange,
  type BacktestRow,
} from '@shared/contract'
import {
  DEFAULT_BACKTEST_PAGE_SETTINGS,
  normalizeBacktestPageSettings,
} from '@shared/backtest'
import { backtestKey, useBacktest } from '@/api/backtestQueries'
import { api } from '@/api/client'
import { usePortfolio, useQuotes } from '@/api/queries'
import { useSettings, useSettingsMutation } from '@/api/settingsQueries'
import { LineChart, type LineSeries } from '@/components/charts/LineChart'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Button } from '@/components/ui/Button'
import { NumberInput } from '@/components/ui/NumberInput'
import { Splitter } from '@/components/ui/Splitter'

type Tone = 'muted' | 'positive' | 'warning' | 'negative'
type EditableRow = BacktestRow & { id: number }

const toneClass: Record<Tone, string> = {
  muted: 'text-text-muted',
  positive: 'text-up',
  warning: 'text-warn',
  negative: 'text-down',
}

const MIN_LEFT_WIDTH = 300
const MIN_RIGHT_WIDTH = 440

function percent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '--'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function currency(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '$--'
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function BacktestPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const backtest = useBacktest()
  const queryClient = useQueryClient()
  const settingsQuery = useSettings()
  const savedBacktest = normalizeBacktestPageSettings(settingsQuery.data?.data.backtestPage)
  const startupBacktest = useQuery({
    queryKey: backtestKey(savedBacktest),
    queryFn: () => api.backtest(savedBacktest),
    enabled: false,
  })
  const saveSettings = useSettingsMutation()
  const portfolioQuery = usePortfolio()
  const mainPortfolio = useMemo(() => {
    const payload = portfolioQuery.data?.data
    return payload?.portfolios.find((entry) => entry.id === payload.mainId)
  }, [portfolioQuery.data])
  const mainTickers = useMemo(() => mainPortfolio?.tickers ?? [], [mainPortfolio])
  const quotesQuery = useQuotes(mainTickers)

  const rowSequence = useRef(1)
  const editable = useCallback(
    (rows: BacktestRow[]): EditableRow[] =>
      rows.map((row) => ({ ...row, id: rowSequence.current++ })),
    [],
  )
  const [rows, setRows] = useState<EditableRow[]>(() =>
    DEFAULT_BACKTEST_PAGE_SETTINGS.rows.map((row) => ({ ...row, id: rowSequence.current++ })),
  )
  const [compareSymbol, setCompareSymbol] = useState(DEFAULT_BACKTEST_PAGE_SETTINGS.compareSymbol)
  const [interval, setInterval] = useState<BacktestInterval>(DEFAULT_BACKTEST_PAGE_SETTINGS.interval)
  const [range, setRange] = useState<BacktestRange>(DEFAULT_BACKTEST_PAGE_SETTINGS.range)
  const [splitterSizes, setSplitterSizes] = useState([...DEFAULT_BACKTEST_PAGE_SETTINGS.splitterSizes])
  const [leftWidth, setLeftWidth] = useState(390)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [manualPayload, setPayload] = useState<BacktestPayload | null>(null)
  const payload = manualPayload ?? startupBacktest.data?.data ?? null
  const [notice, setNotice] = useState<{ text: string; tone: Tone } | null>(null)
  const hydrated = useRef(false)
  const pageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (hydrated.current || !settingsQuery.data?.data) return
    const saved = normalizeBacktestPageSettings(settingsQuery.data.data.backtestPage)
    hydrated.current = true
    setRows(editable(saved.rows))
    setCompareSymbol(saved.compareSymbol)
    setInterval(saved.interval)
    setRange(saved.range)
    setSplitterSizes(saved.splitterSizes)
    const total = saved.splitterSizes[0] + saved.splitterSizes[1]
    const available = Math.max(MIN_LEFT_WIDTH + MIN_RIGHT_WIDTH, window.innerWidth - 28)
    setLeftWidth(Math.max(MIN_LEFT_WIDTH, Math.min(available - MIN_RIGHT_WIDTH, available * saved.splitterSizes[0] / total)))
  }, [editable, settingsQuery.data])

  const storedRows = useCallback(
    (values: EditableRow[] = rows): BacktestRow[] =>
      values.map(({ symbol, weight }) => ({ symbol: symbol.trim().toUpperCase(), weight })),
    [rows],
  )

  const persist = useCallback(
    (patch: Partial<BacktestPageSettings> = {}) => {
      if (!hydrated.current) return
      const value: BacktestPageSettings = {
        rows: patch.rows ?? storedRows(),
        compareSymbol: patch.compareSymbol ?? compareSymbol,
        interval: patch.interval ?? interval,
        range: patch.range ?? range,
        splitterSizes: patch.splitterSizes ?? splitterSizes,
      }
      void saveSettings({ type: 'setBacktestPage', value })
    },
    [compareSymbol, interval, range, saveSettings, splitterSizes, storedRows],
  )

  useEffect(() => {
    onStatusChange(
      [
        { label: 'Backtest', envelope: backtest.data ?? startupBacktest.data, error: backtest.error ?? startupBacktest.error,
          enabled: savedBacktest.rows.some((row) => row.symbol && row.weight > 0) || !backtest.isIdle,
          loading: backtest.isPending || startupBacktest.isFetching },
        { label: 'Holdings', envelope: portfolioQuery.data, error: portfolioQuery.error, enabled: portfolioQuery.isEnabled, loading: portfolioQuery.isFetching },
        { label: 'Quotes', envelope: quotesQuery.data, error: quotesQuery.error, enabled: quotesQuery.isEnabled, loading: quotesQuery.isFetching },
      ],
      settingsQuery.data?.data.sourcePath ?? '',
    )
  }, [
    backtest.data,
    backtest.isPending,
    startupBacktest.data,
    startupBacktest.isFetching,
    onStatusChange,
    portfolioQuery.data,
    portfolioQuery.isFetching,
    quotesQuery.data,
    quotesQuery.isFetching,
    settingsQuery.data,
  ])

  const weightTotal = useMemo(
    () => rows.reduce((sum, row) => sum + (Number.isFinite(row.weight) ? row.weight : 0), 0),
    [rows],
  )

  const status = useMemo<{ text: string; tone: Tone }>(() => {
    if (notice) return notice
    if (backtest.isPending || startupBacktest.isFetching) {
      return {
        text: `Loading ${rows.filter((row) => row.symbol.trim()).length} ticker(s) for ${range} ${interval} backtest...`,
        tone: 'muted',
      }
    }
    if (backtest.data?.meta.freshness === 'failed') {
      return {
        text: `Backtest failed: ${backtest.data.meta.failureReason ?? 'Backtest unavailable'}`,
        tone: 'negative',
      }
    }
    if (payload?.stats) {
      if (payload.compareError) return { text: `Backtest loaded. ${payload.compareError}`, tone: 'warning' }
      return {
        text: `Backtest loaded from ${payload.stats.start} to ${payload.stats.end}.`,
        tone: 'positive',
      }
    }
    return { text: 'Ready', tone: 'muted' }
  }, [backtest.data, backtest.isPending, startupBacktest.isFetching, interval, notice, payload, range, rows])

  const replaceRows = useCallback(
    (next: EditableRow[], message?: string) => {
      setRows(next)
      setSelectedId(null)
      persist({ rows: storedRows(next) })
      if (message) setNotice({ text: message, tone: 'positive' })
    },
    [persist, storedRows],
  )

  const normalizeWeights = useCallback(() => {
    const total = rows.reduce(
      (sum, row) => sum + (row.symbol.trim() && row.weight > 0 ? row.weight : 0),
      0,
    )
    if (total <= 0) {
      setNotice({ text: 'Normalize failed: total weight is zero.', tone: 'warning' })
      return
    }
    const next = rows.map((row) =>
      row.symbol.trim() && row.weight > 0 ? { ...row, weight: row.weight / total * 100 } : row,
    )
    replaceRows(next)
    setNotice({ text: 'Weights normalized to 100%.', tone: 'positive' })
  }, [replaceRows, rows])

  const loadMainPortfolio = useCallback(() => {
    if (!mainPortfolio?.tickers.length) {
      setNotice({ text: 'Main portfolio has no stock tickers to load.', tone: 'warning' })
      return
    }
    const values = new Map<string, number>()
    for (const symbol of mainPortfolio.tickers) {
      const shares = mainPortfolio.holdings[symbol]?.shares ?? 0
      const price = quotesQuery.data?.data.holdings[symbol]?.price ?? 0
      const value = shares * price
      if (value > 0) values.set(symbol, value)
    }
    const total = [...values.values()].reduce((sum, value) => sum + value, 0)
    const nextRows = total > 0
      ? mainPortfolio.tickers.flatMap((symbol) => {
          const value = values.get(symbol)
          return value ? [{ symbol, weight: value / total * 100 }] : []
        })
      : mainPortfolio.tickers.map((symbol) => ({
          symbol,
          weight: 100 / mainPortfolio.tickers.length,
        }))
    replaceRows(editable(nextRows), `Loaded ${nextRows.length} ticker(s) from Main Portfolio.`)
  }, [editable, mainPortfolio, quotesQuery.data, replaceRows])

  const run = useCallback(async () => {
    const cleanedCompare = compareSymbol.trim().toUpperCase()
    setCompareSymbol(cleanedCompare)
    setNotice(null)
    const requestRows = storedRows()
    if (!requestRows.some((row) => row.symbol)) {
      setNotice({ text: 'Add at least one ticker before running a backtest.', tone: 'warning' })
      return
    }
    persist({ rows: requestRows, compareSymbol: cleanedCompare })
    const request = {
      rows: requestRows,
      compareSymbol: cleanedCompare,
      interval,
      range,
    }
    const result = await backtest.mutateAsync(request)
    queryClient.setQueryData(backtestKey(request), result)
    if (result.meta.freshness !== 'failed') setPayload(result.data)
  }, [backtest, compareSymbol, interval, persist, queryClient, range, storedRows])

  const chartSeries = useMemo<LineSeries[]>(() => {
    if (!payload?.points.length) return []
    const series: LineSeries[] = [{
      label: 'Backtest Portfolio',
      color: 'var(--color-accent-hover)',
      values: payload.points.map((point) => point.portfolioReturnPct),
    }]
    if (payload.points.some((point) => point.compareReturnPct !== null)) {
      series.push({
        label: payload.compareSymbol || 'Compare',
        color: 'var(--color-warn)',
        dashed: true,
        values: payload.points.map((point) => point.compareReturnPct),
      })
    }
    return series
  }, [payload])

  const onDrag = useCallback((clientX: number) => {
    const box = pageRef.current?.getBoundingClientRect()
    if (!box) return
    const available = box.width
    const width = Math.max(MIN_LEFT_WIDTH, Math.min(available - MIN_RIGHT_WIDTH, clientX - box.left))
    setLeftWidth(width)
    const sizes = [Math.round(width), Math.max(1, Math.round(available - width))]
    setSplitterSizes(sizes)
  }, [])

  useEffect(() => {
    if (!hydrated.current) return
    const timer = window.setTimeout(() => persist({ splitterSizes }), 400)
    return () => window.clearTimeout(timer)
  }, [persist, splitterSizes])

  const stats = payload?.stats
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-center gap-2">
        <h1 className="text-sm font-semibold text-text">Backtest</h1>
        <span className={`ml-auto text-right text-2xs ${toneClass[status.tone]}`}>{status.text}</span>
      </div>

      <div ref={pageRef} className="flex min-h-0 flex-1">
        <section
          className="flex min-h-0 shrink-0 flex-col gap-2 border border-border bg-surface p-2"
          style={{ width: leftWidth }}
        >
          <div className="flex shrink-0 items-center gap-1">
            <Button
              onClick={() => {
                const next = [...rows, { id: rowSequence.current++, symbol: '', weight: 0 }]
                setRows(next)
                persist({ rows: storedRows(next) })
              }}
            >
              Add
            </Button>
            <Button
              onClick={() => {
                if (selectedId === null) return
                let next = rows.filter((row) => row.id !== selectedId)
                if (!next.length) next = editable(DEFAULT_BACKTEST_PAGE_SETTINGS.rows)
                replaceRows(next)
              }}
            >
              Remove
            </Button>
            <Button onClick={normalizeWeights}>Normalize</Button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto border border-border">
            <table className="w-full border-collapse text-2xs">
              <thead className="sticky top-0 z-10 bg-surface-raised text-left text-text-muted">
                <tr>
                  <th className="border-b border-border px-2 py-1 font-medium">Symbol</th>
                  <th className="w-32 border-b border-border px-2 py-1 text-right font-medium">Weight %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setSelectedId(row.id)}
                    className={`border-b border-border/60 ${selectedId === row.id ? 'bg-accent-dim/60' : 'hover:bg-surface-hover'}`}
                  >
                    <td className="px-1 py-0.5">
                      <input
                        value={row.symbol}
                        aria-label="Backtest ticker"
                        spellCheck={false}
                        onChange={(event) => {
                          const value = event.target.value
                          setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, symbol: value } : entry))
                        }}
                        onBlur={() => {
                          const next = rows.map((entry) => entry.id === row.id ? { ...entry, symbol: entry.symbol.trim().toUpperCase() } : entry)
                          setRows(next)
                          persist({ rows: storedRows(next) })
                        }}
                        className="h-7 w-full border border-transparent bg-transparent px-1 text-2xs text-text outline-none hover:border-border-strong focus:border-accent focus:bg-surface-raised"
                      />
                    </td>
                    <td className="px-1 py-0.5">
                      <NumberInput
                        value={row.weight}
                        decimals={2}
                        min={0}
                        max={10_000}
                        aria-label={`${row.symbol || 'Blank'} weight`}
                        onCommit={(weight) => {
                          const next = rows.map((entry) => entry.id === row.id ? { ...entry, weight } : entry)
                          setRows(next)
                          persist({ rows: storedRows(next) })
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className={`shrink-0 text-2xs ${Math.abs(weightTotal - 100) <= 0.01 ? 'text-up' : 'text-warn'}`}>
            Weight total: {weightTotal.toFixed(2)}%
            {Math.abs(weightTotal - 100) > 0.01 ? ' (will normalize on run)' : ''}
          </p>
          <div className="flex shrink-0 gap-1">
            <Button onClick={loadMainPortfolio} disabled={portfolioQuery.isLoading}>Load Main Portfolio</Button>
            <Button variant="accent" onClick={() => void run()} disabled={backtest.isPending}>Run Backtest</Button>
          </div>
        </section>

        <Splitter onDrag={onDrag} />

        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 border border-border bg-surface p-2">
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <span className="px-1 text-2xs text-text-muted">Compare</span>
            <input
              value={compareSymbol}
              placeholder="Optional ticker"
              aria-label="Compare ticker"
              spellCheck={false}
              onChange={(event) => setCompareSymbol(event.target.value)}
              onBlur={() => {
                const value = compareSymbol.trim().toUpperCase()
                setCompareSymbol(value)
                persist({ compareSymbol: value })
              }}
              className="h-8 w-32 border border-border-strong bg-surface-raised px-2 text-2xs text-text outline-none focus:border-accent"
            />
            <span className="ml-2 px-1 text-2xs text-text-muted">Interval</span>
            {BACKTEST_INTERVALS.map((value) => (
              <Button
                key={value}
                variant="toggle"
                active={interval === value}
                onClick={() => {
                  setInterval(value)
                  persist({ interval: value })
                }}
              >
                {value}
              </Button>
            ))}
            <span className="ml-2 px-1 text-2xs text-text-muted">Range</span>
            {BACKTEST_RANGES.map((value) => (
              <Button
                key={value}
                variant="toggle"
                active={range === value}
                onClick={() => {
                  setRange(value)
                  persist({ range: value })
                }}
              >
                {value}
              </Button>
            ))}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-y border-border py-1 text-2xs text-text-muted">
            <span>{stats ? `${stats.start} → ${stats.end}` : 'Window --'}</span>
            <span>Return {percent(stats?.totalReturnPct)}</span>
            <span>CAGR {percent(stats?.cagrPct)}</span>
            <span>Max DD {percent(stats?.maxDrawdownPct)}</span>
            <span>Final {currency(stats?.finalValue)}</span>
          </div>

          {chartSeries.length ? (
            <>
              <div className="flex shrink-0 items-center gap-4 text-2xs text-text-muted">
                {chartSeries.map((series) => (
                  <span key={series.label} className="inline-flex items-center gap-1">
                    <span
                      className="inline-block w-6 border-t-2"
                      style={{ borderColor: series.color, borderTopStyle: series.dashed ? 'dashed' : 'solid' }}
                    />
                    {series.label}
                  </span>
                ))}
              </div>
              <LineChart
                labels={payload?.points.map((point) => point.date) ?? []}
                series={chartSeries}
                format={(value) => `${value.toFixed(1)}%`}
                baseline="zero"
                empty="Run a backtest to plot normalized portfolio performance."
              />
            </>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center text-2xs text-text-dim">
              Run a backtest to plot normalized portfolio performance.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
