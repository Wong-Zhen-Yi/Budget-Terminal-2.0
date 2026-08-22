import type { Fundamentals, Holding, Portfolio, Quote } from './contract.js'

/**
 * Portfolio maths, ported from the PySide6 `dashboard_presenters.py`,
 * `portfolio_presenters.py` and `_p4_build_tracker_metrics_map`. Kept in `shared/` so
 * the renderer and the probe scripts compute identical numbers from identical inputs.
 */

/* --------------------------------------------------- dashboard holdings panel */

export interface PortfolioRow {
  ticker: string
  price: number | null
  changePercent: number | null
  /** Percent of the portfolio's market value, null when there is no position or quote. */
  weight: number | null
  /** Unrealised dollar gain, null when there is no position or quote. */
  gain: number | null
  shares: number
  avgPrice: number
  marketValue: number
  hasQuote: boolean
}

function holdingFor(portfolio: Portfolio, ticker: string): Holding {
  return portfolio.holdings[ticker] ?? { ticker, shares: 0, avgPrice: 0, includeInWeight: true }
}

export function buildPortfolioRows(
  portfolio: Portfolio,
  quotes: Record<string, Quote>,
): PortfolioRow[] {
  const rows: PortfolioRow[] = portfolio.tickers.map((ticker) => {
    const holding = holdingFor(portfolio, ticker)
    const quote = quotes[ticker]
    const hasQuote = Boolean(quote)
    const price = quote?.price ?? 0
    return {
      ticker,
      price: hasQuote ? price : null,
      changePercent: hasQuote ? quote.change : null,
      weight: null,
      gain: null,
      shares: holding.shares,
      avgPrice: holding.avgPrice,
      marketValue: holding.shares ? holding.shares * price : 0,
      hasQuote,
    }
  })

  // Weight is a share of total market value, so it needs every row priced first.
  const totalValue = rows.reduce((sum, row) => sum + row.marketValue, 0)
  for (const row of rows) {
    if (!row.shares || !row.hasQuote) continue
    row.weight = totalValue > 0 ? (row.marketValue / totalValue) * 100 : 0
    row.gain = ((row.price ?? 0) - row.avgPrice) * row.shares
  }

  // Biggest dollar gain first, matching the PySide6 table's default ordering.
  return rows.sort((a, b) => (b.gain ?? -Infinity) - (a.gain ?? -Infinity))
}

/* ------------------------------------------------------ portfolio page rows */

export interface PositionRow {
  ticker: string
  shares: number
  avgPrice: number
  cost: number
  price: number
  /** Day's change, as a percent. */
  changePercent: number
  marketValue: number
  /** Null when the position is excluded from weight, which renders as `--`. */
  weight: number | null
  dollarGain: number
  /** Dollar gain as a percent of cost. */
  growth: number
  includeInWeight: boolean
  hasQuote: boolean
  size: number | null
  sizeType: 'marketCap' | 'aum' | null
  analystTarget: number | null
  /** Percent upside to the analyst target, null when either side is missing. */
  analystUpside: number | null
  /** True for instruments that never carry a target, which render as `N/A`. */
  analystNotApplicable: boolean
}

export interface PortfolioSummary {
  /** Market value of weight-included positions. */
  stockValue: number
  /** Unrealised P&L across weight-included positions. */
  stockPnl: number
  /** Stock value plus counted cash, less margin debt. */
  total: number
  /** Margin debt as a percent of gross assets, or null when there is no debt. */
  marginUtilization: number | null
  positionCount: number
}

const FUND_QUOTE_TYPES = new Set(['ETF', 'MUTUALFUND'])

export function buildPositionRows(
  portfolio: Portfolio,
  quotes: Record<string, Quote>,
  fundamentals: Record<string, Fundamentals> = {},
): PositionRow[] {
  const priced = portfolio.tickers.map((ticker) => {
    const holding = holdingFor(portfolio, ticker)
    const quote = quotes[ticker]
    const price = quote?.price ?? 0
    const cost = holding.shares * holding.avgPrice
    const marketValue = holding.shares * price
    return {
      ticker,
      holding,
      quote,
      price,
      cost,
      marketValue,
      dollarGain: marketValue - cost,
    }
  })

  // The weight denominator is every position plus the full cash balance — the reference
  // app rebases only the allocation views on the include flags, not this column.
  const stockMarketValue = priced.reduce((sum, entry) => sum + entry.marketValue, 0)
  const gross = stockMarketValue + Math.max(portfolio.cashBalance, 0)

  return priced.map((entry): PositionRow => {
    const facts = fundamentals[entry.ticker]
    const target = facts?.targetMeanPrice ?? null
    const analystUpside =
      target !== null && entry.price > 0 ? ((target - entry.price) / entry.price) * 100 : null

    return {
      ticker: entry.ticker,
      shares: entry.holding.shares,
      avgPrice: entry.holding.avgPrice,
      cost: entry.cost,
      price: entry.price,
      changePercent: entry.quote?.change ?? 0,
      marketValue: entry.marketValue,
      weight: entry.holding.includeInWeight
        ? gross > 0
          ? (entry.marketValue / gross) * 100
          : 0
        : null,
      dollarGain: entry.dollarGain,
      growth: entry.cost ? (entry.dollarGain / entry.cost) * 100 : 0,
      includeInWeight: entry.holding.includeInWeight,
      hasQuote: Boolean(entry.quote),
      size: facts?.size ?? null,
      sizeType: facts?.sizeType ?? null,
      analystTarget: target,
      analystUpside,
      analystNotApplicable: Boolean(facts && FUND_QUOTE_TYPES.has(facts.quoteType)),
    }
  })
}

/**
 * The header figures. Unlike the Weight column these count only weight-included
 * positions, and only count cash when the portfolio says to — `filtered_summary` in the
 * PySide6 `portfolio_analysis.py`.
 */
export function summarizePortfolio(
  portfolio: Portfolio,
  rows: PositionRow[],
): PortfolioSummary {
  const included = rows.filter((row) => row.includeInWeight)
  const stockValue = included.reduce((sum, row) => sum + row.marketValue, 0)
  const stockPnl = included.reduce((sum, row) => sum + row.dollarGain, 0)
  const cash = portfolio.includeCashInWeight ? Math.max(portfolio.cashBalance, 0) : 0
  const margin = Math.max(portfolio.marginDebt, 0)
  const grossAssets = Math.max(stockValue, 0) + Math.max(portfolio.cashBalance, 0)

  return {
    stockValue,
    stockPnl,
    total: stockValue + cash - margin,
    marginUtilization: margin > 0 && grossAssets > 0 ? (margin / grossAssets) * 100 : null,
    positionCount: rows.length,
  }
}

/** Size bucket label for the Market Cap / AUM column, as the reference app words it. */
export function sizeBucket(value: number | null): string {
  if (value === null) return ''
  if (value >= 200_000_000_000) return 'Mega'
  if (value >= 10_000_000_000) return 'Large'
  if (value >= 2_000_000_000) return 'Mid'
  if (value >= 300_000_000) return 'Small'
  return 'Micro'
}
