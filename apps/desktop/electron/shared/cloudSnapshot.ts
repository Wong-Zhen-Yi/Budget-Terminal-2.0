import { z } from 'zod'
import { COMBINED_PORTFOLIO_ID, MAX_ENTRY_DESC, MAX_FINANCE_ROWS, MAX_GOAL_TITLE, MAX_PORTFOLIOS } from './contract.js'

// Network validation never coerces values or applies the local stores' recovery defaults.
// These ceilings also bound validation work for many small entries within the byte cap.
export const MAX_CLOUD_SNAPSHOT_BYTES = 750_000
const text = z.string().max(4096)
const id = z.string().min(1).max(256)
const number = z.number().finite()
const strings = z.array(text).max(10_000)
const uniqueIds = z.array(id).max(10_000).refine(values => new Set(values).size === values.length, 'Duplicate IDs')
const record = <T extends z.ZodType>(schema: T, max = 10_000) => z.record(id, schema)
  .refine(values => Object.keys(values).length <= max, 'Too many records')
const currency = z.enum(['SGD', 'USD'])
const entry = z.object({ id, desc: z.string().max(MAX_ENTRY_DESC), amount: number.nonnegative() }).strict()
const finance = z.object({
  cash: z.array(entry).max(MAX_FINANCE_ROWS), debt: z.array(entry).max(MAX_FINANCE_ROWS),
  recurringBills: z.array(entry.extend({ frequency: z.enum(['monthly', 'yearly']), currency })).max(MAX_FINANCE_ROWS),
  totalsCurrency: currency,
  goal: z.object({ title: z.string().max(MAX_GOAL_TITLE), targetAmount: number.nonnegative(), currency }).strict(),
}).strict().refine(value => {
  const ids = [...value.cash, ...value.debt, ...value.recurringBills].map(row => row.id)
  return new Set(ids).size === ids.length
}, 'Duplicate finance IDs')
const portfolio = z.object({
  id, name: text, tickers: strings,
  holdings: record(z.object({ ticker: text, shares: number, avgPrice: number, includeInWeight: z.boolean() }).strict()),
  cashBalance: number, marginDebt: number, includeCashInWeight: z.boolean(),
  options: z.array(z.object({ rowId: id, ticker: text, strategy: text, expiry: text,
    strike: number, contracts: number, premium: number, status: text, openDate: text }).strict()).max(10_000),
}).strict()
const userData = z.object({
  version: z.union([z.literal(1), z.literal(2)]), activeId: id.nullable(), mainId: id.nullable(),
  order: uniqueIds, portfolios: record(portfolio, MAX_PORTFOLIOS), personalFinance: finance.optional(),
  chartsWatchlists: z.object({ watchlist: strings, multiCustomSymbols: strings, multiOrder: strings }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.version === 2 && !value.personalFinance) ctx.addIssue({ code: 'custom', message: 'Missing finance book' })
  if (Object.entries(value.portfolios).some(([key, row]) => key !== row.id)) ctx.addIssue({ code: 'custom', message: 'Portfolio ID mismatch' })
  const refs = [...value.order, value.mainId, value.activeId === COMBINED_PORTFOLIO_ID ? null : value.activeId]
    .filter((ref): ref is string => ref !== null)
  if (refs.some(ref => !Object.hasOwn(value.portfolios, ref))) ctx.addIssue({ code: 'custom', message: 'Unknown portfolio reference' })
})
const settings = z.object({
  version: z.literal(1), clockCountry: text, time12h: z.boolean(),
  tabOrder: strings, hiddenTabs: strings, favoriteTabs: strings,
  sidebarCollapsed: z.boolean().optional(), obscuredTabs: strings.optional(), lastBackupAt: number.nonnegative().optional(),
  backtestPage: z.object({ rows: z.array(z.object({ symbol: text, weight: number }).strict()).max(10_000),
    compareSymbol: text, interval: z.enum(['1D', '1W']), range: z.enum(['Max', '5Y', '3Y', '1Y', 'YTD']),
    splitterSizes: z.array(number.positive()).length(2) }).strict().optional(),
  signalsPage: z.object({ filter: z.enum(['all', 'ready', 'watching', 'expired', 'invalidated', 'market_closed', 'awaiting_data', 'stale', 'error']),
    setup: z.enum(['all', 'opening_range', 'vwap_pullback']), search: text }).strict().optional(),
  quantPage: z.object({ activeTab: z.enum(['screener', 'pairs']),
    screenFilter: z.enum(['all', 'top_quartile', 'momentum', 'oversold', 'overbought', 'low_volatility']),
    pairFilter: z.enum(['all', 'stationary', 'stretched', 'fast']), search: text, pairLeft: text, pairRight: text }).strict().optional(),
  youtubePage: z.object({ sortColumn: number.int().min(-1).max(6), sortDescending: z.boolean() }).strict().optional(),
}).strict()
const cards = z.object({
  version: z.union([z.literal(1), z.literal(2)]), starterCardsVersion: number.int().min(0).max(1).optional(),
  customCards: z.array(z.object({ id: id.startsWith('custom:'), name: z.string().max(80),
    symbols: strings.min(1), weighting: z.enum(['equal', 'custom']), weights: record(number.nonnegative()) }).strict()).max(1000),
  cardOrder: uniqueIds, hiddenPortfolioIds: uniqueIds.optional(),
  intervals: record(z.enum(['1d', '30d', '1y'])).optional(),
}).strict().refine(value => new Set(value.customCards.map(row => row.id)).size === value.customCards.length, 'Duplicate card IDs')
const articles = z.object({ articles: z.array(z.object({
  id, title: z.string().min(1).max(300).refine(value => value.trim().length > 0), topic: z.string().max(500), content: z.string().max(1_000_000),
  status: z.enum(['draft', 'finished']), createdAt: number, updatedAt: number, revision: number.int().positive(),
}).strict()).max(10_000) }).strict()
  .refine(value => new Set(value.articles.map(row => row.id)).size === value.articles.length, 'Duplicate article IDs')

export const cloudSnapshotSchema = z.object({ version: z.literal(1), userData, settings, cards, articles }).strict()

export class CloudSnapshotError extends Error {
  constructor(readonly code: 'SNAPSHOT_TOO_LARGE' | 'SNAPSHOT_INVALID') {
    super(code === 'SNAPSHOT_TOO_LARGE' ? 'Saved data exceeds the 750 KB sync limit.' : 'Saved data does not match the supported sync schema.')
  }
}

/** Errors deliberately omit payload values, paths, and schema diagnostics. */
export function parseCloudSnapshot(payload: string, enforceByteLimit = true) {
  if (enforceByteLimit && new TextEncoder().encode(payload).length > MAX_CLOUD_SNAPSHOT_BYTES) throw new CloudSnapshotError('SNAPSHOT_TOO_LARGE')
  try { return cloudSnapshotSchema.parse(JSON.parse(payload)) }
  catch { throw new CloudSnapshotError('SNAPSHOT_INVALID') }
}
