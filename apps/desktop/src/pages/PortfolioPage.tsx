import { useCallback, useEffect, useMemo, useState } from 'react'

import type { OptionPosition, PortfolioMutation, PositionInput } from '@shared/contract'
import { buildPositionRows, summarizePortfolio } from '@shared/portfolioMath'
import { api } from '@/api/client'
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
  { id: 'positions', label: 'Positions' },
  { id: 'pie', label: 'Pie Chart' },
  { id: 'heatmap', label: 'Portfolio Heatmap' },
  { id: 'momentum', label: 'Momentum Tracker' },
  { id: 'metrics', label: 'Portfolio Metrics' },
] as const

type SubTabId = (typeof SUB_TABS)[number]['id']

export function PortfolioPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const portfolioQuery = usePortfolio()
  const mutate = usePortfolioMutation()

  const payload = portfolioQuery.data?.data
  const portfolios = useMemo(() => payload?.portfolios ?? [], [payload])
  const selected = useMemo(
    () => portfolios.find((entry) => entry.id === payload?.activeId) ?? portfolios[0] ?? null,
    [portfolios, payload],
  )

  const holdings = useMemo(() => selected?.tickers ?? [], [selected])
  const quotesQuery = useQuotes(holdings)
  const fundamentalsQuery = useFundamentals(holdings)

  const [subTab, setSubTab] = useState<SubTabId>('positions')
  const [managing, setManaging] = useState(false)
  const [addingPositions, setAddingPositions] = useState(false)
  const [removingPositions, setRemovingPositions] = useState(false)
  const [error, setError] = useState('')

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
  const optionQuotesQuery = useOptionQuotes(optionContracts, subTab === 'positions')
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
    for (const row of includedRows) if (row.marketValue > 0) values[row.ticker] = row.marketValue
    if (cashAmount > 0) values.CASH = cashAmount
    return values
  }, [includedRows, cashAmount])

  /** Allocation slices, rebased across weight-included positions plus counted cash. */
  const allocation = useMemo(() => {
    const total = Object.values(currentValues).reduce((sum, value) => sum + value, 0)
    if (total <= 0) return { slices: [], total: 0 }
    return {
      slices: Object.entries(currentValues)
        .map(([label, value]) => ({ label, value: (value / total) * 100 }))
        .sort((a, b) => b.value - a.value),
      total,
    }
  }, [currentValues])

  useEffect(() => {
    onStatusChange(
      [
        { label: 'Holdings', envelope: portfolioQuery.data, loading: portfolioQuery.isFetching },
        { label: 'Quotes', envelope: quotesQuery.data, loading: quotesQuery.isFetching },
        {
          label: 'Fundamentals',
          envelope: fundamentalsQuery.data,
          loading: fundamentalsQuery.isFetching,
        },
      ],
      payload?.sourcePath ?? '',
    )
  }, [
    onStatusChange,
    payload,
    portfolioQuery.data,
    portfolioQuery.isFetching,
    quotesQuery.data,
    quotesQuery.isFetching,
    fundamentalsQuery.data,
    fundamentalsQuery.isFetching,
  ])

  /** Every edit goes through here so a refused write surfaces in one place. */
  const send = useCallback(
    async (mutation: PortfolioMutation) => {
      const result = await mutate(mutation)
      setError(result.meta.failureReason ?? '')
      return result
    },
    [mutate],
  )

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
    if (!selected || !summary) return
    const lines = [
      `Portfolio: ${selected.name}`,
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
  }, [selected, summary, rows])

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
        <span className="text-2xs text-text-dim">
          Main: {portfolios.find((entry) => entry.id === payload?.mainId)?.name ?? '--'}
        </span>
        {error ? <span className="text-2xs text-down">{error}</span> : null}
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-border">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={`h-8 border-b-2 px-3 text-2xs transition-colors ${
              tab.id === subTab
                ? 'border-accent text-text'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subTab === 'positions' ? (
        <div className="flex min-h-0 flex-1 gap-2">
          <div className="flex min-h-0 min-w-0 flex-[3] flex-col gap-2">
            <Panel
              title="Positions"
              className="min-h-0 flex-[3]"
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
                  <Button onClick={() => void exportForLlm()}>Export for LLM</Button>
                  <Button onClick={() => void exportTickers()} disabled={!selected.tickers.length}>
                    Export Tickers
                  </Button>
                </div>
              }
            >
              <PositionsTable
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

            <Panel
              title="Options Positions"
              className="min-h-0 flex-[2]"
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
          </div>

          <div className="flex min-h-0 w-[26rem] shrink-0 flex-col gap-2">
            <DipFinderPanel rows={rows} visible={subTab === 'positions'} />
            <WeightPanel portfolio={selected} rows={rows} />
          </div>
        </div>
      ) : null}

      {subTab === 'pie' ? (
        <Panel
          title="Included Portfolio Allocation"
          className="min-h-0 flex-1"
          actions={
            <span className="num text-2xs text-text-muted">
              Filtered Total: {currency(allocation.total)} USD
            </span>
          }
        >
          <Donut slices={allocation.slices} />
        </Panel>
      ) : null}

      {subTab === 'heatmap' ? (
        <HeatmapTab portfolio={selected} rows={rows} visible />
      ) : null}

      {subTab === 'momentum' ? (
        <MomentumTab positions={positions} cashAmount={cashAmount} visible />
      ) : null}

      {subTab === 'metrics' ? (
        <MetricsTab
          positions={positions}
          cashAmount={cashAmount}
          currentValues={currentValues}
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
