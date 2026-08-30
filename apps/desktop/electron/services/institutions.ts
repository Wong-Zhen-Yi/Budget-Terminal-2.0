import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type {
  InstitutionActivityPayload,
  InstitutionActivityRequest,
  InstitutionActivityRow,
  InstitutionActivitySide,
  InstitutionManagerRow,
  InstitutionTickerActivityPayload,
  InstitutionTickerActivityRequest,
} from '../shared/contract.js'
import { formatInstitutionMoney } from '../shared/institutions.js'

const BASE_URL = 'https://www.dataroma.com'
const MOBILE_URL = `${BASE_URL}/m`
const REQUEST_TIMEOUT_MS = 24_000
const CACHE_TTL_MS = 4 * 60 * 60_000
const CACHE_VERSION = 2
const MAX_WORKERS = 8

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
}

export const INSTITUTIONS_SOURCE = 'DATAROMA'

const REQUEST_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
}

export interface InstitutionFetchResult<T> {
  payload: T
  fromCache: boolean
  stale: boolean
  cacheAgeSeconds: number
  warning?: string
}

interface DiskDocument<T> {
  version: number
  storedAt: number
  value: T
}

interface RawCell {
  html: string
  text: string
}

interface ActivitySummary {
  managers: InstitutionManagerRow[]
  activity: InstitutionActivityRow[]
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);?/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : Number(body.slice(1))
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match
    }
    return HTML_ENTITIES[body.toLowerCase()] ?? match
  })
}

function textOf(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

function cacheDirectory(): string {
  const appData = process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming')
  return join(appData, 'BudgetTerminalElectron', 'dataroma-cache')
}

function cachePath(key: string): string {
  const safe = key.replace(/[^A-Za-z0-9_.-]+/g, '_') || 'payload'
  return join(cacheDirectory(), `${safe}.json`)
}

async function readCache<T>(key: string): Promise<{ value: T; ageMs: number } | null> {
  try {
    const parsed = JSON.parse(await readFile(cachePath(key), 'utf8')) as DiskDocument<T>
    if (parsed.version !== CACHE_VERSION || !Number.isFinite(parsed.storedAt)) return null
    return { value: parsed.value, ageMs: Math.max(Date.now() - parsed.storedAt, 0) }
  } catch {
    return null
  }
}

async function writeCache<T>(key: string, value: T): Promise<void> {
  const target = cachePath(key)
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  const document: DiskDocument<T> = { version: CACHE_VERSION, storedAt: Date.now(), value }
  await writeFile(temporary, JSON.stringify(document), 'utf8')
  await rename(temporary, target)
}

async function cachedValue<T>(
  key: string,
  force: boolean,
  loader: () => Promise<T>,
): Promise<T> {
  if (!force) {
    const cached = await readCache<T>(key)
    if (cached && cached.ageMs <= CACHE_TTL_MS) return cached.value
  }
  const value = await loader()
  await writeCache(key, value)
  return value
}

async function resolvePayload<T>(
  key: string,
  force: boolean,
  loader: () => Promise<T>,
): Promise<InstitutionFetchResult<T>> {
  const cached = await readCache<T>(key)
  if (!force && cached && cached.ageMs <= CACHE_TTL_MS) {
    return { payload: cached.value, fromCache: true, stale: false, cacheAgeSeconds: cached.ageMs / 1000 }
  }
  try {
    const payload = await loader()
    await writeCache(key, payload)
    return { payload, fromCache: false, stale: false, cacheAgeSeconds: 0 }
  } catch (error) {
    if (cached) {
      return {
        payload: cached.value,
        fromCache: true,
        stale: true,
        cacheAgeSeconds: cached.ageMs / 1000,
        warning: error instanceof Error ? error.message : String(error),
      }
    }
    throw error
  }
}

export async function clearInstitutionCaches(): Promise<void> {
  await rm(cacheDirectory(), { recursive: true, force: true })
}

async function httpGet(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, { headers: REQUEST_HEADERS, signal: controller.signal })
    if (!response.ok) throw new Error(`DATAROMA request failed with HTTP ${response.status}.`)
    const html = await response.text()
    if (html.includes('Not Acceptable') && html.includes('Mod_Security')) {
      throw new Error('DATAROMA rejected the request.')
    }
    return html
  } finally {
    clearTimeout(timer)
  }
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, run))
  return results
}

function absoluteUrl(href: string): string {
  try {
    return new URL(decodeEntities(href), BASE_URL).toString()
  } catch {
    return ''
  }
}

function queryValue(href: string, key: string): string {
  try {
    return new URL(decodeEntities(href), BASE_URL).searchParams.get(key)?.trim() ?? ''
  } catch {
    return ''
  }
}

function attribute(openTag: string, name: string): string {
  const match = new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(openTag)
  return match?.[2] ?? ''
}

function firstLink(
  html: string,
  predicate: (href: string) => boolean = () => true,
): { href: string; text: string } | null {
  const linkPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  let match = linkPattern.exec(html)
  while (match) {
    const href = attribute(match[1], 'href')
    if (href && predicate(decodeEntities(href))) {
      return { href: decodeEntities(href), text: textOf(match[2]) }
    }
    match = linkPattern.exec(html)
  }
  return null
}

function tableById(html: string, id: string): string {
  const pattern = new RegExp(
    `<table\\b[^>]*\\bid\\s*=\\s*(["'])${id}\\1[^>]*>[\\s\\S]*?<\\/table>`,
    'i',
  )
  return pattern.exec(html)?.[0] ?? ''
}

function rowFragments(table: string): Array<{ openTag: string; html: string }> {
  const repaired = table.replace(/<\/tr>\s*<td(?=[^>]*\bclass\s*=\s*["']hist["'])/gi, '</tr><tr><td')
  const rows: Array<{ openTag: string; html: string }> = []
  const pattern = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi
  let match = pattern.exec(repaired)
  while (match) {
    rows.push({ openTag: match[1], html: match[2] })
    match = pattern.exec(repaired)
  }
  return rows
}

function cellsOf(rowHtml: string): RawCell[] {
  const cells: RawCell[] = []
  const pattern = /<td\b[^>]*>([\s\S]*?)<\/td>/gi
  let match = pattern.exec(rowHtml)
  while (match) {
    cells.push({ html: match[1], text: textOf(match[1]) })
    match = pattern.exec(rowHtml)
  }
  return cells
}

function actionSide(activity: string): InstitutionActivitySide | null {
  const action = activity.trim().split(/\s+/, 1)[0]?.toLowerCase()
  if (action === 'buy' || action === 'add') return 'buy'
  if (action === 'sell' || action === 'reduce') return 'sell'
  return null
}

function numberOf(value: string): number {
  const text = value.replace(/[$,%]/g, '').replaceAll(',', '').trim()
  const negative = text.startsWith('(') && text.endsWith(')')
  const parsed = Number(text.replace(/[()]/g, ''))
  return Number.isFinite(parsed) ? (negative ? -parsed : parsed) : 0
}

function percentText(value: number): string {
  return `${value.toFixed(2)}%`
}

function emptyActivityRow(): InstitutionActivityRow {
  return {
    period: '',
    manager: '',
    managerId: '',
    symbol: '',
    company: '',
    activity: '',
    action: '',
    side: 'buy',
    shareChange: '',
    shareChangeValue: 0,
    approxFlow: '',
    approxFlowValue: 0,
    holdPrice: '',
    changeToPortfolio: '',
    changeToPortfolioPct: 0,
    sourceUrl: '',
    historyUrl: '',
  }
}

export function parseAllInstitutionActivity(html: string): ActivitySummary {
  const managers: InstitutionManagerRow[] = []
  const activity: InstitutionActivityRow[] = []
  for (const row of rowFragments(tableById(html, 'grid')).slice(1)) {
    const cells = cellsOf(row.html)
    if (cells.length < 3) continue
    const managerLink = firstLink(cells[0].html, (href) => href.includes('m_activity.php?'))
    const manager = cells[0].text
    const managerId = managerLink ? queryValue(managerLink.href, 'm') : ''
    const period = cells[1].text
    if (!manager || !period) continue
    const entries: InstitutionActivityRow[] = []
    for (const cell of cells.slice(2)) {
      const stockLink = firstLink(
        cell.html,
        (href) => href.includes('activity.php?sym=') || href.includes('stock.php?sym='),
      )
      if (!stockLink) continue
      const symbol = queryValue(stockLink.href, 'sym').toUpperCase() || stockLink.text.toUpperCase()
      const text = cell.text.startsWith(symbol) ? cell.text.slice(symbol.length).trim() : cell.text
      const match = /^(.*?)\s+((?:Buy|Sell|Add|Reduce)(?:\s+[+-]?[0-9,.]+%)?)\s+Change to portfolio:\s*([+-]?[0-9,.]+)%?/i.exec(text)
      if (!match) continue
      const side = actionSide(match[2])
      if (!side) continue
      const change = numberOf(match[3])
      const entry: InstitutionActivityRow = {
        ...emptyActivityRow(),
        period,
        manager,
        managerId,
        symbol,
        company: match[1].trim(),
        activity: match[2].trim(),
        action: match[2].trim().split(/\s+/, 1)[0] ?? '',
        side,
        changeToPortfolio: percentText(change),
        changeToPortfolioPct: change,
        sourceUrl: absoluteUrl(stockLink.href),
      }
      entries.push(entry)
      activity.push(entry)
    }
    managers.push({
      manager,
      managerId,
      period,
      buyCount: entries.filter((entry) => entry.side === 'buy').length,
      sellCount: entries.filter((entry) => entry.side === 'sell').length,
      topActivity: entries.slice(0, 5).map((entry) => `${entry.symbol} ${entry.activity}`.trim()),
      sourceUrl: managerLink ? absoluteUrl(managerLink.href) : '',
    })
  }
  return { managers, activity }
}

export function parseManagerActivityRows(
  html: string,
  manager: string,
  managerId: string,
): InstitutionActivityRow[] {
  const rows: InstitutionActivityRow[] = []
  let period = ''
  for (const row of rowFragments(tableById(html, 'grid'))) {
    const className = attribute(row.openTag, 'class')
    if (className.split(/\s+/).includes('q_chg')) {
      period = textOf(row.html.replace(/&nbsp;?/gi, ' '))
      continue
    }
    const cells = cellsOf(row.html)
    if (cells.length < 5) continue
    const historyLink = firstLink(cells[0].html, (href) => href.includes('hist.php?'))
    const stockLink = firstLink(cells[1].html, (href) => href.includes('stock.php?sym='))
    if (!stockLink) continue
    const activity = cells[2].text
    const side = actionSide(activity)
    if (!side) continue
    const symbol = queryValue(stockLink.href, 'sym').toUpperCase() || stockLink.text.split(' ', 1)[0].toUpperCase()
    const company = stockLink.text.includes(' - ') ? stockLink.text.split(' - ', 2)[1].trim() : ''
    const change = numberOf(cells[4].text)
    rows.push({
      ...emptyActivityRow(),
      period,
      manager,
      managerId,
      symbol,
      company,
      activity,
      action: activity.split(/\s+/, 1)[0] ?? '',
      side,
      shareChange: cells[3].text,
      shareChangeValue: numberOf(cells[3].text),
      changeToPortfolio: percentText(change),
      changeToPortfolioPct: change,
      sourceUrl: absoluteUrl(stockLink.href),
      historyUrl: historyLink ? absoluteUrl(historyLink.href) : '',
    })
  }
  return rows
}

export function parseTickerActivityRows(html: string, symbol: string): InstitutionActivityRow[] {
  const rows: InstitutionActivityRow[] = []
  let period = ''
  for (const row of rowFragments(tableById(html, 'grid'))) {
    const className = attribute(row.openTag, 'class')
    if (className.split(/\s+/).includes('q_chg')) {
      period = textOf(row.html.replace(/&nbsp;?/gi, ' '))
      continue
    }
    const cells = cellsOf(row.html)
    if (cells.length < 5 || cells[1].text === 'Portfolio Manager') continue
    const managerLink = firstLink(cells[1].html, (href) => href.includes('holdings.php?'))
    if (!managerLink) continue
    const historyLink = firstLink(cells[0].html, (href) => href.includes('hist.php?'))
    const activity = cells[2].text
    const side = actionSide(activity)
    if (!side) continue
    const change = numberOf(cells[4].text)
    rows.push({
      ...emptyActivityRow(),
      period,
      manager: cells[1].text,
      managerId: queryValue(managerLink.href, 'm'),
      symbol,
      activity,
      action: activity.split(/\s+/, 1)[0] ?? '',
      side,
      shareChange: cells[3].text,
      shareChangeValue: numberOf(cells[3].text),
      changeToPortfolio: percentText(change),
      changeToPortfolioPct: change,
      sourceUrl: absoluteUrl(managerLink.href),
      historyUrl: historyLink ? absoluteUrl(historyLink.href) : '',
    })
  }
  return rows
}

export function parseDataromaHoldPrice(html: string): { text: string; value: number } {
  const row = /<tr\b[^>]*\bid\s*=\s*(["'])hold_price\1[^>]*>([\s\S]*?)<\/tr>/i.exec(html)?.[2] ?? ''
  const price = /<td\b[^>]*\bid\s*=\s*(["'])price\1[^>]*>([\s\S]*?)<\/td>/i.exec(row)?.[2] ?? ''
  const text = textOf(price)
  return { text, value: numberOf(text) }
}

function managerSummary(
  baseRows: InstitutionManagerRow[],
  selectedRows: InstitutionActivityRow[],
  activePeriod: string,
): InstitutionManagerRow[] {
  if (!selectedRows.length) return baseRows
  const grouped = new Map<string, InstitutionActivityRow[]>()
  for (const row of selectedRows) {
    const key = row.managerId || row.manager
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }
  const summaries: InstitutionManagerRow[] = []
  const seen = new Set<string>()
  for (const base of baseRows) {
    const key = base.managerId || base.manager
    const rows = grouped.get(key) ?? []
    seen.add(key)
    summaries.push({
      ...base,
      period: activePeriod,
      buyCount: rows.filter((row) => row.side === 'buy').length,
      sellCount: rows.filter((row) => row.side === 'sell').length,
      topActivity: rows.slice(0, 5).map((row) => `${row.symbol} ${row.activity}`.trim()),
    })
  }
  for (const [key, rows] of grouped) {
    if (seen.has(key) || !rows[0]) continue
    summaries.push({
      manager: rows[0].manager || key,
      managerId: rows[0].managerId,
      period: activePeriod,
      buyCount: rows.filter((row) => row.side === 'buy').length,
      sellCount: rows.filter((row) => row.side === 'sell').length,
      topActivity: rows.slice(0, 5).map((row) => `${row.symbol} ${row.activity}`.trim()),
      sourceUrl: '',
    })
  }
  return summaries
}

async function loadManagerActivity(
  managers: InstitutionManagerRow[],
  force: boolean,
): Promise<{ rows: InstitutionActivityRow[]; warnings: string[] }> {
  const unique = managers.filter(
    (row, index) => row.managerId && managers.findIndex((item) => item.managerId === row.managerId) === index,
  )
  const loaded = await mapLimit(unique, MAX_WORKERS, async (row) => {
    try {
      const rows = await cachedValue(`manager_activity_${row.managerId}`, force, async () => {
        const url = `${MOBILE_URL}/m_activity.php?${new URLSearchParams({ m: row.managerId, typ: 'a' })}`
        return parseManagerActivityRows(await httpGet(url), row.manager, row.managerId)
      })
      return { rows, warning: '' }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return { rows: [] as InstitutionActivityRow[], warning: `${row.manager}: ${reason}` }
    }
  })
  const warnings = loaded.map((entry) => entry.warning).filter(Boolean)
  return {
    rows: loaded.flatMap((entry) => entry.rows),
    warnings: warnings.length
      ? [`Manager activity partial load: ${warnings.length} manager(s) failed.`, ...warnings.slice(0, 3)]
      : [],
  }
}

async function enrichFlows(rows: InstitutionActivityRow[], force: boolean): Promise<void> {
  const symbols = [...new Set(rows.map((row) => row.symbol).filter(Boolean))].sort()
  const prices = await mapLimit(symbols, MAX_WORKERS, async (symbol) => {
    try {
      const price = await cachedValue(`ticker_price_${symbol}`, force, async () => {
        const html = await httpGet(`${MOBILE_URL}/stock.php?${new URLSearchParams({ sym: symbol })}`)
        return parseDataromaHoldPrice(html)
      })
      return [symbol, price] as const
    } catch {
      return [symbol, { text: '', value: 0 }] as const
    }
  })
  const priceMap = new Map(prices)
  for (const row of rows) {
    const price = priceMap.get(row.symbol) ?? { text: '', value: 0 }
    const flow = Math.abs(row.shareChangeValue) * price.value
    row.holdPrice = price.text
    row.approxFlowValue = flow
    row.approxFlow = flow > 0 ? formatInstitutionMoney(flow) : ''
  }
}

async function loadActivityLive(limit: number, quarter: string, force: boolean): Promise<InstitutionActivityPayload> {
  const sourceUrl = `${MOBILE_URL}/allact.php?typ=a`
  const summary = parseAllInstitutionActivity(await httpGet(sourceUrl))
  const managerActivity = await loadManagerActivity(summary.managers, force)
  const allRows = managerActivity.rows.length ? managerActivity.rows : summary.activity
  const periods = [...new Set(allRows.map((row) => row.period).filter(Boolean))]
  const activePeriod = periods.includes(quarter) ? quarter : (periods[0] ?? quarter)
  const selected = allRows.filter((row) => !activePeriod || row.period === activePeriod)
  const buyRows = selected
    .filter((row) => row.side === 'buy')
    .sort((left, right) => right.changeToPortfolioPct - left.changeToPortfolioPct)
    .slice(0, limit)
  const sellRows = selected
    .filter((row) => row.side === 'sell')
    .sort((left, right) => right.changeToPortfolioPct - left.changeToPortfolioPct)
    .slice(0, limit)
  await enrichFlows([...buyRows, ...sellRows], force)
  return {
    periods,
    activePeriod,
    buyRows,
    sellRows,
    managerRows: managerSummary(summary.managers, selected, activePeriod),
    sourceUrls: { activity: sourceUrl },
    warnings: managerActivity.warnings,
    fetchedAt: new Date().toISOString().slice(0, 19),
  }
}

export async function getInstitutionActivity(
  request: InstitutionActivityRequest,
): Promise<InstitutionFetchResult<InstitutionActivityPayload>> {
  const limit = Math.max(1, Math.min(Math.trunc(request.limit ?? 50), 200))
  const quarter = request.quarter?.replace(/\s+/g, ' ').trim() ?? ''
  const cacheQuarter = quarter.replace(/[^A-Za-z0-9_.-]+/g, '_') || 'latest'
  return resolvePayload(
    `institution_activity_${limit}_${cacheQuarter}`,
    Boolean(request.force),
    () => loadActivityLive(limit, quarter, Boolean(request.force)),
  )
}

function stockMetadata(html: string, fallback: string): { company: string; sector: string } {
  const title = /<(?:h1|title)\b[^>]*>([\s\S]*?)<\/(?:h1|title)>/i.exec(html)?.[1] ?? ''
  const heading = textOf(title)
  const company = heading.replace(new RegExp(`\\b${fallback}\\b`, 'i'), '').replace(/^\s*[-:|]\s*/, '').trim()
  const sectorRow = /<td\b[^>]*class\s*=\s*(["'])sect\1[^>]*>Sector:\s*<\/td>\s*<td\b[^>]*>([\s\S]*?)<\/td>/i.exec(html)
  return { company, sector: sectorRow ? textOf(sectorRow[2]) : '' }
}

export async function getInstitutionTickerActivity(
  request: InstitutionTickerActivityRequest,
): Promise<InstitutionFetchResult<InstitutionTickerActivityPayload>> {
  const symbol = request.symbol.toUpperCase().trim().replace(/[^A-Z0-9.-]+/g, '')
  if (!symbol) throw new Error('Enter a ticker symbol.')
  return resolvePayload(`institution_ticker_activity_${symbol}`, Boolean(request.force), async () => {
    const sourceUrl = `${MOBILE_URL}/activity.php?${new URLSearchParams({ sym: symbol, typ: 'a' })}`
    const html = await httpGet(sourceUrl)
    const activityRows = parseTickerActivityRows(html, symbol)
    const periods = [...new Set(activityRows.map((row) => row.period).filter(Boolean))]
    const metadata = stockMetadata(html, symbol)
    return {
      symbol,
      company: metadata.company,
      sector: metadata.sector,
      periods,
      activePeriod: periods[0] ?? '',
      activityRows,
      sourceUrls: { activity: sourceUrl },
      warnings: [],
      fetchedAt: new Date().toISOString().slice(0, 19),
    }
  })
}
