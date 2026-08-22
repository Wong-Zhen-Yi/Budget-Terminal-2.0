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
  console.log()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
