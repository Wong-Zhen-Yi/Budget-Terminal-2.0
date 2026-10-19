/**
 * The ETF page's pure maths and presenters, ported from `mixins/etf_analyser.py`
 * (page13, `_p13_*`) and `services/etf_arbitrage.py`.
 *
 * Everything here is a pure function of a payload, so the page, the main process and
 * `scripts/probe-etf.ts` cannot disagree about what a weight, a gap or a donut slice is
 * worth. No Electron and no React imports, like every other `shared/` module.
 */

import type {
  EtfArbitragePayload,
  EtfArbitrageRow,
  EtfHoldingRow,
  EtfSectorSlice,
} from './contract.js'

/** `_P13_MAX_NAMED_SLICES`. */
export const MAX_NAMED_SLICES = 12
/** `_P13_MIN_REMAINDER_WEIGHT`: below this the uncovered tail is not worth a wedge. */
export const MIN_REMAINDER_WEIGHT = 0.001
/** `_P13_AUM_PAGE_SIZE`. */
export const AUM_PAGE_SIZE = 250

/* -------------------------------------------------------------- coercion */

/**
 * `_p13_float_or_none`: a finite number, or null.
 *
 * The empty-string and null guards are the same hazard Valuation's `finiteOrNull` and
 * Economic's `finite()` document — `Number(null)` and `Number('')` are both 0, so an
 * absent weight would otherwise render as a real 0.00% row instead of a dash.
 */
export function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/** `_positive_float` in `etf_arbitrage.py`: finite *and* above zero. */
export function positiveOrNull(value: unknown): number | null {
  const number = finiteOrNull(value)
  return number !== null && number > 0 ? number : null
}

/* ------------------------------------------------------------ formatting */

/** `_p13_format_money`. */
export function etfMoney(value: unknown): string {
  const number = finiteOrNull(value)
  return number === null
    ? '--'
    : `$${number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** `_p13_format_signed_pct`: a plus sign only above zero, never on an exact zero. */
export function etfSignedPct(value: unknown): string {
  const number = finiteOrNull(value)
  if (number === null) return '--'
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`
}

/** `_p13_format_signed_bps`, one decimal. */
export function etfSignedBps(value: unknown): string {
  const number = finiteOrNull(value)
  if (number === null) return '--'
  return `${number > 0 ? '+' : ''}${number.toFixed(1)} bps`
}

/** `_p13_format_weight`: the stored weight is a fraction, the column prints percent. */
export function etfWeight(value: unknown): string {
  const number = finiteOrNull(value)
  return number === null ? '--' : `${(number * 100).toFixed(2)}%`
}

/**
 * `_p13_format_aum`: the left rail's own steps.
 *
 * Not `lib/format.ts`'s `compactCurrency` — this one stops at one decimal for T and B,
 * rounds M to whole millions and prints anything smaller in full, which is what keeps a
 * column of five hundred funds the same width.
 */
export function etfAum(value: unknown): string {
  const number = finiteOrNull(value)
  if (number === null) return '--'
  if (number >= 1e12) return `$${(number / 1e12).toFixed(1)}T`
  if (number >= 1e9) return `$${(number / 1e9).toFixed(1)}B`
  if (number >= 1e6) return `$${Math.round(number / 1e6).toLocaleString('en-US')}M`
  return `$${Math.round(number).toLocaleString('en-US')}`
}

/**
 * `_p13_value_color_token`, as a direction rather than a theme token: an exact zero is
 * muted rather than green, which is what keeps a flat component from reading as a gain.
 */
export function etfDirection(value: unknown): 'up' | 'down' | 'flat' {
  const number = finiteOrNull(value)
  if (number === null || Math.abs(number) < 1e-12) return 'flat'
  return number > 0 ? 'up' : 'down'
}

/** `_p13_apply_result`'s sector line: `Technology 34.2% | Financial Services 12.8%`. */
export function sectorBreakdownText(slices: ReadonlyArray<EtfSectorSlice>): string {
  return slices.map((slice) => `${slice.sector} ${slice.percent.toFixed(1)}%`).join(' | ')
}

/* --------------------------------------------------------------- filters */

/** `_p13_filter_holdings_rows`: one needle over both the ticker and the name. */
export function filterHoldings<T extends { symbol: string; name: string }>(
  rows: ReadonlyArray<T>,
  filter: string,
): T[] {
  const needle = filter.trim().toLowerCase()
  if (!needle) return [...rows]
  return rows.filter(
    (row) => row.symbol.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle),
  )
}

/** `_p13_render_aum_table`'s filter, which is ticker-only and case-folded upward. */
export function filterAumRows<T extends { ticker: string; name?: string; category?: string }>(
  rows: ReadonlyArray<T>,
  filter: string,
): T[] {
  const needle = filter.trim().toLowerCase()
  if (!needle) return [...rows]
  return rows.filter((row) => [row.ticker, row.name, row.category].some(value => value?.toLowerCase().includes(needle)))
}

/* ------------------------------------------------------------- the donut */

export interface EtfDonutSlice {
  label: string
  /** The raw weight fraction; the donut takes any positive magnitude. */
  value: number
}

export interface EtfDonutView {
  slices: EtfDonutSlice[]
  /** `loaded_total` clamped into 0..1 and printed as the centre percentage. */
  coveragePct: number
  /** The combined tail: everything past the twelfth name plus the uncovered remainder. */
  othersWeight: number
  /**
   * Degrees clockwise from twelve o'clock to begin the first wedge at.
   *
   * One documented departure in sign only: `_p13_update_holdings_chart` sets Qt's
   * `set_start_angle((others / total) * 180)`, and Qt measures counter-clockwise from
   * three o'clock while this app's `Donut` measures clockwise from twelve. The magnitude
   * is the reference's — half of the Others wedge — so Others still straddles the top
   * and the largest holding still begins immediately after it.
   */
  startAngle: number
}

/**
 * `_p13_update_holdings_chart`.
 *
 * The twelve largest names keep their own wedge; everything below them is folded into
 * Others, and so is the *uncovered* remainder — the part of the fund the loaded rows do
 * not account for. That second term is why the centre reads coverage rather than 100%:
 * a Yahoo top-holdings fallback covers a third of the book and the donut says so.
 */
export function buildDonut(holdings: ReadonlyArray<EtfHoldingRow>): EtfDonutView {
  const ranked: Array<{ label: string; weight: number }> = []
  let loadedTotal = 0
  for (const holding of holdings) {
    const weight = finiteOrNull(holding.weight)
    if (weight === null || weight <= 0) continue
    ranked.push({ label: (holding.symbol || holding.name || 'Unknown').trim(), weight })
    loadedTotal += weight
  }
  if (!ranked.length) return { slices: [], coveragePct: 0, othersWeight: 0, startAngle: 0 }
  ranked.sort((a, b) => b.weight - a.weight)

  const named = new Map<string, number>()
  for (const entry of ranked.slice(0, MAX_NAMED_SLICES)) {
    named.set(entry.label, (named.get(entry.label) ?? 0) + entry.weight)
  }

  let othersWeight = ranked.slice(MAX_NAMED_SLICES).reduce((sum, entry) => sum + entry.weight, 0)
  const uncovered = Math.max(0, 1 - loadedTotal)
  if (uncovered >= MIN_REMAINDER_WEIGHT) othersWeight += uncovered

  const slices: EtfDonutSlice[] = [...named].map(([label, value]) => ({ label, value }))
  if (othersWeight > 0) slices.push({ label: 'Others', value: othersWeight })

  const chartTotal = slices.reduce((sum, slice) => sum + slice.value, 0)
  return {
    slices,
    coveragePct: Math.min(Math.max(loadedTotal, 0), 1) * 100,
    othersWeight,
    startAngle: othersWeight > 0 && chartTotal > 0 ? -(othersWeight / chartTotal) * 180 : 0,
  }
}

/* --------------------------------------------------------------- arbitrage */

/** One quote as the arbitrage builder reads it, which is what `spark` already gives. */
export interface EtfQuote {
  price: number | null
  /** Percent move over the session; `live` is preferred, then `1d`, as the reference is. */
  changes: { live?: number; '1d'?: number }
}

/** `_quote_move_pct`: `live` first, then `1d`. */
export function quoteMovePct(quote: EtfQuote | undefined): number | null {
  if (!quote) return null
  const live = finiteOrNull(quote.changes.live)
  if (live !== null) return live
  return finiteOrNull(quote.changes['1d'])
}

/** `holding_symbols`: unique, positive-weight, uppercase. */
export function holdingSymbols(holdings: ReadonlyArray<EtfHoldingRow>): string[] {
  const seen = new Set<string>()
  const symbols: string[] = []
  for (const holding of holdings) {
    const symbol = holding.symbol.trim().toUpperCase()
    if (!symbol || positiveOrNull(holding.weight) === null || seen.has(symbol)) continue
    seen.add(symbol)
    symbols.push(symbol)
  }
  return symbols
}

/**
 * `build_etf_arbitrage_snapshot`: the raw return gap between an ETF and its own basket.
 *
 * The basket move is weighted over the holdings that *answered*, not over the whole
 * book — an unquoted 3% name must not drag the basket toward zero. That is also why
 * coverage is on the summary strip: a gap computed over half the book is not a signal,
 * and the status line says so rather than printing the number alone.
 */
export function buildArbitrage(
  etfSymbol: string,
  holdings: ReadonlyArray<EtfHoldingRow>,
  quotes: ReadonlyMap<string, EtfQuote>,
): EtfArbitragePayload {
  const ticker = etfSymbol.trim().toUpperCase()
  let totalHoldings = 0
  let loadedWeight = 0
  const quoted: Array<Omit<EtfArbitrageRow, 'normalizedWeight' | 'contributionPct'>> = []

  for (const holding of holdings) {
    const symbol = holding.symbol.trim().toUpperCase()
    const weight = positiveOrNull(holding.weight)
    if (!symbol || weight === null) continue
    totalHoldings += 1
    loadedWeight += weight
    const quote = quotes.get(symbol)
    const price = positiveOrNull(quote?.price)
    const movePct = quoteMovePct(quote)
    if (price === null || movePct === null) continue
    quoted.push({ symbol, name: holding.name, weight, price, movePct })
  }

  const quotedWeight = quoted.reduce((sum, row) => sum + row.weight, 0)
  const rows: EtfArbitrageRow[] = quoted.map((row) => {
    const normalizedWeight = quotedWeight > 0 ? row.weight / quotedWeight : 0
    return { ...row, normalizedWeight, contributionPct: normalizedWeight * row.movePct }
  })
  const basketMovePct =
    quotedWeight > 0 ? rows.reduce((sum, row) => sum + row.contributionPct, 0) : null

  const etfQuote = quotes.get(ticker)
  const etfPrice = positiveOrNull(etfQuote?.price)
  const etfMovePct = quoteMovePct(etfQuote)
  let gapPctPoints: number | null = null
  let gapBps: number | null = null
  let signal = '--'
  if (etfMovePct !== null && basketMovePct !== null) {
    gapPctPoints = etfMovePct - basketMovePct
    gapBps = gapPctPoints * 100
    signal =
      Math.abs(gapPctPoints) < 1e-9
        ? 'No gap'
        : gapPctPoints > 0
          ? 'ETF rich vs basket'
          : 'ETF cheap vs basket'
  }

  return {
    ticker,
    generatedAt: Date.now(),
    etfPrice,
    etfMovePct,
    basketMovePct,
    gapPctPoints,
    gapBps,
    signal,
    quoteCoverage: rows.length,
    totalHoldings,
    quotedWeight,
    loadedWeight,
    rows,
  }
}

/**
 * `_p13_apply_arbitrage_result`'s status line, which reads differently in three cases:
 * no gap at all, a gap over partial coverage, and a gap over the whole book.
 */
export function arbitrageStatus(payload: EtfArbitragePayload): {
  text: string
  status: 'positive' | 'warning'
} {
  const coverage = `${payload.quoteCoverage}/${payload.totalHoldings}`
  if (payload.gapBps === null) {
    return {
      text: `Arbitrage quotes incomplete for ${payload.ticker || 'ETF'}: ${coverage} holdings covered.`,
      status: 'warning',
    }
  }
  const gap = `${etfSignedBps(payload.gapBps)} (${payload.signal})`
  if (payload.totalHoldings && payload.quoteCoverage < payload.totalHoldings) {
    return { text: `Raw return gap ${gap}; ${coverage} holdings covered.`, status: 'warning' }
  }
  return { text: `Raw return gap ${gap}.`, status: 'positive' }
}

/* ---------------------------------------------------------- the clipboard */

/** `_p13_export_clipboard`: the holdings subtab, tab-separated with its header row. */
export function holdingsClipboard(rows: ReadonlyArray<EtfHoldingRow>): string {
  return [
    'Ticker\tName\tWeight',
    ...rows.map((row) => `${row.symbol}\t${row.name}\t${etfWeight(row.weight)}`),
  ].join('\n')
}

/** `_p13_export_arbitrage_clipboard`. */
export function arbitrageClipboard(rows: ReadonlyArray<EtfArbitrageRow>): string {
  return [
    'Ticker\tName\tWeight\tPrice\tMove\tContribution',
    ...rows.map((row) =>
      [
        row.symbol,
        row.name,
        etfWeight(row.weight),
        etfMoney(row.price),
        etfSignedPct(row.movePct),
        etfSignedPct(row.contributionPct),
      ].join('\t'),
    ),
  ].join('\n')
}
