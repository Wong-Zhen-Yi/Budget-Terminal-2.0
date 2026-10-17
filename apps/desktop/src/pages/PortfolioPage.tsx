import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import type { Envelope, OptionPosition, PortfolioMutation, PortfolioPayload, PositionInput } from '@shared/contract'
import { buildPositionRows, summarizePortfolio } from '@shared/portfolioMath'
import { api, queryKeys } from '@/api/client'
import { useFundamentals, usePortfolio, usePortfolioMutation, useQuotes } from '@/api/queries'
import { useOptionQuotes } from '@/api/portfolioQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Donut } from '@/components/charts/Donut'
import { AddPositionsDialog } from '@/components/portfolio/AddPositionsDialog'
import { DipFinderPanel, WeightPanel } from '@/components/portfolio/DipFinderPanel'
import { HeatmapTab } from '@/components/portfolio/HeatmapTab'
import { ManagePortfoliosDialog } from '@/components/portfolio/ManagePortfoliosDialog'
import { MetricsTab } from '@/components/portfolio/MetricsTab'
import { MomentumTab } from '@/components/portfolio/MomentumTab'
import { buildOptionRows, OptionsTable, totalOptionsPnl } from '@/components/portfolio/OptionsTable'
import { PositionsTable } from '@/components/portfolio/PositionsTable'
import { RemovePositionsDialog } from '@/components/portfolio/RemovePositionsDialog'
import { SummaryBar } from '@/components/portfolio/SummaryBar'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { currency, decimals, percent, plainPercent } from '@/lib/format'

const SUB_TABS = [
  { id: 'stocks', label: 'Stocks' },
  { id: 'options', label: 'Options' },
  { id: 'weight', label: 'Portfolio Weight' },
  { id: 'dip-finder', label: 'Dip Finder' },
  { id: 'pie', label: 'Pie Chart' },
  { id: 'heatmap', label: 'Portfolio Heatmap' },
  { id: 'momentum', label: 'Momentum Tracker' },
  { id: 'metrics', label: 'Portfolio Metrics' },
] as const

type SubTabId = (typeof SUB_TABS)[number]['id']

export function PortfolioPage({
  onStatusChange,
  onNavigate,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate?: (tab: string, symbol?: string) => void
}) {
  const portfolioQuery = usePortfolio()
  const mutate = usePortfolioMutation()
  const queryClient = useQueryClient()
  const pendingWrites = useRef(new Set<Promise<Envelope<PortfolioPayload>>>())
  const lastWriteError = useRef('')

  const payload = portfolioQuery.data?.data
  const portfolios = useMemo(() => payload?.portfolios ?? [], [payload])
  const selected = useMemo(
    () => portfolios.find((entry) => entry.id === payload?.activeId) ?? portfolios[0] ?? null,
    [portfolios, payload],
  )

  const holdings = useMemo(() => selected?.tickers ?? [], [selected])
  const quotesQuery = useQuotes(holdings)
  const fundamentalsQuery = useFundamentals(holdings)

  const [subTab, setSubTab] = useState<SubTabId>('stocks')
  const [managing, setManaging] = useState(false)
  const [addingPositions, setAddingPositions] = useState(false)
  const [removingPositions, setRemovingPositions] = useState(false)
  const [error, setError] = useState('')
  const [saveStatus, setSaveStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)

  const rows = useMemo(
    () =>
      selected
        ? buildPositionRows(
            selected,
            quotesQuery.data?.data.holdings ?? {},
            fundamentalsQuery.data?.data.fundamentals ?? {},
          )
        : [],
    [selected, quotesQuery.data, fundamentalsQuery.data],
  )
  const summary = useMemo(
    () => (selected ? summarizePortfolio(selected, rows) : null),
    [selected, rows],
  )

  /* --------------------------------------------------------------- options */

  const optionContracts = useMemo(
    () =>
      (selected?.options ?? [])
        .filter((option) => option.ticker)
        .map((option) => ({
          rowId: option.rowId,
          ticker: option.ticker,
          expiry: option.expiry,
          strike: option.strike,
          strategy: option.strategy,
        })),
    [selected],
  )
  // Option marks also feed the shared summary, so keep them ready on every subtab.
  const optionQuotesQuery = useOptionQuotes(optionContracts, true)
  const optionRows = useMemo(
    () => buildOptionRows(selected?.options ?? [], optionQuotesQuery.data?.data.quotes ?? {}),
    [selected, optionQuotesQuery.data],
  )

  /* -------------------------------------------------- analytics inputs */

  const includedRows = useMemo(
    () => rows.filter((row) => row.includeInWeight && row.shares > 0),
    [rows],
  )
  const positions: PositionInput[] = useMemo(
    () => includedRows.map((row) => ({ ticker: row.ticker, shares: row.shares })),
    [includedRows],
  )
  const cashAmount = selected?.includeCashInWeight ? Math.max(selected.cashBalance, 0) : 0

  const currentValues = useMemo(() => {
    const values: Record<string, number> = {}
    for (const row of includedRows) if (row.marketValue !== null && row.marketValue > 0) values[row.ticker] = row.marketValue
    if (cashAmount > 0) values.CASH = cashAmount
    return values
  }, [includedRows, cashAmount])

  /** Allocation slices, rebased across weight-included positions plus counted cash. */
  const allocation = useMemo(() => {
    const total = Object.values(currentValues).reduce((sum, value) => sum + value, 0)
    if (total <= 0 || !summary?.complete) return { slices: [], total }
    return {
      slices: Object.entries(currentValues)
        .map(([label, value]) => ({ label, value: (value / total) * 100 }))
        .sort((a, b) => b.value - a.value),
      total,
    }
  }, [currentValues, summary])

  useEffect(() => {
    onStatusChange(
      [
        { label: 'Holdings', envelope: portfolioQuery.data, loading: portfolioQuery.isFetching, error: portfolioQuery.error, enabled: portfolioQuery.isEnabled },
        { label: 'Option marks', envelope: optionQuotesQuery.data, loading: optionQuotesQuery.isFetching, error: optionQuotesQuery.error, enabled: optionQuotesQuery.isEnabled },
        { label: 'Quotes', envelope: quotesQuery.data, loading: quotesQuery.isFetching, error: quotesQuery.error, enabled: quotesQuery.isEnabled },
        {
          label: 'Fundamentals',
          envelope: fundamentalsQuery.data,
          loading: fundamentalsQuery.isFetching,
          error: fundamentalsQuery.error,
          enabled: fundamentalsQuery.isEnabled,
        },
      ],
      payload?.sourcePath ?? '',
    )
  }, [
    onStatusChange,
    optionQuotesQuery.data,
    optionQuotesQuery.isFetching,
    optionQuotesQuery.error,
    optionQuotesQuery.isEnabled,
    portfolioQuery.error,
    quotesQuery.error,
    fundamentalsQuery.error,
    payload,
    portfolioQuery.data,
    portfolioQuery.isFetching,
    quotesQuery.data,
    quotesQuery.isFetching,
    fundamentalsQuery.data,
    fundamentalsQuery.isFetching,
    fundamentalsQuery.isEnabled,
    quotesQuery.isEnabled,
    portfolioQuery.isEnabled,
  ])

  /** Every edit goes through here so a refused write surfaces in one place. */
  const send = useCallback(
    async (mutation: PortfolioMutation) => {
      setSaveStatus('')
      lastWriteError.current = ''
      const write = mutate(mutation)
      pendingWrites.current.add(write)
      try {
        const result = await write
        if (result.meta.failureReason) lastWriteError.current = result.meta.failureReason
        setError(result.meta.failureReason ?? '')
        return result
      } finally {
        pendingWrites.current.delete(write)
      }
    },
    [mutate],
  )

  const save = useCallback(async () => {
    if (saving) return
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setSaving(true)
    setSaveStatus('')
    try {
      await Promise.all([...pendingWrites.current])
      if (lastWriteError.current) throw new Error(lastWriteError.current)
      const current = await api.portfolio()
      if (current.meta.freshness === 'failed') {
        throw new Error(current.meta.failureReason ?? 'Could not read the portfolio.')
      }
      queryClient.setQueryData(queryKeys.portfolio, current)
      const check = await api.verifyStoredData({ kind: 'portfolio', expected: current.data })
      if (!check.data) throw new Error('Portfolio does not match the AppData file. Please retry Save.')
      setError('')
      setSaveStatus('Saved and verified in AppData.')
    } catch (cause) {
      setSaveStatus(cause instanceof Error ? cause.message : 'Could not verify the AppData file.')
    } finally {
      setSaving(false)
    }
  }, [queryClient, saving])

  /**
   * Writes one ticker at a time so a refusal — a duplicate, say — costs only that ticker
   * and the rest of the list still lands. The store queues the writes behind each other.
   */
  const eachTicker = useCallback(
    async (mutation: 'addPosition' | 'removePosition', tickers: string[]) => {
      if (!selected) return []
      const failures: string[] = []
      for (const ticker of tickers) {
        const result = await mutate({ type: mutation, portfolioId: selected.id, ticker })
        if (result.meta.failureReason) failures.push(`${ticker}: ${result.meta.failureReason}`)
      }
      // The dialog reports its own failures, so the page-level line stays clear.
      setError('')
      return failures
    },
    [selected, mutate],
  )

  const exportTickers = useCallback(async () => {
    if (!selected) return
    await api.saveText(`${selected.name}_tickers.txt`, selected.tickers.join('\n'))
  }, [selected])

  /** A plain-text snapshot of the book, for pasting into a chat with a model. */
  const exportForLlm = useCallback(async () => {
    if (!selected || exporting) return
    const portfolioId = selected.id
    setExporting(true)
    setError('')
    try {
      const snapshot = await api.portfolio()
      if (snapshot.meta.freshness === 'failed') {
        throw new Error(snapshot.meta.failureReason ?? 'Could not read the portfolio for export.')
      }
      const selected = snapshot.data.portfolios.find((entry) => entry.id === portfolioId)
      if (!selected) throw new Error('This portfolio no longer exists. Please select a portfolio again.')
      const [quotes, fundamentals] = await Promise.all([
        api.quotes({ holdings: selected.tickers, force: true }),
        api.fundamentals({ tickers: selected.tickers, force: true }),
      ])
      if (quotes.meta.freshness === 'failed' || selected.tickers.some((ticker) => !quotes.data.holdings[ticker])) {
        throw new Error('Could not refresh all holding prices. Please retry the export.')
      }
      const rows = buildPositionRows(selected, quotes.data.holdings, fundamentals.data.fundamentals)
      const summary = summarizePortfolio(selected, rows)
      const lines = [
        `Portfolio: ${selected.name}`,
        `Exported: ${new Date().toISOString()}`,
        ...[quotes, fundamentals].map((result) =>
          `${result.meta.source}: ${result.meta.freshness}, fetched ${new Date(result.meta.fetchedAt).toISOString()}${result.meta.failureReason ? ` (${result.meta.failureReason})` : ''}`,
        ),
        `Total: ${currency(summary.total)}  Stock P&L: ${currency(summary.stockPnl)}  Positions: ${summary.positionCount}`,
        `Cash: ${currency(selected.cashBalance)}${selected.includeCashInWeight ? '' : ' (excluded from weight)'}  Margin: ${currency(selected.marginDebt)}`,
        '',
        '| Ticker | Shares | Avg Price | Cost | Price | Day % | Market Value | Weight | Gain | Growth | Size | Analyst PT |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        ...rows.map(
          (row) =>
            `| ${[
              row.ticker,
              decimals(row.shares, row.shares % 1 === 0 ? 0 : 4),
              currency(row.avgPrice),
              currency(row.cost),
              currency(row.price),
              percent(row.changePercent),
              currency(row.marketValue),
              row.weight === null ? '--' : plainPercent(row.weight),
              currency(row.dollarGain),
              percent(row.growth, 1),
              row.size === null ? '--' : currency(row.size, 0),
              row.analystTarget === null ? '--' : currency(row.analystTarget),
            ].join(' | ')} |`,
        ),
      ]
      await api.saveText(`${selected.name}_portfolio.md`, lines.join('\n'))
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Portfolio export failed.')
    } finally {
      setExporting(false)
    }
  }, [selected, exporting])

  if (!selected || !summary) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-2xs text-text-dim">
          {portfolioQuery.isLoading ? 'Loading portfolios...' : 'No portfolios found.'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <SummaryBar
        portfolio={selected}
        summary={summary}
        optionsPnl={totalOptionsPnl(optionRows)}
        onSetCash={(cashBalance) => void send({ type: 'setCash', portfolioId: selected.id, cashBalance })}
        onSetMargin={(marginDebt) => void send({ type: 'setMargin', portfolioId: selected.id, marginDebt })}
        onToggleIncludeCash={(includeCashInWeight) =>
          void send({ type: 'setIncludeCash', portfolioId: selected.id, includeCashInWeight })
        }
      />

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span className="text-2xs text-text-muted">Portfolios</span>
        <select
          aria-label="Active portfolio"
          value={selected.id}
          onChange={(event) => void send({ type: 'setActive', id: event.target.value })}
          className="h-8 min-w-52 border border-border-strong bg-surface-raised px-2 text-2xs text-text outline-none focus:border-accent"
        >
          {portfolios.map((portfolio) => (
            <option key={portfolio.id} value={portfolio.id}>
              {portfolio.name}
              {portfolio.id === payload?.mainId ? '  (main)' : ''}
            </option>
          ))}
        </select>
        <Button variant="accent" onClick={() => setManaging(true)}>
          Manage Portfolios
        </Button>
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? 'Checking...' : 'Save'}
        </Button>
        {saveStatus ? <span role="status" className={`text-2xs ${saveStatus.startsWith('Saved') ? 'text-up' : 'text-down'}`}>{saveStatus}</span> : null}
        <span className="text-2xs text-text-dim">
          Main: {portfolios.find((entry) => entry.id === payload?.mainId)?.name ?? '--'}
        </span>
        {error ? <span className="text-2xs text-down">{error}</span> : null}
      </div>

      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={`h-8 shrink-0 border-b-2 px-3 text-2xs transition-colors ${
              tab.id === subTab
                ? 'border-accent text-text'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subTab === 'stocks' ? (
        <Panel
          title="Stocks"
          className="min-h-0 flex-1"
          actions={
            <div className="flex items-center gap-1">
              {selected.readOnly ? (
                <span className="pr-1 text-2xs text-text-dim">
                  Combined is a read-only view of every portfolio
                </span>
              ) : (
                <>
                  <Button variant="accent" onClick={() => setAddingPositions(true)}>
                    + Add Position
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => setRemovingPositions(true)}
                    disabled={!selected.tickers.length}
                  >
                    - Remove Position
                  </Button>
                </>
              )}
              <Button onClick={() => void exportForLlm()} disabled={exporting}>
                {exporting ? 'Exporting...' : 'Export for LLM'}
              </Button>
              <Button onClick={() => void exportTickers()} disabled={!selected.tickers.length}>
                Export Tickers
              </Button>
            </div>
          }
        >
          {Object.values(quotesQuery.data?.data.holdings ?? {}).some(quote => quote.priceBasis === 'published-close') && <div className="shrink-0 px-2 py-1 text-2xs text-text-dim">DefeatBeta prices are published daily closes, not live quotes. The status bar shows the source date.</div>}
          <PositionsTable
            onResearch={(symbol) => onNavigate?.('stocks', symbol)}
            portfolio={selected}
            rows={rows}
            loading={quotesQuery.isLoading || fundamentalsQuery.isLoading}
            onSetShares={(ticker, shares) =>
              void send({ type: 'setPosition', portfolioId: selected.id, ticker, shares })
            }
            onSetAvgPrice={(ticker, avgPrice) =>
              void send({ type: 'setPosition', portfolioId: selected.id, ticker, avgPrice })
            }
            onToggleWeight={(ticker, includeInWeight) =>
              void send({ type: 'setPosition', portfolioId: selected.id, ticker, includeInWeight })
            }
            onRemove={(ticker) =>
              void send({ type: 'removePosition', portfolioId: selected.id, ticker })
            }
          />
        </Panel>
      ) : null}

      {subTab === 'options' ? (
        <Panel
          title="Options"
          className="min-h-0 flex-1"
          actions={
            selected.readOnly ? null : (
              <Button
                variant="accent"
                onClick={() => void send({ type: 'addOption', portfolioId: selected.id })}
              >
                + Add Position
              </Button>
            )
          }
        >
          <OptionsTable
            portfolio={selected}
            rows={optionRows}
            expiries={optionQuotesQuery.data?.data.expiries ?? {}}
            loading={optionQuotesQuery.isFetching}
            onPatch={(rowId, patch: Partial<OptionPosition>) =>
              void send({ type: 'setOption', portfolioId: selected.id, rowId, patch })
            }
            onRemove={(rowId) =>
              void send({ type: 'removeOption', portfolioId: selected.id, rowId })
            }
          />
        </Panel>
      ) : null}

      {subTab === 'weight' ? <WeightPanel portfolio={selected} rows={rows} /> : null}

      {subTab === 'dip-finder' ? <DipFinderPanel rows={rows} visible /> : null}

      {subTab === 'pie' ? (
        <Panel
          title="Included Portfolio Allocation"
          className="min-h-0 flex-1"
          actions={
            <span className="num text-2xs text-text-muted">
              {summary.complete ? 'Included subtotal' : 'Known subtotal'}: {currency(allocation.total)} USD
            </span>
          }
        >
          {summary.complete ? <Donut slices={allocation.slices} />
            : <p className="p-4 text-2xs text-warn">Allocation unavailable. {summary.missingReasons.join(' ')}</p>}
        </Panel>
      ) : null}

      {subTab === 'heatmap' ? (
        <HeatmapTab portfolio={selected} rows={rows} visible />
      ) : null}

      {subTab === 'momentum' ? (
        <MomentumTab positions={positions} cashAmount={cashAmount} valuationComplete={summary.complete} visible />
      ) : null}

      {subTab === 'metrics' ? (
        <MetricsTab
          positions={positions}
          cashAmount={cashAmount}
          currentValues={currentValues}
          valuationComplete={summary.complete}
          visible
        />
      ) : null}

      {addingPositions ? (
        <AddPositionsDialog
          existing={selected.tickers}
          onClose={() => setAddingPositions(false)}
          onSubmit={(tickers) => eachTicker('addPosition', tickers)}
        />
      ) : null}

      {removingPositions ? (
        <RemovePositionsDialog
          rows={rows}
          onClose={() => setRemovingPositions(false)}
          onSubmit={(tickers) => eachTicker('removePosition', tickers)}
        />
      ) : null}

      {managing ? (
        <ManagePortfoliosDialog
          portfolios={portfolios}
          mainId={payload?.mainId ?? null}
          error={error}
          onClose={() => {
            setManaging(false)
            setError('')
          }}
          onCreate={() => void send({ type: 'create' })}
          onRename={(id, name) => void send({ type: 'rename', id, name })}
          onDelete={(id) => void send({ type: 'delete', id })}
          onSetMain={(id) => void send({ type: 'setMain', id })}
          onReorder={(order) => void send({ type: 'reorder', order })}
        />
      ) : null}
    </div>
  )
}
