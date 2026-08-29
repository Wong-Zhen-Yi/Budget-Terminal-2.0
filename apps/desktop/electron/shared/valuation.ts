/**
 * The Valuation page's maths, ported from the PySide6 `services/valuation.py` (page23).
 *
 * Everything here is pure: the DCF itself, the bear/base/bull ladder, and the derivation
 * that turns reported history, the Treasury curve, analyst estimates and peer multiples
 * into a full set of assumptions. The main process derives once on load and the renderer
 * re-solves on every assumption edit, so the two must not be able to disagree.
 *
 * Percentages are percentage points throughout — 10.0 is ten percent — matching the
 * reference's spin boxes and every `*_pct` field it emits.
 */

/* ------------------------------------------------------------------- types */

export type ValuationBasisType = 'FCF' | 'EPS'
export type ValuationTerminalMethod = 'gordon_growth' | 'exit_multiple'

export interface ValuationAssumptions {
  basisType: ValuationBasisType
  basisValue: number
  growth1to5: number
  growth6to10: number
  discountRate: number
  terminalMethod: ValuationTerminalMethod
  terminalGrowth: number
  exitMultiple: number
  projectionYears: number
  marginOfSafety: number
}

/** One derived assumption, with the sentence the page prints to explain it. */
export interface ValuationSuggestion {
  value: number
  source: string
}

export interface ValuationRequiredReturn extends ValuationSuggestion {
  baseline: number
  method: 'capm' | 'heuristic'
  riskFreeRate: number | null
  asOf: string | null
  equityRiskPremium: number | null
  betaRaw: number | null
  betaAdjusted: number | null
  adjustments: Array<{ factor: string; adjustmentPctPoints: number; value: number | null }>
  caveat: string
}

export interface ValuationTerminalGrowth extends ValuationSuggestion {
  riskFreeRate: number | null
  breakevenInflation: number | null
  capsApplied: string[]
}

export interface ValuationGrowthSuggestion extends ValuationSuggestion {
  inputs: Array<{ name: string; value: number }>
}

export interface ValuationExitMultiple extends ValuationSuggestion {
  peerCount: number
  inputs: Array<{ ticker: string; value: number }>
}

export interface ValuationMarginOfSafety extends ValuationSuggestion {
  reasons: string[]
}

export interface ValuationFairValueDetails {
  fairValue: number | null
  explicitForecastPv: number | null
  terminalPv: number | null
  terminalValueShare: number | null
  method: ValuationTerminalMethod | 'earnings_multiple'
  requestedTerminalMethod: ValuationTerminalMethod
  warnings: string[]
  assumptions: ValuationAssumptions
  projectedBasis: number[]
}

export interface ValuationComponents {
  explicitForecastPv: number | null
  terminalPv: number | null
  terminalValueShare: number | null
  method: ValuationFairValueDetails['method']
}

export interface ValuationScenarioRow {
  name: string
  fairValue: number | null
  upsidePct: number | null
  assumptions: ValuationAssumptions
  components: ValuationComponents
  warnings: string[]
}

export interface ValuationScenarios {
  assumptions: ValuationAssumptions
  scenarios: ValuationScenarioRow[]
  baseFairValue: number | null
  buyBelow: number | null
  upperScenario: number | null
  trimAbove: number | null
  verdict: string | null
  warnings: string[]
  priceComparisonValid: boolean
  blockingWarnings: string[]
  components: ValuationComponents
  scenariosOrdered: boolean
  modelQuality: 'Low' | 'Medium' | 'High' | null
  comparableHistoryPoints: number
}

export interface ValuationMarketContext {
  riskFreeRate: number
  realRate: number | null
  breakevenInflation: number | null
  asOf: string
  tenor: string
  freshness: 'fresh' | 'stale'
  source: string
}

export interface ValuationAnalystEstimates {
  longTermGrowthPct: number | null
  nextYearGrowthPct: number | null
  currentYearGrowthPct: number | null
  analystCount: number | null
  source: string
  available: boolean
}

export interface ValuationPeerRow {
  ticker: string
  company: string
  source: 'Loaded' | 'Custom' | 'Auto'
  marketCap: number | null
  revenueGrowth: number | null
  netMargin: number | null
  pe: number | null
  forwardPe: number | null
  evEbitda: number | null
  fcfYield: number | null
}

export interface ValuationTrends {
  labels: string[]
  revenue: Array<number | null>
  eps: Array<number | null>
  fcf: Array<number | null>
  fcfPerShare: Array<number | null>
  perShareApproximate: boolean
  perShareSource: string
  comparableHistoryPoints: number
}

export interface ValuationMetrics {
  ticker: string
  companyName: string
  sector: string
  industry: string
  currency: string | null
  financialCurrency: string | null
  currencyMismatch: boolean
  price: number | null
  previousClose: number | null
  marketCap: number | null
  enterpriseValue: number | null
  revenue: number | null
  netIncome: number | null
  ebitda: number | null
  operatingCashFlow: number | null
  freeCashFlow: number | null
  shares: number | null
  eps: number | null
  fcfPerShare: number | null
  basisType: ValuationBasisType
  basisValue: number | null
  cash: number | null
  debt: number | null
  netDebt: number | null
  pe: number | null
  forwardPe: number | null
  ps: number | null
  pb: number | null
  evEbitda: number | null
  fcfYield: number | null
  earningsYield: number | null
  peg: number | null
  dividendYield: number | null
  netMargin: number | null
  revenueGrowth: number | null
  beta: number | null
}

export interface ValuationSuggestionFields {
  discountRate: ValuationRequiredReturn
  terminalGrowth: ValuationTerminalGrowth
  growth1to5: ValuationGrowthSuggestion
  growth6to10: ValuationSuggestion
  exitMultiple: ValuationExitMultiple
  marginOfSafety: ValuationMarginOfSafety
}

export type ValuationSuggestionKey = keyof ValuationSuggestionFields

export interface ValuationSuggestionBundle {
  basisType: ValuationBasisType
  fields: ValuationSuggestionFields
  caveats: string[]
  market: ValuationMarketContext | null
  quality: {
    historyPoints: number
    terminalValueShare: number | null
    missingInputs: string[]
  }
}

/* --------------------------------------------------------------- constants */

export const DEFAULT_VALUATION_ASSUMPTIONS: ValuationAssumptions = {
  basisType: 'FCF',
  basisValue: 0,
  growth1to5: 10,
  growth6to10: 5,
  discountRate: 10,
  terminalMethod: 'gordon_growth',
  terminalGrowth: 2.5,
  exitMultiple: 15,
  projectionYears: 10,
  marginOfSafety: 20,
}

/**
 * Equity risk premium used by the CAPM required return. A judgement constant, not a
 * fetched series: Damodaran's implied US ERP has oscillated roughly 4.0-5.5% over the
 * last decade and 5.0 is the round midpoint. Every derived required return moves
 * one-for-one with it, which is why it is named here rather than buried in the formula.
 */
export const EQUITY_RISK_PREMIUM_PCT = 5.0

/**
 * Minimum required-return-minus-terminal-growth spread the derivation targets in the BASE
 * case. `inputWarnings` blocks below 1.0, but the bull case is built with
 * `discountRate - 1.0` and `terminalGrowth + 0.5` — narrowing the spread by 1.5 points. A
 * base spread under 1.0 + 1.5 therefore yields an unsolvable bull case, which flips
 * `scenariosOrdered` off and drops the whole verdict even though the base case looks fine.
 */
export const MIN_GORDON_SPREAD_PCT = 2.5

/**
 * Extra slack on top of the arithmetic minimum. The assumption inputs carry one decimal,
 * so a derived terminal growth can round up 0.05 while the required return rounds down
 * 0.05; that 0.1 of shrinkage plus binary-float slop must not be allowed to eat into the
 * spread.
 */
const SPREAD_SAFETY_PCT = 0.2

/** Fallback anchors. These reproduce the pre-CAPM behaviour exactly. */
export const HEURISTIC_BASELINE_RETURN_PCT = 10.0
export const DEFAULT_TERMINAL_GROWTH_PCT = 2.5
export const DEFAULT_EXIT_MULTIPLE = 15.0

/** Blume adjustment: an unadjusted 0.15 or 3.4 beta yields a return the clamps rewrite. */
const BLUME_WEIGHT = 0.67
const BETA_BOUNDS: [number, number] = [0.5, 2.5]

const EXIT_MULTIPLE_BOUNDS: [number, number] = [3, 50]
export const MIN_PEER_COUNT = 3

/**
 * Weight given to the analyst leg when blending with reported history. The long-term
 * (+5y) estimate covers exactly the years 1-5 horizon, so it earns more weight than a
 * single fiscal year.
 */
const ANALYST_LONG_TERM_WEIGHT = 0.6
const ANALYST_NEXT_YEAR_WEIGHT = 0.4

/** Yahoo emits absurd growth off a near-zero prior-year base; treat those as data errors. */
const MAX_ANALYST_GROWTH_PCT = 100.0

/* ----------------------------------------------------------------- helpers */

/**
 * `_safe_float`: a finite number, or null.
 *
 * The null/undefined/empty guard is load-bearing. `Number(null)` is 0 and `Number('')` is
 * 0, so without it every absent Yahoo field would arrive as a real zero — a missing free
 * cash flow would read as "negative FCF" and add 1.5pp to the required return, and a
 * missing basis would fail the model with a "greater than zero" warning instead of falling
 * back. Python's `float(None)` raises, which is why the reference has no such hazard.
 */
export function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function boundedFloat(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const numeric = finiteOrNull(value)
  return clamp(numeric === null ? fallback : numeric, minimum, maximum)
}

export function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/* ------------------------------------------------------------- assumptions */

/** Normalize persisted or edited assumptions onto the supported valuation contract. */
export function normalizeValuationAssumptions(values: unknown): ValuationAssumptions {
  const saved = (values && typeof values === 'object' ? values : {}) as Record<string, unknown>
  const basisType: ValuationBasisType =
    String(saved.basisType ?? 'FCF').toUpperCase().trim() === 'EPS' ? 'EPS' : 'FCF'
  const rawMethod = String(saved.terminalMethod ?? 'gordon_growth')
    .toLowerCase()
    .trim()
    .replaceAll(' ', '_')
  const terminalMethod: ValuationTerminalMethod =
    rawMethod === 'exit_multiple' ? 'exit_multiple' : 'gordon_growth'
  const rawYears = Number(saved.projectionYears ?? 10)
  const years = Number.isFinite(rawYears) ? Math.trunc(rawYears) : 10
  return {
    basisType,
    basisValue: boundedFloat(saved.basisValue, 0, 0, 100_000),
    growth1to5: boundedFloat(saved.growth1to5, 10, -30, 50),
    growth6to10: boundedFloat(saved.growth6to10, 5, -15, 30),
    discountRate: boundedFloat(saved.discountRate, 10, 4, 30),
    terminalMethod,
    terminalGrowth: boundedFloat(saved.terminalGrowth, 2.5, -2, 5),
    exitMultiple: boundedFloat(saved.exitMultiple, 15, 3, 50),
    projectionYears: Math.min(Math.max(years, 5), 15),
    marginOfSafety: boundedFloat(saved.marginOfSafety, 20, 0, 50),
  }
}

const NUMERIC_FIELDS = [
  'basisValue',
  'growth1to5',
  'growth6to10',
  'discountRate',
  'terminalGrowth',
  'exitMultiple',
  'projectionYears',
  'marginOfSafety',
] as const

const FIELD_TITLES: Record<(typeof NUMERIC_FIELDS)[number], string> = {
  basisValue: 'Basis Value',
  growth1to5: 'Growth 1 5',
  growth6to10: 'Growth 6 10',
  discountRate: 'Discount Rate',
  terminalGrowth: 'Terminal Growth',
  exitMultiple: 'Exit Multiple',
  projectionYears: 'Projection Years',
  marginOfSafety: 'Margin Of Safety',
}

function inputWarnings(raw: unknown, values: ValuationAssumptions): string[] {
  const warnings: string[] = []
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    for (const field of NUMERIC_FIELDS) {
      if (field in record && finiteOrNull(record[field]) === null) {
        warnings.push(`${FIELD_TITLES[field]} must be a finite number.`)
      }
    }
  }
  if (values.basisValue <= 0) {
    warnings.push('Starting FCF/share or EPS must be greater than zero.')
  }
  if (values.basisType === 'FCF' && values.terminalMethod === 'gordon_growth') {
    if (values.discountRate - values.terminalGrowth < 1) {
      warnings.push(
        'Required return must exceed Gordon terminal growth by at least 1 percentage point.',
      )
    }
  }
  return warnings
}

/* ----------------------------------------------------------------- the DCF */

/** Solve fair value per share and every auditable component behind it. */
export function calculateFairValueDetails(assumptions: unknown): ValuationFairValueDetails {
  const values = normalizeValuationAssumptions(assumptions)
  const warnings = inputWarnings(assumptions, values)
  const requestedMethod = values.terminalMethod
  const result: ValuationFairValueDetails = {
    fairValue: null,
    explicitForecastPv: null,
    terminalPv: null,
    terminalValueShare: null,
    method: values.basisType === 'FCF' ? requestedMethod : 'earnings_multiple',
    requestedTerminalMethod: requestedMethod,
    warnings,
    assumptions: values,
    projectedBasis: [],
  }
  if (warnings.length) return result

  const requiredReturn = values.discountRate / 100
  const growthNear = values.growth1to5 / 100
  const growthFar = values.growth6to10 / 100
  const years = values.projectionYears
  const projected: number[] = []
  let current = values.basisValue
  for (let year = 1; year <= years; year += 1) {
    current *= 1 + (year <= 5 ? growthNear : growthFar)
    projected.push(current)
  }
  const last = projected[projected.length - 1]

  let explicitPv = 0
  let terminalPv: number
  if (values.basisType === 'EPS') {
    // An EPS model has no discounted-flow leg at all: the whole answer is the exit multiple.
    terminalPv = (last * values.exitMultiple) / (1 + requiredReturn) ** years
  } else {
    explicitPv = projected.reduce(
      (sum, value, index) => sum + value / (1 + requiredReturn) ** (index + 1),
      0,
    )
    const terminalGrowth = values.terminalGrowth / 100
    const terminalValue =
      requestedMethod === 'gordon_growth'
        ? (last * (1 + terminalGrowth)) / (requiredReturn - terminalGrowth)
        : last * values.exitMultiple
    terminalPv = terminalValue / (1 + requiredReturn) ** years
  }

  const fairValue = explicitPv + terminalPv
  if (!Number.isFinite(fairValue) || fairValue <= 0) {
    result.warnings.push('The selected assumptions do not produce a positive finite fair value.')
    return result
  }
  result.fairValue = fairValue
  result.explicitForecastPv = explicitPv
  result.terminalPv = terminalPv
  result.terminalValueShare = terminalPv / fairValue
  result.projectedBasis = projected
  return result
}

/** Compatibility helper returning only the calculated per-share value. */
export function calculateFairValuePerShare(assumptions: unknown): number | null {
  return calculateFairValueDetails(assumptions).fairValue
}

function scenarioAssumptions(
  base: ValuationAssumptions,
  kind: 'bear' | 'base' | 'bull',
): ValuationAssumptions {
  if (kind === 'bear') {
    const values: ValuationAssumptions = {
      ...base,
      growth1to5: base.growth1to5 - 5,
      growth6to10: base.growth6to10 - 3,
      discountRate: base.discountRate + 2,
    }
    if (base.terminalMethod === 'gordon_growth') values.terminalGrowth = base.terminalGrowth - 0.5
    else values.exitMultiple = base.exitMultiple * 0.8
    return values
  }
  if (kind === 'bull') {
    const values: ValuationAssumptions = {
      ...base,
      growth1to5: base.growth1to5 + 5,
      growth6to10: base.growth6to10 + 3,
      discountRate: base.discountRate - 1,
    }
    if (base.terminalMethod === 'gordon_growth') values.terminalGrowth = base.terminalGrowth + 0.5
    else values.exitMultiple = base.exitMultiple * 1.2
    return values
  }
  return { ...base }
}

function modelQuality(
  base: ValuationAssumptions,
  details: ValuationFairValueDetails,
  historyPoints: number,
  ordered: boolean,
  materialWarnings: string[],
): ValuationScenarios['modelQuality'] {
  if (details.fairValue === null) return null
  const terminalShare = details.terminalValueShare
  const warnings = [...details.warnings, ...materialWarnings]
  if (
    base.basisType === 'EPS' ||
    historyPoints < 3 ||
    (terminalShare !== null && terminalShare > 0.85) ||
    warnings.length
  ) {
    return 'Low'
  }
  if (
    base.basisType === 'FCF' &&
    historyPoints >= 4 &&
    ordered &&
    !warnings.length &&
    terminalShare !== null &&
    terminalShare <= 0.75
  ) {
    return 'High'
  }
  return 'Medium'
}

/**
 * Solve the additive bear/base/bull ladder, its thresholds and the model quality.
 *
 * `materialWarnings` qualify the model but leave the verdict standing.
 * `blockingWarnings` say the fair values cannot be compared to `price` at all — a quote
 * and statements in different currencies, for instance. The scenario fair values still
 * come back, because the model itself is sound in its own unit, but every price-relative
 * output (upside, the buy-below and trim-above thresholds, the verdict) is withheld and
 * `priceComparisonValid` goes false.
 */
export function calculateValuationScenarios(
  price: unknown,
  assumptions: unknown,
  options: {
    historyPoints?: number
    materialWarnings?: string[]
    blockingWarnings?: string[]
  } = {},
): ValuationScenarios {
  const base = normalizeValuationAssumptions(assumptions)
  const historyPoints = Math.max(Math.trunc(Number(options.historyPoints ?? 0)) || 0, 0)
  const materialWarnings = [...(options.materialWarnings ?? [])]
  const comparisonWarnings = (options.blockingWarnings ?? []).map(String).filter((item) => item.trim())
  const priceComparisonValid = comparisonWarnings.length === 0
  const priceValue = finiteOrNull(price)

  const rows: ValuationScenarioRow[] = (
    [
      ['Bear Case', 'bear'],
      ['Base Case', 'base'],
      ['Bull Case', 'bull'],
    ] as const
  ).map(([name, key]) => {
    const details = calculateFairValueDetails(scenarioAssumptions(base, key))
    const fairValue = details.fairValue
    return {
      name,
      fairValue,
      upsidePct:
        priceComparisonValid && fairValue !== null && priceValue !== null && priceValue > 0
          ? (fairValue / priceValue - 1) * 100
          : null,
      assumptions: details.assumptions,
      components: {
        explicitForecastPv: details.explicitForecastPv,
        terminalPv: details.terminalPv,
        terminalValueShare: details.terminalValueShare,
        method: details.method,
      },
      warnings: details.warnings,
    }
  })

  const [bearValue, baseValue, bullValue] = rows.map((row) => row.fairValue)
  const ordered =
    bearValue !== null &&
    baseValue !== null &&
    bullValue !== null &&
    bearValue <= baseValue &&
    baseValue <= bullValue
  const baseDetails = calculateFairValueDetails(assumptions)
  const verdictBlockers = [...baseDetails.warnings, ...comparisonWarnings]
  const warnings = [...baseDetails.warnings, ...comparisonWarnings, ...materialWarnings]
  if (!ordered && baseValue !== null) {
    const orderingWarning = 'Bear, base, and bull values are not ordered; review the assumptions.'
    warnings.push(orderingWarning)
    verdictBlockers.push(orderingWarning)
  }
  const buyBelow =
    baseValue !== null && priceComparisonValid ? baseValue * (1 - base.marginOfSafety / 100) : null
  let verdict: string | null = null
  if (
    !verdictBlockers.length &&
    priceValue !== null &&
    priceValue > 0 &&
    buyBelow !== null &&
    bullValue !== null
  ) {
    verdict =
      priceValue < buyBelow ? 'Undervalued' : priceValue > bullValue ? 'Overvalued' : 'Fairly valued'
  }
  return {
    assumptions: base,
    scenarios: rows,
    baseFairValue: baseValue,
    buyBelow,
    upperScenario: priceComparisonValid ? bullValue : null,
    trimAbove: priceComparisonValid ? bullValue : null,
    verdict,
    warnings,
    priceComparisonValid,
    blockingWarnings: comparisonWarnings,
    components: {
      explicitForecastPv: baseDetails.explicitForecastPv,
      terminalPv: baseDetails.terminalPv,
      terminalValueShare: baseDetails.terminalValueShare,
      method: baseDetails.method,
    },
    scenariosOrdered: ordered,
    modelQuality: modelQuality(base, baseDetails, historyPoints, ordered, [
      ...materialWarnings,
      ...comparisonWarnings,
    ]),
    comparableHistoryPoints: historyPoints,
  }
}

/* -------------------------------------------------------------- derivation */

function threeYearCagr(values: Array<number | null> | undefined, labels?: string[]): number | null {
  const series = values ?? []
  if (series.length < 4) return null
  const numeric = series.slice(-4).map(finiteOrNull)
  if (numeric.some((value) => value === null || value <= 0)) return null
  if (labels) {
    const years = labels.slice(-4).map((label) => Number(String(label).slice(0, 4)))
    if (years.length !== 4 || years.some((year) => !Number.isFinite(year))) return null
    for (let index = 1; index < years.length; index += 1) {
      if (years[index] - years[index - 1] !== 1) return null
    }
  }
  return (((numeric[3] as number) / (numeric[0] as number)) ** (1 / 3) - 1) * 100
}

/** Pull a raw beta toward 1.0 and bound it, so one noisy estimate cannot dominate CAPM. */
function blumeBeta(betaRaw: number | null): number {
  if (betaRaw === null) return 1
  return clamp(BLUME_WEIGHT * betaRaw + (1 - BLUME_WEIGHT), BETA_BOUNDS[0], BETA_BOUNDS[1])
}

/** Small companies carry risk beta alone does not price; approximate the decile spread. */
function sizePremiumPct(marketCap: number | null): number {
  if (marketCap === null || marketCap >= 10_000_000_000) return 0
  if (marketCap >= 2_000_000_000) return 0.5
  if (marketCap >= 300_000_000) return 1
  return 2
}

function leveragePremiumPct(
  netDebt: number | null,
  marketCap: number | null,
): [number, number | null] {
  if (netDebt === null || marketCap === null || marketCap <= 0) return [0, null]
  const leverage = netDebt / marketCap
  return [leverage > 0.5 ? 2 : leverage > 0.2 ? 1 : 0, leverage]
}

/**
 * A CAPM required return anchored to the live risk-free rate, with every term itemized.
 *
 * Falls back to the previous company-risk heuristic — identical arithmetic, identical
 * output — whenever `market` carries no usable risk-free rate, so a failed Treasury fetch
 * costs precision rather than correctness.
 */
export function estimateRequiredReturn(
  metrics: Partial<ValuationMetrics> | null | undefined,
  market: ValuationMarketContext | null | undefined,
): ValuationRequiredReturn {
  const source = metrics ?? {}
  const adjustments: ValuationRequiredReturn['adjustments'] = []
  const beta = finiteOrNull(source.beta)
  const freeCashFlow = finiteOrNull(source.freeCashFlow)
  const marketCap = finiteOrNull(source.marketCap)
  const riskFreeRate = market ? finiteOrNull(market.riskFreeRate) : null
  // netDebt is reported and marketCap is quoted. Dividing one by the other across a
  // currency split manufactures a leverage premium out of the exchange rate, so the term
  // is dropped. The size premium keeps marketCap, quoted on both sides of that test.
  const netDebt = source.currencyMismatch ? null : finiteOrNull(source.netDebt)

  let requiredReturn: number
  let baseline: number
  let betaAdjusted: number | null
  let method: 'capm' | 'heuristic'
  let sourceText: string
  let caveat: string
  if (riskFreeRate === null) {
    requiredReturn = HEURISTIC_BASELINE_RETURN_PCT
    if (beta !== null) {
      const adjustment = (beta - 1) * 2
      requiredReturn += adjustment
      adjustments.push({ factor: 'Beta', adjustmentPctPoints: adjustment, value: beta })
    }
    betaAdjusted = null
    baseline = HEURISTIC_BASELINE_RETURN_PCT
    method = 'heuristic'
    sourceText = '10% baseline plus beta, negative-FCF, and leverage adjustments'
    caveat = 'Heuristic required return; it is not a market-implied cost of equity.'
  } else {
    betaAdjusted = blumeBeta(beta)
    const equityPremium = betaAdjusted * EQUITY_RISK_PREMIUM_PCT
    const sizePremium = sizePremiumPct(marketCap)
    requiredReturn = riskFreeRate + equityPremium + sizePremium
    adjustments.push({
      factor: 'Risk-free rate (10Y Treasury)',
      adjustmentPctPoints: riskFreeRate,
      value: riskFreeRate,
    })
    adjustments.push({
      factor: 'Beta x equity risk premium',
      adjustmentPctPoints: equityPremium,
      value: betaAdjusted,
    })
    if (sizePremium) {
      adjustments.push({ factor: 'Size premium', adjustmentPctPoints: sizePremium, value: marketCap })
    }
    baseline = riskFreeRate
    method = 'capm'
    sourceText =
      `CAPM: ${riskFreeRate.toFixed(2)}% 10Y Treasury + ${betaAdjusted.toFixed(2)} adjusted beta ` +
      `x ${EQUITY_RISK_PREMIUM_PCT.toFixed(1)}% ERP, plus size, FCF, and leverage add-ons`
    caveat =
      `The ${EQUITY_RISK_PREMIUM_PCT.toFixed(1)}% equity risk premium is a fixed assumption, ` +
      'not a market-implied estimate.'
  }

  if (freeCashFlow !== null && freeCashFlow <= 0) {
    requiredReturn += 1.5
    adjustments.push({ factor: 'Negative FCF', adjustmentPctPoints: 1.5, value: freeCashFlow })
  }
  const [leveragePremium, leverage] = leveragePremiumPct(netDebt, marketCap)
  if (leveragePremium) {
    requiredReturn += leveragePremium
    adjustments.push({
      factor: 'Net debt / market cap',
      adjustmentPctPoints: leveragePremium,
      value: leverage,
    })
  }
  return {
    value: clamp(requiredReturn, 4, 30),
    baseline,
    method,
    riskFreeRate,
    asOf: market?.asOf ? String(market.asOf) : null,
    equityRiskPremium: method === 'capm' ? EQUITY_RISK_PREMIUM_PCT : null,
    betaRaw: beta,
    betaAdjusted,
    adjustments,
    source: sourceText,
    caveat,
  }
}

/** Anchor perpetual growth to market expectations, then cap it so every scenario solves. */
function terminalGrowthPct(
  market: ValuationMarketContext | null | undefined,
  requiredReturnPct: number,
): ValuationTerminalGrowth {
  const riskFreeRate = market ? finiteOrNull(market.riskFreeRate) : null
  const breakeven = market ? finiteOrNull(market.breakevenInflation) : null
  let value: number
  let source: string
  if (breakeven !== null && breakeven > 0) {
    value = breakeven
    source = `10Y breakeven inflation (${breakeven.toFixed(2)}%)`
  } else if (riskFreeRate !== null) {
    value = Math.min(riskFreeRate, DEFAULT_TERMINAL_GROWTH_PCT)
    source =
      `Lesser of the ${riskFreeRate.toFixed(2)}% 10Y Treasury yield and the ` +
      `${DEFAULT_TERMINAL_GROWTH_PCT.toFixed(1)}% mature-growth anchor`
  } else {
    value = DEFAULT_TERMINAL_GROWTH_PCT
    source = 'Independent mature-growth anchor'
  }

  const caps: string[] = []
  if (riskFreeRate !== null && value > riskFreeRate) {
    value = riskFreeRate
    caps.push('capped at the 10Y Treasury yield')
  }
  const spreadCap = requiredReturnPct - (MIN_GORDON_SPREAD_PCT + SPREAD_SAFETY_PCT)
  if (value > spreadCap) {
    value = spreadCap
    caps.push(
      `held ${MIN_GORDON_SPREAD_PCT.toFixed(1)}pp under the required return so the bull case stays solvable`,
    )
  }
  return {
    value: clamp(value, -2, 5),
    source: source + (caps.length ? ` — ${caps.join('; ')}` : ''),
    riskFreeRate,
    breakevenInflation: breakeven,
    capsApplied: caps,
  }
}

/** Pick the best-horizon analyst growth figure, or null when none is usable. */
function analystGrowthPct(
  analyst: ValuationAnalystEstimates | null | undefined,
): { value: number; weight: number; label: string } | null {
  if (!analyst) return null
  const candidates: Array<[number | null, number, string]> = [
    [
      finiteOrNull(analyst.longTermGrowthPct),
      ANALYST_LONG_TERM_WEIGHT,
      'analyst long-term (+5y) growth',
    ],
    [finiteOrNull(analyst.nextYearGrowthPct), ANALYST_NEXT_YEAR_WEIGHT, 'analyst next-year growth'],
  ]
  for (const [value, weight, label] of candidates) {
    if (value === null || Math.abs(value) > MAX_ANALYST_GROWTH_PCT) continue
    return { value, weight, label }
  }
  return null
}

function blendNearGrowth(
  historical: number | null,
  candidates: Array<[string, number]>,
  estimate: { value: number; weight: number; label: string } | null,
): [number, string, Array<{ name: string; value: number }>] {
  const inputs = candidates.map(([name, value]) => ({ name, value }))
  if (estimate) inputs.push({ name: estimate.label, value: estimate.value })
  const historyLabel = candidates.length
    ? `median of ${candidates.map(([name]) => name).join(', ')}`
    : ''
  let value: number
  let source: string
  if (estimate && historical !== null) {
    const weight = estimate.weight
    value = weight * estimate.value + (1 - weight) * historical
    source =
      `${(weight * 100).toFixed(0)}% ${estimate.label} (${estimate.value.toFixed(1)}%) blended with ` +
      `${((1 - weight) * 100).toFixed(0)}% ${historyLabel} (${historical.toFixed(1)}%)`
  } else if (estimate) {
    value = estimate.value
    source = `${estimate.label} (${estimate.value.toFixed(1)}%); no usable annual history`
  } else if (historical !== null) {
    value = historical
    source = `Median of ${candidates.map(([name]) => name).join(', ')}`
  } else {
    value = DEFAULT_VALUATION_ASSUMPTIONS.growth1to5
    source = `No usable growth inputs; held at the ${value.toFixed(1)}% default`
  }
  return [clamp(value, -30, 50), source, inputs]
}

/**
 * Average of a linear fade from near-term growth at year 5 to terminal growth at year N.
 *
 * The DCF charges a single flat rate across years 6..N, so the honest stand-in for a fade
 * is its mean over that tail rather than either endpoint. The closed form is exact.
 */
export function fadeGrowth(nearPct: number, terminalPct: number, projectionYears: number): number {
  const tail = projectionYears - 5
  if (tail <= 0) return terminalPct
  const weight = (projectionYears - 4) / (2 * tail)
  return nearPct + (terminalPct - nearPct) * weight
}

/**
 * Median peer *equity* multiple matched to the model's per-share flow, or null.
 *
 * The DCF multiplies a per-share flow, so the multiple has to be an equity multiple. Peer
 * rows carry no P/FCF column, but `100 / fcfYield` is exactly that; EV/EBITDA is
 * deliberately unused because an enterprise multiple on a per-share equity flow is a unit
 * error.
 */
export function peerExitMultiple(
  peerRows: ValuationPeerRow[] | null | undefined,
  basisType: ValuationBasisType,
  anchorTicker?: string | null,
): ValuationExitMultiple | null {
  const anchor = String(anchorTicker ?? '').toUpperCase().trim()
  const isEps = basisType === 'EPS'
  const [low, high] = EXIT_MULTIPLE_BOUNDS
  const inputs: Array<{ ticker: string; value: number }> = []
  for (const row of peerRows ?? []) {
    if (!row || typeof row !== 'object') continue
    const symbol = String(row.ticker ?? '').toUpperCase().trim()
    if (row.source === 'Loaded' || (anchor && symbol === anchor)) continue
    let multiple: number | null
    if (isEps) {
      multiple = finiteOrNull(row.pe)
      if (multiple === null || multiple <= 0) multiple = finiteOrNull(row.forwardPe)
    } else {
      const fcfYield = finiteOrNull(row.fcfYield)
      multiple = fcfYield !== null && fcfYield > 0 ? 100 / fcfYield : null
    }
    if (multiple === null || multiple <= 0 || multiple < low || multiple > high) continue
    inputs.push({ ticker: symbol || '?', value: multiple })
  }
  if (inputs.length < MIN_PEER_COUNT) return null
  const label = isEps ? 'P/E' : 'P/FCF'
  const excluded = anchor ? ` (${anchor} excluded)` : ''
  return {
    value: clamp(median(inputs.map((item) => item.value)), low, high),
    source: `Median ${label} of ${inputs.length} peers${excluded}`,
    peerCount: inputs.length,
    inputs,
  }
}

/**
 * Size the discount to fair value from how much of the model is supported by real data.
 * The thresholds mirror `modelQuality` rather than inventing a second notion of confidence.
 */
function marginOfSafetyPct(options: {
  basisType: ValuationBasisType
  historyPoints: number
  terminalShare: number | null
  missingInputs: string[]
}): ValuationMarginOfSafety {
  const reasons: string[] = []
  let margin = 15
  if (options.historyPoints < 4) {
    margin += 10
    reasons.push(`${options.historyPoints} comparable annual periods`)
  }
  if (options.historyPoints < 3) margin += 5
  if (options.terminalShare === null || options.terminalShare > 0.75) {
    margin += 10
    reasons.push(
      options.terminalShare !== null
        ? 'terminal value is most of the answer'
        : 'the model did not solve on the derived inputs',
    )
  }
  if (options.terminalShare !== null && options.terminalShare > 0.85) margin += 5
  if (options.basisType === 'EPS') {
    margin += 5
    reasons.push('an EPS basis ignores capital intensity')
  }
  if (options.missingInputs.length) {
    margin += Math.min(5 * options.missingInputs.length, 10)
    reasons.push(`missing ${options.missingInputs.join(', ')}`)
  }
  const detail = reasons.length ? reasons.join('; ') : 'every derivation input was available'
  return { value: clamp(margin, 0, 50), source: `Scaled to model support — ${detail}`, reasons }
}

/**
 * Derive every assumption from reported history, market rates, analyst estimates and peers.
 *
 * Each field carries its own `source` sentence so the page can explain itself, and the
 * order below is load-bearing: the required return sets the terminal-growth cap, terminal
 * growth sets the fade target, and the whole derived set is priced once to size the margin
 * of safety.
 */
export function deriveValuationSuggestions(
  metrics: Partial<ValuationMetrics> | null | undefined,
  trends: Partial<ValuationTrends> | null | undefined,
  basisTypeInput: string = 'FCF',
  options: {
    market?: ValuationMarketContext | null
    analyst?: ValuationAnalystEstimates | null
    peerRows?: ValuationPeerRow[] | null
    projectionYears?: number
    terminalMethod?: ValuationTerminalMethod
  } = {},
): ValuationSuggestionBundle {
  const source = metrics ?? {}
  const trend = trends ?? {}
  const basisType: ValuationBasisType =
    String(basisTypeInput ?? '').toUpperCase().trim() === 'EPS' ? 'EPS' : 'FCF'
  const rawYears = Number(options.projectionYears ?? 10)
  const years = Math.min(Math.max(Number.isFinite(rawYears) ? Math.trunc(rawYears) : 10, 5), 15)
  const historyPoints = Math.max(Math.trunc(Number(trend.comparableHistoryPoints ?? 0)) || 0, 0)

  const caveats = [
    'Suggestions require consecutive, consistently positive annual history; ' +
      'invalid series are excluded in full.',
  ]
  const missingInputs: string[] = []

  const required = estimateRequiredReturn(source, options.market ?? null)
  if (required.method !== 'capm') {
    missingInputs.push('risk-free rate')
    caveats.push(
      'Risk-free rate unavailable; the required return falls back to the 10% heuristic baseline.',
    )
  }

  const terminal = terminalGrowthPct(options.market ?? null, required.value)

  const labels = trend.labels
  const basisSeries =
    basisType === 'EPS'
      ? trend.eps
      : trend.fcfPerShare && trend.fcfPerShare.length
        ? trend.fcfPerShare
        : trend.fcf
  const candidates: Array<[string, number]> = []
  const basisCagr = threeYearCagr(basisSeries, labels)
  if (basisCagr !== null) candidates.push([`3-year ${basisType} CAGR`, basisCagr])
  const revenueCagr = threeYearCagr(trend.revenue, labels)
  if (revenueCagr !== null) candidates.push(['3-year revenue CAGR', revenueCagr])
  const latestRevenueGrowth = finiteOrNull(source.revenueGrowth)
  if (latestRevenueGrowth !== null) candidates.push(['latest revenue growth', latestRevenueGrowth])
  const historical = candidates.length ? median(candidates.map(([, value]) => value)) : null
  const estimate = analystGrowthPct(options.analyst ?? null)
  if (estimate === null) {
    missingInputs.push('analyst estimates')
    caveats.push('Analyst estimates unavailable; near-term growth uses reported history only.')
  }
  const [nearGrowth, growthSource, growthInputs] = blendNearGrowth(historical, candidates, estimate)

  const farGrowth: ValuationSuggestion = {
    value: clamp(fadeGrowth(nearGrowth, terminal.value, years), -15, 30),
    source:
      `Average of a linear fade from ${nearGrowth.toFixed(1)}% at year 5 to ` +
      `${terminal.value.toFixed(1)}% at year ${years}`,
  }

  let exitMultiple = peerExitMultiple(options.peerRows ?? null, basisType, source.ticker)
  if (exitMultiple === null) {
    missingInputs.push('peer multiples')
    caveats.push(
      `Fewer than ${MIN_PEER_COUNT} usable peer multiples; ` +
        `the exit multiple stays at the ${DEFAULT_EXIT_MULTIPLE.toFixed(1)}x default.`,
    )
    exitMultiple = {
      value: DEFAULT_EXIT_MULTIPLE,
      source: `Default ${DEFAULT_EXIT_MULTIPLE.toFixed(1)}x — too few usable peer multiples`,
      peerCount: 0,
      inputs: [],
    }
  }

  const probe = calculateFairValueDetails({
    basisType,
    basisValue: source.basisValue,
    growth1to5: nearGrowth,
    growth6to10: farGrowth.value,
    discountRate: required.value,
    terminalMethod: options.terminalMethod ?? 'gordon_growth',
    terminalGrowth: terminal.value,
    exitMultiple: exitMultiple.value,
    projectionYears: years,
    marginOfSafety: DEFAULT_VALUATION_ASSUMPTIONS.marginOfSafety,
  })

  return {
    basisType,
    fields: {
      discountRate: required,
      terminalGrowth: terminal,
      growth1to5: { value: nearGrowth, source: growthSource, inputs: growthInputs },
      growth6to10: farGrowth,
      exitMultiple,
      marginOfSafety: marginOfSafetyPct({
        basisType,
        historyPoints,
        terminalShare: probe.terminalValueShare,
        missingInputs,
      }),
    },
    caveats,
    market: options.market ?? null,
    quality: { historyPoints, terminalValueShare: probe.terminalValueShare, missingInputs },
  }
}

/**
 * Turn a derivation bundle into the assumption set the page's controls hold.
 *
 * A load always re-derives: saved per-ticker assumptions are the first-paint defaults,
 * never an input to the derivation. `terminalMethod` and `projectionYears` survive because
 * neither has a derivation rule — they are the user's model choices.
 */
export function assumptionsFromSuggestions(
  bundle: ValuationSuggestionBundle,
  metrics: Partial<ValuationMetrics> | null | undefined,
  current: ValuationAssumptions,
): ValuationAssumptions {
  const source = metrics ?? {}
  const basisValue = finiteOrNull(source.basisValue)
  return normalizeValuationAssumptions({
    ...DEFAULT_VALUATION_ASSUMPTIONS,
    terminalMethod: current.terminalMethod,
    projectionYears: current.projectionYears,
    basisType: source.basisType ?? current.basisType,
    basisValue: basisValue !== null && basisValue > 0 ? basisValue : current.basisValue,
    growth1to5: bundle.fields.growth1to5.value,
    growth6to10: bundle.fields.growth6to10.value,
    discountRate: bundle.fields.discountRate.value,
    terminalGrowth: bundle.fields.terminalGrowth.value,
    exitMultiple: bundle.fields.exitMultiple.value,
    marginOfSafety: bundle.fields.marginOfSafety.value,
  })
}

/**
 * Block the price-vs-fair-value comparison when quote and statements disagree on unit.
 *
 * `basisValue` is per-share and comes off the financial statements; `price` comes off the
 * quote. For a foreign listing such as a Korean ADR those are KRW and USD, so the DCF is
 * solved in one currency and compared against a price in another, and every price-relative
 * output — verdict, upside, buy-below, trim-above, the band chart — is nonsense.
 *
 * No FX conversion is applied here on purpose. Converting needs a rate source and a
 * per-statement-period date convention; picking one silently would swap a visible error
 * for an invisible one.
 */
export function valuationCurrencyWarnings(
  metrics: Partial<ValuationMetrics> | null | undefined,
): string[] {
  if (!metrics || !metrics.currencyMismatch) return []
  const quote = String(metrics.currency ?? '').trim() || 'the quote currency'
  const statement = String(metrics.financialCurrency ?? '').trim() || 'the reporting currency'
  return [
    `Price is quoted in ${quote} but the statements report in ${statement}, so fair value ` +
      'cannot be compared to price. Verdict, upside, and the buy/trim band are withheld.',
  ]
}

/* ------------------------------------------------------------- label short */

const LABEL_CLAUSES: Array<[ValuationSuggestionKey, string, (value: number) => string]> = [
  ['discountRate', 'required return', (value) => `${value.toFixed(1)}%`],
  ['growth1to5', 'growth', (value) => `${value.toFixed(1)}%`],
  ['terminalGrowth', 'terminal', (value) => `${value.toFixed(1)}%`],
  ['exitMultiple', 'exit', (value) => `${value.toFixed(1)}x`],
  ['marginOfSafety', 'margin of safety', (value) => `${value.toFixed(0)}%`],
]

/**
 * Compress one derivation into a few words, reading the structured fields not the prose.
 *
 * The full sentence goes in the tooltip. On the summary line it would wrap to six lines
 * and shove the assumption grid off the bottom of the panel.
 */
export function shortDerivationSource(
  key: ValuationSuggestionKey,
  fields: ValuationSuggestionFields,
): string {
  if (key === 'discountRate') {
    const detail = fields.discountRate
    if (detail.method === 'capm' && detail.riskFreeRate !== null) {
      return `CAPM on ${detail.riskFreeRate.toFixed(2)}% 10Y`
    }
    return 'company-risk heuristic'
  }
  if (key === 'terminalGrowth') {
    const detail = fields.terminalGrowth
    if (detail.capsApplied.length) return 'capped under required return'
    if (detail.breakevenInflation !== null) return '10Y breakeven'
    return 'mature-growth anchor'
  }
  if (key === 'growth1to5') {
    const names = fields.growth1to5.inputs.map((item) => item.name)
    const hasAnalyst = names.some((name) => name.startsWith('analyst'))
    const hasHistory = names.some((name) => !name.startsWith('analyst'))
    if (hasAnalyst && hasHistory) return 'analyst + reported history'
    if (hasAnalyst) return 'analyst estimates'
    return hasHistory ? 'reported history' : 'default'
  }
  if (key === 'exitMultiple') {
    const count = fields.exitMultiple.peerCount
    return count ? `median of ${count} peers` : 'default'
  }
  return 'scaled to model support'
}

/**
 * Summarize the derivation in one short line, with the unabridged version as the tooltip.
 * `_valuation_set_assumption_state_label` in the reference builds exactly these two.
 */
export function derivationSummary(
  bundle: ValuationSuggestionBundle,
  stamp: string,
): { summary: string; detail: string } {
  const fields = bundle.fields
  const clauses: string[] = []
  const detailed: string[] = []
  for (const [key, name, format] of LABEL_CLAUSES) {
    const entry = fields[key]
    if (!entry || entry.value === null || entry.value === undefined) continue
    const shown = format(entry.value)
    clauses.push(`${name} ${shown} (${shortDerivationSource(key, fields)})`)
    const source = String(entry.source ?? '').trim()
    detailed.push(`${name} ${shown}${source ? ` - ${source}` : ''}`)
  }
  // The first caveat is the standing one every bundle carries; only the rest are counted.
  const caveats = bundle.caveats.slice(1).filter((item) => item.trim())
  const headline = stamp ? `Auto-derived ${stamp}` : 'Auto-derived'
  let summary = headline + (clauses.length ? ` - ${clauses.join('; ')}` : '')
  if (caveats.length) summary += `. ${caveats.length} caveat${caveats.length === 1 ? '' : 's'}`
  return {
    summary,
    detail: [headline, ...detailed, ...(caveats.length ? ['', ...caveats] : [])].join('\n'),
  }
}
