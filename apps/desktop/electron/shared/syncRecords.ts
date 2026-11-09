import { z } from 'zod'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { COMBINED_PORTFOLIO_ID, MAX_ENTRY_DESC, MAX_GOAL_TITLE } from './contract.js'

// These limits also apply on the server. No device paths or arbitrary settings objects.
export const RECORD_BYTES = 64_000
export const BATCH_BYTES = 240_000
export const BATCH_RECORDS = 16
export const PAGE_RECORDS = 8
export const ACCOUNT_BYTES = 50_000_000
export const ACCOUNT_RECORDS = 20_000 // Includes permanent deletion markers and content chunks.
export const utf8Bytes = (value: string) => new TextEncoder().encode(value).length
export const digest = (value: string) => bytesToHex(sha256(new TextEncoder().encode(value)))
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
  return JSON.stringify(value)
}

const id = z.string().min(1).max(200).refine(value => !['__proto__', 'prototype', 'constructor'].includes(value))
const text = z.string().max(500)
const number = z.number().finite()
const strings = z.array(id).max(4000)
const currency = z.enum(['SGD', 'USD'])
const entry = { id, desc: z.string().trim().min(1).max(MAX_ENTRY_DESC), amount: number.nonnegative(), position: z.number().int().nonnegative() }
const preferenceSchemas = {
  'user.activeId': id.nullable(), 'user.mainId': id.nullable(), 'user.order': strings,
  'finance.totalsCurrency': currency,
  'finance.goal': z.strictObject({ title: z.string().trim().min(1).max(MAX_GOAL_TITLE), targetAmount: number.nonnegative(), currency }),
  'charts.watchlist': strings, 'charts.multiCustomSymbols': strings, 'charts.multiOrder': strings,
  'cards.cardOrder': strings, 'cards.hiddenPortfolioIds': strings,
  'cards.intervals': z.record(id, z.enum(['1d', '30d', '1y'])),
  'settings.version': z.literal(1), 'settings.clockCountry': z.string().max(8),
  'settings.time12h': z.boolean(), 'settings.sidebarCollapsed': z.boolean(),
  'settings.tabOrder': strings, 'settings.hiddenTabs': strings, 'settings.favoriteTabs': strings, 'settings.obscuredTabs': strings,
  'settings.backtestPage': z.strictObject({ rows: z.array(z.strictObject({ symbol: id, weight: number })).max(1000),
    compareSymbol: z.string().max(200), interval: z.enum(['1D', '1W']), range: z.enum(['Max', '5Y', '3Y', '1Y', 'YTD']), splitterSizes: z.array(number).length(2) }),
  'settings.signalsPage': z.strictObject({ filter: z.enum(['all', 'ready', 'watching', 'expired', 'invalidated', 'market_closed', 'awaiting_data', 'stale', 'error']),
    setup: z.enum(['all', 'opening_range', 'vwap_pullback']), search: z.string().max(32) }),
  'settings.quantPage': z.strictObject({ activeTab: z.enum(['screener', 'pairs']), screenFilter: z.enum(['all', 'top_quartile', 'momentum', 'oversold', 'overbought', 'low_volatility']),
    pairFilter: z.enum(['all', 'stationary', 'stretched', 'fast']), search: text, pairLeft: text, pairRight: text }),
  'settings.youtubePage': z.strictObject({ sortColumn: z.number().int().min(-1).max(6), sortDescending: z.boolean() }),
} as const
const schemas = {
  format: z.strictObject({ userVersion: z.number().int().min(1).max(2), cardsVersion: z.number().int().min(1).max(2), starterCardsVersion: z.number().int().nonnegative() }),
  portfolio: z.strictObject({ id, name: z.string().max(2000), cashBalance: number, marginDebt: number, includeCashInWeight: z.boolean() }),
  ticker: z.strictObject({ portfolioId: id, ticker: id, position: z.number().int().nonnegative() }),
  holding: z.strictObject({ portfolioId: id, ticker: id, shares: number, avgPrice: number, includeInWeight: z.boolean() }),
  option: z.strictObject({ portfolioId: id, rowId: id, ticker: text, strategy: text, expiry: text, strike: number, contracts: number,
    premium: number, status: text, openDate: text, position: z.number().int().nonnegative() }),
  cash: z.strictObject(entry), debt: z.strictObject(entry),
  bill: z.strictObject({ ...entry, frequency: z.enum(['monthly', 'yearly']), currency }),
  card: z.strictObject({ id, name: z.string().max(80), symbols: strings, weighting: z.enum(['equal', 'custom']), weights: z.record(id, number), position: z.number().int().nonnegative() }),
  // Immutable chunks are written first; publishing the manifest is the atomic article edit.
  chunk: z.strictObject({ hash: z.string().regex(/^[a-f0-9]{64}$/), text: z.string().max(16_000) }),
  article: z.strictObject({ id, title: z.string().min(1).max(300), topic: text, status: z.enum(['draft', 'finished']),
    createdAt: number, updatedAt: number, revision: z.number().int().positive(), position: z.number().int().nonnegative(), chunks: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(200) }),
  preference: z.strictObject({ name: z.string().max(80), value: z.unknown() }),
}
export type RecordKind = keyof typeof schemas
export interface RecordValue { key: string; kind: RecordKind; data: string | null }
export interface RemoteRecord extends RecordValue { revision: number; seq: number; updatedAt: number }
export interface RecordWrite extends RecordValue { expectedRevision: number }
export interface SyncSignal { protocol: 2; epoch: string; seq: number; updatedAt: number; migrated: boolean; deleted: boolean }
export interface RecordPage { records: RemoteRecord[]; cursor: number; done: boolean; signal: SyncSignal }
export interface WriteResult { records: RemoteRecord[]; conflicts: RemoteRecord[]; signal: SyncSignal }
export const recordKey = (kind: RecordKind, ...parts: string[]) => JSON.stringify([kind, ...parts])

export function validateRecord(record: RecordValue): Record<string, unknown> | null {
  const parts = z.array(z.string().max(200)).max(3).parse(JSON.parse(record.key))
  const kind = z.enum(Object.keys(schemas) as [RecordKind, ...RecordKind[]]).parse(record.kind)
  if (parts[0] !== kind || record.key !== JSON.stringify(parts)) throw Error('Invalid record key.')
  const child = ['holding', 'ticker', 'option'].includes(kind)
  if (parts.length !== (kind === 'format' ? 1 : child ? 3 : 2)) throw Error('Invalid record key.')
  parts.slice(1).forEach(part => id.parse(part))
  if (record.data === null) {
    if (['format', 'preference', 'chunk'].includes(kind)) throw Error('This record cannot be deleted.')
    return null
  }
  if (utf8Bytes(record.data) > RECORD_BYTES) throw Error('One saved record exceeds the 64 KB sync limit. Local data is safe.')
  const data = schemas[kind].parse(JSON.parse(record.data)) as Record<string, unknown>
  if (kind === 'preference') {
    const schema = preferenceSchemas[data.name as keyof typeof preferenceSchemas]
    if (!schema) throw Error('This preference cannot be synced.')
    schema.parse(data.value)
  }
  const expected = kind === 'format' ? recordKey(kind) : kind === 'preference' ? recordKey(kind, data.name as string) :
    kind === 'chunk' ? recordKey(kind, data.hash as string) : child ? recordKey(kind, data.portfolioId as string, (data.rowId ?? data.ticker) as string) : recordKey(kind, data.id as string)
  if (expected !== record.key) throw Error('Record ID does not match its contents.')
  if (kind === 'chunk' && digest(data.text as string) !== data.hash) throw Error('Invalid article content hash.')
  return data
}

export function splitSnapshot(payload: string): RecordValue[] {
  const source = JSON.parse(payload)
  if (source.version !== 1) throw Error('Unsupported saved-data format.')
  const records = new Map<string, RecordValue>()
  const add = (kind: RecordKind, data: Record<string, unknown>, ...parts: string[]) => {
    const record = { kind, key: recordKey(kind, ...parts), data: stableJson(data) }
    validateRecord(record)
    if (records.has(record.key) && kind !== 'chunk') throw Error('Duplicate saved record ID.')
    records.set(record.key, record)
  }
  const pref = (name: string, value: unknown) => { if (value !== undefined) add('preference', { name, value }, name) }
  const user = source.userData
  add('format', { userVersion: user.version, cardsVersion: source.cards.version, starterCardsVersion: source.cards.starterCardsVersion ?? 0 })
  for (const name of ['activeId', 'mainId', 'order']) pref(`user.${name}`, user[name])
  for (const [portfolioId, portfolio] of Object.entries(user.portfolios) as [string, Record<string, any>][]) {
    const { holdings, options, tickers, ...data } = portfolio
    if (portfolioId !== data.id) throw Error('Portfolio ID mismatch.')
    add('portfolio', data, portfolioId)
    tickers.forEach((ticker: string, position: number) => add('ticker', { portfolioId, ticker, position }, portfolioId, ticker))
    for (const [ticker, holding] of Object.entries(holdings) as [string, object][]) add('holding', { ...holding, portfolioId }, portfolioId, ticker)
    options.forEach((option: { rowId: string }, position: number) => add('option', { ...option, portfolioId, position }, portfolioId, option.rowId))
  }
  const finance = user.personalFinance ?? { cash: [], debt: [], recurringBills: [], totalsCurrency: 'SGD', goal: { title: 'Net Worth Goal', targetAmount: 0, currency: 'SGD' } }
  for (const [field, kind] of [['cash', 'cash'], ['debt', 'debt'], ['recurringBills', 'bill']] as const) {
    finance[field].forEach((entry: { id: string }, position: number) => add(kind, { ...entry, position }, entry.id))
  }
  for (const name of ['totalsCurrency', 'goal']) pref(`finance.${name}`, finance[name])
  for (const name of ['watchlist', 'multiCustomSymbols', 'multiOrder']) pref(`charts.${name}`, user.chartsWatchlists?.[name] ?? [])
  source.cards.customCards.forEach((card: { id: string }, position: number) => add('card', { ...card, position }, card.id))
  for (const name of ['cardOrder', 'hiddenPortfolioIds', 'intervals']) pref(`cards.${name}`, source.cards[name])
  for (const [name, value] of Object.entries(source.settings)) pref(`settings.${name}`, value)
  source.articles.articles.forEach((article: { id: string; content: string }, position: number) => {
    const { content, ...metadata } = article
    const chunks: string[] = []
    // Code points prevent splitting a UTF-16 surrogate pair.
    const points = Array.from(content)
    for (let offset = 0; offset < points.length; offset += 8000) {
      const text = points.slice(offset, offset + 8000).join('')
      const hash = digest(text)
      add('chunk', { hash, text }, hash)
      chunks.push(hash)
    }
    add('article', { ...metadata, position, chunks }, article.id)
  })
  // Dependencies before references, including within migration and write batches.
  const priority = (kind: RecordKind) => kind === 'chunk' ? 0 : kind === 'portfolio' ? 1 : kind === 'article' ? 3 : 2
  return [...records.values()].sort((a, b) => priority(a.kind) - priority(b.kind) || a.key.localeCompare(b.key, 'en'))
}

/** Reconstruct only records owned by this account. Dangling children of deleted portfolios stay hidden. */
export function joinSnapshot(records: Iterable<RecordValue>, defaults: string): string {
  const result = JSON.parse(defaults)
  const user = result.userData
  user.portfolios = Object.create(null)
  user.personalFinance.cash = []; user.personalFinance.debt = []; user.personalFinance.recurringBills = []
  result.cards.customCards = []; result.articles.articles = []
  const values = [...records].filter(row => row.data !== null).map(row => ({ ...row, value: validateRecord(row)! }))
  const chunks = new Map(values.filter(row => row.kind === 'chunk').map(row => [row.value.hash, row.value.text]))
  for (const { kind, value: data } of values) {
    if (kind === 'portfolio') user.portfolios[data.id as string] = { ...data, holdings: Object.create(null), options: [], tickers: [] }
    if (kind === 'format') { user.version = data.userVersion; result.cards.version = data.cardsVersion; result.cards.starterCardsVersion = data.starterCardsVersion }
    if (kind === 'preference') {
      const [section, name] = (data.name as string).split('.')
      const target = section === 'user' ? user : section === 'finance' ? user.personalFinance : section === 'charts' ? user.chartsWatchlists : result[section]
      target[name] = data.value
    }
  }
  const ordered = values.sort((a, b) => Number(a.value.position ?? 0) - Number(b.value.position ?? 0) || a.key.localeCompare(b.key, 'en'))
  for (const { kind, value: data } of ordered) {
    const { position: _position, portfolioId, ...value } = data
    const parent = user.portfolios[portfolioId as string]
    if (kind === 'holding' && parent) parent.holdings[value.ticker as string] = value
    if (kind === 'ticker' && parent) parent.tickers.push(value.ticker)
    if (kind === 'option' && parent) parent.options.push(value)
    if (kind === 'cash' || kind === 'debt' || kind === 'bill') user.personalFinance[kind === 'bill' ? 'recurringBills' : kind].push(value)
    if (kind === 'card') result.cards.customCards.push(value)
    if (kind === 'article') {
      const { chunks: hashes, ...metadata } = value
      const content = (hashes as string[]).map(hash => {
        if (!chunks.has(hash)) throw Error('Article content is incomplete. Retry sync; local data is safe.')
        return chunks.get(hash) as string
      }).join('')
      if (content.length > 1_000_000) throw Error('Article exceeds the saved content limit.')
      result.articles.articles.push({ ...metadata, content })
    }
  }
  // Concurrent additions are retained even if an ordering preference came from another device.
  user.order = [...new Set([...user.order.filter((key: string) => Object.hasOwn(user.portfolios, key)), ...Object.keys(user.portfolios)])]
  user.mainId = user.mainId && Object.hasOwn(user.portfolios, user.mainId) ? user.mainId : user.order[0] ?? null
  user.activeId = user.activeId === COMBINED_PORTFOLIO_ID ? user.activeId :
    user.activeId && Object.hasOwn(user.portfolios, user.activeId) ? user.activeId : user.mainId
  return stableJson(result)
}

export function recordBatches<T extends RecordValue>(records: T[]): T[][] {
  const batches: T[][] = []
  let batch: T[] = []; let bytes = 0
  let articles = 0
  for (const record of records) {
    const size = utf8Bytes(JSON.stringify(record))
    // Manifest validation reads content chunks. Bound referenced bytes as well as request bytes.
    if (batch.length && (batch.length === BATCH_RECORDS || bytes + size > BATCH_BYTES || record.kind === 'article' && articles > 0)) {
      batches.push(batch); batch = []; bytes = 0; articles = 0
    }
    batch.push(record); bytes += size
    if (record.kind === 'article') articles++
  }
  if (batch.length) batches.push(batch)
  return batches
}
