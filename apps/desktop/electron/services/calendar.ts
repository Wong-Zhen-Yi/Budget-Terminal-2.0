import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type {
  CalendarMonthPayload,
  CalendarMonthRequest,
  EarningsCalendarPayload,
  EarningsCalendarRequest,
  EarningsCalendarRow,
  EconomicCalendarEvent,
  EnvelopeError,
} from '../shared/contract.js'
import {
  addMonths,
  buildMarketHolidays,
  companyEventsFromCalendar,
  dedupeEconomic,
  emptyEarningsPayload,
  mergeEarningsRows,
  mergeEconomicCategories,
  parseBeaSchedule,
  parseBlsSchedule,
  parseCensusSchedule,
  parseEarningsVisualization,
  parseFomcSchedule,
  parseFredRelease,
  parseNasdaqCompanySymbols,
  type EarningsVisualizationDocument,
} from '../shared/calendar.js'
import { cache } from './cache.js'
import { paced, yahoo } from './yahoo/client.js'

export const CALENDAR_SOURCE = 'financial calendar'
export const EARNINGS_SOURCE = 'yahoo earnings calendar'

const CACHE_VERSION = 1
const ECONOMIC_TTL_MS = 6 * 60 * 60_000
const COMPANY_TTL_MS = 6 * 60 * 60_000
const EARNINGS_TTL_MS = 12 * 60 * 60_000
const SYMBOL_TTL_MS = 7 * 24 * 60 * 60_000
const CALENDAR_URL = 'https://query1.finance.yahoo.com/v1/finance/visualization'
const SYMBOL_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt'
const FOMC_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'
const BEA_URL = 'https://www.bea.gov/news/schedule/full'
const BLS_URL = (year: number) => `https://www.bls.gov/schedule/${year}/home.htm`
const FRED_URL = (releaseId: number, year: number) =>
  `https://fred.stlouisfed.org/releases/calendar?rid=${releaseId}&y=${year}`
const CENSUS_URLS = (year: number) => [
  `https://www.census.gov/economic-indicators/calendar-listview-${year}.html`,
  'https://www.census.gov/economic-indicators/calendar-listview.html',
]
const APP_HEADERS = {
  'User-Agent': 'BudgetTerminalElectron/0.1 (personal finance research tool)',
  Accept: 'text/html,text/plain,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

interface CacheDocument<T> {
  version: number
  storedAt: number
  value: T
}

interface CacheHit<T> {
  value: T
  ageSeconds: number
  fresh: boolean
}

export interface CalendarFetchResult<T> {
  payload: T
  errors: EnvelopeError[]
  fromCache: boolean
  stale: boolean
  cacheAgeSeconds: number
}

function cacheRoot(): string {
  const appData = process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming')
  return join(appData, 'BudgetTerminalElectron', 'calendar-cache')
}

function safeKey(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || 'default'
}

async function readCache<T>(path: string, ttlMs: number): Promise<CacheHit<T> | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as CacheDocument<T>
    if (parsed.version !== CACHE_VERSION || !Number.isFinite(parsed.storedAt)) return null
    const ageMs = Math.max(Date.now() - parsed.storedAt, 0)
    return { value: parsed.value, ageSeconds: ageMs / 1000, fresh: ageMs <= ttlMs }
  } catch {
    return null
  }
}

async function writeCache<T>(path: string, value: T): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(
    temporary,
    JSON.stringify({ version: CACHE_VERSION, storedAt: Date.now(), value }, null, 2),
    'utf8',
  )
  await rename(temporary, path)
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: APP_HEADERS,
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.text()
}

function sourceError(source: string, error: unknown, symbol = 'Economic Events'): EnvelopeError {
  return {
    source,
    operation: 'calendar',
    symbol,
    reason: error instanceof Error ? error.message : String(error),
  }
}

const FRED_SPECS = [
  [10, 'Consumer Price Index', 'CPI Release', 'high'],
  [46, 'Producer Price Index', 'PPI Release', 'medium'],
  [50, 'Employment Situation', 'Jobs Report', 'high'],
  [192, 'Job Openings and Labor Turnover Survey', 'JOLTS Report', 'medium'],
] as const

async function fetchEconomicYearLive(
  year: number,
): Promise<{ events: EconomicCalendarEvent[]; errors: EnvelopeError[] }> {
  const errors: EnvelopeError[] = []
  const settled = await Promise.allSettled([
    fetchText(FOMC_URL).then((html) => parseFomcSchedule(html, year)),
    fetchText(BEA_URL).then((html) => parseBeaSchedule(html, year)),
    fetchText(BLS_URL(year)).then((html) => parseBlsSchedule(html, year)),
    (async () => {
      for (const url of CENSUS_URLS(year)) {
        try {
          const events = parseCensusSchedule(await fetchText(url), year)
          if (events.length) return events
        } catch {
          // Try the current schedule after the year-specific schedule.
        }
      }
      throw new Error(`No Census schedule was available for ${year}.`)
    })(),
  ])
  const labels = ['Federal Reserve', 'BEA', 'BLS', 'Census']
  const events: EconomicCalendarEvent[] = []
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') events.push(...outcome.value)
    else errors.push(sourceError(labels[index], outcome.reason))
  })

  const present = new Set(events.map((event) => event.name))
  const missing = FRED_SPECS.filter((spec) => !present.has(spec[2]))
  const fallback = await Promise.allSettled(
    missing.map(async ([id, source, name, importance]) =>
      parseFredRelease(await fetchText(FRED_URL(id, year)), year, source, name, importance),
    ),
  )
  fallback.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') events.push(...outcome.value)
    else errors.push(sourceError(`FRED ${missing[index]?.[2] ?? 'release'}`, outcome.reason))
  })
  return { events: dedupeEconomic(events), errors }
}

async function economicYear(
  year: number,
  force: boolean,
): Promise<CalendarFetchResult<EconomicCalendarEvent[]>> {
  const path = join(cacheRoot(), 'economic', `${year}.json`)
  const cached = await readCache<EconomicCalendarEvent[]>(path, ECONOMIC_TTL_MS)
  if (!force && cached?.fresh) {
    return { payload: cached.value, errors: [], fromCache: true, stale: false, cacheAgeSeconds: cached.ageSeconds }
  }
  const { events, errors } = await fetchEconomicYearLive(year)
  if (events.length) {
    const merged = mergeEconomicCategories(events, cached?.value ?? [])
    await writeCache(path, merged).catch(() => undefined)
    return { payload: merged, errors, fromCache: false, stale: false, cacheAgeSeconds: 0 }
  }
  if (cached) {
    return { payload: cached.value, errors, fromCache: true, stale: true, cacheAgeSeconds: cached.ageSeconds }
  }
  return { payload: [], errors, fromCache: false, stale: false, cacheAgeSeconds: 0 }
}

async function companyEvents(
  tickers: string[],
  force: boolean,
): Promise<CalendarFetchResult<CalendarMonthPayload['companyEvents']>> {
  const normalized = [...new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))].sort()
  if (!normalized.length) return { payload: [], errors: [], fromCache: false, stale: false, cacheAgeSeconds: 0 }
  const signature = createHash('sha256').update(normalized.join(',')).digest('hex').slice(0, 24)
  const path = join(cacheRoot(), 'company', `${signature}.json`)
  const disk = await readCache<CalendarMonthPayload['companyEvents']>(path, COMPANY_TTL_MS)
  if (!force && disk?.fresh) {
    return { payload: disk.value, errors: [], fromCache: true, stale: false, cacheAgeSeconds: disk.ageSeconds }
  }
  const cached = await cache.resolveWithStaleFallback(
    `calendar:company:${normalized.join(',')}`,
    COMPANY_TTL_MS,
    async () => {
      const settled = await Promise.allSettled(
        normalized.map(async (ticker) => {
          const result = await paced(() => yahoo.quoteSummary(ticker, { modules: ['calendarEvents'] }))
          return companyEventsFromCalendar(ticker, result.calendarEvents ?? {})
        }),
      )
      const events: CalendarMonthPayload['companyEvents'] = []
      const errors: EnvelopeError[] = []
      settled.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') events.push(...outcome.value)
        else errors.push(sourceError('yahoo calendar', outcome.reason, normalized[index]))
      })
      if (!events.length && errors.length === normalized.length) throw new Error('No portfolio company calendars were available.')
      return { events, errors }
    },
    { force },
  ).catch((error) => ({ value: { events: [], errors: [sourceError('yahoo calendar', error, 'Company Events')] }, ageSeconds: 0, fromCache: false, stale: false }))

  if (cached.value.events.length) await writeCache(path, cached.value.events).catch(() => undefined)
  if (!cached.value.events.length && disk) {
    return { payload: disk.value, errors: cached.value.errors, fromCache: true, stale: true, cacheAgeSeconds: disk.ageSeconds }
  }
  return {
    payload: cached.value.events.sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker)),
    errors: cached.value.errors,
    fromCache: cached.fromCache,
    stale: cached.stale,
    cacheAgeSeconds: cached.ageSeconds,
  }
}

export async function getCalendarMonth(
  request: CalendarMonthRequest,
): Promise<CalendarFetchResult<CalendarMonthPayload>> {
  const year = Math.min(Math.max(Math.trunc(request.year), 1990), 2200)
  const month = Math.min(Math.max(Math.trunc(request.month), 1), 12)
  const years = new Set<number>([year])
  for (let offset = 0; offset < 3; offset += 1) years.add(addMonths(year, month, offset).year)
  const [company, ...economic] = await Promise.all([
    companyEvents(request.tickers, Boolean(request.force)),
    ...[...years].map((visibleYear) => economicYear(visibleYear, Boolean(request.force))),
  ])
  const errors = [...company.errors, ...economic.flatMap((result) => result.errors)]
  return {
    payload: {
      companyEvents: company.payload,
      economicEvents: dedupeEconomic(economic.flatMap((result) => result.payload)),
      marketHolidays: buildMarketHolidays(year),
      generatedAt: Date.now(),
    },
    errors,
    fromCache: company.fromCache && economic.every((result) => result.fromCache),
    stale: company.stale || economic.some((result) => result.stale),
    cacheAgeSeconds: Math.max(company.cacheAgeSeconds, ...economic.map((result) => result.cacheAgeSeconds), 0),
  }
}

interface SymbolCacheValue {
  symbols: string[]
  discoverySymbols?: string[]
  fetchedAt: string
}

export async function companySymbolUniverse(force: boolean): Promise<CacheHit<SymbolCacheValue>> {
  const path = join(cacheRoot(), 'earnings', 'nasdaq-company-symbols.json')
  const cached = await readCache<SymbolCacheValue>(path, SYMBOL_TTL_MS)
  if (!force && cached?.fresh && cached.value.discoverySymbols) return cached
  try {
    const directory = await fetchText(SYMBOL_URL)
    const symbols = [...parseNasdaqCompanySymbols(directory)].sort()
    const discoverySymbols = [...parseNasdaqCompanySymbols(directory, new Set(['Q', 'N', 'A']))].sort()
    if (!symbols.length) throw new Error('NASDAQ Trader returned no company symbols.')
    if (!discoverySymbols.length) throw new Error('NASDAQ Trader returned no U.S. exchange company symbols.')
    const value = { symbols, discoverySymbols, fetchedAt: new Date().toISOString() }
    await writeCache(path, value)
    return { value, ageSeconds: 0, fresh: true }
  } catch (error) {
    if (cached) return { ...cached, fresh: false }
    throw error
  }
}

let crumbWarmup: Promise<void> | null = null
async function warmCrumb(): Promise<void> {
  if (!crumbWarmup) {
    crumbWarmup = paced(() => yahoo.screener({ scrIds: 'most_actives', count: 1 }))
      .then(() => undefined)
      .catch(() => {
        crumbWarmup = null
      })
  }
  await crumbWarmup
}

interface VisualizationResponse {
  finance?: {
    error?: unknown
    result?: Array<{ documents?: EarningsVisualizationDocument[] }>
  }
}

async function earningsPage(
  startDate: string,
  endDate: string,
  offset: number,
): Promise<EarningsVisualizationDocument> {
  await warmCrumb()
  const body = {
    sortType: 'DESC',
    entityIdType: 'sp_earnings',
    sortField: 'intradaymarketcap',
    includeFields: [
      'ticker',
      'companyshortname',
      'intradaymarketcap',
      'eventname',
      'startdatetime',
      'startdatetimetype',
      'epsestimate',
      'epsactual',
      'epssurprisepct',
    ],
    size: 100,
    offset,
    query: {
      operator: 'AND',
      operands: [
        { operator: 'EQ', operands: ['region', 'us'] },
        {
          operator: 'OR',
          operands: [
            { operator: 'EQ', operands: ['eventtype', 'EAD'] },
            { operator: 'EQ', operands: ['eventtype', 'ERA'] },
          ],
        },
        { operator: 'GTE', operands: ['startdatetime', startDate] },
        { operator: 'LTE', operands: ['startdatetime', endDate] },
      ],
    },
  }
  const response = (await paced(() =>
    yahoo._fetch(
      CALENDAR_URL,
      { lang: 'en-US', region: 'US' },
      { fetchOptions: { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } },
      'json',
      true,
    ),
  )) as VisualizationResponse
  if (response.finance?.error) throw new Error(JSON.stringify(response.finance.error))
  return response.finance?.result?.[0]?.documents?.[0] ?? { columns: [], rows: [] }
}

async function fetchEarningsLive(
  request: EarningsCalendarRequest,
  allowed: Set<string>,
): Promise<EarningsCalendarRow[]> {
  const rows: EarningsCalendarRow[] = []
  const seenPages = new Set<string>()
  for (let page = 0; page < 120; page += 1) {
    const document = await earningsPage(request.startDate, request.endDate, page * 100)
    const parsed = parseEarningsVisualization(document, request.startDate, request.endDate, allowed)
    const key = parsed.map((row) => `${row.datetimeUtc}|${row.symbol}|${row.eventKey}`).join('\n')
    if (!parsed.length || seenPages.has(key)) break
    seenPages.add(key)
    rows.push(...parsed)
    if ((document.rows?.length ?? 0) < 100) break
  }
  return rows
}

export async function getEarningsCalendar(
  request: EarningsCalendarRequest,
): Promise<CalendarFetchResult<EarningsCalendarPayload>> {
  const rangeKey = safeKey(request.rangeKey)
  const path = join(cacheRoot(), 'earnings', `${rangeKey}.json`)
  const cached = await readCache<EarningsCalendarPayload>(path, EARNINGS_TTL_MS)
  if (!request.force && cached?.fresh) {
    return { payload: cached.value, errors: [], fromCache: true, stale: false, cacheAgeSeconds: cached.ageSeconds }
  }
  try {
    const universe = await companySymbolUniverse(false)
    const liveRows = await fetchEarningsLive(request, new Set(universe.value.symbols))
    const rows = mergeEarningsRows(liveRows, cached?.value.rows ?? [])
    const payload: EarningsCalendarPayload = {
      rows,
      source: EARNINGS_SOURCE,
      sourceUrl: 'https://finance.yahoo.com/calendar/earnings',
      fetchedAt: new Date().toISOString(),
      startDate: request.startDate,
      endDate: request.endDate,
      rangeKey,
      symbolUniverseCount: universe.value.symbols.length,
    }
    await writeCache(path, payload)
    return { payload, errors: [], fromCache: false, stale: false, cacheAgeSeconds: 0 }
  } catch (error) {
    const failure = sourceError(EARNINGS_SOURCE, error, 'Earnings')
    if (cached) {
      return { payload: cached.value, errors: [failure], fromCache: true, stale: true, cacheAgeSeconds: cached.ageSeconds }
    }
    return {
      payload: emptyEarningsPayload(request.startDate, request.endDate, rangeKey),
      errors: [failure],
      fromCache: false,
      stale: false,
      cacheAgeSeconds: 0,
    }
  }
}

export async function clearCalendarCaches(): Promise<void> {
  await rm(cacheRoot(), { recursive: true, force: true })
}
