import type {
  ProjectionsFailure,
  ProjectionsPayload,
  ProjectionsRequest,
} from '../../shared/contract.js'
import { describeError } from '../../shared/envelope.js'
import { projectionsRange } from '../../shared/projections.js'
import { getChartsHistory } from './chartsPage.js'
import { getOptionsExpirations } from './optionsPage.js'

/**
 * The Projections page's one load, ported from `_p28_load`.
 *
 * The reference fetches a chart frame and then sweeps every live expiration's chain in
 * a single background task; this does the same, except that the two halves run
 * concurrently — the rate gate paces them either way, and the sweep is by far the
 * longer of the two, so the chart costs nothing extra in wall time.
 *
 * Both halves are already built for other pages, and both are reused rather than
 * reimplemented:
 *
 * - `getChartsHistory` gives the OHLCV bars for all eight timeframes, four-hour
 *   aggregation included.
 * - `getOptionsExpirations` gives the raw chain for every live expiration — precisely
 *   the `bucket_config` / `bucket_records` loop `_p28_load` writes by hand.
 *
 * A missing chart is not fatal. `_p28_update_view` only fails the page when the chart
 * *and* every expiration came back empty; a chart failure on its own leaves the option
 * tables on screen and drops the projections, which have no close to anchor on.
 */

export const PROJECTIONS_SOURCE = 'Yahoo Finance options'

export function emptyProjections(
  symbol: string,
  timeframe: ProjectionsRequest['timeframe'],
): ProjectionsPayload {
  return {
    symbol,
    timeframe,
    interval: '',
    candles: [],
    stats: null,
    chartError: '',
    spotPrice: 0,
    buckets: [],
    generatedAt: 0,
  }
}

export async function getProjections(
  symbol: string,
  timeframe: ProjectionsRequest['timeframe'],
  force: boolean,
): Promise<{ payload: ProjectionsPayload; failures: ProjectionsFailure[] }> {
  const failures: ProjectionsFailure[] = []

  const [chart, sweep] = await Promise.all([
    getChartsHistory({ symbol, interval: timeframe, range: projectionsRange(timeframe), force })
      .then((result) => result.payload)
      .catch((error) => {
        // `_p28_load`'s chart branch: the reason is carried into the status line rather
        // than thrown, because the option tables can still render without it.
        failures.push({ block: 'Chart', reason: describeError(error) })
        return null
      }),
    getOptionsExpirations(symbol, force),
  ])

  failures.push(...sweep.failures)

  return {
    payload: {
      symbol,
      timeframe,
      interval: chart?.interval ?? '',
      candles: chart?.candles ?? [],
      stats: chart?.stats ?? null,
      chartError: chart ? '' : failures.find((entry) => entry.block === 'Chart')?.reason ?? '',
      spotPrice: sweep.payload.spotPrice,
      buckets: sweep.payload.buckets,
      generatedAt: Date.now(),
    },
    failures,
  }
}
