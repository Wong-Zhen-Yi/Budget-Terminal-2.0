import type { Fundamentals, Holding, Portfolio, Quote } from './contract.js'

/**
 * Portfolio maths, ported from the PySide6 `dashboard_presenters.py`,
 * `portfolio_presenters.py` and `_p4_build_tracker_metrics_map`. Kept in `shared/` so
 * the renderer and the probe scripts compute identical numbers from identical inputs.
 */

/* --------------------------------------------------- dashboard holdings panel */

export interface PortfolioRow {
  unavailableReason?: string
  ticker: string
  price: number | null
  changePercent: number | null
  /** Percent of the portfolio's market value, null when there is no position or quote. */
  weight: number | null
  /** Unrealised dollar gain, null when there is no position or quote. */
  gain: number | null
  shares: number
  includeInWeight: boolean
  avgPrice: number
  marketValue: number | null
  hasQuote: boolean
}

function holdingFor(portfolio: Portfolio, ticker: string): Holding {
  return portfolio.holdings[ticker] ?? { ticker, shares: 0, avgPrice: 0, includeInWeight: true }
}

/** All allocation views use included holdings and only cash selected for weighting. */
function allocationBasis(portfolio: Portfolio, rows: readonly { shares: number; includeInWeight: boolean; marketValue: number | null }[]) {
  const included = rows.filter(row => row.includeInWeight && row.shares > 0)
  return {
    complete: included.every(row => row.marketValue !== null),
    total: included.reduce((sum, row) => sum + (row.marketValue ?? 0), 0)
      + (portfolio.includeCashInWeight ? Math.max(portfolio.cashBalance, 0) : 0),
  }
}

/** Brokerage books are USD-native; an unavailable conversion must not become a USD mark. */
export function usablePortfolioQuote(quote: Quote | undefined): quote is Quote {
  return Boolean(quote && Number.isFinite(quote.price) && (!quote.currency || quote.currency.toUpperCase() === 'USD'))
}

export function unavailablePortfolioQuoteReason(ticker: string, quote: Quote | undefined): string {
  return quote?.currency && quote.currency.toUpperCase() !== 'USD'
    ? `${ticker} is quoted in ${quote.currency}; USD valuation requires a currency conversion.`
    : `${ticker}: market mark unavailable.`
}

export function buildPortfolioRows(
  portfolio: Portfolio,
  quotes: Record<string, Quote>,
): PortfolioRow[] {
  const rows: PortfolioRow[] = portfolio.tickers.map((ticker) => {
    const holding = holdingFor(portfolio, ticker)
    const quote = usablePortfolioQuote(quotes[ticker]) ? quotes[ticker] : undefined
    const hasQuote = Boolean(quote)
    const price = quote?.price ?? 0
    return {
      ticker,
      price: hasQuote ? price : null,
      changePercent: quote?.change ?? null,
      weight: null,
      gain: null,
      shares: holding.shares,
      includeInWeight: holding.includeInWeight,
      avgPrice: holding.avgPrice,
      marketValue: !holding.shares ? 0 : hasQuote ? holding.shares * price : null,
      hasQuote,
      unavailableReason: hasQuote ? '' : unavailablePortfolioQuoteReason(ticker, quotes[ticker]),
    }
  })

  const { complete, total } = allocationBasis(portfolio, rows)
  for (const row of rows) {
    if (!row.shares || !row.hasQuote) continue
    row.weight = row.includeInWeight && row.shares > 0 && complete && row.marketValue !== null
      ? total > 0 ? (row.marketValue / total) * 100 : 0 : null
    row.gain = ((row.price ?? 0) - row.avgPrice) * row.shares
  }

  // Biggest dollar gain first, matching the PySide6 table's default ordering.
  return rows.sort((a, b) => (b.gain ?? -Infinity) - (a.gain ?? -Infinity))
}

/** Positive, weight-included allocations; never rebase around missing market marks. */
export function buildPortfolioAllocation(portfolio: Portfolio, quotes: Record<string, Quote>) {
  const included = buildPortfolioRows(portfolio, quotes)
    .filter(row => row.includeInWeight && row.shares > 0)
  const missingReasons = included
    .filter(row => row.marketValue === null || !Number.isFinite(row.marketValue))
    .map(row => row.unavailableReason || `${row.ticker}: market value unavailable.`)
  const slices = included
    .filter(row => row.marketValue !== null && Number.isFinite(row.marketValue) && row.marketValue > 0)
    .map(row => ({ label: row.ticker, value: row.marketValue! }))
  if (portfolio.includeCashInWeight && Number.isFinite(portfolio.cashBalance) && portfolio.cashBalance > 0) {
    slices.push({ label: 'CASH', value: portfolio.cashBalance })
  }
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  return {
    complete: missingReasons.length === 0,
    missingReasons,
    total,
    slices: missingReasons.length ? [] : slices.sort((a, b) => b.value - a.value),
  }
}

/* ------------------------------------------------------ portfolio page rows */

export interface PositionRow {
  unavailableReason?: string
  ticker: string
  shares: number
  avgPrice: number
  cost: number
  price: number | null
  /** Day's change, as a percent. */
  changePercent: number | null
  marketValue: number | null
  /** Null when the position is excluded from weight, which renders as `--`. */
  weight: number | null
  dollarGain: number | null
  /** Dollar gain as a percent of cost. */
  growth: number | null
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
  complete: boolean
  missingTickers: string[]
  missingReasons: string[]
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
    const quote = usablePortfolioQuote(quotes[ticker]) ? quotes[ticker] : undefined
    const price = quote?.price ?? null
    const cost = holding.shares * holding.avgPrice
    const marketValue = holding.shares === 0 ? 0 : price === null ? null : holding.shares * price
    return {
      ticker,
      holding,
      quote,
      price,
      cost,
      marketValue,
      dollarGain: marketValue === null ? null : marketValue - cost,
    }
  })

  const { complete, total: gross } = allocationBasis(portfolio, priced.map(entry => ({
    shares: entry.holding.shares, includeInWeight: entry.holding.includeInWeight, marketValue: entry.marketValue,
  })))

  return priced.map((entry): PositionRow => {
    const facts = fundamentals[entry.ticker]
    const target = facts?.targetMeanPrice ?? null
    const analystUpside =
      target !== null && entry.price !== null && entry.price > 0 ? ((target - entry.price) / entry.price) * 100 : null

    return {
      ticker: entry.ticker,
      shares: entry.holding.shares,
      avgPrice: entry.holding.avgPrice,
      cost: entry.cost,
      price: entry.price,
      changePercent: entry.quote?.change ?? null,
      marketValue: entry.marketValue,
      weight: entry.holding.includeInWeight && entry.holding.shares > 0 && complete && entry.marketValue !== null
        ? gross > 0
          ? (entry.marketValue / gross) * 100
          : 0
        : null,
      dollarGain: entry.dollarGain,
      growth: entry.dollarGain === null ? null : entry.cost ? (entry.dollarGain / entry.cost) * 100 : 0,
      includeInWeight: entry.holding.includeInWeight,
      hasQuote: Boolean(entry.quote),
      unavailableReason: entry.quote ? '' : unavailablePortfolioQuoteReason(entry.ticker, quotes[entry.ticker]),
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
  const missingTickers = included.filter(row => row.marketValue === null).map(row => row.ticker)
  const stockValue = included.reduce((sum, row) => sum + (row.marketValue ?? 0), 0)
  const stockPnl = included.reduce((sum, row) => sum + (row.dollarGain ?? 0), 0)
  const cash = portfolio.includeCashInWeight ? Math.max(portfolio.cashBalance, 0) : 0
  const margin = Math.max(portfolio.marginDebt, 0)
  const grossAssets = Math.max(stockValue, 0) + Math.max(portfolio.cashBalance, 0)

  return {
    complete: missingTickers.length === 0,
    missingTickers,
    missingReasons: included.filter(row => row.marketValue === null).map(row => row.unavailableReason ?? `${row.ticker}: market mark unavailable.`),
    stockValue,
    stockPnl,
    total: stockValue + cash - margin,
    marginUtilization: !missingTickers.length && margin > 0 && grossAssets > 0 ? (margin / grossAssets) * 100 : null,
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
