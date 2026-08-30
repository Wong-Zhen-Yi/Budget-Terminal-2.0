import type { YouTubeVideo } from './contract.js'

export const YOUTUBE_MIN_VIEW_COUNT = 1_000
export const YOUTUBE_MAX_AGE_DAYS = 90
export const YOUTUBE_RESULTS_PER_TICKER = 3
export const YOUTUBE_SEARCH_POOL = 10

export const DEFAULT_YOUTUBE_PAGE_SETTINGS = {
  sortColumn: -1,
  sortDescending: false,
} as const

export function normalizeYouTubePageSettings(value: unknown): {
  sortColumn: number
  sortDescending: boolean
} {
  const input = value && typeof value === 'object'
    ? value as { sortColumn?: unknown; sortDescending?: unknown }
    : {}
  const numeric = Number(input.sortColumn)
  const sortColumn = Number.isInteger(numeric) && numeric >= -1 && numeric <= 6 ? numeric : -1
  return {
    sortColumn,
    sortDescending:
      typeof input.sortDescending === 'boolean' ? input.sortDescending : false,
  }
}

export function normalizeViewCount(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null
}

export function parseViewCount(value: unknown): number | null {
  const text = String(value ?? '').trim().replace(/,/g, '')
  if (!text) return null
  if (/^no views?$/i.test(text)) return 0
  const match = text.match(/([\d.]+)\s*([KMBT])?/i)
  if (!match) return null
  const numeric = Number(match[1])
  if (!Number.isFinite(numeric)) return null
  const units: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }
  return Math.max(0, Math.round(numeric * (units[(match[2] ?? '').toUpperCase()] ?? 1)))
}

export function formatViewCount(value: unknown): string {
  const count = normalizeViewCount(value)
  if (count === null) return 'N/A'
  if (count < 1_000) return count.toLocaleString('en-US')
  const units: Array<[number, string]> = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ]
  const [threshold, suffix] = units.find(([limit]) => count >= limit) as [number, string]
  return `${(count / threshold).toFixed(1).replace(/\.0$/, '')}${suffix}`
}

export function daysSincePublished(value: unknown, now = Date.now()): number | null {
  const text = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const published = Date.parse(`${text}T00:00:00Z`)
  if (!Number.isFinite(published)) return null
  return Math.max(0, Math.floor((now - published) / 86_400_000))
}

export function formatPublishedDays(value: unknown): string {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric >= 0 ? String(numeric) : 'N/A'
}

export function videoKey(item: YouTubeVideo): string {
  if (item.videoId) return `video:${item.videoId}`
  if (item.url) return `url:${item.url}`
  const fallback = [item.ticker, item.title, item.publishedText, item.channel]
    .map((value) => value.trim())
    .join('|')
    .replace(/^\|+|\|+$/g, '')
  return fallback ? `fallback:${fallback}` : ''
}

function defaultSortKey(item: YouTubeVideo): Array<number | string> {
  const daysMissing = item.publishedDays === null ? 1 : 0
  const days = item.publishedDays ?? 1e9
  const published = /^\d{4}-\d{2}-\d{2}$/.test(item.publishedText)
    ? Date.parse(`${item.publishedText}T00:00:00Z`)
    : 0
  const views = item.viewCount === null ? 1 : -item.viewCount
  return [daysMissing, days, -published, views, item.ticker, item.title]
}

function compareValues(left: number | string, right: number | string): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right), undefined, { sensitivity: 'base' })
}

function compareKeys(left: Array<number | string>, right: Array<number | string>): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const compared = compareValues(left[index] ?? '', right[index] ?? '')
    if (compared) return compared
  }
  return 0
}

function durationSeconds(value: string): number | null {
  const parts = value.split(':')
  if (!parts.length || parts.some((part) => !/^\d+$/.test(part))) return null
  return parts.reduce((total, part) => total * 60 + Number(part), 0)
}

function columnValue(item: YouTubeVideo, column: number): number | string | null {
  if (column === 0) return item.ticker
  if (column === 1) return item.title
  if (column === 2) return item.channel
  if (column === 3) return item.viewCount
  if (column === 4) {
    return /^\d{4}-\d{2}-\d{2}$/.test(item.publishedText)
      ? Date.parse(`${item.publishedText}T00:00:00Z`)
      : null
  }
  if (column === 5) return item.publishedDays
  if (column === 6) return durationSeconds(item.durationText)
  return null
}

export function sortYouTubeVideos(
  items: readonly YouTubeVideo[],
  sortColumn: number,
  sortDescending: boolean,
): YouTubeVideo[] {
  if (sortColumn < 0) return [...items].sort((a, b) => compareKeys(defaultSortKey(a), defaultSortKey(b)))
  const present: Array<{ item: YouTubeVideo; value: number | string }> = []
  const missing: YouTubeVideo[] = []
  for (const item of items) {
    const value = columnValue(item, sortColumn)
    if (value === null) missing.push(item)
    else present.push({ item, value })
  }
  present.sort((a, b) => {
    const primary = compareValues(a.value, b.value)
    const compared = primary || compareKeys(defaultSortKey(a.item), defaultSortKey(b.item))
    return sortDescending ? -compared : compared
  })
  return [...present.map(({ item }) => item), ...missing.sort((a, b) => compareKeys(defaultSortKey(a), defaultSortKey(b)))]
}

export function filterYouTubeVideos(
  items: readonly YouTubeVideo[],
  query: string,
): YouTubeVideo[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return [...items]
  return items.filter((item) =>
    [item.ticker, item.title, item.channel, item.descriptionSnippet]
      .join(' ')
      .toLocaleLowerCase()
      .includes(needle),
  )
}
