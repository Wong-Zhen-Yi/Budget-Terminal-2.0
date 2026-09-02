import type {
  GoldAboveGround,
  GoldBlock,
  GoldBlockStatus,
  GoldEtf,
  GoldMarket,
  GoldMining,
  GoldMiningRow,
  GoldPayload,
  GoldQuarterPoint,
  GoldQuarterly,
  GoldUnit,
  GoldValue,
} from './contract.js'

export const GOLD_WGC_SOURCE = 'World Gold Council / Metals Focus'
export const GOLD_USGS_SOURCE = 'U.S. Geological Survey'
export const GOLD_MARKET_SOURCE = 'Yahoo Finance'

const QUARTER_FIELDS: ReadonlyArray<[keyof GoldQuarterPoint, string]> = [
  ['mineProduction', 'Mine Production'],
  ['producerHedging', 'Net Producer Hedging'],
  ['recycledGold', 'Recycled Gold'],
  ['totalSupply', 'Total Supply'],
  ['jewellery', 'Jewellery Fabrication'],
  ['technology', 'Technology'],
  ['barAndCoin', 'Total Bar and Coin'],
  ['etfDemand', 'ETFs & Similar Products'],
  ['centralBanks', 'Central Banks & Other inst.'],
  ['otcAndOther', 'OTC and Other'],
  ['totalDemand', 'Total Demand'],
  ['averagePrice', 'LBMA Gold Price (US$/oz)'],
]

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
}

export function goldPlainText(html: string): string {
  const withoutCode = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  return decodeHtml(withoutCode.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function cellText(html: string): string {
  return decodeHtml(html.replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function numeric(value: string): number | null {
  const clean = value.replace(/[−–—]/g, '-').replace(/,/g, '').trim()
  if (!clean || clean === '-' || clean === '—') return null
  const parsed = Number(clean.replace(/^\((.+)\)$/, '-$1'))
  return Number.isFinite(parsed) ? parsed : null
}

function isoDate(value: string): string {
  const parsed = new Date(`${value.trim()} UTC`)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : value.trim()
}

function normalizeMetric(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Parse the limited five-quarter table rendered publicly in the latest GDT report. */
export function parseGoldDemandHtml(html: string, sourceUrl: string): GoldQuarterly | null {
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map((match) => match[0])
  const table = tables.find((entry) => /Mine Production/i.test(entry) && /Total Demand/i.test(entry))
  if (!table) return null

  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) =>
    [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => cellText(cell[1])),
  )
  const header = rows.find((row) => row.some((cell) => /^Q[1-4]'?\d{2,4}$/i.test(cell)))
  if (!header) return null
  const periods = header.slice(1).filter((cell) => /^Q[1-4]'?\d{2,4}$/i.test(cell)).slice(0, 5)
  if (!periods.length) return null

  const rowByMetric = new Map(rows.filter((row) => row.length > 1).map((row) => [normalizeMetric(row[0]), row]))
  const points: GoldQuarterPoint[] = periods.map((period) => ({
    period,
    mineProduction: null,
    producerHedging: null,
    recycledGold: null,
    totalSupply: null,
    jewellery: null,
    technology: null,
    barAndCoin: null,
    etfDemand: null,
    centralBanks: null,
    otcAndOther: null,
    totalDemand: null,
    averagePrice: null,
  }))

  for (const [field, label] of QUARTER_FIELDS) {
    const row = rowByMetric.get(normalizeMetric(label))
    if (!row) continue
    points.forEach((point, index) => {
      point[field] = numeric(row[index + 1]) as never
    })
  }

  const text = goldPlainText(html)
  const asOfMatch = text.match(/\*?Data as of\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i)
  return {
    asOf: asOfMatch ? isoDate(asOfMatch[1]) : periods[periods.length - 1],
    source: GOLD_WGC_SOURCE,
    sourceUrl,
    periods: points,
  }
}

function firstNumber(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern)
  return match ? numeric(match[1]) : null
}

function slice(label: string, tonnes: number | null, sharePct: number | null) {
  return tonnes === null ? null : { label, tonnes, sharePct }
}

/** Parse only the headline stock totals that are visible without a Goldhub account. */
export function parseAboveGroundHtml(html: string): GoldAboveGround | null {
  const text = goldPlainText(html)
  const totalMatch = text.match(/Total above-ground stock\s*\(([^)]+)\)\s*:\s*~?([\d,]+)\s*tonnes/i)
  if (!totalMatch) return null
  const total = numeric(totalMatch[2])
  if (total === null) return null

  const jewellery = slice(
    'Jewellery',
    firstNumber(text, /Jewellery\s*~?([\d,]+)t/i),
    firstNumber(text, /Jewellery\s*~?[\d,]+t,\s*([\d.]+)%/i),
  )
  const centralBanks = slice(
    'Central banks',
    firstNumber(text, /Central banks\s*~?([\d,]+)t/i),
    firstNumber(text, /Central banks\s*~?[\d,]+t,\s*([\d.]+)%/i),
  )

  const combinedInvestment = text.match(/(?:Bar, Coin|Bars, coins)\s*&?\s*(?:and\s*)?(?:gold\s*)?ETFs?\s*~?([\d,]+)t,\s*([\d.]+)%/i)
  const bars = firstNumber(text, /Bars and coins:\s*~?([\d,]+)t/i)
  const etfs = firstNumber(text, /Gold ETFs:\s*~?([\d,]+)t/i)
  const barsPct = firstNumber(text, /Bars and coins:\s*~?[\d,]+t,\s*([\d.]+)%/i)
  const etfPct = firstNumber(text, /Gold ETFs:\s*~?[\d,]+t,\s*([\d.]+)%/i)
  const investment = slice(
    'Bars, coins & gold ETFs',
    combinedInvestment ? numeric(combinedInvestment[1]) : bars !== null && etfs !== null ? bars + etfs : null,
    combinedInvestment ? numeric(combinedInvestment[2]) : barsPct !== null && etfPct !== null ? barsPct + etfPct : null,
  )

  const combinedOther = text.match(/(?:OTC\s*&\s*other|Other\s*&\s*OTC)\s*~?([\d,]+)t,\s*([\d.]+)%/i)
  const otc = firstNumber(text, /OTC:\s*~?([\d,]+)t/i)
  const other = firstNumber(text, /Other:\s*~?([\d,]+)t/i)
  const otcPct = firstNumber(text, /OTC:\s*~?[\d,]+t,\s*([\d.]+)%/i)
  const otherPct = firstNumber(text, /Other:\s*~?[\d,]+t,\s*([\d.]+)%/i)
  const otherSlice = slice(
    'OTC & other',
    combinedOther ? numeric(combinedOther[1]) : otc !== null && other !== null ? otc + other : null,
    combinedOther ? numeric(combinedOther[2]) : otcPct !== null && otherPct !== null ? otcPct + otherPct : null,
  )
  const slices = [jewellery, centralBanks, investment, otherSlice].filter(
    (entry): entry is NonNullable<typeof entry> => entry !== null,
  )
  const accounted = slices.reduce((sum, entry) => sum + entry.tonnes, 0)
  const asOf = totalMatch[1].replace(/^end-/i, '')
  const stamp = asOf.match(/^Q([1-4])\s+(\d{4})$/i)
  const date = stamp ? `${stamp[2]}-Q${stamp[1]}` : asOf
  const source = GOLD_WGC_SOURCE
  return {
    asOf: date,
    source,
    total: goldValue(total, 'tonnes', date, source, 'quarterly'),
    belowGroundReserves: goldValue(
      firstNumber(text, /(?:Below-ground\s*)?(?:5\.\s*)?Reserves:\s*~?([\d,]+)t/i),
      'tonnes',
      date,
      source,
      'quarterly',
    ),
    belowGroundResources: goldValue(
      firstNumber(text, /(?:6\.\s*)?Resources:\s*~?([\d,]+)t/i),
      'tonnes',
      date,
      source,
      'quarterly',
    ),
    slices,
    reconciliationGap: total - accounted,
  }
}

function scaledUsd(value: string, scale: string): number | null {
  const amount = numeric(value)
  if (amount === null) return null
  return amount * (scale.toLowerCase() === 'tn' ? 1e12 : scale.toLowerCase() === 'bn' ? 1e9 : 1e6)
}

/** Parse the public headline only; fund-level/login-only tables are deliberately ignored. */
export function parseGoldEtfHtml(html: string, sourceUrl: string): GoldEtf | null {
  const text = goldPlainText(html)
  const published = text.match(/Published:\s*(\d{1,2}\s+[A-Za-z]+,?\s+\d{4})/i)
  const asOfMatch = text.match(/\*?As of\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i)
  const asOf = isoDate((asOfMatch ?? published)?.[1] ?? '')
  const holdingsMatch = text.match(/collective holdings[^.]{0,100}?by\s+([\d,.]+)t\s+to\s+([\d,.]+)t/i)
  const holdingsVerb = holdingsMatch?.[0] ?? ''
  const holdingsChange = holdingsMatch ? numeric(holdingsMatch[1]) : null
  const demandSign = /(?:fell|declined|reduced|shed|outflow)/i.test(holdingsVerb) ? -1 : 1
  const aumMatch = text.match(/(?:AUM|assets under management)[^.]{0,100}?to\s+US\$([\d,.]+)(tn|bn|mn)/i)
  const flowMatch = text.match(/US\$([\d,.]+)(tn|bn|mn)\s+(?:net\s+)?(inflows|outflows)/i)
  const source = 'World Gold Council'
  const holdings = holdingsMatch ? numeric(holdingsMatch[2]) : null
  const aum = aumMatch ? scaledUsd(aumMatch[1], aumMatch[2]) : null
  const flow = flowMatch ? scaledUsd(flowMatch[1], flowMatch[2]) : null
  if (holdings === null && aum === null && flow === null) return null
  return {
    asOf,
    source,
    sourceUrl,
    holdings: goldValue(holdings, 'tonnes', asOf, source, 'monthly'),
    aum: goldValue(aum, 'usd', asOf, source, 'monthly'),
    monthlyFlowUsd: goldValue(
      flow === null ? null : flow * (flowMatch?.[3].toLowerCase() === 'outflows' ? -1 : 1),
      'usd',
      asOf,
      source,
      'monthly',
    ),
    monthlyDemand: goldValue(
      holdingsChange === null ? null : holdingsChange * demandSign,
      'tonnes',
      asOf,
      source,
      'monthly',
    ),
  }
}

/** Parse the newline-preserving text extracted from the official two-page USGS gold PDF. */
export function parseUsgsGoldText(text: string, sourceUrl: string): GoldMining | null {
  const section = text.match(/World Mine Production and Reserves:[\s\S]*?World Resources:/i)?.[0]
  if (!section) return null
  const years = section.match(/Mine production\s+Reserves\s*\d*\s*\n\s*(\d{4})\s+(\d{4})/i)
  const year = years?.[2] ?? ''
  const productionYearEstimated = /Mine production\s+Reserves\s*\d*\s*\n\s*\d{4}\s+\d{4}\s+e/i.test(section)
  const rows: GoldMiningRow[] = []
  for (const rawLine of section.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim()
    const match = line.match(/^(.+?)\s+(e\s+)?([\d,]+)\s+([\d,]+)\s+(?:(?:1[0-5])\s+)?([\d,]+)$/i)
    if (!match) continue
    const country = match[1].trim()
    if (/^(Mine production|Reserves for)/i.test(country)) continue
    const priorProduction = numeric(match[3])
    const production = numeric(match[4])
    const reserves = numeric(match[5])
    if (priorProduction === null || production === null || reserves === null) continue
    rows.push({
      country: country.replace(/\s*\(rounded\)$/i, ''),
      priorProduction,
      production,
      reserves,
      reserveLifeYears: production > 0 ? reserves / production : null,
      estimated: productionYearEstimated || Boolean(match[2]) || /\be\s+[\d,]+/i.test(line),
    })
  }
  if (!rows.some((row) => row.country === 'World total')) return null
  return { asOf: year, source: GOLD_USGS_SOURCE, sourceUrl, rows }
}

export function goldValue(
  value: number | null,
  unit: GoldUnit,
  asOf: string,
  source: string,
  frequency: GoldValue['frequency'],
  note?: string,
): GoldValue {
  return { value: value !== null && Number.isFinite(value) ? value : null, unit, asOf, source, frequency, note }
}

export interface GoldBuildInput {
  fetchedAt: string
  market: GoldMarket
  quarterly: GoldQuarterly | null
  aboveGround: GoldAboveGround | null
  etf: GoldEtf | null
  mining: GoldMining | null
}

export function emptyGoldMarket(): GoldMarket {
  const empty = (unit: GoldUnit): GoldValue => goldValue(null, unit, '', GOLD_MARKET_SOURCE, 'live')
  return {
    futuresPrice: empty('usdPerOz'),
    futuresChangePct: empty('percent'),
    gldPrice: empty('usd'),
    gldChangePct: empty('percent'),
  }
}

export function buildGoldPayload(input: GoldBuildInput): GoldPayload {
  const latest = input.quarterly?.periods.at(-1) ?? null
  const world = input.mining?.rows.find((row) => row.country === 'World total') ?? null
  const stock = input.aboveGround?.total.value ?? null
  const stockToFlow = stock !== null && world?.production ? stock / world.production : null
  const latestStamp = input.quarterly?.asOf ?? ''
  const progress = Object.fromEntries(
    [
      ['market', Object.values(input.market).some((metric) => metric.value !== null)],
      ['demand', input.quarterly !== null],
      ['aboveGround', input.aboveGround !== null],
      ['etf', input.etf !== null],
      ['mining', input.mining !== null],
    ].map(([block, loaded]) => [block, loaded ? 'loaded' : 'unavailable']),
  ) as Record<GoldBlock, GoldBlockStatus>
  return {
    fetchedAt: input.fetchedAt,
    market: input.market,
    quarterly: input.quarterly,
    aboveGround: input.aboveGround,
    etf: input.etf,
    mining: input.mining,
    derived: {
      latestSupply: goldValue(latest?.totalSupply ?? null, 'tonnes', latestStamp, GOLD_WGC_SOURCE, 'quarterly'),
      latestDemand: goldValue(latest?.totalDemand ?? null, 'tonnes', latestStamp, GOLD_WGC_SOURCE, 'quarterly'),
      stockToFlow: goldValue(
        stockToFlow,
        'years',
        [input.aboveGround?.asOf, input.mining?.asOf].filter(Boolean).join(' / '),
        `${input.aboveGround?.source ?? GOLD_WGC_SOURCE} × ${input.mining?.source ?? GOLD_USGS_SOURCE}`,
        'derived',
        'Above-ground stock divided by latest annual world mine production; source dates differ.',
      ),
    },
    progress,
  }
}

export function emptyGoldPayload(fetchedAt = ''): GoldPayload {
  return buildGoldPayload({
    fetchedAt,
    market: emptyGoldMarket(),
    quarterly: null,
    aboveGround: null,
    etf: null,
    mining: null,
  })
}

function snapshotLine(label: string, metric: GoldValue): string {
  const value = metric.value === null ? '—' : metric.value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return `${label}: ${value} ${metric.unit} · ${metric.asOf || 'date unavailable'} · ${metric.source}`
}

export function buildGoldSnapshot(payload: GoldPayload): string {
  return [
    'GOLD — PHYSICAL FUNDAMENTALS',
    `Fetched: ${payload.fetchedAt || '—'}`,
    snapshotLine('COMEX futures proxy', payload.market.futuresPrice),
    snapshotLine('GLD proxy', payload.market.gldPrice),
    snapshotLine('Above-ground stock', payload.aboveGround?.total ?? goldValue(null, 'tonnes', '', GOLD_WGC_SOURCE, 'quarterly')),
    snapshotLine('Latest quarterly supply', payload.derived.latestSupply),
    snapshotLine('Latest quarterly demand', payload.derived.latestDemand),
    snapshotLine('Stock-to-flow', payload.derived.stockToFlow),
    '',
    'Sources: World Gold Council / Metals Focus; U.S. Geological Survey; Yahoo Finance.',
    'Public headline extracts only. COMEX and GLD are market proxies, not the LBMA benchmark.',
  ].join('\n')
}
