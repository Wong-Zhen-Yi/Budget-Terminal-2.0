import type {
  OilBlock,
  OilBenchmarkKey,
  OilBenchmarks,
  OilBlockStatus,
  OilCurve,
  OilCurvePoint,
  OilCurveShape,
  OilDerived,
  OilEiaBlock,
  OilFlowKey,
  OilMarket,
  OilOpec,
  OilPayload,
  OilPoint,
  OilSeries,
  OilSeriesKey,
  OilStockKey,
  OilUnit,
  OilValue,
} from './contract.js'
import { OIL_BENCHMARK_KEYS, OIL_FLOW_KEYS, OIL_STOCK_KEYS } from './contract.js'
import { buildMarketHolidays } from './calendar.js'

export const OIL_EIA_SOURCE = 'U.S. Energy Information Administration'
export const OIL_OPEC_SOURCE = 'OPEC Secretariat'
export const OIL_MARKET_SOURCE = 'Yahoo Finance'

/** Gallons in a barrel — the constant that makes a $/gal product quote comparable to WTI. */
export const GALLONS_PER_BARREL = 42

/**
 * Weekly observations either side of the anniversary that still count as the same week.
 *
 * The comparison is done on dates rather than on `index - 52`, for the reason
 * `services/economic.ts` documents: index arithmetic breaks the moment a series has a
 * reporting gap, and EIA shifts a holiday release by a day. Half a week is the widest
 * tolerance that cannot pair an observation with its neighbour instead.
 */
const WEEK_TOLERANCE_DAYS = 4

/** Years averaged for the five-year band. EIA's own published comparison uses exactly five. */
const FIVE_YEAR_WINDOW = 5

/** Percent move front-to-back below which the strip is reported as flat rather than either way. */
const CURVE_FLAT_BAND_PCT = 0.5

const MONTH_CODES = 'FGHJKMNQUVXZ'
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export interface OilSeriesSpec {
  key: OilSeriesKey
  /** EIA's own series id, as used by the public `dnav` history handler. */
  eiaId: string
  label: string
  unit: OilUnit
}

export const OIL_STOCK_SPECS: ReadonlyArray<OilSeriesSpec & { key: OilStockKey }> = [
  { key: 'crude', eiaId: 'WCESTUS1', label: 'Crude oil (ex-SPR)', unit: 'kb' },
  { key: 'spr', eiaId: 'WCSSTUS1', label: 'Strategic Petroleum Reserve', unit: 'kb' },
  { key: 'cushing', eiaId: 'W_EPC0_SAX_YCUOK_MBBL', label: 'Cushing, OK', unit: 'kb' },
  { key: 'gasoline', eiaId: 'WGTSTUS1', label: 'Total gasoline', unit: 'kb' },
  { key: 'distillate', eiaId: 'WDISTUS1', label: 'Distillate fuel oil', unit: 'kb' },
  { key: 'totalPetroleum', eiaId: 'WTTSTUS1', label: 'Crude and products', unit: 'kb' },
]

/**
 * EIA's own price assessments, which are a different thing from the futures quotes on the
 * market strip: a survey of physical transactions rather than an exchange settlement. The
 * two retail series are the pump end of the same barrel and carry the same weekly cadence,
 * so they summarize through exactly the same path.
 */
export const OIL_BENCHMARK_SPECS: ReadonlyArray<OilSeriesSpec & { key: OilBenchmarkKey }> = [
  { key: 'wtiSpot', eiaId: 'RWTC', label: 'WTI spot (Cushing)', unit: 'usdPerBbl' },
  { key: 'brentSpot', eiaId: 'RBRTE', label: 'Brent spot (Europe)', unit: 'usdPerBbl' },
  { key: 'retailGasoline', eiaId: 'EMM_EPM0_PTE_NUS_DPG', label: 'Retail gasoline', unit: 'usdPerGal' },
  { key: 'retailDiesel', eiaId: 'EMD_EPD2DXL0_PTE_NUS_DPG', label: 'Retail diesel (ULSD)', unit: 'usdPerGal' },
]

export const OIL_FLOW_SPECS: ReadonlyArray<OilSeriesSpec & { key: OilFlowKey }> = [
  { key: 'production', eiaId: 'WCRFPUS2', label: 'Field production', unit: 'kbd' },
  { key: 'netImports', eiaId: 'WCRNTUS2', label: 'Net crude imports', unit: 'kbd' },
  { key: 'exports', eiaId: 'WCREXUS2', label: 'Crude exports', unit: 'kbd' },
  { key: 'refinerInput', eiaId: 'WCRRIUS2', label: 'Refiner crude input', unit: 'kbd' },
  { key: 'utilization', eiaId: 'WPULEUS3', label: 'Refinery utilization', unit: 'percent' },
  { key: 'productSupplied', eiaId: 'WRPUPUS2', label: 'Products supplied', unit: 'kbd' },
  { key: 'gasolineSupplied', eiaId: 'WGFUPUS2', label: 'Gasoline supplied', unit: 'kbd' },
]

/* ------------------------------------------------------------------ values */

export function oilValue(
  value: number | null,
  unit: OilUnit,
  asOf: string,
  source: string,
  frequency: OilValue['frequency'],
  note?: string,
): OilValue {
  return { value: value !== null && Number.isFinite(value) ? value : null, unit, asOf, source, frequency, note }
}

/**
 * Coerce a possibly-absent number without letting `null` become a real zero.
 *
 * `Number(null)` and `Number('')` are both 0, the hazard `shared/valuation.ts` and
 * `services/economic.ts` document: an absent inventory print rendered as a genuine zero
 * would show up as an empty tank rather than as missing data.
 */
export function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/* ------------------------------------------------------------------- dates */

const DAY_MS = 24 * 60 * 60_000

function utcDay(iso: string): number | null {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const stamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isFinite(stamp) ? Math.round(stamp / DAY_MS) : null
}

function isoOf(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Shift an ISO date by whole years, clamping 29 February onto the 28th.
 *
 * `Date.UTC(y - 1, 1, 29)` silently rolls into March, which would move the anniversary
 * outside the tolerance window and drop a year out of the five-year mean.
 */
export function shiftIsoYears(iso: string, years: number): string | null {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1]) + years
  const month = Number(match[2])
  const day = Number(match[3])
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return isoOf(year, month, Math.min(day, last))
}

/** The observation closest to `targetIso`, or `null` when the nearest is outside tolerance. */
export function nearestPoint(
  points: readonly OilPoint[],
  targetIso: string,
  toleranceDays = WEEK_TOLERANCE_DAYS,
): OilPoint | null {
  const target = utcDay(targetIso)
  if (target === null) return null
  let best: OilPoint | null = null
  let bestGap = Number.POSITIVE_INFINITY
  for (const point of points) {
    const day = utcDay(point.date)
    if (day === null) continue
    const gap = Math.abs(day - target)
    if (gap < bestGap) {
      best = point
      bestGap = gap
    }
  }
  return best !== null && bestGap <= toleranceDays ? best : null
}

/* -------------------------------------------------------------- EIA parsing */

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
}

export function oilPlainText(html: string): string {
  const withoutCode = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  return decodeHtml(withoutCode.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function cellText(html: string): string {
  return decodeHtml(html.replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Read one EIA data cell.
 *
 * The grid marks an absent observation four different ways — `-` for none reported, `--`
 * for not applicable, `NA` for not available and `W` for withheld to avoid disclosing an
 * individual company — and every one of them has to become `null` rather than a number.
 */
function eiaNumber(value: string): number | null {
  const clean = value.replace(/[−–—]/g, '-').replace(/,/g, '').trim()
  if (!clean || /^(?:-{1,2}|NA|W)$/i.test(clean)) return null
  const parsed = Number(clean.replace(/^\((.+)\)$/, '-$1'))
  return Number.isFinite(parsed) ? parsed : null
}

const MONTH_INDEX = new Map(MONTH_NAMES.map((name, index) => [name.toLowerCase(), index + 1]))

/**
 * Read the unit out of the title's trailing parenthetical.
 *
 * The dollar tests come first: `Dollars per Barrel` also matches `barrel`, and reading a
 * $/bbl spot assessment as thousand barrels of inventory would print a crude price as a
 * stock level.
 */
function unitFromTitle(title: string): OilUnit {
  const parenthetical = title.match(/\(([^)]+)\)\s*$/)?.[1] ?? ''
  if (/dollars per barrel/i.test(parenthetical)) return 'usdPerBbl'
  if (/dollars per gallon/i.test(parenthetical)) return 'usdPerGal'
  if (/per day/i.test(parenthetical)) return 'kbd'
  if (/percent/i.test(parenthetical)) return 'percent'
  if (/barrel/i.test(parenthetical)) return 'kb'
  return 'kb'
}

function usDate(value: string | undefined): string | null {
  const match = value?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return match ? isoOf(Number(match[3]), Number(match[1]), Number(match[2])) : null
}

export interface ParsedEiaSeries {
  title: string
  unit: OilUnit
  releaseDate: string | null
  nextReleaseDate: string | null
  points: OilPoint[]
}

/**
 * Parse EIA's public `dnav` history page into ascending `(iso_date, value)` pairs.
 *
 * The page is a `Year-Month` x `Week n` grid whose cells hold a bare `MM/DD`, so the year
 * comes from the row label rather than the cell. A week ending on 31 December can be filed
 * under the following January (and 1 January under the preceding December), which is why
 * the year is nudged when the cell's month and the row's month sit on opposite sides of the
 * turn — without that a single observation lands a whole year away and poisons both the
 * year-ago and the five-year comparisons.
 */
export function parseEiaSeriesHtml(html: string): ParsedEiaSeries | null {
  const title = decodeHtml(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!title) return null

  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map((match) => match[0])
  const grid = tables.find((entry) => /Year-Month/i.test(entry))
  if (!grid) return null

  const rows = [...grid.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) =>
    [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => cellText(cell[1])),
  )

  const points: OilPoint[] = []
  for (const row of rows) {
    const stamp = row[0]?.match(/^(\d{4})-([A-Za-z]{3})$/)
    if (!stamp) continue
    const rowYear = Number(stamp[1])
    const rowMonth = MONTH_INDEX.get(stamp[2].toLowerCase())
    if (!rowMonth) continue
    for (let index = 1; index + 1 < row.length; index += 2) {
      const day = row[index].match(/^(\d{1,2})\/(\d{1,2})$/)
      if (!day) continue
      const value = eiaNumber(row[index + 1])
      if (value === null) continue
      const month = Number(day[1])
      const year = month === 12 && rowMonth === 1 ? rowYear - 1 : month === 1 && rowMonth === 12 ? rowYear + 1 : rowYear
      points.push({ date: isoOf(year, month, Number(day[2])), value })
    }
  }
  if (!points.length) return null
  points.sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0))

  // `Next Release Date:` contains `Release Date:`, so both stamps are collected in one
  // pass and told apart by the captured prefix rather than by two competing patterns.
  const text = oilPlainText(html)
  let releaseDate: string | null = null
  let nextReleaseDate: string | null = null
  for (const match of text.matchAll(/(Next\s+)?Release Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/gi)) {
    const stampIso = usDate(match[2])
    if (match[1]) nextReleaseDate ??= stampIso
    else releaseDate ??= stampIso
  }

  return { title, unit: unitFromTitle(title), releaseDate, nextReleaseDate, points }
}

/**
 * Reduce one weekly series to the comparisons the page prints.
 *
 * The five-year mean is `null` unless all five anniversaries are present: averaging three
 * of them under a label that says five would misstate the single most-watched number on
 * the page.
 */
export function summarizeOilSeries(spec: OilSeriesSpec, points: readonly OilPoint[]): OilSeries {
  const history = [...points]
  const latest = history.at(-1) ?? null
  const previous = history.at(-2) ?? null
  const yearAgo = latest ? nearestPoint(history, shiftIsoYears(latest.date, -1) ?? '') : null

  let fiveYearAverage: number | null = null
  if (latest) {
    const priors: number[] = []
    for (let back = 1; back <= FIVE_YEAR_WINDOW; back += 1) {
      const anniversary = shiftIsoYears(latest.date, -back)
      const match = anniversary ? nearestPoint(history, anniversary) : null
      if (match) priors.push(match.value)
    }
    if (priors.length === FIVE_YEAR_WINDOW) {
      fiveYearAverage = priors.reduce((sum, value) => sum + value, 0) / FIVE_YEAR_WINDOW
    }
  }

  return {
    key: spec.key,
    label: spec.label,
    unit: spec.unit,
    asOf: latest?.date ?? '',
    latest: latest?.value ?? null,
    weekChange: latest && previous ? latest.value - previous.value : null,
    yearAgo: yearAgo?.value ?? null,
    fiveYearAverage,
    deviationPct:
      latest && fiveYearAverage ? ((latest.value - fiveYearAverage) / fiveYearAverage) * 100 : null,
    history,
  }
}

export function buildOilEiaBlock(
  series: OilSeries[],
  sourceUrl: string,
  releaseDate: string | null,
  nextReleaseDate: string | null,
): OilEiaBlock | null {
  const loaded = series.filter((entry) => entry.latest !== null)
  if (!loaded.length) return null
  const asOf = loaded.map((entry) => entry.asOf).sort().at(-1) ?? ''
  return { asOf, source: OIL_EIA_SOURCE, sourceUrl, releaseDate, nextReleaseDate, series }
}

/* ------------------------------------------------------------ OPEC parsing */

/**
 * Parse OPEC's public daily basket archive.
 *
 * The document is a flat list of `<BasketList data="YYYY-MM-DD" val="95.32"/>` elements;
 * only the attributes are read, so a change to the surrounding element names cannot break
 * it. The basket is a settlement average of member crudes, not a traded instrument, which
 * is why it is labelled `daily` and never mixed into a live quote.
 */
export function parseOpecBasketXml(xml: string, sourceUrl: string): OilOpec | null {
  const points: OilPoint[] = []
  for (const match of xml.matchAll(/<BasketList\b[^>]*\bdata="([^"]+)"[^>]*\bval="([^"]*)"/gi)) {
    const date = match[1].trim()
    const value = finiteOrNull(match[2].trim())
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || value === null) continue
    points.push({ date, value })
  }
  if (!points.length) return null
  points.sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0))

  const latest = points[points.length - 1]
  const previous = points[points.length - 2] ?? null
  const month = latest.date.slice(0, 7)
  const inMonth = points.filter((point) => point.date.startsWith(month))
  const average = inMonth.length
    ? inMonth.reduce((sum, point) => sum + point.value, 0) / inMonth.length
    : null

  return {
    asOf: latest.date,
    source: OIL_OPEC_SOURCE,
    sourceUrl,
    basketPrice: oilValue(latest.value, 'usdPerBbl', latest.date, OIL_OPEC_SOURCE, 'daily', 'OPEC Reference Basket: a settlement average of member crudes, not a traded contract.'),
    dayChange: oilValue(previous ? latest.value - previous.value : null, 'usdPerBbl', latest.date, OIL_OPEC_SOURCE, 'daily'),
    monthAverage: oilValue(average, 'usdPerBbl', month, OIL_OPEC_SOURCE, 'daily', `Mean of the ${inMonth.length} published sessions so far in ${month}.`),
    history: points,
  }
}

/* -------------------------------------------------------------- the strip */

export interface OilContract {
  symbol: string
  label: string
  monthsOut: number
}

/**
 * WTI trading ends at 14:30 New York time, three business days before the 25th
 * of the month preceding delivery (or before the business day preceding a closed
 * 25th). Do not request expired months or duplicate CL=F's front delivery month.
 * https://www.cmegroup.com/markets/energy/crude-oil/light-sweet-crude.contractSpecs.html
 */
export function oilContractSymbols(from: Date, count: number): OilContract[] {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(from).map(part => [part.type, part.value]))
  const year = Number(parts.year)
  const monthIndex = Number(parts.month) - 1
  const holidays = new Set(buildMarketHolidays(year).filter(day => day.detail === 'Closed all day').map(day => day.date))
  const isBusinessDay = (date: Date) => ![0, 6].includes(date.getUTCDay()) && !holidays.has(date.toISOString().slice(0, 10))
  const expiry = new Date(Date.UTC(year, monthIndex, 25))
  while (!isBusinessDay(expiry)) expiry.setUTCDate(expiry.getUTCDate() - 1)
  for (let left = 3; left > 0;) {
    expiry.setUTCDate(expiry.getUTCDate() - 1)
    if (isBusinessDay(expiry)) left--
  }
  const day = Number(parts.day)
  const rolled = day > expiry.getUTCDate() || (day === expiry.getUTCDate() && Number(parts.hour) * 60 + Number(parts.minute) >= 14 * 60 + 30)
  const frontMonth = monthIndex + (rolled ? 2 : 1)
  const contracts: OilContract[] = []
  for (let step = 1; step <= count; step += 1) {
    const month = new Date(Date.UTC(year, frontMonth + step, 1))
    const deliveryYear = String(month.getUTCFullYear() % 100).padStart(2, '0')
    const index = month.getUTCMonth()
    contracts.push({
      symbol: `CL${MONTH_CODES[index]}${deliveryYear}.NYM`,
      label: `${MONTH_NAMES[index]} ${deliveryYear}`,
      monthsOut: step,
    })
  }
  return contracts
}

export function oilCurveShape(frontPrice: number, backPrice: number): OilCurveShape {
  const movePct = ((backPrice - frontPrice) / frontPrice) * 100
  if (movePct <= -CURVE_FLAT_BAND_PCT) return 'backwardation'
  if (movePct >= CURVE_FLAT_BAND_PCT) return 'contango'
  return 'flat'
}

export interface OilCurveQuote {
  symbol: string
  label: string
  monthsOut: number
  price: number | null
}

/**
 * Build the WTI term structure from the quoted strip.
 *
 * The shape is read front-to-back rather than off adjacent months: a single illiquid
 * contract can invert one step of an otherwise clean curve, and the question the panel
 * answers — is the market paying to hold barrels now, or later — is about the whole strip.
 */
export function buildOilCurve(quotes: readonly OilCurveQuote[], asOf: string): OilCurve | null {
  const points: OilCurvePoint[] = quotes
    .filter((quote): quote is OilCurveQuote & { price: number } => quote.price !== null && quote.price > 0)
    .sort((left, right) => left.monthsOut - right.monthsOut)
    .map((quote) => ({
      symbol: quote.symbol,
      label: quote.label,
      monthsOut: quote.monthsOut,
      price: quote.price,
      premiumPct: null,
    }))
  if (points.length < 2) return null

  const front = points[0]
  const back = points[points.length - 1]
  for (const point of points) {
    point.premiumPct = point.monthsOut === front.monthsOut ? null : ((point.price - front.price) / front.price) * 100
  }

  const span = back.monthsOut - front.monthsOut
  return {
    asOf,
    source: OIL_MARKET_SOURCE,
    shape: oilCurveShape(front.price, back.price),
    points,
    frontPrice: oilValue(front.price, 'usdPerBbl', asOf, OIL_MARKET_SOURCE, 'live', `Front quoted contract: ${front.symbol}.`),
    frontToBackSpread: oilValue(front.price - back.price, 'usdPerBbl', asOf, OIL_MARKET_SOURCE, 'live', `${front.label} minus ${back.label}; positive is backwardation.`),
    annualisedRollYield: oilValue(
      span > 0 ? ((front.price - back.price) / back.price) * (12 / span) * 100 : null,
      'percent',
      asOf,
      OIL_MARKET_SOURCE,
      'derived',
      `Front-to-back spread over ${span} month(s), annualised. Positive is a roll gain to a long holder.`,
    ),
  }
}

/* ----------------------------------------------------------------- derived */

/**
 * The 3-2-1 crack spread in dollars per barrel: three barrels of crude into two of
 * gasoline and one of distillate.
 *
 * RBOB and ULSD are quoted in dollars per gallon and WTI in dollars per barrel, so the
 * products are converted at 42 gallons before the subtraction. Dropping that factor makes
 * the refining margin read as roughly minus the crude price.
 */
export function crackSpread321(
  wtiPerBarrel: number | null,
  gasolinePerGallon: number | null,
  dieselPerGallon: number | null,
): number | null {
  if (wtiPerBarrel === null || gasolinePerGallon === null || dieselPerGallon === null) return null
  const products = (2 * gasolinePerGallon + dieselPerGallon) * GALLONS_PER_BARREL
  return (products - 3 * wtiPerBarrel) / 3
}

export function emptyOilMarket(): OilMarket {
  const empty = (unit: OilUnit): OilValue => oilValue(null, unit, '', OIL_MARKET_SOURCE, 'live')
  return {
    wtiPrice: empty('usdPerBbl'),
    wtiChangePct: empty('percent'),
    brentPrice: empty('usdPerBbl'),
    brentChangePct: empty('percent'),
    gasolinePrice: empty('usdPerGal'),
    gasolineChangePct: empty('percent'),
    dieselPrice: empty('usdPerGal'),
    dieselChangePct: empty('percent'),
  }
}

export interface OilBuildInput {
  fetchedAt: string
  market: OilMarket
  curve: OilCurve | null
  inventories: OilEiaBlock | null
  flows: OilEiaBlock | null
  benchmarks: OilBenchmarks | null
}

function seriesOf(block: OilEiaBlock | null | undefined, key: OilSeriesKey): OilSeries | null {
  return block?.series.find((entry) => entry.key === key) ?? null
}

function buildDerived(input: OilBuildInput): OilDerived {
  const { market } = input
  const crude = seriesOf(input.inventories, 'crude')
  const refinerInput = seriesOf(input.flows, 'refinerInput')

  const marketStamp = market.wtiPrice.asOf
  const spread =
    market.brentPrice.value !== null && market.wtiPrice.value !== null
      ? market.brentPrice.value - market.wtiPrice.value
      : null

  // Commercial crude in thousand barrels over refiner crude runs in thousand barrels a
  // day: the units cancel to days of cover. Both are EIA weekly prints, but a holiday can
  // leave one series a week behind the other, so the stamp names both dates.
  const cover =
    crude?.latest !== null && crude?.latest !== undefined && refinerInput?.latest
      ? crude.latest / refinerInput.latest
      : null

  const basket = input.benchmarks?.opec?.basketPrice.value ?? null
  const basketSpread = basket !== null && market.brentPrice.value !== null ? basket - market.brentPrice.value : null

  const wtiSpot = seriesOf(input.benchmarks?.prices, 'wtiSpot')
  const spotBasis =
    wtiSpot?.latest !== null && wtiSpot?.latest !== undefined && market.wtiPrice.value !== null
      ? wtiSpot.latest - market.wtiPrice.value
      : null

  return {
    brentWtiSpread: oilValue(spread, 'usdPerBbl', marketStamp, OIL_MARKET_SOURCE, 'live', 'Brent minus WTI front month.'),
    crackSpread321: oilValue(
      crackSpread321(market.wtiPrice.value, market.gasolinePrice.value, market.dieselPrice.value),
      'usdPerBbl',
      marketStamp,
      OIL_MARKET_SOURCE,
      'derived',
      '(2 x RBOB + 1 x ULSD) x 42 gal, less 3 x WTI, over 3. A gross refining margin, before any operating cost.',
    ),
    daysOfSupply: oilValue(
      cover,
      'days',
      [crude?.asOf, refinerInput?.asOf].filter(Boolean).join(' / '),
      OIL_EIA_SOURCE,
      'derived',
      'Commercial crude stocks over refiner crude runs. Excludes the SPR, which is not available to refiners on demand.',
    ),
    basketToBrent: oilValue(
      basketSpread,
      'usdPerBbl',
      [input.benchmarks?.opec?.asOf, marketStamp].filter(Boolean).join(' / '),
      `${OIL_OPEC_SOURCE} x ${OIL_MARKET_SOURCE}`,
      'derived',
      'OPEC basket settlement against a live Brent quote: the two are struck at different moments and the gap is not a tradeable spread.',
    ),
    spotVsFutures: oilValue(
      spotBasis,
      'usdPerBbl',
      [wtiSpot?.asOf, marketStamp].filter(Boolean).join(' / '),
      `${OIL_EIA_SOURCE} x ${OIL_MARKET_SOURCE}`,
      'derived',
      "EIA's weekly Cushing spot assessment less the live front-month future. A survey week against a live tick, so this is a staleness check rather than a tradeable basis.",
    ),
    crudeVsFiveYear: oilValue(
      crude?.deviationPct ?? null,
      'percent',
      crude?.asOf ?? '',
      OIL_EIA_SOURCE,
      'derived',
      'Commercial crude stocks against the mean of the same week over the five preceding years.',
    ),
  }
}

export function buildOilPayload(input: OilBuildInput): OilPayload {
  const progress = Object.fromEntries(
    [
      ['market', Object.values(input.market).some((metric) => metric.value !== null)],
      ['curve', input.curve !== null],
      ['inventories', input.inventories !== null],
      ['flows', input.flows !== null],
      ['benchmarks', input.benchmarks !== null],
    ].map(([block, loaded]) => [block, loaded ? 'loaded' : 'unavailable']),
  ) as Record<OilBlock, OilBlockStatus>

  return {
    fetchedAt: input.fetchedAt,
    market: input.market,
    curve: input.curve,
    inventories: input.inventories,
    flows: input.flows,
    benchmarks: input.benchmarks,
    derived: buildDerived(input),
    progress,
  }
}

export function emptyOilPayload(fetchedAt = ''): OilPayload {
  return buildOilPayload({
    fetchedAt,
    market: emptyOilMarket(),
    curve: null,
    inventories: null,
    flows: null,
    benchmarks: null,
  })
}

/* ---------------------------------------------------------------- snapshot */

function snapshotLine(label: string, metric: OilValue): string {
  const value = metric.value === null ? '--' : metric.value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return `${label}: ${value} ${metric.unit} · ${metric.asOf || 'date unavailable'} · ${metric.source}`
}

export function buildOilSnapshot(payload: OilPayload): string {
  const crude = seriesOf(payload.inventories, 'crude')
  const production = seriesOf(payload.flows, 'production')
  const spot = seriesOf(payload.benchmarks?.prices ?? null, 'wtiSpot')
  const pump = seriesOf(payload.benchmarks?.prices ?? null, 'retailGasoline')
  return [
    'OIL — PHYSICAL FUNDAMENTALS',
    `Fetched: ${payload.fetchedAt || '--'}`,
    snapshotLine('WTI front month', payload.market.wtiPrice),
    snapshotLine('Brent front month', payload.market.brentPrice),
    snapshotLine('Brent-WTI spread', payload.derived.brentWtiSpread),
    snapshotLine('3-2-1 crack spread', payload.derived.crackSpread321),
    snapshotLine('OPEC basket', payload.benchmarks?.opec?.basketPrice ?? oilValue(null, 'usdPerBbl', '', OIL_OPEC_SOURCE, 'daily')),
    snapshotLine(
      'EIA WTI spot (Cushing)',
      oilValue(spot?.latest ?? null, 'usdPerBbl', spot?.asOf ?? '', OIL_EIA_SOURCE, 'weekly'),
    ),
    snapshotLine(
      'Retail gasoline',
      oilValue(pump?.latest ?? null, 'usdPerGal', pump?.asOf ?? '', OIL_EIA_SOURCE, 'weekly'),
    ),
    `Curve: ${payload.curve ? `${payload.curve.shape} over ${payload.curve.points.length} contracts` : 'unavailable'}`,
    snapshotLine('Front-to-back spread', payload.curve?.frontToBackSpread ?? oilValue(null, 'usdPerBbl', '', OIL_MARKET_SOURCE, 'live')),
    snapshotLine(
      'Commercial crude stocks',
      oilValue(crude?.latest ?? null, 'kb', crude?.asOf ?? '', OIL_EIA_SOURCE, 'weekly'),
    ),
    snapshotLine('Crude vs 5-year average', payload.derived.crudeVsFiveYear),
    snapshotLine('Days of supply', payload.derived.daysOfSupply),
    snapshotLine(
      'US field production',
      oilValue(production?.latest ?? null, 'kbd', production?.asOf ?? '', OIL_EIA_SOURCE, 'weekly'),
    ),
    '',
    'Sources: U.S. Energy Information Administration; OPEC Secretariat; Yahoo Finance.',
    'EIA weekly figures are survey estimates and are revised. CL=F and BZ=F are futures, not physical assessments.',
  ].join('\n')
}

export const OIL_SERIES_SPECS: ReadonlyArray<OilSeriesSpec> = [
  ...OIL_STOCK_SPECS,
  ...OIL_FLOW_SPECS,
  ...OIL_BENCHMARK_SPECS,
]

export const oilTesting = {
  FIVE_YEAR_WINDOW,
  WEEK_TOLERANCE_DAYS,
  CURVE_FLAT_BAND_PCT,
  OIL_BENCHMARK_KEYS,
  OIL_FLOW_KEYS,
  OIL_STOCK_KEYS,
}
