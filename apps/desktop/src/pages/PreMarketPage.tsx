import { useEffect } from 'react'

import type { Envelope } from '@shared/contract'
import { dxyNote, tnxNote } from '@shared/preMarket'
import { usePreMarket } from '@/api/preMarketQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { FearGreedPanel } from '@/components/premarket/FearGreedPanel'
import { FuturesPanel } from '@/components/premarket/FuturesPanel'
import { MacroPanel, Stat } from '@/components/premarket/MacroPanel'
import { MomentumPanel } from '@/components/premarket/MomentumPanel'
import { decimals } from '@/lib/format'
import { usePreMarketPage } from '@/stores/preMarket'

/** `+0.00`-style signs, which the reference uses on every figure on this page. */
function signed(value: number, places: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(places)}`
}

/** The dot on a panel whose feed is degraded, as the Dashboard reports one. */
function warningOf(envelope: Envelope<unknown> | undefined, block: string): string | undefined {
  if (!envelope) return undefined
  const failed = envelope.errors.find((entry) => entry.symbol === block)
  if (failed) return failed.reason
  const { freshness, failureReason } = envelope.meta
  if (freshness === 'failed') return failureReason || freshness
  return undefined
}

/**
 * The Pre-Market page, ported from `init_page14`.
 *
 * Unlike the reference it is not a scroll area ending in a stretch, so it fills the
 * window at any height instead of leaving a dead strip under the bottom row. The macro
 * row is taller than the reference's fixed 175px because each of its three right-hand
 * panels now carries a chart.
 */
export function PreMarketPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const query = usePreMarket()
  const data = query.data?.data
  const loading = query.isFetching
  const ranges = usePreMarketPage((state) => state.ranges)
  const setRange = usePreMarketPage((state) => state.setRange)

  useEffect(() => {
    onStatusChange(
      [
        { label: 'Futures', envelope: query.data, error: query.error, enabled: query.isEnabled, loading },
        { label: 'DXY', envelope: query.data, error: query.error, enabled: query.isEnabled, loading },
        { label: '10Y', envelope: query.data, error: query.error, enabled: query.isEnabled, loading },
        { label: 'VIX', envelope: query.data, error: query.error, enabled: query.isEnabled, loading },
        { label: 'Fear & Greed', envelope: query.data, error: query.error, enabled: query.isEnabled, loading },
        { label: 'Momentum', envelope: query.data, error: query.error, enabled: query.isEnabled, loading },
      ],
      '',
    )
  }, [onStatusChange, query.data, loading])

  const dxy = data?.dxy ?? null
  const tnx = data?.tnx ?? null
  const vix = data?.vix ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex min-h-0 flex-[5] gap-2">
        <FuturesPanel
          className="min-h-0 flex-[62] min-w-[20rem]"
          rows={data?.futures ?? []}
          loading={loading}
          warning={warningOf(query.data, 'Futures')}
        />

        <MacroPanel
          className="min-h-0 flex-[46] min-w-[15rem]"
          title="DXY"
          series={dxy?.series ?? null}
          color="#42a5f5"
          range={ranges.dxy}
          onRangeChange={(range) => setRange('dxy', range)}
          format={(value) => value.toFixed(1)}
          loading={loading}
          warning={warningOf(query.data, 'DXY')}
          note={dxy ? dxyNote(dxy.trend) : ''}
          stats={
            dxy ? (
              <>
                <Stat label="Level" value={decimals(dxy.level, 2)} />
                <Stat label="1d Change" value={`${signed(dxy.changePct, 2)}%`} />
                <Stat label="5d Trend" value={dxy.trend} />
              </>
            ) : null
          }
        />

        <MacroPanel
          className="min-h-0 flex-[46] min-w-[15rem]"
          title="10Y Yield"
          series={tnx?.series ?? null}
          color="#ffa726"
          range={ranges.tnx}
          onRangeChange={(range) => setRange('tnx', range)}
          format={(value) => `${value.toFixed(2)}%`}
          loading={loading}
          warning={warningOf(query.data, '10Y Yield')}
          note={tnx ? tnxNote(tnx.changeBps, tnx.vsAvg) : ''}
          stats={
            tnx ? (
              <>
                <Stat label="Yield" value={`${decimals(tnx.yield, 3)}%`} />
                <Stat label="1d Change" value={`${signed(tnx.changeBps, 1)} bps`} />
                <Stat label="vs 20d Avg" value={`${signed(tnx.vsAvg, 3)}%`} />
              </>
            ) : null
          }
        />

        <MacroPanel
          className="min-h-0 flex-[46] min-w-[15rem]"
          title="VIX"
          series={vix?.series ?? null}
          color="#c084fc"
          range={ranges.vix}
          onRangeChange={(range) => setRange('vix', range)}
          format={(value) => value.toFixed(0)}
          loading={loading}
          warning={warningOf(query.data, 'VIX')}
          stats={
            vix ? (
              <>
                <Stat label="Level" value={decimals(vix.level, 2)} />
                {/* Points, not percent — the VIX panel is the one that prints no sign unit. */}
                <Stat label="1d Change" value={signed(vix.change, 2)} />
                <Stat label="Regime" value={vix.regime} />
              </>
            ) : null
          }
        />
      </div>

      <div className="flex min-h-0 flex-[6] gap-2">
        <FearGreedPanel
          className="min-h-0 flex-1 min-w-[26rem]"
          data={data?.fearGreed ?? null}
          loading={loading}
          warning={warningOf(query.data, 'Fear & Greed')}
        />
        <MomentumPanel
          className="min-h-0 flex-1 min-w-[26rem]"
          data={data?.momentum ?? null}
          loading={loading}
          warning={warningOf(query.data, 'Market Momentum')}
        />
      </div>
    </div>
  )
}
