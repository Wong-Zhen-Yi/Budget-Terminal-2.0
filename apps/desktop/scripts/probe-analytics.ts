/**
 * Print the Dip Finder, Momentum, Heatmap and Metrics numbers for the active portfolio.
 *
 *   npm run probe:analytics
 *
 * Every figure here has a counterpart on the matching sub-tab of the PySide6 Portfolio
 * page; they are expected to agree.
 */
import assert from 'node:assert/strict'
import { weightedMove, buildPortfolioSeries, computeRiskMetrics, computeExposure, toReturnSeries } from '../electron/shared/analytics.js'
import { buildPositionRows } from '../electron/shared/portfolioMath.js'
import { sectorFor } from '../electron/shared/sectors.js'
import type { MetricsLookback, ReturnTimeframe } from '../electron/shared/contract.js'
import { yahooProvider } from '../electron/services/provider.js'

const timeframe = (process.argv[2] ?? '1mo') as ReturnTimeframe
const lookback = (process.argv[3] ?? '1y') as MetricsLookback
const benchmark = (process.argv[4] ?? 'SPY').toUpperCase()

function pct(value: number | null | undefined, digits = 1): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`
    : '--'
}

function num(value: number | null | undefined, digits = 2): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '--'
}

function money(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '--'
}

async function main(): Promise<void> {
  const portfolioEnvelope = await yahooProvider.portfolio()
  const payload = portfolioEnvelope.data
  const active =
    payload.portfolios.find((entry) => entry.id === payload.activeId) ?? payload.portfolios[0]
  if (!active) {
    console.error('No portfolios found.')
    process.exit(1)
  }

  const quotes = await yahooProvider.quotes({ holdings: active.tickers })
  const facts = await yahooProvider.fundamentals({ tickers: active.tickers })
  const rows = buildPositionRows(active, quotes.data.holdings, facts.data.fundamentals)
  const included = rows.filter((row) => row.includeInWeight && row.shares > 0)
  const positions = included.map((row) => ({ ticker: row.ticker, shares: row.shares }))
  const cash = active.includeCashInWeight ? Math.max(active.cashBalance, 0) : 0

  console.log(`portfolio: ${active.name}   cash ${money(cash)}   benchmark ${benchmark}`)

  /* ------------------------------------------------------------ dip finder */
  const returns = await yahooProvider.returns({
    tickers: included.map((row) => row.ticker),
    window: timeframe,
  })
  console.log(`\n== DIP FINDER (${timeframe}) ==`)
  for (const [ticker, value] of Object.entries(returns.data.returns).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${ticker.padEnd(8)} ${pct(value)}`)
  }
  if (returns.data.missing.length) console.log(`  missing: ${returns.data.missing.join(', ')}`)

  /* --------------------------------------------------------------- heatmap */
  const totalValue = included.reduce((sum, row) => sum + (row.marketValue ?? 0), 0) + cash
  const tiles = included.map((row) => ({
    ticker: row.ticker,
    sector: sectorFor(row.ticker),
    weight: totalValue > 0 ? ((row.marketValue ?? 0) / totalValue) * 100 : 0,
    changePct: row.changePercent,
  }))
  console.log('\n== HEATMAP (live) ==')
  for (const tile of tiles) {
    console.log(
      `  ${tile.ticker.padEnd(8)} ${tile.sector.padEnd(22)} weight ${tile.weight.toFixed(2)}%  live ${pct(tile.changePct, 2)}`,
    )
  }
  console.log(`  Weighted Move ${pct(weightedMove(tiles), 2)}`)
  console.log(`  Cash ${money(cash)} / ${((cash / totalValue) * 100).toFixed(1)}%`)

  /* -------------------------------------------------------------- momentum */
  const momentum = await yahooProvider.momentum({ positions, cashAmount: cash, timeframe })
  const series = momentum.data
  console.log(`\n== MOMENTUM (${timeframe}) ==`)
  if (series.reason) {
    console.log(`  ${series.reason}`)
  } else {
    const last = series.returns[series.returns.length - 1]
    const lastEma = series.ema[series.ema.length - 1]
    console.log(
      `  Since ${series.startDate} | Portfolio ${pct(last)} | ${series.includedTickers.filter(ticker => ticker !== 'CASH').length} included holdings${cash > 0 ? ' + cash' : ''} | ` +
        `${last >= lastEma ? 'Above' : 'Below'} ${series.emaPeriod}-day EMA`,
    )
    console.log(`  points ${series.dates.length}   ema(last) ${pct(lastEma)}`)
  }

  /* --------------------------------------------------------------- metrics */
  const currentValues: Record<string, number> = {}
  for (const row of included) if (row.marketValue !== null && row.marketValue > 0) currentValues[row.ticker] = row.marketValue
  if (cash > 0) currentValues.CASH = cash

  const analytics = await yahooProvider.analytics({
    positions,
    cashAmount: cash,
    currentValues,
    benchmarkSymbol: benchmark,
    lookback,
  })
  const { metrics, exposure } = analytics.data
  console.log(`\n== METRICS (${lookback}, benchmark ${benchmark}) ==`)
  console.log(
    `  ${analytics.data.includedTickers.filter(ticker => ticker !== 'CASH').length} included holdings${cash > 0 ? ' + cash' : ''} | ${analytics.data.historyPoints} daily points | ` +
      `${analytics.data.startDate} to ${analytics.data.endDate}`,
  )
  if (analytics.data.note) console.log(`  note: ${analytics.data.note}`)
  console.log(`  Portfolio Beta   ${num(metrics.beta)}x`)
  console.log(`  Alpha            ${pct(metrics.alpha)} / yr`)
  console.log(`  Volatility       ${pct(metrics.volatility)} / yr`)
  console.log(`  Max Drawdown     ${pct(metrics.maxDrawdown)}`)
  console.log(`  Sharpe Ratio     ${num(metrics.sharpe)}`)
  console.log(`  Sortino Ratio    ${num(metrics.sortino)}`)
  console.log(`  CAGR             ${pct(metrics.cagr)} / yr`)
  console.log(`  Tail Risk        ${num(metrics.tailRisk)}% CVaR`)
  console.log(`  Skewness         ${num(metrics.skewness)}`)

  console.log('\n== EXPOSURE ==')
  console.log(`  Holdings         ${exposure.holdingsCount}`)
  console.log(`  Valued Holdings  ${exposure.valuedHoldingsCount}`)
  console.log(`  Unpriced         ${exposure.unvaluedHoldingsCount}`)
  console.log(`  Coverage         ${pct(exposure.coveragePct)}`)
  console.log(`  Invested Value   ${money(exposure.investedValue)}`)
  console.log(`  Largest Position ${exposure.largestPositionTicker ?? '--'}`)
  console.log(`  Largest Value    ${money(exposure.largestPositionValue)}`)
  console.log(`  Largest Weight   ${pct(exposure.topPositionWeight)}`)
  console.log(`  Top 3 Weight     ${pct(exposure.top3Weight)}`)
  console.log(`  Top 5 Weight     ${pct(exposure.top5Weight)}`)
  console.log(`  Effective Hldgs  ${num(exposure.effectiveHoldings, 1)}`)
  console.log(`  HHI              ${num(exposure.concentrationScore, 3)}`)
  console.log('  Top Holdings')
  for (const [index, position] of exposure.topPositions.entries()) {
    console.log(
      `    ${index + 1}. ${position.ticker.padEnd(8)} ${pct(position.weightPct)}  ${money(position.value)}`,
    )
  }
  console.log()
}

function offline(): void {
  const { series, included, excluded } = buildPortfolioSeries([{ ticker: 'A', shares: 2 }, { ticker: 'B', shares: 1 }],
    { A: { dates: ['2026-01-01', '2026-01-02', '2026-01-03'], values: [100, 90, 110] } }, 10)
  assert.deepEqual(series.values, [210, 190, 230])
  assert.deepEqual(included, ['A', 'CASH'])
  assert.deepEqual(excluded, ['B'])
  assert.ok(Math.abs(toReturnSeries(series).at(-1)! - (230 / 210 - 1) * 100) < 1e-10,
    'Cash remains a constant zero-return balance in portfolio returns')
  const exposure = computeExposure(2, { A: 200, CASH: 50 })
  assert.equal(exposure.holdingsCount, 2)
  assert.equal(exposure.valuedHoldingsCount, 1, 'Cash is not a priced security')
  assert.equal(exposure.unvaluedHoldingsCount, 1)
  assert.equal(exposure.coveragePct, 50)
  assert.equal(exposure.investedValue, 250)
  assert.equal(exposure.topPositionWeight, 80, 'Counted cash still dilutes portfolio security weights')
  assert.equal(computeRiskMetrics(series, null).metrics.beta, null)
  assert.equal(weightedMove([{ weight: 75, changePct: 2 }, { weight: 25, changePct: -2 }]), 1)
  console.log('PASS: fixed-share series, constant-cash returns, security-only exposure coverage, explicit missing history, optional benchmark and weighted moves')
}
offline()
if (!process.argv.includes('--offline')) main().catch((error) => {
  console.error(error)
  process.exit(1)
})
