import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'

import { randomUUID } from 'node:crypto'

import type {
  FinanceCategory,
  FinanceEntry,
  Holding,
  OptionPosition,
  PersonalFinanceMutation,
  PersonalFinancePayload,
  Portfolio,
  PortfolioMutation,
  PortfolioPayload,
} from '../shared/contract.js'
import {
  COMBINED_PORTFOLIO_ID,
  MAX_ENTRY_DESC,
  MAX_FINANCE_ROWS,
  MAX_GOAL_TITLE,
  MAX_PORTFOLIOS,
} from '../shared/contract.js'

/**
 * Today as a civil date in the machine's own zone, which is what `date.today()` is.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date, so for anyone east of
 * Greenwich a position opened in the morning is stamped with yesterday.
 */
function todayIso(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * The holdings store, owned by this app.
 *
 * It is seeded once from the PySide6 app's `user_data.json` and then never reads it
 * again — from that point the two applications keep separate books. Writes are atomic
 * (temp file plus rename) so a crash mid-write cannot leave a truncated document.
 */

/* -------------------------------------------------------------- the document */

const holdingSchema = z.object({
  ticker: z.string(),
  shares: z.number().finite().catch(0),
  avgPrice: z.number().finite().catch(0),
  includeInWeight: z.boolean().catch(true),
})

const optionSchema = z.object({
  rowId: z.string(),
  ticker: z.string().catch(''),
  strategy: z.string().catch('Calls'),
  expiry: z.string().catch(''),
  strike: z.number().finite().catch(0),
  contracts: z.number().finite().catch(1),
  premium: z.number().finite().catch(0),
  status: z.string().catch('Open'),
  openDate: z.string().catch(''),
})

const portfolioSchema = z.object({
  id: z.string(),
  name: z.string(),
  tickers: z.array(z.string()).catch([]),
  holdings: z.record(z.string(), holdingSchema).catch({}),
  cashBalance: z.number().finite().catch(0),
  marginDebt: z.number().finite().catch(0),
  includeCashInWeight: z.boolean().catch(true),
  // Live marks are not persisted; only the contract the user entered is.
  options: z.array(optionSchema).catch([]),
})

/* The Personal Finance book. Mirrors `_normalize_networth_payload` in the PySide6
 * `persistence.py`, and lives in this same document so it shares the one write queue. */

const entrySchema = z.object({
  id: z.string().catch(''),
  desc: z.string().catch(''),
  amount: z.coerce.number().finite().catch(0),
})

const billSchema = z.object({
  id: z.string().catch(''),
  desc: z.string().catch('Recurring Bill'),
  amount: z.coerce.number().finite().catch(0),
  frequency: z.enum(['monthly', 'yearly']).catch('monthly'),
  currency: z.enum(['SGD', 'USD']).catch('SGD'),
})

const goalSchema = z.object({
  title: z.string().catch('Net Worth Goal'),
  targetAmount: z.coerce.number().finite().catch(0),
  currency: z.enum(['SGD', 'USD']).catch('SGD'),
})

const personalFinanceSchema = z.object({
  cash: z.array(entrySchema).catch([]),
  debt: z.array(entrySchema).catch([]),
  recurringBills: z.array(billSchema).catch([]),
  totalsCurrency: z.enum(['SGD', 'USD']).catch('SGD'),
  goal: goalSchema.catch({ title: 'Net Worth Goal', targetAmount: 0, currency: 'SGD' }),
})

const documentSchema = z.object({
  version: z.number().catch(1),
  activeId: z.string().nullable().catch(null),
  mainId: z.string().nullable().catch(null),
  order: z.array(z.string()).catch([]),
  portfolios: z.record(z.string(), portfolioSchema).catch({}),
  // Optional so a v1 document parses; its absence is the signal to backfill from the
  // PySide6 store rather than to start the page empty.
  personalFinance: personalFinanceSchema.optional(),
})

type StoredPortfolio = z.infer<typeof portfolioSchema>
type StoredFinance = z.infer<typeof personalFinanceSchema>
type StoredDocument = z.infer<typeof documentSchema>

const STORE_VERSION = 2

function emptyFinance(): StoredFinance {
  return {
    cash: [],
    debt: [],
    recurringBills: [],
    totalsCurrency: 'SGD',
    goal: { title: 'Net Worth Goal', targetAmount: 0, currency: 'SGD' },
  }
}

function emptyDocument(): StoredDocument {
  return {
    version: STORE_VERSION,
    activeId: null,
    mainId: null,
    order: [],
    portfolios: {},
    personalFinance: emptyFinance(),
  }
}

/* ------------------------------------------------------------------- paths */

export function storePath(): string {
  // Resolved from the environment rather than Electron's `app`, so the probe scripts
  // read the same file without booting a browser process.
  const appData = process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming')
  return join(appData, 'BudgetTerminalElectron', 'portfolio.json')
}

/** The PySide6 store, read exactly once to seed ours. */
export function legacyStorePath(): string {
  const localAppData =
    process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Local')
  return join(localAppData, 'BudgetTerminal', 'user_data.json')
}

/* ------------------------------------------------------------------ seeding */

const legacyHoldingSchema = z
  .object({
    shares: z.coerce.number().finite().catch(0),
    avg_price: z.coerce.number().finite().catch(0),
    include_in_weight: z.boolean().catch(true),
  })
  .partial()

const legacyPortfolioSchema = z
  .object({
    name: z.string().optional(),
    portfolio: z.array(z.string()).catch([]),
    portfolio_tracker: z.record(z.string(), legacyHoldingSchema).catch({}),
    cash_balance: z.coerce.number().finite().catch(0),
    margin_debt: z.coerce.number().finite().catch(0),
    include_cash_in_weight: z.boolean().catch(true),
  })
  .partial()

const legacyEntrySchema = z
  .object({
    desc: z.string().catch(''),
    description: z.string().optional(),
    amount: z.coerce.number().finite().catch(0),
  })
  .partial()

const legacyBillSchema = z
  .object({
    desc: z.string().catch('Recurring Bill'),
    description: z.string().optional(),
    amount: z.coerce.number().finite().catch(0),
    frequency: z.string().catch('monthly'),
    currency: z.string().catch('SGD'),
  })
  .partial()

const legacyNetWorthSchema = z
  .object({
    cash: z.array(legacyEntrySchema).catch([]),
    debt: z.array(legacyEntrySchema).catch([]),
    recurring_bills: z.array(legacyBillSchema).catch([]),
    totals_currency: z.string().catch('SGD'),
    goal: z
      .object({
        title: z.string().catch('Net Worth Goal'),
        target_amount: z.coerce.number().finite().catch(0),
        currency: z.string().catch('SGD'),
      })
      .partial()
      .optional(),
  })
  .partial()

const legacyDocumentSchema = z
  .object({
    active_portfolio_id: z.string().optional(),
    main_portfolio_id: z.string().optional(),
    portfolio_order: z.array(z.string()).optional(),
    portfolios: z.record(z.string(), legacyPortfolioSchema).optional(),
    net_worth: legacyNetWorthSchema.optional(),
  })
  .partial()

function legacyCurrency(value: string | undefined, fallback: 'SGD' | 'USD'): 'SGD' | 'USD' {
  const text = String(value ?? '').trim().toUpperCase()
  return text === 'SGD' || text === 'USD' ? text : fallback
}

/**
 * Map the PySide6 `net_worth` block onto ours.
 *
 * Read once, like the rest of the seeding: from then on the two apps keep separate
 * books. Rows gain an id here because the reference addresses them by table index.
 */
function financeFromLegacy(source: z.infer<typeof legacyNetWorthSchema> | undefined): StoredFinance {
  const finance = emptyFinance()
  if (!source) return finance

  const mapEntries = (rows: z.infer<typeof legacyEntrySchema>[] | undefined): FinanceEntry[] =>
    (rows ?? []).map((row) => ({
      id: randomUUID(),
      desc: String(row.desc || row.description || '').trim(),
      amount: row.amount ?? 0,
    }))

  finance.cash = mapEntries(source.cash)
  finance.debt = mapEntries(source.debt)
  finance.recurringBills = (source.recurring_bills ?? []).map((row) => {
    const frequency = String(row.frequency ?? 'monthly').trim().toLowerCase()
    return {
      id: randomUUID(),
      desc: String(row.desc || row.description || '').trim(),
      amount: row.amount ?? 0,
      frequency: frequency === 'yearly' ? ('yearly' as const) : ('monthly' as const),
      currency: legacyCurrency(row.currency, 'SGD'),
    }
  })
  finance.totalsCurrency = legacyCurrency(source.totals_currency, 'SGD')
  finance.goal = {
    title: String(source.goal?.title ?? '').trim() || 'Net Worth Goal',
    targetAmount: source.goal?.target_amount ?? 0,
    // The reference defaults the goal currency to the totals currency.
    currency: legacyCurrency(source.goal?.currency, finance.totalsCurrency),
  }
  return finance
}

/** Read just the `net_worth` block, for a v1 document that predates this section. */
async function seedFinanceFromLegacy(): Promise<StoredFinance> {
  try {
    const raw = await readFile(legacyStorePath(), 'utf8')
    const result = legacyDocumentSchema.safeParse(JSON.parse(raw))
    if (!result.success) return emptyFinance()
    return financeFromLegacy(result.data.net_worth)
  } catch {
    return emptyFinance()
  }
}

async function seedFromLegacy(): Promise<StoredDocument> {
  const document = emptyDocument()
  let parsed: z.infer<typeof legacyDocumentSchema>
  try {
    const raw = await readFile(legacyStorePath(), 'utf8')
    const result = legacyDocumentSchema.safeParse(JSON.parse(raw))
    if (!result.success) return withDefaultPortfolio(document)
    parsed = result.data
  } catch {
    // No PySide6 install, or an unreadable file: start clean rather than fail.
    return withDefaultPortfolio(document)
  }

  document.personalFinance = financeFromLegacy(parsed.net_worth)

  const entries = parsed.portfolios ?? {}
  const order = parsed.portfolio_order?.length ? parsed.portfolio_order : Object.keys(entries)
  order.forEach((id, index) => {
    const entry = entries[id]
    if (!entry) return
    const tickers = [
      ...new Set((entry.portfolio ?? []).map((t) => t.trim().toUpperCase()).filter(Boolean)),
    ]
    const holdings: Record<string, Holding> = {}
    for (const [rawTicker, source] of Object.entries(entry.portfolio_tracker ?? {})) {
      const ticker = rawTicker.trim().toUpperCase()
      if (!ticker) continue
      holdings[ticker] = {
        ticker,
        shares: source.shares ?? 0,
        avgPrice: source.avg_price ?? 0,
        includeInWeight: source.include_in_weight ?? true,
      }
    }
    document.portfolios[id] = {
      id,
      name: entry.name?.trim() || `Portfolio ${index + 1}`,
      tickers,
      holdings,
      cashBalance: entry.cash_balance ?? 0,
      marginDebt: entry.margin_debt ?? 0,
      includeCashInWeight: entry.include_cash_in_weight ?? true,
      options: [],
    }
    document.order.push(id)
  })

  if (!document.order.length) return withDefaultPortfolio(document)
  document.mainId = pickExisting(document, parsed.main_portfolio_id) ?? document.order[0]
  document.activeId = pickExisting(document, parsed.active_portfolio_id) ?? document.mainId
  return document
}

function pickExisting(document: StoredDocument, id: string | undefined): string | null {
  return id && document.portfolios[id] ? id : null
}

function withDefaultPortfolio(document: StoredDocument): StoredDocument {
  const id = 'portfolio_1'
  document.portfolios[id] = {
    id,
    name: 'Portfolio 1',
    tickers: [],
    holdings: {},
    cashBalance: 0,
    marginDebt: 0,
    includeCashInWeight: true,
    options: [],
  }
  document.order = [id]
  document.activeId = id
  document.mainId = id
  return document
}

/* ------------------------------------------------------------------- access */

let cached: StoredDocument | null = null
/** Serialises writes so two rapid edits cannot interleave read-modify-write. */
let writeChain: Promise<void> = Promise.resolve()

/**
 * Run `task` at the back of the write queue.
 *
 * A read that has to be current — the backup export — joins the same queue the writes
 * use, so an edit that is still queued or mid-persist is in the answer. Reading outside
 * it returns the document as it stood before that edit, which is how a backup taken
 * straight after a cell edit came out one edit behind.
 */
async function queued<T>(task: () => Promise<T>): Promise<T> {
  let result: T | undefined
  let failure: unknown = null
  const run = writeChain.then(async () => {
    try {
      result = await task()
    } catch (error) {
      failure = error
    }
  })
  writeChain = run
  await run
  if (failure) throw failure
  return result as T
}

/**
 * Whether a read failure means "there is no store yet" rather than "the store could not
 * be read this time".
 *
 * Only the first justifies seeding and persisting over the path: a transient EBUSY,
 * EPERM or EACCES — an antivirus scan or a sync client holding the file on Windows —
 * would otherwise replace a live book with a fresh seed, and the next export would carry
 * that empty document. A damaged document counts as absent, since nothing can be
 * recovered from it either way.
 */
function isAbsentOrDamaged(error: unknown): boolean {
  if (error instanceof SyntaxError) return true
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

async function loadDocument(): Promise<StoredDocument> {
  if (cached) return cached
  try {
    const raw = await readFile(storePath(), 'utf8')
    const parsed = documentSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      cached = withDefaultPortfolio(emptyDocument())
      return cached
    }
    // A document written before the Personal Finance page existed has no section of its
    // own. Seeding only happens when this file is missing entirely, so without this the
    // page would open empty for everyone who already ran the app.
    const backfill = !parsed.data.personalFinance
    if (backfill) parsed.data.personalFinance = await seedFinanceFromLegacy()
    cached = normalize(parsed.data)
    if (backfill) await persist(cached)
  } catch (error) {
    if (!isAbsentOrDamaged(error)) throw error
    const seeded = await seedFromLegacy()
    await persist(seeded)
    cached = seeded
  }
  return cached
}

function cleanAmount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function cleanDesc(value: string, fallback: string): string {
  return value.trim().slice(0, MAX_ENTRY_DESC) || fallback
}

/**
 * Repair the finance section: ids present and unique, amounts non-negative, text within
 * the reference's limits. The PySide6 app clamps cash and debt at read time instead;
 * clamping here reaches the same printed totals from a tidier file.
 */
function normalizeFinance(finance: StoredFinance | undefined): StoredFinance {
  const result = finance ?? emptyFinance()
  const seen = new Set<string>()
  const uniqueId = (id: string): string => {
    const value = id && !seen.has(id) ? id : randomUUID()
    seen.add(value)
    return value
  }

  for (const category of ['cash', 'debt'] as const) {
    result[category] = result[category]
      .slice(0, MAX_FINANCE_ROWS)
      .map((row) => ({
        id: uniqueId(row.id),
        desc: cleanDesc(row.desc, 'New Item'),
        amount: cleanAmount(row.amount),
      }))
  }
  result.recurringBills = result.recurringBills.slice(0, MAX_FINANCE_ROWS).map((row) => ({
    id: uniqueId(row.id),
    desc: cleanDesc(row.desc, 'Recurring Bill'),
    amount: cleanAmount(row.amount),
    frequency: row.frequency,
    currency: row.currency,
  }))
  result.goal = {
    title: result.goal.title.trim().slice(0, MAX_GOAL_TITLE) || 'Net Worth Goal',
    targetAmount: cleanAmount(result.goal.targetAmount),
    currency: result.goal.currency,
  }
  return result
}

/**
 * Drop the in-memory document so the next read goes back to disk.
 *
 * The probe scripts use it when they repoint `APPDATA` at a scratch directory partway
 * through a run; without it the cached copy of the real store would answer instead.
 */
export function resetStoreCache(): void {
  cached = null
}

/** Repair anything the schema let through: dangling ids, orphan entries, stale order. */
function normalize(document: StoredDocument): StoredDocument {
  document.version = STORE_VERSION
  document.personalFinance = normalizeFinance(document.personalFinance)
  const known = Object.keys(document.portfolios)
  const order = document.order.filter((id) => known.includes(id))
  for (const id of known) if (!order.includes(id)) order.push(id)
  document.order = order.slice(0, MAX_PORTFOLIOS)
  for (const id of known) if (!document.order.includes(id)) delete document.portfolios[id]
  if (!document.order.length) return withDefaultPortfolio(document)
  document.mainId = pickExisting(document, document.mainId ?? undefined) ?? document.order[0]
  document.activeId =
    document.activeId === COMBINED_PORTFOLIO_ID
      ? COMBINED_PORTFOLIO_ID
      : (pickExisting(document, document.activeId ?? undefined) ?? document.mainId)
  return document
}

async function persist(document: StoredDocument): Promise<void> {
  const target = storePath()
  await mkdir(dirname(target), { recursive: true })
  // Write beside the target then rename: rename is atomic on the same volume, so a
  // reader never sees a half-written document.
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(document, null, 2), 'utf8')
  await rename(temporary, target)
}

/* ------------------------------------------------------------------ reading */

/** The Combined view: every position across every portfolio, share-weighted. */
function buildCombined(document: StoredDocument): Portfolio {
  const tickers: string[] = []
  const holdings: Record<string, Holding> = {}
  let cashBalance = 0
  let marginDebt = 0
  const options: OptionPosition[] = []

  for (const id of document.order) {
    const entry = document.portfolios[id]
    if (!entry) continue
    for (const option of entry.options) {
      options.push({ ...withLiveDefaults(option), rowId: `${id}:${option.rowId}` })
    }
    for (const ticker of entry.tickers) {
      if (!tickers.includes(ticker)) tickers.push(ticker)
      const source = entry.holdings[ticker]
      if (!source) continue
      const current = holdings[ticker] ?? {
        ticker,
        shares: 0,
        avgPrice: 0,
        includeInWeight: true,
      }
      // Cost-weighted average price, so merging two lots of the same name is correct.
      const totalShares = current.shares + source.shares
      const totalCost = current.shares * current.avgPrice + source.shares * source.avgPrice
      holdings[ticker] = {
        ticker,
        shares: totalShares,
        avgPrice: totalShares ? totalCost / totalShares : 0,
        includeInWeight: true,
      }
    }
    cashBalance += entry.cashBalance
    marginDebt += entry.marginDebt
  }

  return {
    id: COMBINED_PORTFOLIO_ID,
    name: 'Combined',
    tickers,
    holdings,
    cashBalance,
    marginDebt,
    options,
    includeCashInWeight: true,
    readOnly: true,
  }
}

/** Stored rows carry the contract only; live marks start at zero each session. */
function withLiveDefaults(option: z.infer<typeof optionSchema>): OptionPosition {
  return { ...option, currentPrice: 0, volume: 0, openInterest: 0, impliedVolatility: 0 }
}

function toPortfolio(entry: StoredPortfolio): Portfolio {
  return { ...entry, options: entry.options.map(withLiveDefaults), readOnly: false }
}

export async function readPortfolios(): Promise<PortfolioPayload> {
  const document = await loadDocument()
  const portfolios = document.order
    .map((id) => document.portfolios[id])
    .filter((entry): entry is StoredPortfolio => Boolean(entry))
    .map(toPortfolio)

  // Combined only earns a slot once there is more than one book to combine.
  if (portfolios.length > 1) portfolios.push(buildCombined(document))

  return {
    portfolios,
    activeId: document.activeId,
    mainId: document.mainId,
    sourcePath: storePath(),
  }
}

/* ------------------------------------------------------------------ writing */

function nextPortfolioId(document: StoredDocument): string {
  for (let index = 1; index <= MAX_PORTFOLIOS; index += 1) {
    const id = `portfolio_${index}`
    if (!document.portfolios[id]) return id
  }
  throw new Error(`A maximum of ${MAX_PORTFOLIOS} portfolios is supported.`)
}

function requireEditable(document: StoredDocument, id: string): StoredPortfolio {
  const entry = document.portfolios[id]
  if (!entry) throw new Error(`Unknown portfolio ${id}.`)
  return entry
}

function cleanNumber(value: number | undefined, { min = 0 } = {}): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value)) return undefined
  return Math.max(min, value)
}

function apply(document: StoredDocument, mutation: PortfolioMutation): void {
  switch (mutation.type) {
    case 'setActive': {
      if (mutation.id === COMBINED_PORTFOLIO_ID || document.portfolios[mutation.id]) {
        document.activeId = mutation.id
      }
      return
    }
    case 'setMain': {
      requireEditable(document, mutation.id)
      document.mainId = mutation.id
      return
    }
    case 'create': {
      if (document.order.length >= MAX_PORTFOLIOS) {
        throw new Error(`A maximum of ${MAX_PORTFOLIOS} portfolios is supported.`)
      }
      const id = nextPortfolioId(document)
      document.portfolios[id] = {
        id,
        name: mutation.name?.trim() || `Portfolio ${document.order.length + 1}`,
        tickers: [],
        holdings: {},
        cashBalance: 0,
        marginDebt: 0,
        includeCashInWeight: true,
        options: [],
      }
      document.order.push(id)
      document.activeId = id
      return
    }
    case 'rename': {
      const entry = requireEditable(document, mutation.id)
      entry.name = mutation.name.trim() || entry.name
      return
    }
    case 'delete': {
      requireEditable(document, mutation.id)
      if (document.order.length <= 1) throw new Error('The last portfolio cannot be deleted.')
      delete document.portfolios[mutation.id]
      document.order = document.order.filter((id) => id !== mutation.id)
      return
    }
    case 'reorder': {
      const wanted = mutation.order.filter((id) => document.portfolios[id])
      for (const id of document.order) if (!wanted.includes(id)) wanted.push(id)
      document.order = wanted
      return
    }
    case 'addPosition': {
      const entry = requireEditable(document, mutation.portfolioId)
      const ticker = mutation.ticker.trim().toUpperCase()
      if (!ticker) throw new Error('Enter a ticker symbol.')
      if (entry.tickers.includes(ticker)) throw new Error(`${ticker} is already in this portfolio.`)
      entry.tickers.push(ticker)
      entry.holdings[ticker] = { ticker, shares: 0, avgPrice: 0, includeInWeight: true }
      return
    }
    case 'removePosition': {
      const entry = requireEditable(document, mutation.portfolioId)
      const ticker = mutation.ticker.trim().toUpperCase()
      entry.tickers = entry.tickers.filter((value) => value !== ticker)
      delete entry.holdings[ticker]
      return
    }
    case 'setPosition': {
      const entry = requireEditable(document, mutation.portfolioId)
      const ticker = mutation.ticker.trim().toUpperCase()
      if (!entry.tickers.includes(ticker)) throw new Error(`${ticker} is not in this portfolio.`)
      const holding = entry.holdings[ticker] ?? {
        ticker,
        shares: 0,
        avgPrice: 0,
        includeInWeight: true,
      }
      const shares = cleanNumber(mutation.shares)
      const avgPrice = cleanNumber(mutation.avgPrice)
      entry.holdings[ticker] = {
        ...holding,
        shares: shares ?? holding.shares,
        avgPrice: avgPrice ?? holding.avgPrice,
        includeInWeight: mutation.includeInWeight ?? holding.includeInWeight,
      }
      return
    }
    case 'setCash': {
      const entry = requireEditable(document, mutation.portfolioId)
      entry.cashBalance = cleanNumber(mutation.cashBalance) ?? entry.cashBalance
      return
    }
    case 'setMargin': {
      const entry = requireEditable(document, mutation.portfolioId)
      entry.marginDebt = cleanNumber(mutation.marginDebt) ?? entry.marginDebt
      return
    }
    case 'setIncludeCash': {
      const entry = requireEditable(document, mutation.portfolioId)
      entry.includeCashInWeight = mutation.includeCashInWeight
      return
    }
    case 'addOption': {
      const entry = requireEditable(document, mutation.portfolioId)
      entry.options.push({
        rowId: randomUUID(),
        ticker: '',
        strategy: 'Calls',
        expiry: '',
        strike: 0,
        contracts: 1,
        premium: 0,
        status: 'Open',
        openDate: todayIso(),
      })
      return
    }
    case 'removeOption': {
      const entry = requireEditable(document, mutation.portfolioId)
      entry.options = entry.options.filter((option) => option.rowId !== mutation.rowId)
      return
    }
    case 'setOption': {
      const entry = requireEditable(document, mutation.portfolioId)
      const index = entry.options.findIndex((option) => option.rowId === mutation.rowId)
      if (index < 0) throw new Error('That option position no longer exists.')
      const { patch } = mutation
      const current = entry.options[index]
      entry.options[index] = {
        ...current,
        ticker: patch.ticker !== undefined ? patch.ticker.trim().toUpperCase() : current.ticker,
        strategy: patch.strategy ?? current.strategy,
        expiry: patch.expiry ?? current.expiry,
        strike: cleanNumber(patch.strike) ?? current.strike,
        contracts: cleanNumber(patch.contracts) ?? current.contracts,
        premium: cleanNumber(patch.premium) ?? current.premium,
        status: patch.status ?? current.status,
        openDate: patch.openDate ?? current.openDate,
      }
      return
    }
  }
}

/**
 * Apply one mutation and return the re-read document. Mutations queue behind each other
 * so a burst of cell edits cannot interleave read-modify-write and lose one.
 */
export async function mutatePortfolios(mutation: PortfolioMutation): Promise<PortfolioPayload> {
  let failure: unknown = null
  const run = writeChain.then(async () => {
    try {
      const document = await loadDocument()
      apply(document, mutation)
      cached = normalize(document)
      await persist(cached)
    } catch (error) {
      failure = error
    }
  })
  writeChain = run
  await run
  if (failure) throw failure
  return readPortfolios()
}

/* --------------------------------------------------- personal finance */

export async function readPersonalFinance(): Promise<PersonalFinancePayload> {
  const document = await loadDocument()
  const finance = document.personalFinance ?? emptyFinance()
  return {
    cash: finance.cash.map((row) => ({ ...row })),
    debt: finance.debt.map((row) => ({ ...row })),
    recurringBills: finance.recurringBills.map((row) => ({ ...row })),
    totalsCurrency: finance.totalsCurrency,
    goal: { ...finance.goal },
    sourcePath: storePath(),
  }
}

function requireRow<T extends { id: string }>(rows: T[], id: string, what: string): T {
  const row = rows.find((entry) => entry.id === id)
  if (!row) throw new Error(`That ${what} no longer exists.`)
  return row
}

function requireDesc(value: string): string {
  const text = value.trim()
  if (!text) throw new Error('Enter a description.')
  return text.slice(0, MAX_ENTRY_DESC)
}

function applyFinance(finance: StoredFinance, mutation: PersonalFinanceMutation): void {
  switch (mutation.type) {
    case 'addEntry': {
      const rows = finance[mutation.category]
      if (rows.length >= MAX_FINANCE_ROWS) {
        throw new Error(`A maximum of ${MAX_FINANCE_ROWS} rows is supported.`)
      }
      rows.push({ id: randomUUID(), desc: 'New Item', amount: 0 })
      return
    }
    case 'setEntry': {
      const row = requireRow(finance[mutation.category], mutation.id, 'row')
      if (mutation.desc !== undefined) row.desc = requireDesc(mutation.desc)
      const amount = cleanNumber(mutation.amount)
      if (amount !== undefined) row.amount = amount
      return
    }
    case 'removeEntry': {
      const category: FinanceCategory = mutation.category
      finance[category] = finance[category].filter((row) => row.id !== mutation.id)
      return
    }
    case 'addBill': {
      if (finance.recurringBills.length >= MAX_FINANCE_ROWS) {
        throw new Error(`A maximum of ${MAX_FINANCE_ROWS} bills is supported.`)
      }
      finance.recurringBills.push({
        id: randomUUID(),
        desc: 'New Bill',
        amount: 0,
        frequency: 'monthly',
        // The reference defaults a new bill to whatever the Totals selector shows.
        currency: finance.totalsCurrency,
      })
      return
    }
    case 'setBill': {
      const bill = requireRow(finance.recurringBills, mutation.id, 'bill')
      if (mutation.desc !== undefined) bill.desc = requireDesc(mutation.desc)
      const amount = cleanNumber(mutation.amount)
      if (amount !== undefined) bill.amount = amount
      if (mutation.frequency) bill.frequency = mutation.frequency
      if (mutation.currency) bill.currency = mutation.currency
      return
    }
    case 'removeBill': {
      finance.recurringBills = finance.recurringBills.filter((row) => row.id !== mutation.id)
      return
    }
    case 'setTotalsCurrency': {
      finance.totalsCurrency = mutation.currency
      return
    }
    case 'setGoal': {
      if (mutation.title !== undefined) {
        finance.goal.title = mutation.title.trim().slice(0, MAX_GOAL_TITLE) || 'Net Worth Goal'
      }
      const target = cleanNumber(mutation.targetAmount)
      if (target !== undefined) finance.goal.targetAmount = target
      if (mutation.currency) finance.goal.currency = mutation.currency
      return
    }
  }
}

/** The finance twin of `mutatePortfolios`: same queue, same atomic write, same re-read. */
export async function mutatePersonalFinance(
  mutation: PersonalFinanceMutation,
): Promise<PersonalFinancePayload> {
  let failure: unknown = null
  const run = writeChain.then(async () => {
    try {
      const document = await loadDocument()
      document.personalFinance = document.personalFinance ?? emptyFinance()
      applyFinance(document.personalFinance, mutation)
      cached = normalize(document)
      await persist(cached)
    } catch (error) {
      failure = error
    }
  })
  writeChain = run
  await run
  if (failure) throw failure
  return readPersonalFinance()
}

/* -------------------------------------------------- backup and maintenance */

/**
 * The stored document, for the Settings page's export.
 *
 * The reference exports `user_data.json` wholesale; this is the same idea against this
 * app's own store, so an export taken here restores here.
 */
export async function exportUserData(): Promise<unknown> {
  return queued(async () => structuredClone(await loadDocument()))
}

/**
 * Copy the current store aside before an import or a clear overwrites it.
 *
 * `create_rollback_backup_file` does the same in the reference. Returns an empty string
 * when there is nothing to copy yet — a first-run install has no store to lose.
 */
async function writeRollback(reason: string): Promise<string> {
  const target = storePath()
  let current: string
  try {
    current = await readFile(target, 'utf8')
  } catch {
    return ''
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = `${target}.${reason}.${stamp}.bak`
  await writeFile(backup, current, 'utf8')
  return backup
}

/** Validate an exported document and make it the live store. Returns the rollback path. */
export async function importUserData(source: unknown): Promise<string> {
  const parsed = documentSchema.safeParse(source)
  if (!parsed.success) throw new Error('The backup does not contain a valid holdings store.')
  let failure: unknown = null
  let rollback = ''
  const run = writeChain.then(async () => {
    try {
      rollback = await writeRollback('before-import')
      parsed.data.personalFinance = parsed.data.personalFinance ?? emptyFinance()
      cached = normalize(parsed.data)
      await persist(cached)
    } catch (error) {
      failure = error
    }
  })
  writeChain = run
  await run
  if (failure) throw failure
  return rollback
}

/**
 * Drop portfolios, the tracker, options and the finance book back to an empty install.
 *
 * Settings live in their own file and are deliberately untouched, matching the
 * reference's Clear — which keeps navigation, privacy and the dashboard chart slots.
 */
export async function clearUserData(): Promise<string> {
  let failure: unknown = null
  let rollback = ''
  const run = writeChain.then(async () => {
    try {
      rollback = await writeRollback('before-clear')
      cached = withDefaultPortfolio(emptyDocument())
      await persist(cached)
    } catch (error) {
      failure = error
    }
  })
  writeChain = run
  await run
  if (failure) throw failure
  return rollback
}

/* ----------------------------------------------------------------- watching */

/**
 * Notify when the store changes underneath us — a second window of this app, or the
 * user editing the file by hand. Portfolios and the finance section share the file, so
 * one watcher covers both.
 */
export function watchPortfolios(onChange: () => void): () => void {
  const path = storePath()
  let watcher: FSWatcher | null = null
  let timer: NodeJS.Timeout | null = null

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      cached = null
      onChange()
    }, 300)
  }

  const start = () => {
    try {
      watcher = watch(dirname(path), (_event, filename) => {
        // Ignore our own `.tmp` writes; only the finished rename matters.
        if (filename && String(filename) === 'portfolio.json') schedule()
      })
    } catch {
      watcher = null
    }
  }

  // The directory may not exist until the first write, so create it before watching.
  void mkdir(dirname(path), { recursive: true }).then(start, () => undefined)

  return () => {
    if (timer) clearTimeout(timer)
    watcher?.close()
  }
}
