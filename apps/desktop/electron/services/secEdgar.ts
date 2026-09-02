import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type {
  FundamentalSeriesMap,
  FundamentalSeriesPoint,
  FundamentalsSecMetadata,
  SecFiling,
  SecFreshness,
} from '../shared/contract.js'
import {
  combineCashAndBonds,
  combineDebt,
  emptyFundamentalSeriesMap,
  periodLabel,
  sortSeries,
  subtractSeries,
} from '../shared/fundamentalsPage.js'

const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json'
const SEC_FACTS_URL = 'https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json'
const SEC_SUBMISSIONS_URL = 'https://data.sec.gov/submissions/CIK{cik}.json'
const SEC_ARCHIVES_URL = 'https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/{document}'

const TICKERS_TTL = 24 * 60 * 60_000
const FACTS_TTL = 6 * 60 * 60_000
const SUBMISSIONS_TTL = 15 * 60_000
const STALE_LIMIT = 7 * 24 * 60 * 60_000
const REQUEST_INTERVAL = 200
const REQUEST_TIMEOUT = 15_000
const MAX_ATTEMPTS = 3

type RawMetric =
  | 'revenue'
  | 'netIncome'
  | 'sellingGeneralAdmin'
  | 'researchDevelopment'
  | 'operatingCashFlow'
  | 'capitalExpenditure'
  | 'sharesOutstanding'
  | 'cashCombined'
  | 'cash'
  | 'shortTermInvestments'
  | 'longTermInvestments'
  | 'totalDebt'
  | 'currentDebt'
  | 'nonCurrentDebt'

interface FactSpec {
  kind: 'flow' | 'instant'
  units: string[]
  tags: string[]
  absolute?: boolean
}

interface SelectedFact {
  value: number
  start: string
  end: string
  filed: string
  form: string
  fp: string
  accession: string
  derived: boolean
}

interface CachedDocument {
  storedAt: number
  payload: Record<string, unknown>
}

interface CacheMetadata {
  freshness: SecFreshness
  cacheAgeSeconds: number
  warning?: string
}

export interface SecCompanyBundle {
  annual: FundamentalSeriesMap
  quarterly: FundamentalSeriesMap
  metadata: FundamentalsSecMetadata
}

const SPECS: Record<RawMetric, FactSpec> = {
  revenue: {
    kind: 'flow', units: ['USD'],
    tags: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'SalesRevenueGoodsNet'],
  },
  netIncome: {
    kind: 'flow', units: ['USD'],
    tags: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
  },
  sellingGeneralAdmin: {
    kind: 'flow', units: ['USD'], tags: ['SellingGeneralAndAdministrativeExpense'],
  },
  researchDevelopment: {
    kind: 'flow', units: ['USD'], tags: ['ResearchAndDevelopmentExpense'],
  },
  operatingCashFlow: {
    kind: 'flow', units: ['USD'],
    tags: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  },
  capitalExpenditure: {
    kind: 'flow', units: ['USD'], absolute: true,
    tags: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsForAdditionsToPropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
  },
  sharesOutstanding: {
    kind: 'instant', units: ['shares'],
    tags: ['CommonStockSharesOutstanding', 'EntityCommonStockSharesOutstanding'],
  },
  cashCombined: {
    kind: 'instant', units: ['USD'], tags: ['CashCashEquivalentsAndShortTermInvestments'],
  },
  cash: {
    kind: 'instant', units: ['USD'],
    tags: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
  },
  shortTermInvestments: {
    kind: 'instant', units: ['USD'], tags: ['MarketableSecuritiesCurrent', 'ShortTermInvestments'],
  },
  longTermInvestments: {
    kind: 'instant', units: ['USD'],
    tags: ['MarketableSecuritiesNoncurrent', 'AvailableForSaleSecuritiesDebtSecuritiesNoncurrent'],
  },
  totalDebt: {
    kind: 'instant', units: ['USD'],
    tags: ['DebtAndFinanceLeaseObligations', 'LongTermDebtAndFinanceLeaseObligations', 'LongTermDebt'],
  },
  currentDebt: {
    kind: 'instant', units: ['USD'],
    tags: ['DebtCurrent', 'LongTermDebtAndFinanceLeaseObligationsCurrent', 'LongTermDebtCurrent', 'ShortTermBorrowings'],
  },
  nonCurrentDebt: {
    kind: 'instant', units: ['USD'],
    tags: ['LongTermDebtAndFinanceLeaseObligationsNoncurrent', 'LongTermDebtNoncurrent'],
  },
}

const Q4_DERIVABLE = new Set<RawMetric>([
  'revenue',
  'netIncome',
  'sellingGeneralAdmin',
  'researchDevelopment',
  'operatingCashFlow',
  'capitalExpenditure',
])

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function cacheRoot(): string {
  const local = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Local')
  return join(local, 'BudgetTerminalElectron', 'cache', 'sec')
}

function cachePath(namespace: string, key: string): string {
  const safe = key.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 100)
  return join(cacheRoot(), `${namespace}-${safe}.json`)
}

async function readCached(namespace: string, key: string): Promise<CachedDocument | null> {
  try {
    const parsed = JSON.parse(await readFile(cachePath(namespace, key), 'utf8')) as CachedDocument
    return Number.isFinite(parsed.storedAt) && parsed.payload && typeof parsed.payload === 'object'
      ? parsed
      : null
  } catch {
    return null
  }
}

async function writeCached(namespace: string, key: string, payload: Record<string, unknown>): Promise<void> {
  const target = cachePath(namespace, key)
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(temporary, JSON.stringify({ storedAt: Date.now(), payload }), 'utf8')
  await rename(temporary, target)
}

export async function clearSecCaches(): Promise<void> {
  await rm(cacheRoot(), { recursive: true, force: true })
}

let secGate: Promise<void> = Promise.resolve()
let lastRequestAt = 0

async function paceSec(): Promise<void> {
  const next = secGate.then(async () => {
    const delay = REQUEST_INTERVAL - (Date.now() - lastRequestAt)
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    lastRequestAt = Date.now()
  })
  secGate = next.catch(() => {})
  await next
}

async function requestJson(url: string): Promise<Record<string, unknown>> {
  let lastError: unknown = new Error('SEC request failed.')
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    await paceSec()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
    let retryable = true
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': process.env.BUDGET_TERMINAL_SEC_USER_AGENT
            ?? 'BudgetTerminalElectron/0.1 (contact: maintainers-at-budget-terminal.invalid)',
          'Accept-Encoding': 'gzip, deflate',
        },
        signal: controller.signal,
      })
      retryable = response.status === 429 || response.status >= 500
      if (!response.ok) throw new Error(`SEC returned HTTP ${response.status}`)
      const payload = await response.json()
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('SEC response was not a JSON object.')
      }
      return payload as Record<string, unknown>
    } catch (error) {
      lastError = error
      if (!retryable || attempt === MAX_ATTEMPTS - 1) break
      await new Promise((resolve) => setTimeout(resolve, Math.min(500 * 2 ** attempt, 2_000)))
    } finally {
      clearTimeout(timeout)
    }
  }
  throw lastError
}

async function cachedJson(
  namespace: string,
  key: string,
  url: string,
  ttl: number,
  force: boolean,
): Promise<{ payload: Record<string, unknown>; metadata: CacheMetadata }> {
  const cached = await readCached(namespace, key)
  const age = cached ? Date.now() - cached.storedAt : Number.POSITIVE_INFINITY
  if (!force && cached && age <= ttl) {
    return { payload: cached.payload, metadata: { freshness: 'cached', cacheAgeSeconds: age / 1000 } }
  }
  try {
    const payload = await requestJson(url)
    await writeCached(namespace, key, payload)
    return { payload, metadata: { freshness: 'fresh', cacheAgeSeconds: 0 } }
  } catch (error) {
    if (cached && age <= STALE_LIMIT) {
      return {
        payload: cached.payload,
        metadata: {
          freshness: 'stale',
          cacheAgeSeconds: age / 1000,
          warning: error instanceof Error ? error.message : String(error),
        },
      }
    }
    throw error
  }
}

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase().replace('.', '-')
}

function isoDate(value: unknown): string {
  const text = String(value ?? '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function durationDays(item: Record<string, unknown>): number | null {
  const start = Date.parse(`${isoDate(item.start)}T00:00:00Z`)
  const end = Date.parse(`${isoDate(item.end)}T00:00:00Z`)
  return Number.isFinite(start) && Number.isFinite(end) ? (end - start) / 86_400_000 : null
}

function rank(item: SelectedFact): string {
  return `${item.filed}:${item.form.endsWith('/A') ? 1 : 0}:${item.accession}`
}

function unitValues(fact: Record<string, unknown>, wanted: string[]): unknown[] {
  const units = record(fact.units)
  for (const preferred of wanted) {
    const match = Object.keys(units).find((key) => key.replaceAll(' ', '').toLowerCase() === preferred.replaceAll(' ', '').toLowerCase())
    if (match && Array.isArray(units[match])) return units[match] as unknown[]
  }
  return []
}

function selectFacts(companyFacts: Record<string, unknown>, spec: FactSpec): {
  annual: SelectedFact[]
  quarterly: SelectedFact[]
} {
  const facts = record(companyFacts.facts)
  const annual = new Map<string, SelectedFact>()
  const quarterly = new Map<string, SelectedFact>()
  const cumulative = new Map<string, SelectedFact>()
  for (const tag of spec.tags) {
    for (const taxonomy of ['us-gaap', 'dei']) {
      const fact = record(record(facts[taxonomy])[tag])
      for (const rawValue of unitValues(fact, spec.units)) {
        const raw = record(rawValue)
        const numeric = Number(raw.val)
        const end = isoDate(raw.end)
        if (!Number.isFinite(numeric) || !end) continue
        const form = String(raw.form ?? '')
        const fp = String(raw.fp ?? '').toUpperCase()
        const duration = durationDays(raw)
        const annualOk = spec.kind === 'flow'
          ? (form === '10-K' || form === '10-K/A') && fp === 'FY' && duration !== null && duration >= 300 && duration <= 380
          : form === '10-K' || form === '10-K/A'
        const quarterlyOk = spec.kind === 'flow'
          ? (form === '10-Q' || form === '10-Q/A') && ['Q1', 'Q2', 'Q3'].includes(fp) && duration !== null && duration >= 70 && duration <= 110
          : form === '10-Q' || form === '10-Q/A'
        const cumulativeOk = spec.kind === 'flow'
          && (form === '10-Q' || form === '10-Q/A')
          && ['Q2', 'Q3'].includes(fp)
          && duration !== null && duration > 110 && duration < 320
        if (!annualOk && !quarterlyOk && !cumulativeOk) continue
        const selected: SelectedFact = {
          value: spec.absolute ? Math.abs(numeric) : numeric,
          start: isoDate(raw.start),
          end,
          filed: isoDate(raw.filed),
          form,
          fp,
          accession: String(raw.accn ?? ''),
          derived: false,
        }
        const target = annualOk ? annual : cumulativeOk ? cumulative : quarterly
        const previous = target.get(end)
        if (!previous || rank(selected) > rank(previous)) target.set(end, selected)
      }
    }
  }
  if (spec.kind === 'flow' && cumulative.size) deriveCumulative(quarterly, cumulative)
  return {
    annual: [...annual.values()].sort((left, right) => left.end.localeCompare(right.end)),
    quarterly: [...quarterly.values()].sort((left, right) => left.end.localeCompare(right.end)),
  }
}

function deriveCumulative(direct: Map<string, SelectedFact>, cumulative: Map<string, SelectedFact>): void {
  const q1ByStart = new Map(
    [...direct.values()].filter((item) => item.fp === 'Q1' && item.start).map((item) => [item.start, item]),
  )
  const cumulativeByKey = new Map([...cumulative.values()].map((item) => [`${item.start}:${item.fp}`, item]))
  for (const start of new Set([...cumulative.values()].map((item) => item.start).filter(Boolean))) {
    let previous = q1ByStart.get(start)
    for (const fp of ['Q2', 'Q3']) {
      const current = cumulativeByKey.get(`${start}:${fp}`)
      if (!current || !previous) {
        previous = current
        continue
      }
      if (!direct.has(current.end)) {
        direct.set(current.end, {
          ...current,
          value: current.value - previous.value,
          start: previous.end ? new Date(Date.parse(`${previous.end}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : '',
          form: `${current.form} derived ${fp}`,
          derived: true,
        })
      }
      previous = current
    }
  }
}

function deriveQ4(annual: SelectedFact[], quarterly: SelectedFact[]): SelectedFact[] {
  const output = new Map(quarterly.map((item) => [item.end, item]))
  for (const year of annual) {
    if (output.has(year.end)) continue
    const start = Date.parse(`${year.start}T00:00:00Z`)
    const end = Date.parse(`${year.end}T00:00:00Z`)
    const direct = quarterly.filter((item) => {
      const itemStart = Date.parse(`${item.start}T00:00:00Z`)
      const itemEnd = Date.parse(`${item.end}T00:00:00Z`)
      return itemStart >= start && itemEnd < end
    })
    if (direct.length !== 3 || new Set(direct.map((item) => item.fp)).size !== 3) continue
    output.set(year.end, {
      ...year,
      value: year.value - direct.reduce((sum, item) => sum + item.value, 0),
      start: '',
      form: '10-K derived Q4',
      fp: 'Q4',
      derived: true,
    })
  }
  return [...output.values()].sort((left, right) => left.end.localeCompare(right.end))
}

function toPoints(facts: SelectedFact[], period: 'annual' | 'quarterly'): FundamentalSeriesPoint[] {
  return facts.slice(period === 'annual' ? -10 : -16).map((fact) => ({
    endDate: fact.end,
    label: periodLabel(fact.end, period),
    value: fact.value,
    source: fact.derived ? 'derived' : 'sec',
  }))
}

function normalizeStatements(companyFacts: Record<string, unknown>): {
  annual: FundamentalSeriesMap
  quarterly: FundamentalSeriesMap
} {
  const annualRaw = {} as Record<RawMetric, FundamentalSeriesPoint[]>
  const quarterlyRaw = {} as Record<RawMetric, FundamentalSeriesPoint[]>
  for (const [key, spec] of Object.entries(SPECS) as Array<[RawMetric, FactSpec]>) {
    const selected = selectFacts(companyFacts, spec)
    const quarterly = Q4_DERIVABLE.has(key) ? deriveQ4(selected.annual, selected.quarterly) : selected.quarterly
    const instantQuarterly = spec.kind === 'instant'
      ? [...new Map([...selected.quarterly, ...selected.annual].map((item) => [item.end, item])).values()]
      : quarterly
    annualRaw[key] = toPoints(selected.annual, 'annual')
    quarterlyRaw[key] = toPoints(instantQuarterly, 'quarterly')
  }
  const build = (raw: Record<RawMetric, FundamentalSeriesPoint[]>): FundamentalSeriesMap => {
    const output = emptyFundamentalSeriesMap()
    output.revenue = raw.revenue
    output.netIncome = raw.netIncome
    output.operatingCashFlow = raw.operatingCashFlow
    output.freeCashFlow = subtractSeries(raw.operatingCashFlow, raw.capitalExpenditure)
    output.sharesOutstanding = raw.sharesOutstanding
    output.cashAndBonds = combineCashAndBonds(raw.cashCombined, raw.cash, raw.shortTermInvestments, raw.longTermInvestments)
    const componentDebt = combineDebt([], raw.currentDebt, raw.nonCurrentDebt)
    output.totalDebt = componentDebt.length ? componentDebt : combineDebt(raw.totalDebt, [], [])
    output.sellingGeneralAdmin = raw.sellingGeneralAdmin
    output.researchDevelopment = raw.researchDevelopment
    return output
  }
  return { annual: build(annualRaw), quarterly: build(quarterlyRaw) }
}

function normalizeFilings(submissions: Record<string, unknown>, cik: string): SecFiling[] {
  const recent = record(record(submissions.filings).recent)
  const forms = Array.isArray(recent.form) ? recent.form : []
  const field = (name: string, index: number): string => {
    const values = recent[name]
    return Array.isArray(values) ? String(values[index] ?? '') : ''
  }
  const filings: SecFiling[] = []
  for (let index = 0; index < forms.length && filings.length < 50; index += 1) {
    const form = String(forms[index] ?? '')
    if (!['10-K', '10-Q', '8-K'].some((prefix) => form.startsWith(prefix))) continue
    const accessionNumber = field('accessionNumber', index)
    const document = field('primaryDocument', index)
    const accession = accessionNumber.replaceAll('-', '')
    const documentUrl = accession && document
      ? SEC_ARCHIVES_URL
        .replace('{cik}', String(Number(cik)))
        .replace('{accession}', accession)
        .replace('{document}', document)
      : ''
    filings.push({
      form,
      filedDate: field('filingDate', index),
      reportPeriod: field('reportDate', index),
      description: field('primaryDocDescription', index) || field('items', index) || document,
      items: field('items', index),
      accessionNumber,
      documentUrl,
    })
  }
  return filings
}

function emptyMetadata(warning: string): FundamentalsSecMetadata {
  return {
    available: false,
    statementsAvailable: false,
    cik: '',
    freshness: 'failed',
    statementFreshness: 'failed',
    cacheAgeSeconds: 0,
    filings: [],
    warnings: warning ? [warning] : [],
  }
}

export async function fetchSecCompanyBundle(symbolInput: string, force = false): Promise<SecCompanyBundle> {
  const symbol = symbolInput.trim().toUpperCase()
  const empty = { annual: emptyFundamentalSeriesMap(), quarterly: emptyFundamentalSeriesMap() }
  try {
    const tickers = await cachedJson('tickers', 'company_tickers', SEC_TICKERS_URL, TICKERS_TTL, force)
    const wanted = normalizeTicker(symbol)
    const entry = Object.values(tickers.payload).map(record).find((item) => normalizeTicker(String(item.ticker ?? '')) === wanted)
    if (!entry) {
      return {
        ...empty,
        metadata: {
          ...emptyMetadata('No domestic SEC filer mapping was found; using Yahoo data only.'),
          freshness: tickers.metadata.freshness,
          statementFreshness: 'unavailable',
          cacheAgeSeconds: tickers.metadata.cacheAgeSeconds,
        },
      }
    }
    const cik = String(Number(entry.cik_str)).padStart(10, '0')
    const [factsResult, submissionsResult] = await Promise.allSettled([
      cachedJson('companyfacts', cik, SEC_FACTS_URL.replace('{cik}', cik), FACTS_TTL, force),
      cachedJson('submissions', cik, SEC_SUBMISSIONS_URL.replace('{cik}', cik), SUBMISSIONS_TTL, force),
    ])
    const warnings: string[] = []
    let facts: Record<string, unknown> = {}
    let submissions: Record<string, unknown> = {}
    let factsMeta: CacheMetadata = { freshness: 'failed', cacheAgeSeconds: 0 }
    let submissionsMeta: CacheMetadata = { freshness: 'failed', cacheAgeSeconds: 0 }
    if (factsResult.status === 'fulfilled') {
      facts = factsResult.value.payload
      factsMeta = factsResult.value.metadata
      if (factsMeta.warning) warnings.push(`SEC facts refresh failed; using cached data: ${factsMeta.warning}`)
    } else warnings.push(`SEC facts unavailable: ${String(factsResult.reason)}`)
    if (submissionsResult.status === 'fulfilled') {
      submissions = submissionsResult.value.payload
      submissionsMeta = submissionsResult.value.metadata
      if (submissionsMeta.warning) warnings.push(`SEC submissions refresh failed; using cached data: ${submissionsMeta.warning}`)
    } else warnings.push(`SEC submissions unavailable: ${String(submissionsResult.reason)}`)

    const statements = Object.keys(facts).length ? normalizeStatements(facts) : empty
    const statementsAvailable = [...Object.values(statements.annual), ...Object.values(statements.quarterly)]
      .some((series) => series.length > 0)
    const filings = normalizeFilings(submissions, cik)
    if (!statementsAvailable) warnings.push('No supported domestic 10-K/10-Q XBRL facts were available; using Yahoo statements only.')
    const freshnessValues = [tickers.metadata.freshness, factsMeta.freshness, submissionsMeta.freshness]
    const freshness: SecFreshness = freshnessValues.includes('stale')
      ? 'stale'
      : freshnessValues.includes('fresh')
        ? 'fresh'
        : freshnessValues.includes('cached')
          ? 'cached'
          : 'failed'
    return {
      ...statements,
      metadata: {
        available: statementsAvailable || filings.length > 0,
        statementsAvailable,
        cik,
        freshness,
        statementFreshness: factsMeta.freshness,
        cacheAgeSeconds: Math.max(tickers.metadata.cacheAgeSeconds, factsMeta.cacheAgeSeconds, submissionsMeta.cacheAgeSeconds),
        filings,
        warnings,
      },
    }
  } catch (error) {
    return {
      ...empty,
      metadata: emptyMetadata(`SEC ticker lookup failed: ${error instanceof Error ? error.message : String(error)}`),
    }
  }
}

export interface SecFactsDocument {
  /** Zero-padded ten-digit CIK the document was fetched under. */
  cik: string
  /** The raw `companyfacts` JSON exactly as SEC returned it. */
  facts: Record<string, unknown>
  /** `normalizeFilings` output; empty when `includeFilings` is false or submissions failed. */
  filings: SecFiling[]
  freshness: SecFreshness
  cacheAgeSeconds: number
  warnings: string[]
}

/**
 * The raw cached `companyfacts` document, for callers that read their own tags.
 *
 * `fetchSecCompanyBundle` above normalises into the nine fixed `FundamentalSeriesKey`s the
 * Fundamentals and Valuation pages share. A page that needs a tag outside that set — the
 * BMNR page and its `CryptoAssetNumberOfUnits`, say — cannot be served by widening `SPECS`
 * without changing what those two pages see. This hands back the document instead and lets
 * the caller do its own selection, while still going through the same 200ms `paceSec` gate,
 * the same disk cache and the same seven-day stale fallback. Both callers share one cache
 * entry per CIK, so opening Fundamentals on a ticker warms this path for free.
 *
 * `target` accepts a CIK directly so a fixed-ticker page skips the `company_tickers.json`
 * round trip entirely — two SEC requests rather than three.
 */
export async function fetchSecFactsDocument(
  target: { cik: string } | { symbol: string },
  { force = false, includeFilings = true }: { force?: boolean; includeFilings?: boolean } = {},
): Promise<SecFactsDocument> {
  const warnings: string[] = []
  let tickerFreshness: SecFreshness | null = null
  let tickerAge = 0
  let cik: string

  if ('cik' in target) {
    const numeric = Number(String(target.cik).trim())
    if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`Invalid CIK: ${target.cik}`)
    cik = String(numeric).padStart(10, '0')
  } else {
    const tickers = await cachedJson('tickers', 'company_tickers', SEC_TICKERS_URL, TICKERS_TTL, force)
    tickerFreshness = tickers.metadata.freshness
    tickerAge = tickers.metadata.cacheAgeSeconds
    const wanted = normalizeTicker(target.symbol)
    const entry = Object.values(tickers.payload).map(record).find((item) => normalizeTicker(String(item.ticker ?? '')) === wanted)
    if (!entry) throw new Error(`No domestic SEC filer mapping was found for ${target.symbol}.`)
    cik = String(Number(entry.cik_str)).padStart(10, '0')
  }

  const [factsResult, submissionsResult] = await Promise.allSettled([
    cachedJson('companyfacts', cik, SEC_FACTS_URL.replace('{cik}', cik), FACTS_TTL, force),
    includeFilings
      ? cachedJson('submissions', cik, SEC_SUBMISSIONS_URL.replace('{cik}', cik), SUBMISSIONS_TTL, force)
      : Promise.resolve(null),
  ])

  if (factsResult.status !== 'fulfilled') {
    // No cached fallback was available inside `cachedJson`, so there is nothing to return.
    throw new Error(`SEC facts unavailable: ${String(factsResult.reason)}`)
  }
  const facts = factsResult.value.payload
  const factsMeta = factsResult.value.metadata
  if (factsMeta.warning) warnings.push(`SEC facts refresh failed; using cached data: ${factsMeta.warning}`)

  let filings: SecFiling[] = []
  let submissionsMeta: CacheMetadata | null = null
  if (submissionsResult.status === 'fulfilled' && submissionsResult.value) {
    submissionsMeta = submissionsResult.value.metadata
    if (submissionsMeta.warning) warnings.push(`SEC submissions refresh failed; using cached data: ${submissionsMeta.warning}`)
    filings = normalizeFilings(submissionsResult.value.payload, cik)
  } else if (submissionsResult.status === 'rejected') {
    warnings.push(`SEC submissions unavailable: ${String(submissionsResult.reason)}`)
  }

  const freshnessValues = [
    ...(tickerFreshness ? [tickerFreshness] : []),
    factsMeta.freshness,
    ...(submissionsMeta ? [submissionsMeta.freshness] : []),
  ]
  const freshness: SecFreshness = freshnessValues.includes('stale')
    ? 'stale'
    : freshnessValues.includes('fresh')
      ? 'fresh'
      : freshnessValues.includes('cached')
        ? 'cached'
        : 'failed'

  return {
    cik,
    facts,
    filings,
    freshness,
    cacheAgeSeconds: Math.max(tickerAge, factsMeta.cacheAgeSeconds, submissionsMeta?.cacheAgeSeconds ?? 0),
    warnings,
  }
}

export const secTesting = {
  cachedJson,
  cacheRoot,
  ttl: {
    tickers: TICKERS_TTL,
    facts: FACTS_TTL,
    submissions: SUBMISSIONS_TTL,
    staleLimit: STALE_LIMIT,
  },
  normalizeStatements,
  normalizeFilings,
  sortSeries,
  // `rank` and `unitValues` are exported for `probe-bmnr.ts`, which asserts its own copies
  // of the amendment-precedence string and the unit-key matcher against these.
  rank,
  unitValues,
}
