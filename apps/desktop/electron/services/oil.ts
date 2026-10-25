import type {
  EnvelopeError,
  OilBlock,
  OilCurve,
  OilEiaBlock,
  OilBenchmarks,
  OilMarket,
  OilPayload,
  OilSeries,
} from '../shared/contract.js'
import {
  OIL_EIA_SOURCE,
  OIL_BENCHMARK_SPECS,
  OIL_FLOW_SPECS,
  OIL_MARKET_SOURCE,
  OIL_STOCK_SPECS,
  type OilContract,
  type OilCurveQuote,
  type OilSeriesSpec,
  buildOilCurve,
  buildOilEiaBlock,
  buildOilPayload,
  emptyOilMarket,
  oilContractSymbols,
  oilValue,
  parseEiaSeriesHtml,
  parseOpecBasketXml,
  summarizeOilSeries,
} from '../shared/oil.js'
import { localIsoSeconds } from '../shared/crypto.js'
import { describeError, err } from '../shared/envelope.js'
import { cache, TTL } from './cache.js'
import { observeSource } from './sourceHealth.js'
import { getQuote } from './yahoo/quotes.js'

export const OIL_SOURCE = 'Oil physical fundamentals'

/**
 * EIA's public `dnav` history handler. This is the keyless route: the v2 API needs a
 * registered key, and FRED retired the EIA weekly petroleum mirrors, so the HTML grid is
 * what is actually reachable without one.
 */
const EIA_SERIES_URL = 'https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s={series}&f=W'
const OPEC_BASKET_URL = 'https://www.opec.org/basket/basketDayArchives.xml'

const TIMEOUT_MS = 25_000

/**
 * Concurrent EIA downloads. Each series page carries the full history back to the 1980s at
 * roughly a quarter of a megabyte, so thirteen of them is a few megabytes per cold refresh
 * — the reason the block is cached for hours rather than minutes. There is no way to ask
 * the handler for a shorter window.
 */
const EIA_CONCURRENCY = 4

/**
 * Contracts quoted beyond the front month. Thirteen reaches a full year out, which is the
 * span the roll yield is annualised over; each one is a separate paced Yahoo request.
 */
const CURVE_MONTHS = 13

/**
 * Identify the client honestly, exactly as `services/economic.ts` does for its government
 * hosts. Do not put a browser user-agent here: eia.gov and opec.org both answer a plain
 * product token, and a spoofed one only risks the Akamai bot handling that costs FRED
 * every series on the Economic page.
 */
const HEADERS = {
  'User-Agent': 'BudgetTerminalElectron/0.1 (personal finance research tool)',
  Accept: 'text/html,application/xml,text/xml,text/plain,*/*',
}

export const OIL_BLOCK_LABELS: Record<OilBlock, string> = {
  market: 'Crude & Product Prices',
  curve: 'WTI Term Structure',
  inventories: 'EIA Weekly Inventories',
  flows: 'EIA Weekly Supply & Demand',
  benchmarks: 'EIA Price Assessments',
}

async function fetchText(url: string): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (response.ok) return response.text()
    if (attempt === 0 && [500, 502, 503, 504].includes(response.status)) {
      await response.body?.cancel()
      await new Promise(resolve => setTimeout(resolve, 250))
      continue
    }
    throw new Error(`HTTP ${response.status} from ${url}`)
  }
  throw new Error(`Could not download ${url}`)
}

interface Lane<T> {
  value: T | null
  warning: unknown | null
}

/** Fresh cache -> network -> stale cache, keeping a refresh failure visible in the envelope. */
async function lane<T>(key: string, ttlMs: number, force: boolean, load: () => Promise<T>): Promise<Lane<T>> {
  try {
    const result = await cache.resolve(key, ttlMs, load, { force })
    return { value: result.value, warning: null }
  } catch (error) {
    const stale = cache.get<T>(key, { allowStale: true, observe: true })
    return { value: stale?.value ?? null, warning: error }
  }
}

/** Run `worker` over `items` with at most `limit` in flight, preserving input order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const runners = Array.from({ length: Math.max(Math.min(limit, items.length), 1) }, async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await worker(items[index])
    }
  })
  await Promise.all(runners)
  return results
}

export function eiaSeriesUrl(seriesId: string): string {
  return EIA_SERIES_URL.replace('{series}', seriesId)
}

/**
 * Download one EIA block's series.
 *
 * A series that fails is dropped rather than failing the block: losing Cushing costs one
 * row, and the block is only reported unavailable when nothing at all came back.
 */
async function fetchEiaBlock(specs: readonly OilSeriesSpec[]): Promise<OilEiaBlock> {
  let releaseDate: string | null = null
  let nextReleaseDate: string | null = null

  const results = await mapLimit(specs, EIA_CONCURRENCY, async (spec): Promise<OilSeries | null> => {
    try {
      const parsed = parseEiaSeriesHtml(await fetchText(eiaSeriesUrl(spec.eiaId)))
      if (!parsed) throw new Error(`No usable EIA observations for ${spec.eiaId}`)
      releaseDate ??= parsed.releaseDate
      nextReleaseDate ??= parsed.nextReleaseDate
      // The page's own parenthetical unit wins over the spec: it is what EIA actually
      // published, and a series that changes its reporting basis must not keep an old label.
      return summarizeOilSeries({ ...spec, unit: parsed.unit }, parsed.points)
    } catch (error) {
      observeSource({ fetchedAt: Date.now(), stale: false, fromCache: false,
        failures: [`EIA ${spec.eiaId}: ${describeError(error)}`] })
      return null
    }
  })

  const block = buildOilEiaBlock(
    results.filter((entry): entry is OilSeries => entry !== null),
    eiaSeriesUrl(specs[0]?.eiaId ?? ''),
    releaseDate,
    nextReleaseDate,
  )
  if (!block) throw new Error('No EIA weekly series could be read.')
  return block
}

/**
 * Fetch EIA's price assessments, with the OPEC basket alongside when it answers.
 *
 * opec.org sits behind a Cloudflare rule that refuses this client outright — the same
 * situation `services/ipo.ts` documents for stockanalysis.com, and no attempt is made to
 * work around it. The basket is therefore optional inside this lane rather than a lane of
 * its own: losing it costs two rows, and the EIA half of the panel stands up without it.
 */
async function fetchBenchmarks(): Promise<OilBenchmarks> {
  const [prices, opec] = await Promise.allSettled([
    fetchEiaBlock(OIL_BENCHMARK_SPECS),
    fetchText(OPEC_BASKET_URL).then((xml) => parseOpecBasketXml(xml, OPEC_BASKET_URL)),
  ])
  if (prices.status === 'rejected') throw prices.reason
  return { prices: prices.value, opec: opec.status === 'fulfilled' ? opec.value : null }
}

async function fetchMarket(force: boolean, fetchedAt: string): Promise<OilMarket> {
  const symbols = ['CL=F', 'BZ=F', 'RB=F', 'HO=F'] as const
  const [wti, brent, gasoline, diesel] = await Promise.allSettled(
    symbols.map((symbol) => getQuote(symbol, force)),
  )
  const market = emptyOilMarket()
  if (wti.status === 'fulfilled') {
    market.wtiPrice = oilValue(wti.value.price, 'usdPerBbl', fetchedAt, OIL_MARKET_SOURCE, 'live', 'NYMEX light sweet crude front month (CL=F).')
    market.wtiChangePct = oilValue(wti.value.change, 'percent', fetchedAt, OIL_MARKET_SOURCE, 'live')
  }
  if (brent.status === 'fulfilled') {
    market.brentPrice = oilValue(brent.value.price, 'usdPerBbl', fetchedAt, OIL_MARKET_SOURCE, 'live', 'ICE Brent front month (BZ=F).')
    market.brentChangePct = oilValue(brent.value.change, 'percent', fetchedAt, OIL_MARKET_SOURCE, 'live')
  }
  if (gasoline.status === 'fulfilled') {
    market.gasolinePrice = oilValue(gasoline.value.price, 'usdPerGal', fetchedAt, OIL_MARKET_SOURCE, 'live', 'RBOB gasoline front month (RB=F), in dollars per gallon.')
    market.gasolineChangePct = oilValue(gasoline.value.change, 'percent', fetchedAt, OIL_MARKET_SOURCE, 'live')
  }
  if (diesel.status === 'fulfilled') {
    market.dieselPrice = oilValue(diesel.value.price, 'usdPerGal', fetchedAt, OIL_MARKET_SOURCE, 'live', 'NY Harbor ULSD front month (HO=F), in dollars per gallon.')
    market.dieselChangePct = oilValue(diesel.value.change, 'percent', fetchedAt, OIL_MARKET_SOURCE, 'live')
  }
  if (symbols.every((_symbol, index) => [wti, brent, gasoline, diesel][index].status === 'rejected')) {
    throw new Error('No crude or product quote was returned.')
  }
  return market
}

/**
 * Quote the dated strip.
 *
 * `CL=F` supplies the front month, so only the deferred contracts are requested; a month
 * that does not answer is dropped rather than failing the curve, because the shape is read
 * from whatever contiguous strip came back.
 */
async function fetchCurve(
  force: boolean,
  fetchedAt: string,
  front: number | null,
  contracts: OilContract[],
  loadQuote: typeof getQuote = getQuote,
): Promise<OilCurve> {
  const quoted = await Promise.allSettled(contracts.map((contract) => loadQuote(contract.symbol, force)))
  const strip: OilCurveQuote[] = contracts.map((contract, index) => {
    const result = quoted[index]
    return {
      ...contract,
      price: result.status === 'fulfilled' && Number.isFinite(result.value.price) ? result.value.price : null,
    }
  })
  if (front !== null && Number.isFinite(front)) {
    strip.unshift({ symbol: 'CL=F', label: 'Front', monthsOut: 0, price: front })
  }
  const curve = buildOilCurve(strip, fetchedAt)
  if (!curve) throw new Error('Fewer than two WTI contract months answered.')
  return curve
}

export interface OilFetchResult {
  payload: OilPayload
  errors: EnvelopeError[]
}

export async function getOil(force = false): Promise<OilFetchResult> {
  const fetchedAt = localIsoSeconds()

  // The curve needs the front-month price the market lane already fetches, so those two
  // run in sequence while the three document lanes run alongside them.
  const [market, inventories, flows, benchmarks] = await Promise.all([
    lane('oil:market', TTL.oilMarket, force, () => fetchMarket(force, fetchedAt)),
    lane('oil:inventories', TTL.oilEia, force, () => fetchEiaBlock(OIL_STOCK_SPECS)),
    lane('oil:flows', TTL.oilEia, force, () => fetchEiaBlock(OIL_FLOW_SPECS)),
    lane('oil:benchmarks', TTL.oilOpec, force, fetchBenchmarks),
  ])
  const contracts = oilContractSymbols(new Date(), CURVE_MONTHS)
  // Expiry rolls invalidate the old strip immediately, including persisted snapshots
  // that captured a now-expired contract failure under the legacy oil:curve key.
  const curve = await lane(`oil:curve:v2:${contracts[0].symbol}`, TTL.oilCurve, force, () =>
    fetchCurve(force, fetchedAt, market.value?.wtiPrice.value ?? null, contracts),
  )

  const errors: EnvelopeError[] = []
  const record = (block: OilBlock, source: string, warning: unknown): void => {
    if (warning === null) return
    errors.push(err(source, describeError(warning), `oil-${block}`, OIL_BLOCK_LABELS[block]))
  }
  record('market', OIL_MARKET_SOURCE, market.warning)
  record('curve', OIL_MARKET_SOURCE, curve.warning)
  record('inventories', OIL_EIA_SOURCE, inventories.warning)
  record('flows', OIL_EIA_SOURCE, flows.warning)
  record('benchmarks', OIL_EIA_SOURCE, benchmarks.warning)

  return {
    payload: buildOilPayload({
      fetchedAt,
      market: market.value ?? emptyOilMarket(),
      curve: curve.value,
      inventories: inventories.value,
      flows: flows.value,
      benchmarks: benchmarks.value,
    }),
    errors,
  }
}

export const oilTesting = {
  fetchText,
  fetchEiaBlock,
  fetchCurve,
  CURVE_MONTHS,
  EIA_CONCURRENCY,
  EIA_SERIES_URL,
  HEADERS,
  OPEC_BASKET_URL,
  TIMEOUT_MS,
}
