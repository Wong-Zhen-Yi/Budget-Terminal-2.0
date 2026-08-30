import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  ROLL_PATTERN_LABELS,
  ROLL_PATTERN_MODES,
  ROLL_PATTERN_TOOLTIPS,
  rollResultStatus,
  type RollPatternMode,
} from '@shared/roll'
import { api } from '@/api/client'
import { usePortfolio } from '@/api/queries'
import { useRoll } from '@/api/rollQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { RollChart } from '@/components/roll/RollChart'
import { RollSummary } from '@/components/roll/RollSummary'
import {
  RollCandidatesTable,
  RollHistoryTable,
  RollNewsTable,
  RollTopOptionsTable,
} from '@/components/roll/RollTables'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Panel, PanelMessage } from '@/components/ui/Panel'
import { useChartsStore } from '@/stores/charts'
import { useRollPage } from '@/stores/roll'

/**
 * Roll, ported from `mixins/random_recommender.py` (page18).
 *
 * One dice throw over the liquid US equity screen: score a sampled pool, optionally run
 * the six technical evaluators over a year of daily bars, then draw one name weighted by
 * score and load a small research workspace around it. Decision support only.
 *
 * The page has no refresh timer and requests nothing on mount, exactly as `init_page18`
 * does — every load is the Roll button or a Roll History row. The status line stands in
 * for the reference's per-stage `progress` signal, which an IPC request/response cannot
 * carry.
 */
export function RollPage({
  onStatusChange,
  onNavigate,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate: (tabId: string, symbol?: string) => void
}) {
  const patternModes = useRollPage((state) => state.patternModes)
  const indicators = useRollPage((state) => state.indicators)
  const payload = useRollPage((state) => state.payload)
  const payloads = useRollPage((state) => state.payloads)
  const history = useRollPage((state) => state.history)
  const togglePatternMode = useRollPage((state) => state.togglePatternMode)
  const setIndicators = useRollPage((state) => state.setIndicators)
  const applyRoll = useRollPage((state) => state.applyRoll)
  const revisit = useRollPage((state) => state.revisit)

  const watchlist = useChartsStore((state) => state.watchlist)
  const setWatchlist = useChartsStore((state) => state.setWatchlist)

  const [notice, setNotice] = useState('')

  // `_p18_excluded_symbols`: names already held are pushed down the ranking so a roll
  // keeps surfacing something new. `_p18_history_symbols` does the same, more gently.
  const portfolioQuery = usePortfolio()
  const excludeSymbols = useMemo(() => {
    const symbols = new Set<string>()
    for (const portfolio of portfolioQuery.data?.data.portfolios ?? []) {
      for (const ticker of Object.keys(portfolio.holdings)) symbols.add(ticker.toUpperCase())
    }
    return [...symbols]
  }, [portfolioQuery.data])
  const historySymbols = useMemo(() => history.map((row) => row.symbol), [history])

  // Read inside `openSymbol` without making the callback depend on the payload, which
  // changes on every roll.
  const currentSymbolRef = useRef('')
  currentSymbolRef.current = payload?.symbol ?? ''

  const { roll, rolling, envelope } = useRoll({
    patternModes,
    excludeSymbols,
    historySymbols,
    onPayload: applyRoll,
  })

  const status = useMemo(() => {
    if (rolling) {
      return patternModes.length ? 'Scanning patterns...' : 'Scoring candidates...'
    }
    if (envelope?.meta.freshness === 'failed') {
      return `Random roll failed: ${envelope.meta.failureReason ?? 'unknown error'}`
    }
    if (notice) return notice
    if (payload) return rollResultStatus(payload).text
    return 'Ready to roll a liquid US stock from the Yahoo screener.'
  }, [envelope, notice, patternModes.length, payload, rolling])

  useEffect(() => {
    onStatusChange([{ label: 'Roll', envelope: envelope ?? undefined, loading: rolling }], '')
  }, [envelope, onStatusChange, rolling])

  const openUrl = useCallback((url: string) => {
    if (url) void api.openExternal(url)
  }, [])

  /**
   * `_p18_open_history_item`: repaint from the cache, or re-roll that exact symbol.
   *
   * Both the Roll History rows and the Scored Candidates rows land here. The reference's
   * candidate table is selection-only, but a scored candidate is exactly the same thing a
   * history row is — a symbol the page already knows how to load — and leaving eleven of
   * the twelve ranked names inert is the one thing the panel invites you to do and cannot.
   */
  const openSymbol = useCallback(
    (symbol: string) => {
      setNotice('')
      if (!symbol || symbol === currentSymbolRef.current) return
      const cached = payloads[symbol]
      if (cached) {
        revisit(cached)
        setNotice(`Reopened ${symbol} from the roll cache.`)
        return
      }
      void roll({ targetSymbol: symbol })
    },
    [payloads, revisit, roll],
  )

  /** `_p18_save_to_charts_watchlist`. */
  const saveToCharts = useCallback(() => {
    const symbol = payload?.symbol
    if (!symbol) return
    if (watchlist.includes(symbol)) {
      setNotice(`${symbol} is already in the Charts watchlist.`)
      return
    }
    setWatchlist([...watchlist, symbol].sort())
    setNotice(`Saved ${symbol} to the Charts watchlist.`)
  }, [payload, setWatchlist, watchlist])

  const chartWarning = payload?.chartStatus || undefined
  const optionsWarning = payload?.topOptionsStatus || undefined
  const newsWarning = payload?.newsStatus || undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <h1 className="text-sm font-semibold text-text">Random Research Roll</h1>
        <Button
          variant="accent"
          onClick={() => {
            setNotice('')
            void roll()
          }}
          disabled={rolling}
          className="min-w-[110px]"
        >
          {rolling ? 'Rolling...' : 'Roll'}
        </Button>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          {ROLL_PATTERN_MODES.map((mode: RollPatternMode) => (
            <Checkbox
              key={mode}
              checked={patternModes.includes(mode)}
              onChange={(checked) => togglePatternMode(mode, checked)}
              disabled={rolling}
              label={ROLL_PATTERN_LABELS[mode]}
              title={ROLL_PATTERN_TOOLTIPS[mode]}
            />
          ))}
        </div>
      </div>

      <p className="shrink-0 truncate text-2xs text-text-muted" title={status}>
        {status}
      </p>
      <p className="shrink-0 text-2xs text-text-dim">
        Pattern filters: selected modes use OR matching; no selection uses a balanced roll.
      </p>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,1fr)_minmax(0,3fr)_minmax(0,2fr)] gap-2">
        <Panel title="Candidate">
          <RollSummary
            payload={payload}
            onOpenUrl={openUrl}
            onNavigate={(tab, symbol) => onNavigate(tab, symbol)}
            onSaveToCharts={saveToCharts}
          />
        </Panel>

        <div className="grid min-h-0 grid-rows-[2fr_3fr] gap-2">
          <Panel
            title="1Y Price Snapshot"
            warning={chartWarning}
            actions={
              <Checkbox
                checked={indicators}
                onChange={setIndicators}
                label="Indicators"
                title="Show candlesticks with daily moving averages, volume, RSI, and MACD."
              />
            }
          >
            {payload?.chart.length ? (
              <RollChart bars={payload.chart} indicators={indicators} />
            ) : (
              <PanelMessage>
                {payload?.chartStatus || 'Roll a stock to load chart history.'}
              </PanelMessage>
            )}
          </Panel>
          <Panel title="Scored Candidates">
            <RollCandidatesTable
              candidates={payload?.candidatePool ?? []}
              currentSymbol={payload?.symbol ?? ''}
              patternActive={Boolean(payload?.patternModes.length)}
              onOpen={openSymbol}
            />
          </Panel>
        </div>

        <div className="grid min-h-0 grid-rows-[2fr_3fr_2fr] gap-2">
          <Panel title="Top Options By Expiration" warning={optionsWarning}>
            <RollTopOptionsTable rows={payload?.topOptions ?? []} />
          </Panel>
          <Panel title="Recent Headlines" warning={newsWarning}>
            <RollNewsTable rows={payload?.news ?? []} onOpen={openUrl} />
          </Panel>
          <Panel title="Roll History">
            <RollHistoryTable
              rows={history}
              currentSymbol={payload?.symbol ?? ''}
              onOpen={openSymbol}
            />
          </Panel>
        </div>
      </div>
    </div>
  )
}
