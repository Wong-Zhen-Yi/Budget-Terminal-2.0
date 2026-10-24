import type {
  CalendarCompanyEvent,
  CalendarEconomicReading,
  EconomicPoint,
  CalendarExportInput,
  EarningsCalendarPayload,
  EarningsCalendarRow,
  EarningsExportInput,
  EconomicCalendarEvent,
  MarketHolidayEvent,
} from './contract.js'

export const CALENDAR_TIMEZONES = [
  { id: 'local', label: 'Local', zone: '' },
  { id: 'utc', label: 'UTC', zone: 'UTC' },
  { id: 'est', label: 'EST', zone: 'America/New_York' },
  { id: 'cst', label: 'CST', zone: 'America/Chicago' },
  { id: 'pst', label: 'PST', zone: 'America/Los_Angeles' },
  { id: 'gmt', label: 'GMT', zone: 'Europe/London' },
  { id: 'cet', label: 'CET', zone: 'Europe/Paris' },
  { id: 'ist', label: 'IST', zone: 'Asia/Kolkata' },
  { id: 'jst', label: 'JST', zone: 'Asia/Tokyo' },
  { id: 'sgt', label: 'SGT', zone: 'Asia/Singapore' },
  { id: 'aest', label: 'AEST', zone: 'Australia/Sydney' },
  { id: 'nzst', label: 'NZST', zone: 'Pacific/Auckland' },
] as const

export type CalendarTimezoneId = (typeof CALENDAR_TIMEZONES)[number]['id']
export type EarningsRangeMode = 'rolling' | 'year'
export type EarningsTiming = 'all' | 'BMO' | 'AMC' | 'TAS' | 'TBD'

const MONTHS: Record<string, number> = {
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12,
}

const HOLIDAY_LABELS: Record<string, string> = {
  "New Year's Day": 'New Year',
  'Martin Luther King Jr. Day': 'MLK Day',
  'Presidents Day': 'Presidents',
  'Good Friday': 'Good Friday',
  'Memorial Day': 'Memorial',
  Juneteenth: 'Juneteenth',
  'Independence Day': 'July 4',
  'Independence Day (observed)': 'July 4 Obs',
  'Labor Day': 'Labor Day',
  Thanksgiving: 'Thanksgiving',
  'Christmas Day': 'Christmas',
  'Christmas Day (observed)': 'Christmas Obs',
  'Black Friday': 'Black Fri',
  'Christmas Eve': 'Xmas Eve',
  'Independence Day Eve': 'July 3 Close',
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

export function parseIsoDate(value: unknown): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? '').trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) return null
  return parsed
}

export function calendarToday(timezone: CalendarTimezoneId, now = new Date()): string {
  const choice = CALENDAR_TIMEZONES.find((entry) => entry.id === timezone) ?? CALENDAR_TIMEZONES[0]
  if (!choice.zone) {
    return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate())
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: choice.zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${read('year')}-${read('month')}-${read('day')}`
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const value = new Date(Date.UTC(year, month - 1 + delta, 1))
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1 }
}

/** Monday-first, always six rows, with nulls outside the selected month. */
export function monthCells(year: number, month: number): Array<number | null> {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const mondayOffset = (first.getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - mondayOffset + 1
    return day >= 1 && day <= days ? day : null
  })
}

export function startOfWeek(value: string): string {
  const date = parseIsoDate(value) ?? new Date()
  const weekday = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - weekday)
  return date.toISOString().slice(0, 10)
}

export function addDays(value: string, days: number): string {
  const date = parseIsoDate(value) ?? new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number {
  const left = parseIsoDate(from)
  const right = parseIsoDate(to)
  if (!left || !right) return 0
  return Math.round((right.getTime() - left.getTime()) / 86_400_000)
}

export function earningsDateRange(
  mode: EarningsRangeMode,
  year: number,
  today = new Date().toISOString().slice(0, 10),
): { startDate: string; endDate: string; rangeKey: string; label: string } {
  if (mode === 'year') {
    return {
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      rangeKey: `year_${year}`,
      label: String(year),
    }
  }
  return {
    startDate: today,
    endDate: addDays(today, 365),
    rangeKey: 'rolling_12m',
    label: 'Current + next 12 months',
  }
}

function nthWeekday(year: number, month: number, weekday: number, occurrence: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const offset = (weekday - first.getUTCDay() + 7) % 7
  return isoDate(year, month, 1 + offset + (occurrence - 1) * 7)
}

function lastWeekday(year: number, month: number, weekday: number): string {
  const last = new Date(Date.UTC(year, month, 0))
  last.setUTCDate(last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7))
  return last.toISOString().slice(0, 10)
}

function observedFixed(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1)
  else if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function easterSunday(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const correction = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * correction) / 451)
  const month = Math.floor((h + correction - 7 * m + 114) / 31)
  const day = ((h + correction - 7 * m + 114) % 31) + 1
  return isoDate(year, month, day)
}

function friendlyHolidayName(name: string, date: string): string {
  const suffix = date.slice(5)
  if (name === 'Independence Day' && suffix !== '07-04') return `${name} (observed)`
  if (name === 'Christmas Day' && suffix !== '12-25') return `${name} (observed)`
  if (name === "New Year's Day" && suffix !== '01-01') return `${name} (observed)`
  if (name === 'Juneteenth' && suffix !== '06-19') return `${name} (observed)`
  return name
}

export function buildMarketHolidays(year: number): MarketHolidayEvent[] {
  const easter = parseIsoDate(easterSunday(year))!
  easter.setUTCDate(easter.getUTCDate() - 2)
  const holidays: Array<[string, string]> = [
    [nthWeekday(year, 1, 1, 3), 'Martin Luther King Jr. Day'],
    [nthWeekday(year, 2, 1, 3), 'Presidents Day'],
    [easter.toISOString().slice(0, 10), 'Good Friday'],
    [lastWeekday(year, 5, 1), 'Memorial Day'],
    [observedFixed(year, 7, 4), 'Independence Day'],
    [nthWeekday(year, 9, 1, 1), 'Labor Day'],
    [nthWeekday(year, 11, 4, 4), 'Thanksgiving'],
    [observedFixed(year, 12, 25), 'Christmas Day'],
  ]
  if (year >= 2022) holidays.push([observedFixed(year, 6, 19), 'Juneteenth'])
  // NYSE does not observe a Saturday New Year's Day on the preceding Friday.
  // https://www.nyse.com/markets/hours-calendars (2028 calendar footnote)
  if (new Date(Date.UTC(year, 0, 1)).getUTCDay() !== 6) holidays.push([observedFixed(year, 1, 1), "New Year's Day"])

  const byDate = new Map(
    holidays
      .filter(([date]) => date.startsWith(`${year}-`))
      .map(([date, name]) => [date, friendlyHolidayName(name, date)]),
  )
  const early: Array<[string, string]> = [
    [addDays(nthWeekday(year, 11, 4, 4), 1), 'Black Friday'],
    [isoDate(year, 12, 24), 'Christmas Eve'],
    [addDays(isoDate(year, 7, 4), -1), 'Independence Day Eve'],
  ]
  const events: MarketHolidayEvent[] = [...byDate].map(([date, event]) => ({
    date,
    market: 'US Equities',
    event,
    detail: 'Closed all day',
    cellLabel: HOLIDAY_LABELS[event] ?? event.slice(0, 12),
    color: '#26c6da',
  }))
  for (const [date, event] of early) {
    const parsed = parseIsoDate(date)
    if (!parsed || !date.startsWith(`${year}-`) || parsed.getUTCDay() === 0 || parsed.getUTCDay() === 6 || byDate.has(date)) continue
    events.push({
      date,
      market: 'US Equities',
      event,
      detail: '1:00 PM ET close',
      cellLabel: HOLIDAY_LABELS[event] ?? event.slice(0, 12),
      color: '#8bc34a',
    })
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.event.localeCompare(b.event))
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', rsquo: "'",
  }
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
    if (entity.startsWith('#')) {
      const hex = entity[1]?.toLowerCase() === 'x'
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ''
    }
    return named[entity.toLowerCase()] ?? ''
  })
}

export function htmlText(value: string): string {
  return decodeEntities(
    value
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

function textLines(html: string): string[] {
  return htmlText(html).split('\n').filter(Boolean)
}

function dateFromMonthDay(month: string, day: string, year: number): string | null {
  const monthNumber = MONTHS[month]
  const parsedDay = Number(day)
  if (!monthNumber || !Number.isInteger(parsedDay)) return null
  return parseIsoDate(isoDate(year, monthNumber, parsedDay))?.toISOString().slice(0, 10) ?? null
}

export function parseFomcSchedule(html: string, year: number): EconomicCalendarEvent[] {
  const lines = textLines(html)
  const marker = `${year} FOMC Meetings`
  const start = lines.indexOf(marker)
  if (start < 0) return []
  const events: EconomicCalendarEvent[] = []
  for (let index = start + 1; index < lines.length - 1; index += 1) {
    if (lines[index].endsWith('FOMC Meetings')) break
    const month = MONTHS[lines[index]]
    const match = /^(\d{1,2})(?:-(\d{1,2}))?\*?$/.exec(lines[index + 1])
    if (!month || !match) continue
    const date = isoDate(year, month, Number(match[2] ?? match[1]))
    if (parseIsoDate(date)) events.push({ date, name: 'FOMC Decision', importance: 'high' })
  }
  return dedupeEconomic(events)
}

export function parseBeaSchedule(html: string, year: number): EconomicCalendarEvent[] {
  const lines = textLines(html)
  const marker = `Year ${year}`
  const start = Math.max(lines.indexOf(marker), 0)
  let currentDate = ''
  const events: EconomicCalendarEvent[] = []
  for (const line of lines.slice(start)) {
    if (line.startsWith('Year ') && line !== marker) break
    const dateMatch = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\b/.exec(line)
    if (dateMatch) {
      currentDate = dateFromMonthDay(dateMatch[1], dateMatch[2], year) ?? ''
      continue
    }
    if (!currentDate) continue
    if (line.startsWith('Personal Income and Outlays,')) {
      const reference = /,\s*(\w+) (\d{4})/.exec(line)
      events.push({ date: currentDate, name: 'PCE Inflation', importance: 'medium',
        ...(reference && MONTHS[reference[1]] ? { referencePeriod: `${reference[2]}-${pad2(MONTHS[reference[1]])}` } : {}),
      })
    } else if (/^(GDP \((Advance|Second|Third) Estimate\)|Gross Domestic Product,)/.test(line) && !line.includes('by State')) {
      events.push({ date: currentDate, name: 'GDP Report', importance: 'high' })
    }
  }
  return dedupeEconomic(events)
}

export function parseBlsSchedule(html: string, year: number): EconomicCalendarEvent[] {
  let currentDate = ''
  const events: EconomicCalendarEvent[] = []
  for (const line of textLines(html)) {
    const match = /^(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})$/.exec(line)
    if (match) {
      currentDate = Number(match[3]) === year ? dateFromMonthDay(match[1], match[2], year) ?? '' : ''
      continue
    }
    if (!currentDate) continue
    const lower = line.toLowerCase()
    const before = events.length
    if (lower.startsWith('employment situation for ')) events.push({ date: currentDate, name: 'Jobs Report', importance: 'high' })
    else if (lower.startsWith('consumer price index for ')) events.push({ date: currentDate, name: 'CPI Release', importance: 'high' })
    else if (lower.startsWith('producer price index for ')) events.push({ date: currentDate, name: 'PPI Release', importance: 'medium' })
    else if (lower.startsWith('job openings and labor turnover survey for ')) events.push({ date: currentDate, name: 'JOLTS Report', importance: 'medium' })
    const reference = /for (\w+) (\d{4})/i.exec(line)
    if (events.length > before && reference && MONTHS[reference[1]]) {
      events[events.length - 1].referencePeriod = `${reference[2]}-${pad2(MONTHS[reference[1]])}`
    }
  }
  return dedupeEconomic(events)
}

/** Values are current revised observations, not release-day vintages or forecasts. */
export const CALENDAR_INFLATION_SERIES = [
  { event: 'CPI Release', id: 'CPIAUCSL', label: 'CPI' },
  { event: 'CPI Release', id: 'CPILFESL', label: 'Core CPI' },
  { event: 'PPI Release', id: 'PPIFIS', label: 'PPI final demand' },
  { event: 'PCE Inflation', id: 'PCEPI', label: 'PCE' },
  { event: 'PCE Inflation', id: 'PCEPILFE', label: 'Core PCE' },
] as const

export function calendarEconomicReadings(
  event: EconomicCalendarEvent,
  series: ReadonlyMap<string, EconomicPoint[]>,
  today: string,
): CalendarEconomicReading[] {
  const release = parseIsoDate(event.date)
  if (!release) return []
  release.setUTCMonth(release.getUTCMonth(), 1)
  release.setUTCMonth(release.getUTCMonth() - 1)
  const period = event.referencePeriod && /^\d{4}-(0[1-9]|1[0-2])$/.test(event.referencePeriod)
    ? event.referencePeriod : release.toISOString().slice(0, 7)
  const monthBefore = (month: string, delta: number) => {
    const date = new Date(`${month}-01T00:00:00Z`)
    date.setUTCMonth(date.getUTCMonth() - delta)
    return date.toISOString().slice(0, 7)
  }
  return CALENDAR_INFLATION_SERIES.filter(spec => spec.event === event.name).flatMap(spec => {
    const points = new Map((series.get(spec.id) ?? []).map(([date, value]) => [date.slice(0, 7), value]))
    const change = (month: string, lag: number): string | null => {
      const current = points.get(month)
      const base = points.get(monthBefore(month, lag))
      if (current === undefined || base === undefined || base === 0) return null
      const value = (current / base - 1) * 100
      return `${Object.is(Number(value.toFixed(1)), -0) ? '0.0' : value.toFixed(1)}%`
    }
    return [1, 12].map(lag => ({
      label: `${spec.label} ${lag === 1 ? 'MoM (SA)' : 'YoY (SA)'}`,
      seriesId: spec.id,
      source: 'FRED · current revised data',
      period,
      actual: event.date <= today ? change(period, lag) : null,
      previous: change(monthBefore(period, 1), lag),
    }))
  })
}

function tableRows(html: string): string[][] {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((cell) => htmlText(cell[1])),
  )
}

export function parseFredRelease(
  html: string,
  year: number,
  sourceName: string,
  eventName: string,
  importance: string,
): EconomicCalendarEvent[] {
  let currentDate = ''
  const events: EconomicCalendarEvent[] = []
  for (const cells of tableRows(html)) {
    const text = cells.join(' ')
    const match = /^(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/.exec(text)
    if (match) {
      currentDate = Number(match[3]) === year ? dateFromMonthDay(match[1], match[2], year) ?? '' : ''
      continue
    }
    if (currentDate && text.toLowerCase().includes(sourceName.toLowerCase())) {
      events.push({ date: currentDate, name: eventName, importance })
      currentDate = ''
    }
  }
  return dedupeEconomic(events)
}

export function parseCensusSchedule(html: string, year: number): EconomicCalendarEvent[] {
  const events: EconomicCalendarEvent[] = []
  for (const cells of tableRows(html)) {
    if (cells.length < 2) continue
    const match = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})$/.exec(cells[1])
    if (!match || Number(match[3]) !== year) continue
    const date = dateFromMonthDay(match[1], match[2], year)
    if (!date) continue
    const name = cells[0].toLowerCase()
    if (name.startsWith('advance monthly sales for retail and food services')) events.push({ date, name: 'Retail Sales', importance: 'high' })
    else if (name.startsWith('advance report on durable goods')) events.push({ date, name: 'Durable Goods Report', importance: 'medium' })
    else if (name.startsWith('new residential construction')) events.push({ date, name: 'Housing Starts & Permits', importance: 'medium' })
    else if (name.startsWith('new residential sales')) events.push({ date, name: 'New Home Sales', importance: 'medium' })
  }
  return dedupeEconomic(events)
}

export function dedupeEconomic(events: EconomicCalendarEvent[]): EconomicCalendarEvent[] {
  const seen = new Set<string>()
  return [...events]
    .filter((event) => event.date && event.name)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
    .filter((event) => {
      const key = `${event.date}|${event.name}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function mergeEconomicCategories(
  fresh: EconomicCalendarEvent[],
  stale: EconomicCalendarEvent[],
): EconomicCalendarEvent[] {
  if (!fresh.length) return dedupeEconomic(stale)
  const names = new Set(fresh.map((event) => event.name))
  return dedupeEconomic([...fresh, ...stale.filter((event) => !names.has(event.name))])
}

const EXCLUDED_SECURITY = /\b(etf|etn|exchange[- ]traded|fund|closed[- ]end|warrant|right|unit|preferred|preference|senior note|subordinated note|baby bond|notes due|depositary share)s?\b/i
const INCLUDED_COMPANY = /\b(common stock|ordinary share|ordinary shares|american depositary|ads|class [a-z] ordinary|shares)\b/i

export function parseNasdaqCompanySymbols(text: string, listingExchanges?: ReadonlySet<string>): Set<string> {
  const lines = text.replace(/\r/g, '').split('\n').filter(Boolean)
  const headers = (lines.shift() ?? '').split('|')
  const index = (name: string) => headers.indexOf(name)
  const symbols = new Set<string>()
  for (const line of lines) {
    const values = line.split('|')
    const symbol = (values[index('Symbol')] ?? '').trim().toUpperCase()
    const name = (values[index('Security Name')] ?? '').trim()
    if (!symbol || symbol.startsWith('FILE CREATION TIME')) continue
    if ((values[index('Nasdaq Traded')] ?? '').trim().toUpperCase() !== 'Y') continue
    if ((values[index('Test Issue')] ?? '').trim().toUpperCase() === 'Y') continue
    if ((values[index('ETF')] ?? '').trim().toUpperCase() === 'Y') continue
    if (listingExchanges && !listingExchanges.has((values[index('Listing Exchange')] ?? '').trim().toUpperCase())) continue
    if (symbol.includes('$') || symbol.includes('^')) continue
    const exclusionName = name.replace(/\bAmerican Depositary Shares?\b/gi, 'American Depositary')
    if (EXCLUDED_SECURITY.test(exclusionName) || !INCLUDED_COMPANY.test(name)) continue
    symbols.add(symbol)
  }
  return symbols
}

export interface EarningsVisualizationDocument {
  columns?: Array<{ id?: string; label?: string; type?: string }>
  rows?: unknown[][]
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value)
  return value !== null && value !== '' && Number.isFinite(number) ? number : null
}

function formatNumber(value: number | null): string {
  return value === null ? '--' : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatPercent(value: number | null): string {
  return value === null ? '--' : `${formatNumber(value)}%`
}

function formatMarketCap(value: number | null): string {
  if (value === null || value <= 0) return '--'
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  return `$${Math.round(value).toLocaleString('en-US')}`
}

export function earningsEventKey(row: Pick<EarningsCalendarRow, 'symbol' | 'eventName' | 'date'>): string {
  const event = row.eventName.trim().toLowerCase().replace(/\s+/g, ' ')
  if (event && event !== '--' && event !== 'none') return `${row.symbol}|${event}`
  const date = parseIsoDate(row.date)
  const quarter = date ? Math.floor(date.getUTCMonth() / 3) + 1 : 0
  return `${row.symbol}|${date?.getUTCFullYear() ?? 'unknown'}Q${quarter || 'unknown'}`
}

/** Calendar-relative labels must be recalculated when a cached schedule is displayed. */
export function earningsStatus(row: Pick<EarningsCalendarRow, 'date' | 'reportedEpsValue'>, today: string): string {
  return typeof row.reportedEpsValue === 'number' && Number.isFinite(row.reportedEpsValue)
    ? 'Reported' : row.date < today ? 'Past date' : row.date === today ? 'Today' : 'Upcoming'
}

export function parseEarningsVisualization(
  document: EarningsVisualizationDocument,
  startDate: string,
  endDate: string,
  allowedSymbols: Set<string>,
  today = new Date().toISOString().slice(0, 10),
): EarningsCalendarRow[] {
  const columns = document.columns ?? []
  const positions = new Map(columns.map((column, index) => [column.id ?? column.label ?? '', index]))
  const read = (row: unknown[], id: string): unknown => row[positions.get(id) ?? -1]
  const parsed: EarningsCalendarRow[] = []
  for (const values of document.rows ?? []) {
    const symbol = String(read(values, 'ticker') ?? '').trim().toUpperCase()
    if (!symbol || (allowedSymbols.size && !allowedSymbols.has(symbol))) continue
    const rawDate = String(read(values, 'startdatetime') ?? '')
    const datetime = new Date(rawDate)
    if (!Number.isFinite(datetime.getTime())) continue
    const date = datetime.toISOString().slice(0, 10)
    if (date < startDate || date > endDate) continue
    const epsEstimateValue = numberOrNull(read(values, 'epsestimate'))
    const reportedEpsValue = numberOrNull(read(values, 'epsactual'))
    const surprisePctValue = numberOrNull(read(values, 'epssurprisepct'))
    const marketCapValue = numberOrNull(read(values, 'intradaymarketcap'))
    const row: EarningsCalendarRow = {
      date,
      dateDisplay: datetime.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' }),
      datetimeUtc: datetime.toISOString(),
      timeDisplay: datetime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }) + ' UTC',
      symbol,
      company: String(read(values, 'companyshortname') ?? '--').trim() || '--',
      eventName: String(read(values, 'eventname') ?? '--').trim() || '--',
      timing: String(read(values, 'startdatetimetype') ?? '--').trim().toUpperCase() || '--',
      epsEstimate: formatNumber(epsEstimateValue),
      epsEstimateValue,
      reportedEps: formatNumber(reportedEpsValue),
      reportedEpsValue,
      surprisePct: formatPercent(surprisePctValue),
      surprisePctValue,
      marketCap: formatMarketCap(marketCapValue),
      marketCapValue,
      status: earningsStatus({ date, reportedEpsValue }, today),
      previousDate: '',
      previousDatetimeUtc: '',
      changedDate: false,
      eventKey: '',
    }
    row.eventKey = earningsEventKey(row)
    parsed.push(row)
  }
  return dedupeEarnings(parsed)
}

export function dedupeEarnings(rows: EarningsCalendarRow[]): EarningsCalendarRow[] {
  const seen = new Set<string>()
  return [...rows]
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeDisplay.localeCompare(b.timeDisplay) || a.symbol.localeCompare(b.symbol))
    .filter((row) => {
      const key = `${earningsEventKey(row)}|${row.datetimeUtc || row.date}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function mergeEarningsRows(
  fresh: EarningsCalendarRow[],
  cached: EarningsCalendarRow[],
  today = new Date().toISOString().slice(0, 10),
): EarningsCalendarRow[] {
  const byKey = new Map(cached.map((row) => [earningsEventKey(row), row]))
  const seen = new Set<string>()
  const merged = fresh.map((incoming) => {
    const row = { ...incoming, eventKey: earningsEventKey(incoming) }
    const previous = byKey.get(row.eventKey)
    if (previous) {
      const moved = Boolean(
        previous.datetimeUtc && row.datetimeUtc && previous.datetimeUtc !== row.datetimeUtc,
      ) || Boolean(previous.timing && row.timing && previous.timing !== row.timing)
      row.changedDate = moved || previous.changedDate
      row.previousDate = moved ? previous.dateDisplay || previous.date : previous.previousDate
      row.previousDatetimeUtc = moved ? previous.datetimeUtc : previous.previousDatetimeUtc
    }
    seen.add(row.eventKey)
    return row
  })
  for (const row of cached) {
    const key = earningsEventKey(row)
    if (!seen.has(key) && row.date < today) merged.push({ ...row, eventKey: key })
  }
  return dedupeEarnings(merged)
}

export function filterEarningsRows(
  rows: EarningsCalendarRow[],
  search: string,
  timing: EarningsTiming,
  changedOnly: boolean,
): EarningsCalendarRow[] {
  const needle = search.trim().toLowerCase()
  return rows.filter((row) => {
    if (needle && !`${row.symbol} ${row.company} ${row.eventName}`.toLowerCase().includes(needle)) return false
    if (timing !== 'all' && row.timing !== timing) return false
    return !changedOnly || row.changedDate
  })
}

export function earningsWeekRows(rows: EarningsCalendarRow[], weekStart: string): EarningsCalendarRow[][] {
  const groups = Array.from({ length: 5 }, () => [] as EarningsCalendarRow[])
  for (const row of rows) {
    const offset = daysBetween(weekStart, row.date)
    if (offset >= 0 && offset < 5) groups[offset].push(row)
  }
  for (const group of groups) {
    group.sort((a, b) => {
      if (a.marketCapValue === null && b.marketCapValue !== null) return 1
      if (a.marketCapValue !== null && b.marketCapValue === null) return -1
      return (b.marketCapValue ?? 0) - (a.marketCapValue ?? 0) || a.datetimeUtc.localeCompare(b.datetimeUtc) || a.symbol.localeCompare(b.symbol)
    })
  }
  return groups
}

function exportValue(value: unknown, fallback = '--'): string {
  const text = String(value ?? '').replace(/[\r\n]+/g, ' ').trim()
  return text || fallback
}

export function buildCalendarExport(input: CalendarExportInput): string {
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(input.year, input.month - 1, 1)))
  const lines = [
    '='.repeat(70),
    'BUDGET TERMINAL - CALENDAR EXPORT',
    `Month: ${monthName} ${input.year}`,
    `Exported: ${input.today}`,
    '='.repeat(70),
    '',
    '-'.repeat(70),
    'LLM INSTRUCTIONS',
    '-'.repeat(70),
    '',
    'You are being given financial calendar data from Budget Terminal.',
    'Your task is to create calendar events from this data.',
    '',
    'For each event below, create a calendar entry with:',
    '  - Title: Use the format shown in each section',
    '  - Date: As specified (YYYY-MM-DD)',
    '  - All-day event: Yes (unless noted otherwise)',
    '  - Calendar: Use the user\'s default calendar or a "Finance" calendar if available',
    '',
    'TITLE FORMATS:',
  ]
  if (input.includeEconomic) lines.push('  Economic events  -> "[ECON] <Event Name>"')
  if (input.includeMarketHolidays) {
    lines.push('  Market holidays  -> "[MARKET] <Holiday Name>"')
    lines.push('  Early closes     -> "[MARKET] <Holiday Name> Early Close"')
  }
  if (input.includeCompany) {
    lines.push('  Earnings         -> "[EARNINGS] <TICKER>"')
    lines.push('  Ex-Dividend      -> "[EX-DIV] <TICKER>"')
  }
  if (input.includeOptions) lines.push('  Options Expiry   -> "[OPTIONS] <TICKER> <STRIKE> <STRATEGY> x<QTY> expires"')
  lines.push('', 'IMPORTANT:', '  - Do NOT create duplicate events if they already exist on the calendar.', '  - Skip any events with dates that have already passed.')
  if (input.includeMarketHolidays) lines.push('  - Early closes should be timed events at 1:00 PM Eastern Time, not all-day events.')
  lines.push(`  - Today's date is ${input.today}.`, '')

  const section = (title: string, rows: string[]) => {
    lines.push('-'.repeat(70), title, '-'.repeat(70), ...(rows.length ? rows : ['  (none)']), '')
  }
  if (input.includeEconomic) {
    section('ECONOMIC EVENTS', input.economicEvents.map(event => [
      `  ${event.date}  ${event.name}  (Importance: ${event.importance})`,
      ...(event.readings ?? []).map(reading =>
        `    ${reading.label}: ${reading.actual ?? 'Not available'} | Previous: ${reading.previous ?? '--'} | Period: ${reading.period} | ${reading.source} (${reading.seriesId})`),
      ...(event.readingsNote ? [`    ${event.readingsNote}`] : []),
    ].join('\n')))
  }
  if (input.includeMarketHolidays) section('MARKET HOLIDAYS & EARLY CLOSES', input.marketHolidays.map((event) => `  ${event.date}  ${event.market}  ${event.event}  ${event.detail}${event.detail.toLowerCase().includes('close') ? '  (timed event)' : ''}`))
  if (input.includeCompany) section('COMPANY EVENTS (Earnings & Ex-Dividend)', input.companyEvents.map((event) => `  ${event.date}  ${event.ticker}  ${event.event}`))
  if (input.includeOptions) section('OPTIONS EXPIRATIONS', input.options.map((option) => `  ${option.expiry}  ${option.ticker}  ${option.strike.toFixed(2)} ${option.strategy} x${option.contracts}`))
  lines.push('='.repeat(70), 'END OF EXPORT', '='.repeat(70))
  return lines.join('\n')
}

export function buildEarningsExport(input: EarningsExportInput): string {
  const groups = earningsWeekRows(input.rows, input.weekStart)
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const visible = groups.reduce((total, group) => total + group.length, 0)
  const filters = [
    input.search.trim() ? `search="${input.search.trim()}"` : '',
    input.timing !== 'all' ? `timing=${input.timing}` : '',
    input.changedOnly ? 'changed_dates_only=true' : '',
  ].filter(Boolean)
  const lines = [
    '='.repeat(70),
    'BUDGET TERMINAL - EARNINGS WEEK EXPORT',
    `Business week: ${input.weekStart} to ${addDays(input.weekStart, 4)} (Monday-Friday)`,
    `Exported: ${input.exportedAt}`,
    `Source: ${exportValue(input.payload.source)}`,
    `Data fetched: ${exportValue(input.payload.fetchedAt)}`,
    `Selected range: ${input.rangeLabel} (${input.payload.startDate} to ${input.payload.endDate})`,
    `Visible filters: ${filters.join(', ') || 'none'}`,
    `Visible events: ${visible}; filtered rows in range: ${input.rows.length}; cached rows: ${input.payload.rows.length}`,
    '='.repeat(70),
    '',
    'LLM INSTRUCTIONS',
    '- Review these US-listed company earnings for the visible business week.',
    '- Identify the most important events, crowded reporting days, notable date changes, and names where EPS expectations or reported results deserve follow-up.',
    '- Treat DATE CHANGED markers as schedule-risk signals.',
    '- Do not assume rows outside this Monday-Friday view are included.',
    '',
    'EARNINGS BY DAY',
    '-'.repeat(70),
  ]
  groups.forEach((group, index) => {
    lines.push(`${weekdays[index]} ${addDays(input.weekStart, index)} (${group.length} events)`)
    if (!group.length) lines.push('  (none)')
    for (const row of group) {
      const changed = row.changedDate ? ` | DATE CHANGED from ${exportValue(row.previousDate, 'unknown previous date')}` : ''
      lines.push(`  - ${row.symbol} | ${row.company} | ${row.eventName} | timing=${row.timing} | time=${row.timeDisplay} | eps_estimate=${row.epsEstimate} | reported_eps=${row.reportedEps} | surprise=${row.surprisePct} | market_cap=${row.marketCap} | status=${row.status}${changed}`)
    }
    lines.push('')
  })
  lines.push('='.repeat(70), 'END OF EXPORT', '='.repeat(70))
  return lines.join('\n')
}

export function companyEventsFromCalendar(
  ticker: string,
  calendar: { earnings?: { earningsDate?: Date[] }; exDividendDate?: Date },
): CalendarCompanyEvent[] {
  const events: CalendarCompanyEvent[] = []
  const earnings = calendar.earnings?.earningsDate?.[0]
  if (earnings instanceof Date && Number.isFinite(earnings.getTime())) {
    events.push({ date: earnings.toISOString().slice(0, 10), ticker, event: 'Earnings' })
  }
  const exDividend = calendar.exDividendDate
  if (exDividend instanceof Date && Number.isFinite(exDividend.getTime())) {
    events.push({ date: exDividend.toISOString().slice(0, 10), ticker, event: 'Ex-Dividend' })
  }
  return events
}

export function emptyEarningsPayload(startDate: string, endDate: string, rangeKey: string): EarningsCalendarPayload {
  return {
    rows: [],
    source: 'yahoo earnings calendar',
    sourceUrl: 'https://finance.yahoo.com/calendar/earnings',
    fetchedAt: '',
    startDate,
    endDate,
    rangeKey,
    symbolUniverseCount: 0,
  }
}
