import { z } from 'zod'
import type { Portfolio } from './contract.js'
import { OPTION_STATUSES, OPTION_STRATEGIES } from './analytics.js'

const amount = z.number().finite().min(0).max(1e15)
const ticker = z.string().regex(/^[A-Z0-9.^=\-]{1,24}$/)
export const agentPortfolioSchema = z.object({
  portfolioId: z.string().min(1).max(100),
  summary: z.string().trim().min(1).max(2000),
  positions: z.array(z.object({ ticker, shares: amount.optional(), avgPrice: amount.optional() }).strict()).max(200),
  cashBalance: amount.optional(),
  marginDebt: amount.optional(),
  options: z.array(z.object({
    rowId: z.string().min(1).max(100).optional(), ticker,
    strategy: z.enum(OPTION_STRATEGIES), expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), strike: amount,
    contracts: amount.optional(), premium: amount.optional(), status: z.enum(OPTION_STATUSES).optional(),
    openDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).strict()).max(200).optional(),
}).strict()
export type AgentPortfolioUpdate = z.infer<typeof agentPortfolioSchema>
export interface AgentPortfolioChange { field: string; before: string; after: string }
export interface AgentPortfolioProposal {
  id: string
  portfolioId: string
  portfolioName: string
  summary: string
  changes: AgentPortfolioChange[]
}

/** Omitted fields and positions stay untouched. New positions require actual cost data. */
export function previewAgentPortfolio(before: Portfolio, input: AgentPortfolioUpdate, newId: () => string) {
  const patch = agentPortfolioSchema.parse(input)
  if (before.readOnly || before.id !== patch.portfolioId) throw new Error('Choose an editable portfolio, not Combined.')
  const after = structuredClone(before)
  const changes: AgentPortfolioChange[] = []
  const change = (field: string, previous: unknown, next: unknown) => {
    if (previous !== next) changes.push({ field, before: previous === undefined ? 'Not recorded' : String(previous), after: String(next) })
  }
  const seen = new Set<string>()
  for (const row of patch.positions) {
    if (seen.has(row.ticker)) throw new Error(`Duplicate ticker ${row.ticker}. Combine or clarify the screenshot rows.`)
    seen.add(row.ticker)
    const current = after.holdings[row.ticker]
    if (!current && (row.shares === undefined || row.avgPrice === undefined)) throw new Error(`New position ${row.ticker} needs both shares and average cost. Ask the user for missing values.`)
    if (row.shares === undefined && row.avgPrice === undefined) throw new Error(`No quantities or average cost supplied for ${row.ticker}.`)
    if (row.shares !== undefined) change(`${row.ticker} · Shares`, current?.shares, row.shares)
    if (row.avgPrice !== undefined) change(`${row.ticker} · Average cost`, current?.avgPrice, row.avgPrice)
    after.holdings[row.ticker] = { ticker: row.ticker, shares: row.shares ?? current!.shares, avgPrice: row.avgPrice ?? current!.avgPrice, includeInWeight: current?.includeInWeight ?? true }
    if (!after.tickers.includes(row.ticker)) after.tickers.push(row.ticker)
  }
  for (const field of ['cashBalance', 'marginDebt'] as const) {
    if (patch[field] !== undefined) { change(field === 'cashBalance' ? 'Cash balance' : 'Margin debt', before[field], patch[field]); after[field] = patch[field] }
  }
  const optionRows = new Set<string>()
  for (const row of patch.options ?? []) {
    const matches = after.options.filter(option => row.rowId ? option.rowId === row.rowId
      : option.ticker === row.ticker && option.strategy === row.strategy && option.expiry === row.expiry && option.strike === row.strike)
    if (matches.length > 1) throw new Error('More than one option matches. Read saved row IDs and clarify the intended contract.')
    if (row.rowId && !matches.length) throw new Error('That option row no longer exists.')
    const current = matches[0]
    if (!current && [row.contracts, row.premium, row.status, row.openDate].some(value => value === undefined)) throw new Error('A new option needs contracts, premium, status and open date. Ask for missing values.')
    const rowId = current?.rowId ?? newId()
    if (optionRows.has(rowId)) throw new Error('An option appears more than once in this update.')
    optionRows.add(rowId)
    const next = { ...current, rowId, ticker: row.ticker, strategy: row.strategy, expiry: row.expiry, strike: row.strike,
      contracts: row.contracts ?? current!.contracts, premium: row.premium ?? current!.premium, status: row.status ?? current!.status, openDate: row.openDate ?? current!.openDate,
      currentPrice: 0, hasMarketMark: false, volume: 0, openInterest: 0, impliedVolatility: 0 }
    for (const field of ['ticker', 'strategy', 'expiry', 'strike', 'contracts', 'premium', 'status', 'openDate'] as const) change(`${row.ticker} ${row.expiry} ${row.strike} ${row.strategy} · ${field}`, current?.[field], next[field])
    if (current) after.options[after.options.findIndex(option => option.rowId === rowId)] = next
    else after.options.push(next)
  }
  if (!changes.length) throw new Error('The supplied values already match the portfolio; no update is needed.')
  return { after, changes }
}
