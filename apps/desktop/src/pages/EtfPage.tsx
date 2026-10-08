import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  arbitrageClipboard,
  holdingsClipboard,
  filterHoldings,
  sectorBreakdownText,
} from '@shared/etf'
import { api } from '@/api/client'
import {
  useEtfArbitrage,
  useEtfAum,
  useEtfHoldings,
  useRefreshEtfArbitrage,
  useRefreshEtfAum,
  useRefreshEtfHoldings,
} from '@/api/etfQueries'
import { ArbitrageTab } from '@/components/etf/ArbitrageTab'
import { AumRail } from '@/components/etf/AumRail'
import { HoldingsTab } from '@/components/etf/HoldingsTab'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Button } from '@/components/ui/Button'
import { DataFreshness } from '@/components/ui/DataFreshness'
import { useEtfPage } from '@/stores/etf'

/**
 * The ETF page, ported from `EtfAnalyserMixin.init_page13`.
 *
 * The same split the reference builds: a fixed left rail ranking the whole US ETF
 * universe by net assets, and a right pane with the ticker controls, the six-figure fund
 * summary, the sector line, a status line and the two subtabs — Holdings and Arbitrage.
 *
 * Nothing here refreshes on a timer. `init_page13` fires exactly one request as the page
 * is built — the AUM rail — and every other load is a button: Load Holdings, a rail row,
 * Refresh Arbitrage, Refresh AUM, or F5.
 */

/** `_p13_left_panel` is a splitter pane sized 280 against 1120; a fixed rail here. */
const RAIL_WIDTH = 'w-[260px]'

export function EtfPage({
  onStatusChange,
  onNavigate,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate?: (tabId: string, symbol?: string) => void
}) {
  const ticker = useEtfPage((state) => state.ticker)
  const setTicker = useEtfPage((state) => state.setTicker)
  const subtab = useEtfPage((state) => state.subtab)
  const setSubtab = useEtfPage((state) => state.setSubtab)
  const holdingsFilter = useEtfPage((state) => state.holdingsFilter)
  const setHoldingsFilter = useEtfPage((state) => state.setHoldingsFilter)
  const aumFilter = useEtfPage((state) => state.aumFilter)
  const setAumFilter = useEtfPage((state) => state.setAumFilter)

  // The input is a draft until Enter or Load, the way the reference's line edit is: it
  // holds what the *next* load will fetch, not what is on screen.
  const [draft, setDraft] = useState(ticker)
  useEffect(() => setDraft(ticker), [ticker])

  const holdingsQuery = useEtfHoldings(ticker)
  const arbitrageQuery = useEtfArbitrage(ticker, subtab === 'arbitrage')
  const aumQuery = useEtfAum()
  const refreshHoldings = useRefreshEtfHoldings()
  const refreshArbitrage = useRefreshEtfArbitrage()
  const refreshAum = useRefreshEtfAum()

  const [loadingHoldings, setLoadingHoldings] = useState(false)
  const [refreshingArbitrage, setRefreshingArbitrage] = useState(false)
  const [refreshingAum, setRefreshingAum] = useState(false)
  const [notice, setNotice] = useState('')

  const payload = holdingsQuery.data?.data
  // A payload for a different ticker is the previous fund's, kept only so the page does
  // not blank between loads; every figure below reads through this guard.
  const fund = payload && payload.ticker === ticker ? payload : undefined
  const holdings = useMemo(() => fund?.holdings ?? [], [fund])
  const holdingsBusy = holdingsQuery.isFetching || loadingHoldings

  const arbitrage =
    arbitrageQuery.data?.data && arbitrageQuery.data.data.ticker === ticker
      ? arbitrageQuery.data.data
      : undefined

  useEffect(() => {
    onStatusChange(
      [
        { label: 'ETF Holdings', envelope: holdingsQuery.data, error: holdingsQuery.error, enabled: holdingsQuery.isEnabled, loading: holdingsBusy },
        {
          label: 'ETF Arbitrage',
          envelope: arbitrageQuery.data, error: arbitrageQuery.error, enabled: arbitrageQuery.isEnabled,
          loading: arbitrageQuery.isFetching || refreshingArbitrage,
        },
        { label: 'ETF AUM', envelope: aumQuery.data, error: aumQuery.error, enabled: aumQuery.isEnabled, loading: aumQuery.isFetching || refreshingAum },
      ],
      // No file behind this page, so the status bar's path slot stays empty.
      '',
    )
  }, [
    onStatusChange,
    holdingsQuery.data,
    holdingsBusy,
    arbitrageQuery.data,
    arbitrageQuery.isFetching,
    refreshingArbitrage,
    aumQuery.data,
    aumQuery.isFetching,
    refreshingAum,
  ])

  /** `_p13_load_etf`: an empty field is a warning, not a request. */
  const load = useCallback(
    async (next?: string) => {
      const symbol = (next ?? draft).trim().toUpperCase()
      if (!symbol) {
        setNotice('Enter an ETF ticker first.')
        return
      }
      setNotice('')
      setTicker(symbol)
      setLoadingHoldings(true)
      try {
        await refreshHoldings(symbol)
      } finally {
        setLoadingHoldings(false)
      }
    },
    [draft, refreshHoldings, setTicker],
  )

  /** `_p13_on_aum_etf_clicked`: fill the field, and only load when nothing is in flight. */
  const selectFromRail = useCallback(
    (symbol: string) => {
      setDraft(symbol)
      if (holdingsBusy) {
        setNotice('A holdings load is already running. Try again in a moment.')
        return
      }
      void load(symbol)
    },
    [holdingsBusy, load],
  )

  const onRefreshArbitrage = useCallback(async () => {
    if (!ticker) return
    setRefreshingArbitrage(true)
    try {
      await refreshArbitrage(ticker)
    } finally {
      setRefreshingArbitrage(false)
    }
  }, [refreshArbitrage, ticker])

  const onRefreshAum = useCallback(async () => {
    setRefreshingAum(true)
    try {
      await refreshAum()
    } finally {
      setRefreshingAum(false)
    }
  }, [refreshAum])

  /** `_p13_export_clipboard`: the *visible* rows of whichever subtab is active. */
  const copyTable = useCallback(async () => {
    if (subtab === 'arbitrage') {
      const rows = arbitrage?.rows ?? []
      if (!rows.length) {
        setNotice('No basket rows to copy. Refresh arbitrage first.')
        return
      }
      await api.writeClipboard(arbitrageClipboard(rows))
      setNotice(`Copied ${rows.length} basket rows to clipboard.`)
      return
    }
    const rows = filterHoldings(holdings, holdingsFilter)
    if (!rows.length) {
      setNotice('No holdings to copy.')
      return
    }
    await api.writeClipboard(holdingsClipboard(rows))
    setNotice(`Copied ${rows.length} holdings to clipboard.`)
  }, [arbitrage, holdings, holdingsFilter, subtab])

  const holdingsMeta = holdingsQuery.data?.meta
  const holdingsFailure =
    holdingsMeta?.freshness === 'failed' ? (holdingsMeta.failureReason ?? 'unknown error') : ''

  /** `_p13_apply_result`'s status line, across its four outcomes. */
  const status = useMemo(() => {
    if (notice) return notice
    if (!ticker) {
      return 'Enter an ETF ticker to load holdings from supported official issuer sources.'
    }
    if (holdingsBusy && !fund) {
      return `Loading ETF holdings for ${ticker} from official issuer sources...`
    }
    if (holdingsFailure) return `Failed to load ${ticker}: ${holdingsFailure}`
    if (!fund) return `Loading ETF holdings for ${ticker} from official issuer sources...`
    const note = fund.coverageNote ? ` ${fund.coverageNote}` : ''
    if (!holdings.length) {
      return `No holdings were returned by the official issuer source for ${fund.ticker}.${note}`
    }
    if (fund.isPartial) {
      return `Loaded ${holdings.length} top holdings for ${fund.ticker} via Yahoo Finance fallback. This is not the full holdings list.${note}`
    }
    return `Loaded ${holdings.length} holdings for ${fund.ticker} from ${fund.issuer}.${note}`
  }, [notice, ticker, holdingsBusy, fund, holdingsFailure, holdings.length])

  const statusClass = holdingsFailure
    ? 'text-down'
    : !fund || holdingsBusy
      ? 'text-text-muted'
      : holdings.length && !fund.isPartial
        ? 'text-up'
        : 'text-warn'

  const summary = [
    { key: 'fund', label: 'Fund', value: fund?.fundName || fund?.ticker || '--' },
    { key: 'issuer', label: 'Issuer', value: fund?.issuer || 'Unknown' },
    { key: 'asOf', label: 'As Of', value: fund?.asOfDate || '--' },
    { key: 'expense', label: 'Expense Ratio', value: fund?.expenseRatio || '--' },
    { key: 'assets', label: 'Net Assets', value: fund?.netAssets || '--' },
    { key: 'count', label: 'Holdings Loaded', value: String(holdings.length) },
  ]

  const sectorLine = fund?.sectorBreakdown.length ? sectorBreakdownText(fund.sectorBreakdown) : ''
  const copyDisabled =
    subtab === 'arbitrage' ? !(arbitrage?.rows.length ?? 0) : !holdings.length

  const arbitrageMeta = arbitrageQuery.data?.meta
  const arbitrageFailure =
    arbitrageMeta?.freshness === 'failed' ? (arbitrageMeta.failureReason ?? 'unknown error') : ''

  const aumMeta = aumQuery.data?.meta
  const aumFailure = aumMeta?.freshness === 'failed' ? (aumMeta.failureReason ?? 'unknown error') : ''

  return (
    <div className="flex min-h-0 flex-1">
      <div className={`flex min-h-0 shrink-0 flex-col ${RAIL_WIDTH}`}>
        <AumRail
          payload={aumQuery.data?.data}
          loading={aumQuery.isFetching}
          failureReason={aumFailure}
          filter={aumFilter}
          onFilterChange={setAumFilter}
          onSelect={selectFromRail}
          onRefresh={() => void onRefreshAum()}
          refreshing={refreshingAum}
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2">
        <div className="flex shrink-0 items-center gap-2">
          <h1 className="text-sm font-semibold text-text">ETF</h1>
          {fund?.sourceUrl ? (
            <button
              type="button"
              title={fund.sourceUrl}
              onClick={() => void api.openExternal(fund.sourceUrl)}
              className="no-drag ml-auto text-2xs text-accent underline"
            >
              Source
            </button>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2 border border-border bg-surface px-2 py-1">
          <span className="text-2xs text-text">ETF:</span>
          <input
            type="text"
            value={draft}
            aria-label="ETF ticker"
            title="Type an ETF ticker and press Enter to load its holdings."
            placeholder="Enter ETF ticker (e.g. SPY, QQQ, VOO)"
            // `_p13_force_upper_input`: the field is uppercase as it is typed.
            onChange={(event) => setDraft(event.target.value.toUpperCase())}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void load()
            }}
            className="no-drag h-8 w-56 border border-border-strong bg-surface-raised px-2 text-2xs text-text outline-none placeholder:text-text-dim focus:border-accent"
          />
          <Button
            variant="accent"
            onClick={() => void load()}
            disabled={holdingsBusy}
            title="Fetch the full holdings list from the official issuer source."
          >
            {holdingsBusy ? 'Loading...' : 'Load Holdings'}
          </Button>
          <Button
            onClick={() => void copyTable()}
            disabled={copyDisabled}
            title="Copy the visible rows of the active subtab to the clipboard (tab-separated)."
          >
            Copy Table
          </Button>
        </div>

        <div className="grid shrink-0 grid-cols-3 gap-x-4 gap-y-1 border border-border bg-surface px-3 py-2">
          {summary.map((cell) => (
            <p key={cell.key} className="truncate text-2xs text-text" title={cell.value}>
              <span className="text-text-muted">{cell.label}: </span>
              {cell.value}
            </p>
          ))}
        </div>

        {sectorLine ? (
          <p className="shrink-0 border border-border bg-surface px-3 py-1.5 text-2xs text-text-muted">
            <span className="font-semibold text-text">Sectors: </span>
            {sectorLine}
          </p>
        ) : null}

        <p className={`shrink-0 text-2xs ${statusClass}`}>{status}</p>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="toggle"
            active={subtab === 'holdings'}
            onClick={() => setSubtab('holdings')}
          >
            Holdings
          </Button>
          <Button
            variant="toggle"
            active={subtab === 'arbitrage'}
            onClick={() => setSubtab('arbitrage')}
          >
            Arbitrage
          </Button>
        </div>

        <DataFreshness envelope={subtab === 'holdings' ? (fund ? holdingsQuery.data : undefined) : (arbitrage ? arbitrageQuery.data : undefined)}
          loading={subtab === 'holdings' ? holdingsBusy : arbitrageQuery.isFetching || refreshingArbitrage}
          coverage={subtab === 'holdings'
            ? fund ? fund.coverageNote || `${holdings.length} holdings${fund.isPartial ? ' · partial list' : ''}` : undefined
            : arbitrage ? `${arbitrage.quoteCoverage}/${arbitrage.totalHoldings} holdings quoted` : undefined} />
        {subtab === 'holdings' ? (
          <HoldingsTab
            holdings={holdings}
            filter={holdingsFilter}
            onFilterChange={setHoldingsFilter}
            onOpenSymbol={(symbol) => onNavigate?.('charts', symbol)}
            loading={holdingsBusy}
          />
        ) : (
          <ArbitrageTab
            payload={arbitrage}
            loading={arbitrageQuery.isFetching || refreshingArbitrage}
            failureReason={arbitrageFailure}
            hasHoldings={holdings.length > 0}
            onRefresh={() => void onRefreshArbitrage()}
            onOpenSymbol={(symbol) => onNavigate?.('charts', symbol)}
          />
        )}
      </div>
    </div>
  )
}
