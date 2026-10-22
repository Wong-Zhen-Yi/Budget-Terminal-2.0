import { mapMcpWork } from '../mcpContext.js'
import type { TechnicalScanPayload, TechnicalScanRow } from '../../shared/contract.js'
import { evaluateTechnicalBars, recentTechnicalListing } from '../../shared/technicalScreen.js'
import { sourceLiquidUniverse } from './quant.js'
import { getYahooSeries } from './series.js'

export const TECHNICAL_SOURCE = 'Yahoo Finance'
const HISTORY_DAYS = 450

/** Quant and Technical Indicators use the same cached liquid shortlist. */
export async function runTechnicalScan(): Promise<TechnicalScanPayload> {
  const universe = await sourceLiquidUniverse(false)
  if (!universe.candidates.length) throw new Error('No liquid US equities passed the universe filters.')
  const now = Date.now()
  const outcomes = await mapMcpWork(universe.candidates, (candidate) =>
    getYahooSeries({
      symbol: candidate.ticker,
      start: new Date(now - HISTORY_DAYS * 86_400_000),
      interval: '1d',
    }),
  )
  const errors: Record<string, string> = {}
  const excluded: Record<string, string> = {}
  const rows: TechnicalScanRow[] = []
  universe.candidates.forEach((candidate, index) => {
    const outcome = outcomes[index]
    if (outcome.status === 'rejected') {
      errors[candidate.ticker] = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
      return
    }
    if (outcome.value.stale) {
      errors[candidate.ticker] = 'Daily history is stale.'
      return
    }
    const bars = outcome.value.rows.flatMap((bar) =>
      bar.close === null ? [] : [{ time: bar.time, close: bar.close }],
    )
    const metrics = evaluateTechnicalBars(bars, now)
    if (!metrics) {
      const listing = (outcome.value.meta as { firstTradeDate?: unknown } | undefined)?.firstTradeDate
      const reason = recentTechnicalListing(bars, listing, now)
      if (reason) { excluded[candidate.ticker] = reason; return }
      errors[candidate.ticker] = 'Insufficient or outdated completed daily history.'
      return
    }
    rows.push({
      ticker: candidate.ticker,
      name: candidate.name,
      exchange: candidate.exchange,
      marketCap: candidate.marketCap,
      medianDollarVolume: candidate.medianDollarVolume,
      ...metrics,
    })
  })
  return {
    rows,
    universeCount: universe.candidates.length,
    scannedCount: rows.length,
    errors,
    excluded,
    sourcedAt: universe.sourcedAt,
    completedAt: new Date().toISOString(),
  }
}
