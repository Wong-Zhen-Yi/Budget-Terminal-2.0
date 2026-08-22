/**
 * Exercise every Yahoo service without Electron or the UI.
 *
 *   npm run probe -- AAPL "1 Week"
 *
 * Compare the printed numbers against the PySide6 app on the same ticker: the price,
 * the MA200 and RSI readings, and the top option rows should match.
 */
import type { TimeframeLabel } from '../electron/shared/contract.js'
import { MACRO_SYMBOLS } from '../electron/shared/contract.js'
import { yahooProvider } from '../electron/services/provider.js'
import { rateGate } from '../electron/services/yahoo/rateGate.js'

const symbol = (process.argv[2] ?? 'AAPL').toUpperCase()
const timeframe = (process.argv[3] ?? '1 Week') as TimeframeLabel

function money(value: number | null | undefined, digits = 2): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : 'N/A'
}

async function main(): Promise<void> {
  const started = Date.now()

  const portfolio = await yahooProvider.portfolio()
  const active =
    portfolio.data.portfolios.find((entry) => entry.id === portfolio.data.activeId) ??
    portfolio.data.portfolios[0]
  const holdings = active?.tickers ?? []
  console.log(`\n== PORTFOLIO (${portfolio.meta.freshness}) ==`)
  console.log(`  source   ${portfolio.data.sourcePath}`)
  console.log(`  active   ${active?.name ?? 'none'} [${holdings.join(', ') || 'empty'}]`)

  const quotes = await yahooProvider.quotes({ holdings })
  console.log(`\n== MACRO (${quotes.meta.freshness}) ==`)
  for (const entry of MACRO_SYMBOLS) {
    const quote = quotes.data.macro[entry.label]
    console.log(
      `  ${entry.label.padEnd(5)} ${quote ? `${money(quote.price)} (${quote.change >= 0 ? '+' : ''}${quote.change.toFixed(2)}%)` : 'unavailable'}`,
    )
  }
  if (holdings.length) {
    console.log('  holdings:')
    for (const ticker of holdings) {
      const quote = quotes.data.holdings[ticker]
      console.log(`    ${ticker.padEnd(6)} ${quote ? money(quote.price) : 'unavailable'}`)
    }
  }

  const chart = await yahooProvider.chart({ symbol, timeframe })
  const { candles, indicators, stats } = chart.data
  console.log(`\n== CHART ${symbol} ${timeframe} (${chart.meta.freshness}) ==`)
  if (chart.meta.failureReason) console.log(`  ! ${chart.meta.failureReason}`)
  console.log(`  bars     ${candles.length} @ ${chart.data.interval}`)
  if (stats) {
    console.log(
      `  quote    ${money(stats.price)}  ${stats.absChange >= 0 ? '+' : ''}${money(stats.absChange)} (${stats.change.toFixed(2)}%)`,
    )
    console.log(
      `  OHLC     O ${money(stats.open)} H ${money(stats.high)} L ${money(stats.low)} C ${money(stats.close)}  Vol ${stats.volume.toLocaleString()}`,
    )
  }
  const lastMa = indicators.ma200.at(-1)
  const lastRsi = indicators.rsi.at(-1)
  const lastRsiMa = indicators.rsiMa.at(-1)
  console.log(`  MA200    ${money(lastMa?.value)}  (${indicators.ma200.length} pts)`)
  console.log(`  RSI(14)  ${money(lastRsi?.value)}   RSI MA(14) ${money(lastRsiMa?.value)}`)
  for (const candle of candles.slice(-3)) {
    console.log(
      `    ${new Date(candle.time * 1000).toISOString().slice(0, 16)}  O ${money(candle.open)} H ${money(candle.high)} L ${money(candle.low)} C ${money(candle.close)}`,
    )
  }

  const options = await yahooProvider.options({ symbol })
  console.log(`\n== TOP OPTIONS ${symbol} (${options.meta.freshness}) ==`)
  for (const bucket of options.data.buckets) {
    console.log(`  ${bucket.label} - exp ${bucket.expiration || 'none'} (${bucket.rows.length} rows)`)
    for (const row of bucket.rows.slice(0, 4)) {
      console.log(
        `    ${row.type.padEnd(4)} ${String(row.strike).padStart(7)}  ${money(row.lastPrice)}  vol ${row.volume.toLocaleString()}`,
      )
    }
  }

  const tickers = holdings.length ? holdings : [symbol]
  const targets = await yahooProvider.targets({ tickers })
  console.log(`\n== TARGETS (${targets.meta.freshness}) ==`)
  for (const row of targets.data.targets) {
    const upside = row.upside === null ? 'N/A' : `${row.upside >= 0 ? '+' : ''}${row.upside.toFixed(1)}%`
    console.log(
      `  ${row.ticker.padEnd(6)} current ${money(row.current).padStart(9)}  target ${money(row.target).padStart(9)}  upside ${upside}${row.unavailableReason ? `  (${row.unavailableReason})` : ''}`,
    )
  }

  const news = await yahooProvider.news({ tickers })
  console.log(`\n== NEWS (${news.meta.freshness}) - ${news.data.items.length} items ==`)
  for (const item of news.data.items.slice(0, 6)) {
    console.log(`  [${item.ticker}] ${item.title}`)
    console.log(`          ${item.source} - ${new Date(item.publishedAt).toISOString().slice(0, 16)}`)
  }

  console.log(
    `\ndone in ${((Date.now() - started) / 1000).toFixed(1)}s | rate gate ${JSON.stringify(rateGate.stats())}\n`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
