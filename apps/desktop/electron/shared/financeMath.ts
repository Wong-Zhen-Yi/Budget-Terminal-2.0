/**
 * Every figure the Personal Finance page prints, ported from the PySide6
 * `mixins/networth.py`.
 *
 * Pure and free of Electron and React, so the page and the probe script compute from
 * the same code and cannot disagree — the role `portfolioMath.ts` plays for the
 * Portfolio page.
 *
 * The currency model: cash and debt rows are natively SGD, portfolios and brokerage
 * accounts natively USD. A display currency is chosen per view, and a conversion that
 * needs a rate it does not have yields zero rather than the unconverted number — that
 * is what makes the reference's totals reproduce.
 */

import type {
  BillFrequency,
  FinanceCurrency,
  FinanceEntry,
  FinanceGoal,
  OptionPosition,
  Portfolio,
  Quote,
  RecurringBill,
} from './contract.js'

/* ------------------------------------------------------------------ colours */

/** `ASSET_COLORS` / `DEBT_COLORS` in `networth.py`. Assigned positionally, not by value. */
export const ASSET_COLORS = ['#66bb6a', '#81c784', '#a5d6a7', '#c8e6c9', '#4caf50', '#43a047']
export const DEBT_COLORS = ['#ef5350', '#e57373', '#ef9a9a', '#f44336', '#d32f2f', '#c62828']
export const PORTFOLIO_LINE_COLORS = ['#1565c0', '#1e88e5', '#42a5f5', '#64b5f6', '#90caf9']
export const CASH_LINE_COLOR = '#2e7d32'
export const DEBT_LINE_COLOR = '#c62828'
export const BROKERAGE_CASH_COLOR = '#f9a825'
export const BROKERAGE_OPTIONS_COLOR = '#7e57c2'

/* --------------------------------------------------------------- conversion */

export function validRate(rate: number | null | undefined): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0
}

/**
 * `_p6_convert_amount`. Note the zero: when a rate is required but missing the
 * reference drops the component rather than passing it through unconverted.
 */
export function convertAmount(
  amount: number,
  native: FinanceCurrency,
  display: FinanceCurrency,
  rate: number | null,
): number {
  const value = Number.isFinite(amount) ? amount : 0
  if (native === display) return value
  if (!validRate(rate)) return 0
  return native === 'USD' ? value * rate : value / rate
}

/* ------------------------------------------------------------ cash and debt */

/** `_p6_category_total`: negatives and non-finite amounts count as zero. */
export function categoryTotal(entries: readonly FinanceEntry[]): number {
  let total = 0
  for (const entry of entries) {
    if (!Number.isFinite(entry.amount)) continue
    total += Math.max(entry.amount, 0)
  }
  return total
}

/* ------------------------------------------------------------------- bills */

/** `_p6_bill_annual_amount`: monthly bills bill twelve times a year, yearly ones once. */
export function billAnnualAmount(amount: number, frequency: BillFrequency): number {
  const value = Number.isFinite(amount) ? Math.max(amount, 0) : 0
  return frequency === 'monthly' ? value * 12 : value
}

/** `_p6_bill_monthly_amount`. */
export function billMonthlyAmount(amount: number, frequency: BillFrequency): number {
  const value = Number.isFinite(amount) ? Math.max(amount, 0) : 0
  return frequency === 'yearly' ? value / 12 : value
}

export interface BillTotals {
  monthly: number
  annual: number
  /** False when a bill in another currency needs a rate that is missing. */
  available: boolean
}

/** `_p6_recurring_bill_totals`: one cross-currency bill without a rate voids both totals. */
export function billTotals(
  bills: readonly RecurringBill[],
  display: FinanceCurrency,
  rate: number | null,
): BillTotals {
  let monthly = 0
  let annual = 0
  for (const bill of bills) {
    const annualAmount = billAnnualAmount(bill.amount, bill.frequency)
    if (annualAmount <= 0) continue
    if (bill.currency !== display && !validRate(rate)) {
      return { monthly: 0, annual: 0, available: false }
    }
    const monthlyAmount = billMonthlyAmount(bill.amount, bill.frequency)
    monthly += convertAmount(monthlyAmount, bill.currency, display, rate)
    annual += convertAmount(annualAmount, bill.currency, display, rate)
  }
  return { monthly, annual, available: true }
}

/* -------------------------------------------------------- portfolio values */

/** One portfolio valued in USD. Mirrors `_p6_portfolio_breakdown`. */
export interface PortfolioSilo {
  id: string
  name: string
  /** Shares times the live mark, summed. */
  stocks: number
  /** Brokerage cash. */
  cash: number
  options: number
  marginDebt: number
}

/** Strategies where the contract was sold, so equity is what is left of the premium. */
const SELLER_STRATEGIES = new Set(['Covered Call', 'Cash Secured Put'])

export function optionsEquity(options: readonly OptionPosition[]): number {
  let total = 0
  for (const position of options) {
    const contracts = Number.isFinite(position.contracts) ? position.contracts : 0
    const premium = Number.isFinite(position.premium) ? position.premium : 0
    const current = Number.isFinite(position.currentPrice) ? position.currentPrice : 0
    total += SELLER_STRATEGIES.has(position.strategy)
      ? (premium - current) * contracts * 100
      : current * contracts * 100
  }
  return total
}

/**
 * Value every real portfolio. The Combined aggregate is skipped: it restates the same
 * holdings and would double every silo.
 */
export function portfolioBreakdown(
  portfolios: readonly Portfolio[],
  quotes: Record<string, Quote>,
): PortfolioSilo[] {
  return portfolios
    .filter((portfolio) => !portfolio.readOnly)
    .map((portfolio) => {
      let stocks = 0
      for (const ticker of portfolio.tickers) {
        const shares = portfolio.holdings[ticker]?.shares ?? 0
        const price = quotes[ticker]?.price ?? 0
        if (Number.isFinite(shares) && Number.isFinite(price)) stocks += shares * price
      }
      return {
        id: portfolio.id,
        name: portfolio.name,
        stocks,
        cash: Math.max(portfolio.cashBalance, 0),
        options: optionsEquity(portfolio.options),
        marginDebt: Math.max(portfolio.marginDebt, 0),
      }
    })
}

/** `_p6_portfolio_margin_total`, the figure the Debt panel footer folds in. */
export function marginTotal(breakdown: readonly PortfolioSilo[]): number {
  return breakdown.reduce((sum, silo) => sum + Math.max(silo.marginDebt, 0), 0)
}

/* ------------------------------------------------------------ totals donut */

export interface TotalsSlice {
  label: string
  value: number
  kind: 'asset' | 'debt'
  color: string
  /** Margin was already netted out of its portfolio's slice; excluded from the centre. */
  includedInPortfolioNet?: boolean
}

/** The stored book, minus the plumbing the maths does not care about. */
export interface FinanceBook {
  cash: readonly FinanceEntry[]
  debt: readonly FinanceEntry[]
  recurringBills: readonly RecurringBill[]
  goal: FinanceGoal
}

/** De-duplicate repeated portfolio names the way `_p6_update_progress_chart` does. */
function uniqueLabels(slices: TotalsSlice[]): TotalsSlice[] {
  const seen = new Map<string, number>()
  return slices.map((slice) => {
    const count = (seen.get(slice.label) ?? 0) + 1
    seen.set(slice.label, count)
    return count === 1 ? slice : { ...slice, label: `${slice.label} ${count}` }
  })
}

/** `_p6_current_total_series`: the donut, in build order. */
export function totalsSeries(
  book: FinanceBook,
  breakdown: readonly PortfolioSilo[],
  display: FinanceCurrency,
  rate: number | null,
): TotalsSlice[] {
  const slices: TotalsSlice[] = []

  const cashTotal = categoryTotal(book.cash)
  if (cashTotal > 0) {
    slices.push({
      label: 'Cash',
      value: convertAmount(cashTotal, 'SGD', display, rate),
      kind: 'asset',
      color: CASH_LINE_COLOR,
    })
  }

  breakdown.forEach((silo, index) => {
    const gross = silo.stocks + silo.cash + silo.options
    const margin = Math.max(silo.marginDebt, 0)
    const net = gross - margin
    if (net > 0) {
      slices.push({
        label: silo.name,
        value: convertAmount(net, 'USD', display, rate),
        kind: 'asset',
        color: PORTFOLIO_LINE_COLORS[index % PORTFOLIO_LINE_COLORS.length],
      })
    }
    if (margin > 0) {
      slices.push({
        label: `${silo.name} Margin`,
        value: convertAmount(margin, 'USD', display, rate),
        kind: 'debt',
        color: DEBT_COLORS[index % DEBT_COLORS.length],
        includedInPortfolioNet: true,
      })
    }
  })

  const debtTotal = categoryTotal(book.debt)
  if (debtTotal > 0) {
    slices.push({
      label: 'Debt',
      value: convertAmount(debtTotal, 'SGD', display, rate),
      kind: 'debt',
      color: DEBT_LINE_COLOR,
    })
  }

  return uniqueLabels(slices.filter((slice) => slice.value > 0))
}

/**
 * The number in the middle of the donut: assets less debts, skipping margin slices
 * because their portfolio's slice is already net of them. It uses a different
 * denominator from the legend percentages, which run over slice magnitudes — that
 * mismatch is in the reference too and is deliberate.
 */
export function totalsCenter(slices: readonly TotalsSlice[]): number {
  let total = 0
  for (const slice of slices) {
    if (slice.includedInPortfolioNet) continue
    total += slice.kind === 'debt' ? -slice.value : slice.value
  }
  return total
}

/* -------------------------------------------------------------------- goal */

export interface GoalStatus {
  value: number
  /** False when the mix of currencies cannot be valued without a rate. */
  available: boolean
}

/** `_p6_goal_net_worth`, computed in the goal's own currency. */
export function goalNetWorth(
  book: FinanceBook,
  breakdown: readonly PortfolioSilo[],
  display: FinanceCurrency,
  rate: number | null,
): GoalStatus {
  const cashTotal = categoryTotal(book.cash)
  const debtTotal = categoryTotal(book.debt)
  const portfolioTotal = breakdown.reduce(
    (sum, silo) => sum + silo.stocks + silo.cash + silo.options,
    0,
  )
  const margin = marginTotal(breakdown)

  const requiresFx =
    display === 'SGD'
      ? Math.abs(portfolioTotal) > 0.0001 || margin > 0.0001
      : cashTotal > 0.0001 || debtTotal > 0.0001
  if (requiresFx && !validRate(rate)) return { value: 0, available: false }

  const value =
    convertAmount(cashTotal, 'SGD', display, rate) +
    convertAmount(portfolioTotal, 'USD', display, rate) -
    convertAmount(margin, 'USD', display, rate) -
    convertAmount(debtTotal, 'SGD', display, rate)
  return { value, available: true }
}

/** Fraction of the target reached, clamped to 0..1 — what the goal ring fills to. */
export function goalProgress(current: number, target: number, available: boolean): number {
  if (!available || target <= 0) return 0
  return Math.max(0, Math.min(1, current / target))
}

/* ------------------------------------------------------------------- silos */

export interface SiloSegment {
  value: number
  color: string
}

export interface SiloBar {
  label: string
  value: number
  color: string
  /** Present on brokerage bars: stocks, then cash, then options, stacked bottom-up. */
  segments?: SiloSegment[]
}

/**
 * `_p6_update_total`'s bar list, in the reference's exact build order. The order is
 * load-bearing: colours come from cycling the palettes as the list is built, not from
 * the values, so a differently ordered build recolours the whole chart.
 */
export function siloBars(
  book: FinanceBook,
  breakdown: readonly PortfolioSilo[],
  display: FinanceCurrency,
  rate: number | null,
): SiloBar[] {
  const bars: SiloBar[] = []
  let assetIndex = 0
  let debtIndex = 0
  const assetColor = (): string => ASSET_COLORS[assetIndex % ASSET_COLORS.length]
  const debtColor = (): string => DEBT_COLORS[debtIndex % DEBT_COLORS.length]

  for (const entry of book.cash) {
    const amount = Math.max(entry.amount, 0)
    if (!(amount > 0)) continue
    bars.push({
      label: entry.desc,
      value: convertAmount(amount, 'SGD', display, rate),
      color: assetColor(),
    })
    assetIndex += 1
  }

  for (const silo of breakdown) {
    const stocks = Math.max(silo.stocks, 0)
    const cash = Math.max(silo.cash, 0)
    const options = Math.max(silo.options, 0)
    const gross = stocks + cash + options
    const margin = Math.max(silo.marginDebt, 0)
    const net = Math.max(gross - margin, 0)

    if (net > 0 && gross > 0) {
      // Margin shrinks the whole stack proportionally rather than removing a segment.
      const scale = net / gross
      const segments: SiloSegment[] = []
      if (stocks > 0) {
        segments.push({
          value: convertAmount(stocks * scale, 'USD', display, rate),
          color: assetColor(),
        })
      }
      if (cash > 0) {
        segments.push({
          value: convertAmount(cash * scale, 'USD', display, rate),
          color: BROKERAGE_CASH_COLOR,
        })
      }
      if (options > 0) {
        segments.push({
          value: convertAmount(options * scale, 'USD', display, rate),
          color: BROKERAGE_OPTIONS_COLOR,
        })
      }
      bars.push({
        label: silo.name,
        value: segments.reduce((sum, segment) => sum + segment.value, 0),
        color: segments[0]?.color ?? assetColor(),
        segments,
      })
      assetIndex += 1
    }

    if (silo.options < 0) {
      bars.push({
        label: `${silo.name} Options`,
        value: convertAmount(Math.abs(silo.options), 'USD', display, rate),
        color: DEBT_COLORS[0],
      })
    }
    if (margin > 0) {
      bars.push({
        label: `${silo.name} Margin`,
        value: convertAmount(margin, 'USD', display, rate),
        color: debtColor(),
      })
      debtIndex += 1
    }
  }

  for (const entry of book.debt) {
    const amount = Math.max(entry.amount, 0)
    if (!(amount > 0)) continue
    bars.push({
      label: entry.desc,
      value: convertAmount(amount, 'SGD', display, rate),
      color: debtColor(),
    })
    debtIndex += 1
  }

  return bars.filter((bar) => bar.value > 0)
}
