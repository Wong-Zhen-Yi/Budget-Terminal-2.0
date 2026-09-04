/**
 * Print both holdings views exactly as the UI renders them.
 *
 *   npm run probe:portfolio
 *
 * Compare against the PySide6 app: the Dashboard panel's Weight/Gain, and the Portfolio
 * page's twelve columns and header figures.
 *
 * The two Weight columns legitimately disagree. The Dashboard divides by stock market
 * value alone; the Portfolio page divides by stock value plus cash. That is what the
 * reference app does, in `dashboard_presenters.py` and `_p4_build_tracker_metrics_map`
 * respectively.
 */
import assert from 'node:assert/strict'

import type { OptionPosition, Portfolio } from '../electron/shared/contract.js'
import {
  OPTION_STATUSES,
  OPTION_STRATEGIES,
  computeOptionMetrics,
  isSellerStrategy,
} from '../electron/shared/analytics.js'
import { optionsEquity } from '../electron/shared/financeMath.js'
import {
  buildPortfolioRows,
  buildPositionRows,
  sizeBucket,
  summarizePortfolio,
} from '../electron/shared/portfolioMath.js'
import { yahooProvider } from '../electron/services/provider.js'

function pad(text: string, width: number, align: 'left' | 'right' = 'right'): string {
  return align === 'left' ? text.padEnd(width) : text.padStart(width)
}

function money(value: number | null | undefined, digits = 2): string {
  return typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(digits)}` : '--'
}

function signed(value: number, digits = 2): string {
  return `${value >= 0 ? '+' : '-'}$${Math.abs(value).toFixed(digits)}`
}

function compact(value: number | null): string {
  if (value === null) return '--'
  const abs = Math.abs(value)
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  return value.toFixed(0)
}

async function main(): Promise<void> {
  const portfolio = await yahooProvider.portfolio()
  if (portfolio.meta.freshness === 'failed') {
    console.error(`Could not read holdings: ${portfolio.meta.failureReason}`)
    process.exit(1)
  }
  console.log(`store : ${portfolio.data.sourcePath}`)
  console.log(`active: ${portfolio.data.activeId ?? 'none'}   main: ${portfolio.data.mainId ?? 'none'}`)

  for (const entry of portfolio.data.portfolios) {
    const quotes = await yahooProvider.quotes({ holdings: entry.tickers })
    const facts = await yahooProvider.fundamentals({ tickers: entry.tickers })
    const positions = buildPositionRows(
      entry,
      quotes.data.holdings,
      facts.data.fundamentals,
    )
    const summary = summarizePortfolio(entry, positions)

    console.log(`\n${'='.repeat(96)}`)
    console.log(
      `${entry.name}${entry.readOnly ? '  (read-only)' : ''}   ` +
        `cash ${money(entry.cashBalance)}${entry.includeCashInWeight ? '' : ' (excluded)'}   ` +
        `margin ${money(entry.marginDebt)}`,
    )
    console.log(
      `Total ${money(summary.total)}   Stock P&L ${signed(summary.stockPnl)}   ` +
        `Positions ${summary.positionCount}` +
        (summary.marginUtilization === null
          ? ''
          : `   Margin used ${summary.marginUtilization.toFixed(1)}%`),
    )

    console.log('\nPortfolio page')
    console.log(
      `  ${pad('Symbol', 8, 'left')}${pad('Shares', 10)}${pad('Avg', 10)}${pad('Cost', 13)}` +
        `${pad('Price', 10)}${pad('Day %', 9)}${pad('Mkt Value', 14)}${pad('Weight', 9)}` +
        `${pad('Gain', 14)}${pad('Growth', 9)}  ${pad('Size', 14, 'left')}${pad('Analyst PT', 18, 'left')}`,
    )
    for (const row of [...positions].sort((a, b) => b.marketValue - a.marketValue)) {
      const size =
        row.size === null
          ? '--'
          : row.sizeType === 'aum'
            ? `AUM $${compact(row.size)}`
            : `${sizeBucket(row.size)} $${compact(row.size)}`
      const analyst = row.analystNotApplicable
        ? 'N/A'
        : row.analystTarget === null || row.analystUpside === null
          ? '--'
          : `${money(row.analystTarget)} (${row.analystUpside >= 0 ? '+' : ''}${row.analystUpside.toFixed(1)}%)`
      console.log(
        `  ${pad(row.ticker + (row.includeInWeight ? '' : '*'), 8, 'left')}` +
          pad(String(row.shares), 10) +
          pad(row.avgPrice.toFixed(2), 10) +
          pad(money(row.cost), 13) +
          pad(row.hasQuote ? money(row.price) : '--', 10) +
          pad(`${row.changePercent >= 0 ? '+' : ''}${row.changePercent.toFixed(2)}%`, 9) +
          pad(money(row.marketValue), 14) +
          pad(row.weight === null ? '--' : `${row.weight.toFixed(1)}%`, 9) +
          pad(signed(row.dollarGain), 14) +
          pad(`${row.growth >= 0 ? '+' : ''}${row.growth.toFixed(1)}%`, 9) +
          '  ' +
          pad(size, 14, 'left') +
          pad(analyst, 18, 'left'),
      )
    }
    if (positions.some((row) => !row.includeInWeight)) {
      console.log('  * excluded from Weight and the header figures')
    }

    console.log('\nDashboard panel')
    const dashboard = buildPortfolioRows(entry, quotes.data.holdings)
    console.log(
      `  ${pad('Ticker', 8, 'left')}${pad('Price', 12)}${pad('Chg %', 10)}${pad('Weight', 10)}${pad('Gain $', 14)}`,
    )
    for (const row of dashboard) {
      console.log(
        `  ${pad(row.ticker, 8, 'left')}` +
          pad(row.price === null ? '--' : money(row.price), 12) +
          pad(
            row.changePercent === null
              ? '--'
              : `${row.changePercent >= 0 ? '+' : ''}${row.changePercent.toFixed(2)}%`,
            10,
          ) +
          pad(row.weight === null ? '--' : `${row.weight.toFixed(1)}%`, 10) +
          pad(
            row.gain === null
              ? '--'
              : `${row.gain >= 0 ? '+' : '-'}$${Math.abs(Math.round(row.gain)).toLocaleString()}`,
            14,
          ),
      )
    }
  }

  await liveOptions(portfolio.data.portfolios)
  console.log()
}

/* ------------------------------------------------------------------- options */

/**
 * The Options Positions tab's maths, asserted rather than printed.
 *
 * Buying and selling are not symmetric, and that is the easy thing to break: a bought
 * contract's P&L is the mark less what was paid and its return is measured against that
 * premium, while a sold one (`Covered Call`, `Cash Secured Put`) profits as the mark
 * decays and earns against the collateral the strike ties up. `optionsEquity` splits the
 * same way, which is what the Personal Finance brokerage bar stacks on top of cash.
 */
function offlineOptions(): void {
  const round = (value: number): number => Math.round(value * 1e6) / 1e6
  // Fixed dates, both in the past: annualisation reads the open-to-expiry span, which
  // must not drift with the day the probe happens to run.
  const base = { strike: 100, expiry: '2026-03-02', openDate: '2026-01-01' }

  const long = computeOptionMetrics({
    ...base,
    strategy: 'Calls',
    contracts: 2,
    premium: 2,
    currentPrice: 3.5,
  })
  assert.equal(long.pnl, 300)
  assert.equal(long.returnPct, 75)
  // 60 days on the books at open, annualised over that life rather than what is left.
  assert.equal(round(long.annualPct), round(75 * (365 / 60)))

  const longLoss = computeOptionMetrics({
    ...base,
    strategy: 'Puts',
    contracts: 1,
    premium: 4,
    currentPrice: 1,
  })
  assert.equal(longLoss.pnl, -300)
  assert.equal(longLoss.returnPct, -75)

  // The seller's P&L inverts: the same 2.00 -> 3.50 move is a 300 dollar loss.
  const short = computeOptionMetrics({
    ...base,
    strategy: 'Covered Call',
    contracts: 2,
    premium: 2,
    currentPrice: 3.5,
  })
  assert.equal(short.pnl, -300)
  // The seller's return is the premium against the collateral, so it does not move with
  // the mark: 400 taken against 20,000 tied up is 2%, priced at 3.50 or at zero.
  assert.equal(short.returnPct, 2)
  assert.equal(
    computeOptionMetrics({
      ...base,
      strategy: 'Covered Call',
      contracts: 2,
      premium: 2,
      currentPrice: 0,
    }).returnPct,
    2,
  )
  assert.equal(
    computeOptionMetrics({
      ...base,
      strategy: 'Cash Secured Put',
      contracts: 5,
      premium: 3,
      currentPrice: 1,
    }).pnl,
    1000,
  )

  // Divisions that would otherwise reach a table cell as Infinity or NaN.
  assert.equal(
    computeOptionMetrics({ ...base, strategy: 'Calls', contracts: 1, premium: 0, currentPrice: 2 })
      .returnPct,
    0,
  )
  assert.equal(
    computeOptionMetrics({
      ...base,
      strike: 0,
      strategy: 'Cash Secured Put',
      contracts: 1,
      premium: 2,
      currentPrice: 1,
    }).returnPct,
    0,
  )

  // A row still being typed carries neither date: annualising falls back to one day.
  const blank = computeOptionMetrics({
    strategy: 'Calls',
    contracts: 1,
    premium: 2,
    currentPrice: 3,
    strike: 0,
    expiry: '',
    openDate: '',
  })
  assert.equal(blank.daysToExpiry, 0)
  assert.equal(round(blank.annualPct), round(50 * 365))

  // An expiry already past reads as zero days out, never negative.
  assert.equal(
    computeOptionMetrics({ ...base, strategy: 'Calls', contracts: 1, premium: 1, currentPrice: 1 })
      .daysToExpiry,
    0,
  )

  assert.deepEqual(
    OPTION_STRATEGIES.filter((strategy) => isSellerStrategy(strategy)),
    ['Covered Call', 'Cash Secured Put'],
  )
  assert.equal(OPTION_STATUSES[0], 'Open', 'a new row is stored as Open')

  const row = (patch: Partial<OptionPosition>): OptionPosition => ({
    rowId: 'probe',
    ticker: 'AAPL',
    strategy: 'Calls',
    expiry: base.expiry,
    strike: 100,
    contracts: 1,
    premium: 2,
    status: 'Open',
    openDate: base.openDate,
    currentPrice: 0,
    volume: 0,
    openInterest: 0,
    impliedVolatility: 0,
    ...patch,
  })
  // A bought contract is worth its mark; a sold one, what is left of the premium.
  assert.equal(optionsEquity([row({ currentPrice: 3.5, contracts: 2 })]), 700)
  assert.equal(optionsEquity([row({ strategy: 'Covered Call', currentPrice: 3.5, contracts: 2 })]), -300)
  assert.equal(optionsEquity([row({ strategy: 'Cash Secured Put', premium: 3, currentPrice: 1 })]), 200)
  // A contract Yahoo refused to price keeps its stored premium and values at zero, not NaN.
  assert.equal(optionsEquity([row({ contracts: Number.NaN, currentPrice: Number.POSITIVE_INFINITY })]), 0)
  assert.equal(optionsEquity([]), 0)

  console.log('offline: all option-tracker assertions passed')
}

/**
 * The live half: price a contract through the tracker's own path and cross-check it
 * against the Options page's chain — the two reach Yahoo by different calls and must
 * agree — then value whatever the store actually holds.
 */
async function liveOptions(portfolios: Portfolio[]): Promise<void> {
  console.log(`\n${'='.repeat(96)}`)
  console.log('Options Positions')

  const chain = await yahooProvider.options({ symbol: 'SPY' })
  const sample = chain.data.buckets.flatMap((bucket) => bucket.rows).find((row) => row.lastPrice > 0)
  if (!sample) {
    console.log('  no SPY contracts came back; skipping the chain cross-check')
  } else {
    const strategy = sample.type === 'Put' ? 'Puts' : 'Calls'
    const quoted = await yahooProvider.optionQuotes({
      positions: [
        {
          rowId: 'probe',
          ticker: sample.ticker,
          expiry: sample.expiration,
          strike: sample.strike,
          strategy,
        },
      ],
    })
    const live = quoted.data.quotes.probe
    console.log(
      `  chain   ${sample.ticker} ${sample.expiration} ${sample.strike} ${strategy}   ` +
        `last ${money(sample.lastPrice)}  vol ${sample.volume}  oi ${sample.openInterest}  ` +
        `iv ${(sample.impliedVolatility * 100).toFixed(1)}%`,
    )
    if (!live) {
      console.log('  FAIL    the tracker could not price a contract the chain lists')
      process.exitCode = 1
    } else {
      console.log(
        `  tracker ${sample.ticker} ${sample.expiration} ${sample.strike} ${strategy}   ` +
          `last ${money(live.currentPrice)}  vol ${live.volume}  oi ${live.openInterest}  ` +
          `iv ${(live.impliedVolatility * 100).toFixed(1)}%`,
      )
      assert.equal(
        live.currentPrice,
        sample.lastPrice,
        'the tracker and the chain must price the same contract alike',
      )
      assert.equal(live.openInterest, sample.openInterest)
      assert.equal(live.impliedVolatility, sample.impliedVolatility)
    }

    // The Expiry dropdown is filled from this list, so the expiry the chain just used
    // has to appear in it or the cell would fall back to plain text.
    const expiries = quoted.data.expiries[sample.ticker] ?? []
    console.log(`  expiries: ${expiries.length} listed, ${expiries.slice(0, 4).join(' ')} ...`)
    assert(expiries.includes(sample.expiration), 'the Expiry dropdown is missing the chain expiry')

    // A strike nobody lists must drop the row rather than snap to a neighbour.
    const bogus = await yahooProvider.optionQuotes({
      positions: [
        {
          rowId: 'bogus',
          ticker: sample.ticker,
          expiry: sample.expiration,
          strike: sample.strike + 0.37,
          strategy,
        },
      ],
    })
    assert.equal(
      bogus.data.quotes.bogus,
      undefined,
      'an unlisted strike must not be matched to a neighbouring contract',
    )
    console.log('  ok      an unlisted strike leaves the row on its stored premium')
  }

  const tracked = portfolios
    .filter((portfolio) => !portfolio.readOnly)
    .flatMap((portfolio) => portfolio.options.map((option) => ({ portfolio, option })))
  if (!tracked.length) {
    console.log('\n  the store holds no option positions — add one on the Portfolio page to fill this table')
    return
  }

  const quotes = await yahooProvider.optionQuotes({
    positions: tracked
      .filter(({ option }) => option.ticker && option.expiry && option.strike > 0)
      .map(({ option }) => ({
        rowId: option.rowId,
        ticker: option.ticker,
        expiry: option.expiry,
        strike: option.strike,
        strategy: option.strategy,
      })),
  })

  console.log(
    `\n  ${pad('Portfolio', 14, 'left')}${pad('Ticker', 8, 'left')}${pad('Type', 18, 'left')}` +
      `${pad('Expiry', 12, 'left')}${pad('Strike', 9)}${pad('Qty', 6)}${pad('Premium', 10)}` +
      `${pad('Market', 10)}${pad('Vol', 9)}${pad('OI', 9)}${pad('IV', 8)}${pad('P&L', 12)}` +
      `${pad('Return', 10)}${pad('Annual', 10)}  ${pad('Status', 10, 'left')}`,
  )
  const merged = tracked.map(({ portfolio, option }) => {
    // Exactly the merge `buildOptionRows` does before the table renders.
    const live = quotes.data.quotes[option.rowId]
    return { portfolio, option: live ? { ...option, ...live } : option }
  })
  let totalPnl = 0
  for (const { portfolio, option } of merged) {
    const metrics = computeOptionMetrics(option)
    totalPnl += metrics.pnl
    console.log(
      `  ${pad(portfolio.name, 14, 'left')}${pad(option.ticker || '--', 8, 'left')}` +
        pad(option.strategy, 18, 'left') +
        pad(option.expiry || '--', 12, 'left') +
        pad(option.strike.toFixed(1), 9) +
        pad(String(option.contracts), 6) +
        pad(option.premium.toFixed(2), 10) +
        pad(option.currentPrice ? option.currentPrice.toFixed(2) : '--', 10) +
        pad(String(option.volume), 9) +
        pad(String(option.openInterest), 9) +
        pad(option.impliedVolatility ? `${(option.impliedVolatility * 100).toFixed(0)}%` : '--', 8) +
        pad(signed(metrics.pnl), 12) +
        pad(`${metrics.returnPct >= 0 ? '+' : ''}${metrics.returnPct.toFixed(1)}%`, 10) +
        pad(`${metrics.annualPct >= 0 ? '+' : ''}${metrics.annualPct.toFixed(1)}%`, 10) +
        '  ' +
        pad(option.status, 10, 'left'),
    )
  }
  // What the header prints as Options P&L, and the slice Personal Finance stacks.
  console.log(
    `\n  Options P&L ${signed(totalPnl)}   ` +
      `option equity ${money(optionsEquity(merged.map(({ option }) => option)))}`,
  )
}

offlineOptions()
if (!process.argv.includes('--offline')) {
  await main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
