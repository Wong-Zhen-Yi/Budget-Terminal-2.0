import {
  assumptionsFromSuggestions,
  calculateFairValueDetails,
  calculateValuationScenarios,
  derivationSummary,
  deriveValuationSuggestions,
  estimateRequiredReturn,
  fadeGrowth,
  normalizeValuationAssumptions,
  peerExitMultiple,
  valuationCurrencyWarnings,
  type ValuationMarketContext,
  type ValuationMetrics,
  type ValuationPeerRow,
  type ValuationTrends,
} from '../electron/shared/valuation.js'
import {
  buildPeerRow,
  normalizePeerSymbols,
  peerCandidateSymbols,
  peerSymbols,
} from '../electron/shared/valuationPeers.js'

/**
 * The Valuation page's probe.
 *
 * `--offline` runs only the pure checks, whose expected numbers were taken from the
 * PySide6 app's own `services/valuation.py` and `workers/valuation.py`. The live half
 * loads one ticker end to end and prints what the page would show.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function close(actual: number | null, expected: number, tolerance = 1e-6): boolean {
  return actual !== null && Math.abs(actual - expected) <= tolerance
}

function sampleMetrics(overrides: Partial<ValuationMetrics> = {}): Partial<ValuationMetrics> {
  return {
    ticker: 'TEST',
    beta: 1.4,
    marketCap: 50_000_000_000,
    netDebt: -5_000_000_000,
    freeCashFlow: 4_000_000_000,
    basisType: 'FCF',
    basisValue: 5,
    revenueGrowth: 12,
    currencyMismatch: false,
    ...overrides,
  }
}

const MARKET: ValuationMarketContext = {
  riskFreeRate: 4.2,
  realRate: 1.9,
  breakevenInflation: 2.3,
  asOf: '2026-08-28',
  tenor: '10Y',
  freshness: 'fresh',
  source: 'US Treasury daily par yield curve, 10Y',
}

function assumptionChecks(): void {
  const normalized = normalizeValuationAssumptions({
    basisType: 'eps',
    terminalMethod: 'Exit Multiple',
    growth1to5: 99,
    growth6to10: -99,
    discountRate: 1,
    projectionYears: 99,
    marginOfSafety: 'nonsense',
  })
  assert(normalized.basisType === 'EPS', 'basis type should upper-case')
  assert(normalized.terminalMethod === 'exit_multiple', 'terminal method should normalize spaces')
  assert(normalized.growth1to5 === 50 && normalized.growth6to10 === -15, 'growth should clamp')
  assert(normalized.discountRate === 4, 'required return should clamp to its 4% floor')
  assert(normalized.projectionYears === 15, 'projection years should clamp to 15')
  assert(normalized.marginOfSafety === 20, 'an unparseable margin should fall back to the default')
}

function dcfChecks(): void {
  // A ten-year Gordon DCF on $5.00 of FCF/share at 10%/5% growth and a 10% required
  // return with 2.5% terminal growth. Solved against the reference's own arithmetic.
  const details = calculateFairValueDetails({
    basisType: 'FCF',
    basisValue: 5,
    growth1to5: 10,
    growth6to10: 5,
    discountRate: 10,
    terminalMethod: 'gordon_growth',
    terminalGrowth: 2.5,
    exitMultiple: 15,
    projectionYears: 10,
    marginOfSafety: 20,
  })
  assert(details.projectedBasis.length === 10, 'the explicit forecast should run ten years')
  assert(
    close(details.projectedBasis[4], 5 * 1.1 ** 5, 1e-9),
    'years 1-5 should compound at the near-term rate',
  )
  assert(
    close(details.projectedBasis[9], 5 * 1.1 ** 5 * 1.05 ** 5, 1e-9),
    'years 6-10 should compound at the far rate',
  )
  const last = details.projectedBasis[9]
  const expectedTerminal = ((last * 1.025) / (0.1 - 0.025)) / 1.1 ** 10
  assert(close(details.terminalPv, expectedTerminal, 1e-9), 'the Gordon terminal PV should match')
  assert(
    close(details.explicitForecastPv! + details.terminalPv!, details.fairValue!, 1e-9),
    'fair value should be the sum of its two legs',
  )
  assert(
    close(details.terminalValueShare, details.terminalPv! / details.fairValue!, 1e-12),
    'the terminal share should be the terminal PV over fair value',
  )

  // An EPS basis has no discounted-flow leg at all; the whole answer is the exit multiple.
  const eps = calculateFairValueDetails({
    basisType: 'EPS',
    basisValue: 5,
    growth1to5: 10,
    growth6to10: 5,
    discountRate: 10,
    terminalMethod: 'gordon_growth',
    exitMultiple: 15,
    projectionYears: 10,
  })
  assert(eps.explicitForecastPv === 0, 'an EPS model should carry no explicit forecast PV')
  assert(eps.method === 'earnings_multiple', 'an EPS basis should report the earnings multiple')
  assert(close(eps.terminalValueShare, 1, 1e-12), 'an EPS model is all terminal value')

  const blocked = calculateFairValueDetails({ basisType: 'FCF', basisValue: 0 })
  assert(blocked.fairValue === null, 'a zero basis should not solve')
  assert(
    blocked.warnings.some((warning) => warning.includes('greater than zero')),
    'a zero basis should say so',
  )
  const spread = calculateFairValueDetails({
    basisType: 'FCF',
    basisValue: 5,
    discountRate: 5,
    terminalGrowth: 4.5,
    terminalMethod: 'gordon_growth',
  })
  assert(
    spread.warnings.some((warning) => warning.includes('at least 1 percentage point')),
    'a sub-1pp Gordon spread should be refused',
  )
}

function scenarioChecks(): void {
  const base = {
    basisType: 'FCF' as const,
    basisValue: 5,
    growth1to5: 10,
    growth6to10: 5,
    discountRate: 10,
    terminalMethod: 'gordon_growth' as const,
    terminalGrowth: 2.5,
    exitMultiple: 15,
    projectionYears: 10,
    marginOfSafety: 20,
  }
  const scenarios = calculateValuationScenarios(100, base, { historyPoints: 5 })
  assert(scenarios.scenarios.length === 3, 'there should be three scenarios')
  const [bear, mid, bull] = scenarios.scenarios
  assert(close(bear.assumptions.growth1to5, 5), 'the bear case should cut near growth by 5pp')
  assert(close(bear.assumptions.discountRate, 12), 'the bear case should add 2pp of required return')
  assert(close(bull.assumptions.terminalGrowth, 3), 'the bull case should add 0.5pp of terminal growth')
  assert(scenarios.scenariosOrdered, 'bear <= base <= bull should hold on the defaults')
  assert(
    close(scenarios.buyBelow, mid.fairValue! * 0.8, 1e-9),
    'buy-below should apply the margin of safety to the base case',
  )
  assert(scenarios.upperScenario === bull.fairValue, 'the upper scenario is the bull case')
  assert(scenarios.verdict !== null, 'a solved ladder with a price should produce a verdict')
  assert(
    close(mid.upsidePct, (mid.fairValue! / 100 - 1) * 100, 1e-9),
    'upside should be measured against the price',
  )
  assert(
    scenarios.modelQuality === 'High' || scenarios.modelQuality === 'Medium',
    'a five-period FCF model should not be Low',
  )

  // A quote and statements in different currencies withhold every price-relative output,
  // but the fair values themselves still come back — the model is sound in its own unit.
  const mismatched = calculateValuationScenarios(100, base, {
    historyPoints: 5,
    blockingWarnings: valuationCurrencyWarnings(
      sampleMetrics({ currencyMismatch: true, currency: 'USD', financialCurrency: 'KRW' }),
    ),
  })
  assert(mismatched.baseFairValue !== null, 'a blocked comparison keeps the fair value')
  assert(mismatched.priceComparisonValid === false, 'a currency mismatch blocks the comparison')
  assert(mismatched.verdict === null, 'a blocked comparison withholds the verdict')
  assert(mismatched.buyBelow === null && mismatched.upperScenario === null, 'the band is withheld')
  assert(mismatched.modelQuality === 'Low', 'a blocking warning drops the model quality to Low')
}

function requiredReturnChecks(): void {
  const capm = estimateRequiredReturn(sampleMetrics(), MARKET)
  // Blume: 0.67 * 1.4 + 0.33 = 1.268. 4.2 + 1.268 * 5 = 10.54, no size or leverage add-on.
  assert(capm.method === 'capm', 'a live risk-free rate should select CAPM')
  assert(close(capm.betaAdjusted, 1.268, 1e-9), 'the Blume adjustment should match')
  assert(close(capm.value, 4.2 + 1.268 * 5, 1e-9), 'the CAPM required return should match')
  assert(capm.adjustments.length === 2, 'a large, cash-rich, profitable name has two terms only')

  const heuristic = estimateRequiredReturn(sampleMetrics(), null)
  // 10% baseline plus (1.4 - 1) * 2.
  assert(heuristic.method === 'heuristic', 'no risk-free rate should fall back to the heuristic')
  assert(close(heuristic.value, 10.8, 1e-9), 'the heuristic required return should match')

  const stressed = estimateRequiredReturn(
    sampleMetrics({
      marketCap: 1_000_000_000,
      freeCashFlow: -100_000_000,
      netDebt: 600_000_000,
    }),
    MARKET,
  )
  // 4.2 + 6.34 + 1.0 size (a $1B cap) + 1.5 negative FCF + 2.0 leverage (0.6x market cap).
  assert(close(stressed.value, 4.2 + 1.268 * 5 + 1 + 1.5 + 2, 1e-9), 'every add-on should apply')

  // A currency split makes net debt over market cap an exchange-rate artefact, so the
  // leverage term is dropped while the size premium, quoted on both sides, survives.
  const crossed = estimateRequiredReturn(
    sampleMetrics({
      marketCap: 1_000_000_000,
      freeCashFlow: 100_000_000,
      netDebt: 600_000_000,
      currencyMismatch: true,
    }),
    MARKET,
  )
  assert(close(crossed.value, 4.2 + 1.268 * 5 + 1, 1e-9), 'a mismatch should drop only leverage')
}

function derivationChecks(): void {
  const trends: ValuationTrends = {
    labels: ['2021', '2022', '2023', '2024', '2025'],
    revenue: [10, 12, 15, 18, 22],
    eps: [1, 1.2, 1.5, 1.8, 2.2],
    fcf: [8, 10, 12, 15, 18],
    fcfPerShare: [0.8, 1, 1.2, 1.5, 1.8],
    perShareApproximate: false,
    perShareSource: 'Period reported shares outstanding',
    comparableHistoryPoints: 5,
  }
  const peers: ValuationPeerRow[] = [
    { ticker: 'A', company: 'A', source: 'Auto', marketCap: 1, revenueGrowth: null, netMargin: null, pe: 20, forwardPe: null, evEbitda: null, fcfYield: 5 },
    { ticker: 'B', company: 'B', source: 'Auto', marketCap: 1, revenueGrowth: null, netMargin: null, pe: 25, forwardPe: null, evEbitda: null, fcfYield: 4 },
    { ticker: 'C', company: 'C', source: 'Auto', marketCap: 1, revenueGrowth: null, netMargin: null, pe: 30, forwardPe: null, evEbitda: null, fcfYield: 2.5 },
    { ticker: 'TEST', company: 'Anchor', source: 'Loaded', marketCap: 1, revenueGrowth: null, netMargin: null, pe: 99, forwardPe: null, evEbitda: null, fcfYield: 99 },
  ]

  // 100 / fcfYield gives 20, 25 and 40; the median is 25 and the anchor row is excluded.
  const multiple = peerExitMultiple(peers, 'FCF', 'TEST')
  assert(multiple !== null && close(multiple.value, 25), 'the P/FCF median should exclude the anchor')
  assert(multiple!.peerCount === 3, 'three peers should clear the bounds')
  assert(peerExitMultiple(peers.slice(0, 2), 'FCF', 'TEST') === null, 'two peers is too few')
  const epsMultiple = peerExitMultiple(peers, 'EPS', 'TEST')
  assert(epsMultiple !== null && close(epsMultiple.value, 25), 'the P/E median should be 25x')

  const bundle = deriveValuationSuggestions(sampleMetrics(), trends, 'FCF', {
    market: MARKET,
    analyst: {
      longTermGrowthPct: 20,
      nextYearGrowthPct: 15,
      currentYearGrowthPct: 10,
      analystCount: 30,
      source: 'Yahoo analyst earnings trend',
      available: true,
    },
    peerRows: peers,
  })
  // Terminal growth anchors on the 2.3% breakeven, under both the 4.2% yield and the
  // required-return spread cap, so it is used as-is.
  assert(close(bundle.fields.terminalGrowth.value, 2.3, 1e-9), 'terminal growth should use breakeven')
  assert(!bundle.fields.terminalGrowth.capsApplied.length, 'no cap should bind here')
  // History: 3-year FCF/share CAGR from 1.0 to 1.8, 3-year revenue CAGR from 12 to 22, and
  // the latest 12% revenue growth. The median of those three, blended 60/40 with the
  // analyst long-term figure.
  assert(
    bundle.fields.growth1to5.inputs.length === 4,
    'three history legs plus the analyst leg should be recorded',
  )
  assert(
    bundle.fields.growth1to5.source.includes('60%') &&
      bundle.fields.growth1to5.source.includes('analyst long-term'),
    'the near-growth blend should be weighted 60% to the long-term estimate',
  )
  assert(
    close(
      bundle.fields.growth6to10.value,
      fadeGrowth(bundle.fields.growth1to5.value, bundle.fields.terminalGrowth.value, 10),
      1e-9,
    ),
    'the far growth should be the closed-form fade average',
  )
  assert(close(bundle.fields.exitMultiple.value, 25), 'the exit multiple should be the peer median')
  assert(bundle.quality.missingInputs.length === 0, 'every derivation input was available')

  const starved = deriveValuationSuggestions(sampleMetrics({ revenueGrowth: null }), {
    labels: [],
    revenue: [],
    eps: [],
    fcf: [],
    fcfPerShare: [],
    perShareApproximate: false,
    perShareSource: '',
    comparableHistoryPoints: 0,
  }, 'FCF')
  assert(
    starved.quality.missingInputs.join(',') === 'risk-free rate,analyst estimates,peer multiples',
    'every missing input should be named, in derivation order',
  )
  assert(close(starved.fields.growth1to5.value, 10), 'no growth inputs should hold the default')
  assert(close(starved.fields.exitMultiple.value, 15), 'no peers should hold the 15x default')
  // 15 base + 10 (under four annual periods) + 5 (under three) + 10 (three missing inputs,
  // capped at 10). The terminal share still lands under 0.75, so that leg does not add.
  assert(close(starved.fields.marginOfSafety.value, 40), 'a starved model should widen the margin')
  assert(
    starved.fields.marginOfSafety.reasons.length === 2,
    'the margin should name the periods and the missing inputs',
  )

  const applied = assumptionsFromSuggestions(
    bundle,
    sampleMetrics(),
    normalizeValuationAssumptions({ terminalMethod: 'exit_multiple', projectionYears: 12 }),
  )
  assert(applied.terminalMethod === 'exit_multiple', 'the model choice should survive a re-derive')
  assert(applied.projectionYears === 12, 'the projection horizon should survive a re-derive')
  assert(close(applied.basisValue, 5), 'the basis should come from the loaded metrics')
  assert(close(applied.discountRate, bundle.fields.discountRate.value), 'the required return applies')

  const summary = derivationSummary(bundle, '2026-08-28')
  assert(summary.summary.startsWith('Auto-derived 2026-08-28'), 'the summary should be stamped')
  assert(summary.summary.includes('median of 3 peers'), 'the exit clause should name the peer count')
  assert(summary.detail.split('\n').length >= 6, 'the tooltip should carry a line per clause')
}

function peerChecks(): void {
  assert(
    JSON.stringify(normalizePeerSymbols([' amd ', 'AMD', 'nvda', ''], 'NVDA')) ===
      JSON.stringify(['AMD']),
    'peer symbols should upper-case, de-duplicate and drop the anchor',
  )
  const candidates = peerCandidateSymbols('NVDA', { industry: 'Semiconductors', sector: 'Technology' })
  assert(candidates.includes('AMD') && candidates.includes('AVGO'), 'the chip bucket should win')
  assert(!candidates.includes('NVDA'), 'the anchor is never its own candidate')
  assert(candidates.length <= 16, 'the candidate list is capped at the request budget')

  const infos = {
    NVDA: { industry: 'Semiconductors', sector: 'Technology', marketCap: 3e12, quoteType: 'EQUITY' },
    AMD: { industry: 'Semiconductors', sector: 'Technology', marketCap: 2.5e11, quoteType: 'EQUITY' },
    AVGO: { industry: 'Semiconductors', sector: 'Technology', marketCap: 7e11, quoteType: 'EQUITY' },
  }
  const rows = peerSymbols('NVDA', infos.NVDA, infos)
  assert(rows[0] === 'NVDA', 'the loaded ticker is always the first row')
  assert(rows.length === 5, 'the default table is five rows')
  const withCustom = peerSymbols('NVDA', infos.NVDA, infos, ['TSM', 'ASML'])
  assert(withCustom[1] === 'TSM' && withCustom[2] === 'ASML', 'custom peers follow in order')
  assert(withCustom.length > 5, 'the row budget grows with the custom list')
  assert(withCustom.length <= 12, 'the row budget is capped at twelve')

  const row = buildPeerRow(
    'AMD',
    { shortName: 'AMD Inc', marketCap: 1000, freeCashflow: 50, revenueGrowth: 0.12, profitMargins: 0.08 },
    'Auto',
  )
  assert(close(row.fcfYield, 5), 'FCF yield should be free cash flow over market cap, in percent')
  assert(close(row.revenueGrowth, 12) && close(row.netMargin, 8), 'Yahoo fractions scale by 100')
}

async function liveCheck(symbol: string): Promise<void> {
  const { getValuation } = await import('../electron/services/yahoo/valuation.js')
  const result = await getValuation(symbol, [], true)
  const { metrics, trends, suggestions, peerRows, market } = result.payload
  assert(metrics.price !== null, `${symbol} should return a price`)
  const scenarios = calculateValuationScenarios(
    metrics.price,
    assumptionsFromSuggestions(suggestions, metrics, normalizeValuationAssumptions({})),
    {
      historyPoints: trends.comparableHistoryPoints,
      blockingWarnings: valuationCurrencyWarnings(metrics),
    },
  )
  console.log(
    [
      `${metrics.ticker} ${metrics.companyName}`,
      `price=${metrics.price?.toFixed(2)} basis=${metrics.basisType} ${metrics.basisValue?.toFixed(2)}`,
      `statements=${result.payload.statementSource} (sec=${result.payload.secBacked})`,
      `history=${trends.comparableHistoryPoints} periods over ${trends.labels.join('/') || 'none'}`,
      `riskFree=${market ? `${market.riskFreeRate.toFixed(2)}% ${market.freshness} ${market.asOf}` : 'unavailable'}`,
      `required=${suggestions.fields.discountRate.value.toFixed(2)}% (${suggestions.fields.discountRate.method})`,
      `growth=${suggestions.fields.growth1to5.value.toFixed(1)}%/${suggestions.fields.growth6to10.value.toFixed(1)}%`,
      `terminal=${suggestions.fields.terminalGrowth.value.toFixed(2)}% exit=${suggestions.fields.exitMultiple.value.toFixed(1)}x`,
      `margin=${suggestions.fields.marginOfSafety.value.toFixed(0)}%`,
      `fairValue=${scenarios.baseFairValue?.toFixed(2) ?? 'unsolved'} verdict=${scenarios.verdict ?? 'withheld'}`,
      `quality=${scenarios.modelQuality ?? 'n/a'}`,
      `peers=${peerRows.map((row) => `${row.ticker}:${row.source}`).join(' ')}`,
      `missing=${suggestions.quality.missingInputs.join(', ') || 'none'}`,
      `envelope errors=${result.errors.length}`,
    ].join('\n  '),
  )
  for (const entry of result.payload.provenance) {
    console.log(`  ${entry.metric}: ${entry.source} | ${entry.basis} | ${entry.period}`)
  }
}

async function loadingChecks(): Promise<void> {
  const { valuationTesting, emptyValuation } = await import('../electron/services/yahoo/valuation.js')
  const { yahoo } = await import('../electron/services/yahoo/client.js')
  const { captureSources } = await import('../electron/services/sourceHealth.js')
  const { emptyFundamentalsPagePayload } = await import('../electron/services/yahoo/fundamentalsPage.js')
  const originalSummary = yahoo.quoteSummary
  let requests = 0
  try {
    Object.assign(yahoo, {
      quoteSummary: async () => {
        requests += 1
        if (requests === 1) throw new DOMException('This operation was aborted', 'AbortError')
        return { price: { longName: 'Probe company', regularMarketPrice: 100, currency: 'USD' } }
      },
    })
    const info = await valuationTesting.fetchInfo('VALUATION-PROBE', true)
    assert(requests === 2 && info.regularMarketPrice === 100, 'interrupted metadata should retry once')
    requests = 0
    Object.assign(yahoo, { quoteSummary: async () => {
      requests += 1
      throw new DOMException('This operation was aborted', 'AbortError')
    } })
    const fallback = await captureSources(() => valuationTesting.fetchInfo('VALUATION-PROBE', true))
    assert(requests === 2, 'repeated interruptions must stop after two attempts')
    assert(fallback.value.regularMarketPrice === 100 && fallback.snapshot?.stale, 'metadata fallback must preserve data and mark it stale')
    let invalidRequests = 0
    try {
      await valuationTesting.retryInterrupted(async () => { invalidRequests += 1; throw new Error('Ticker not found') })
    } catch { /* An invalid symbol must propagate without a transport retry. */ }
    assert(invalidRequests === 1, 'non-transport failures must not be retried')
  } finally {
    Object.assign(yahoo, { quoteSummary: originalSummary })
  }

  const statements = emptyFundamentalsPagePayload('TEST')
  const fetchers = {
    info: async () => ({ symbol: 'TEST', regularMarketPrice: 100, financialCurrency: 'USD', currency: 'USD' }),
    statements: async () => ({ payload: statements, failures: [{ source: 'SEC EDGAR', operation: 'annual statements', reason: 'SEC request timed out' }], stale: true }),
    history: async () => [{ date: '2026-10-14', close: 100 }],
    market: async () => MARKET,
    peers: async () => ({ rows: [], warnings: [] }),
  }
  const partial = await valuationTesting.fetchUncached('TEST', [], true, fetchers)
  assert(partial.payload.metrics.price === 100, 'partial statements must not discard the quote')
  assert(partial.errors.some(error => error.source === 'SEC EDGAR' && error.operation === 'annual statements'), 'statement failures must keep their source and operation')
  const stale = await valuationTesting.fetchUncached('TEST', [], true, {
    ...fetchers, statements: async () => ({ payload: statements, failures: [], stale: true }),
  })
  assert(stale.errors.some(error => error.operation === 'statements' && error.reason.includes('cached')), 'stale statements must remain visible')
  assert(emptyValuation('MISSING').generatedAt === 0, 'a failed load must not look completed')
}

async function main(): Promise<void> {
  assumptionChecks()
  dcfChecks()
  scenarioChecks()
  requiredReturnChecks()
  derivationChecks()
  peerChecks()
  await loadingChecks()
  console.log('Valuation offline checks passed.')
  if (process.argv.includes('--offline')) return
  const symbol = process.argv.slice(2).find((value) => !value.startsWith('-'))?.toUpperCase() ?? 'NVDA'
  await liveCheck(symbol)
}

await main()
