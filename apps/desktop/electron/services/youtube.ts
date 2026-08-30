import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { YouTubePayload, YouTubeRequest, YouTubeVideo } from '../shared/contract.js'
import {
  daysSincePublished,
  formatPublishedDays,
  formatViewCount,
  normalizeViewCount,
  parseViewCount,
  YOUTUBE_MAX_AGE_DAYS,
  YOUTUBE_MIN_VIEW_COUNT,
  YOUTUBE_RESULTS_PER_TICKER,
  YOUTUBE_SEARCH_POOL,
} from '../shared/youtube.js'
import { BROWSER_USER_AGENT } from './userAgent.js'

export const YOUTUBE_SOURCE = 'YouTube search'
export const YOUTUBE_CACHE_TTL_MS = 30 * 60_000

const CACHE_VERSION = 1
const FETCH_TIMEOUT_MS = 20_000
const MAX_PAGE_BYTES = 5 * 1024 * 1024
const MAX_TICKER_WORKERS = 4

interface SearchCandidate {
  videoId: string
  title: string
  channel: string
  viewCount: number | null
  publishedRelative: string
  durationText: string
  thumbnailUrl: string
  descriptionSnippet: string
}

interface WatchMetadata {
  publishedText: string
  viewCount: number | null
}

interface TickerCacheEntry {
  version: number
  ticker: string
  items: YouTubeVideo[]
  warning: string
  fetchedAt: number
}

interface TickerResult {
  ticker: string
  items: YouTubeVideo[]
  warning: string
  fetchedAt: number
  fromCache: boolean
}

export interface YouTubeFetchResult {
  payload: YouTubePayload
  cacheAgeSeconds: number
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function textOf(value: unknown): string {
  const object = record(value)
  const simple = String(object.simpleText ?? '').trim()
  if (simple) return simple
  const runs = Array.isArray(object.runs) ? object.runs : []
  return runs.map((run) => String(record(run).text ?? '')).join('').trim()
}

function collapse(value: unknown, limit = 220): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit - 3).trimEnd()}...` : text
}

/** Extract one JSON assignment without assuming that braces inside strings are structural. */
export function extractYouTubeInitialData(html: string): unknown {
  const markers = ['var ytInitialData = ', 'ytInitialData = ']
  let start = -1
  for (const marker of markers) {
    const markerAt = html.indexOf(marker)
    if (markerAt < 0) continue
    start = html.indexOf('{', markerAt + marker.length)
    if (start >= 0) break
  }
  if (start < 0) throw new Error('YouTube search data was not present in the response.')

  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < html.length; index += 1) {
    const char = html[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return JSON.parse(html.slice(start, index + 1))
    }
  }
  throw new Error('YouTube search data was incomplete.')
}

/** Pure parser exported for the deterministic probe. */
export function parseYouTubeSearchHtml(html: string): SearchCandidate[] {
  const root = extractYouTubeInitialData(html)
  const renderers: Record<string, unknown>[] = []
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    const object = value as Record<string, unknown>
    if (object.videoRenderer && typeof object.videoRenderer === 'object') {
      renderers.push(object.videoRenderer as Record<string, unknown>)
    }
    for (const child of Object.values(object)) visit(child)
  }
  visit(root)

  const seen = new Set<string>()
  const candidates: SearchCandidate[] = []
  for (const renderer of renderers) {
    const videoId = String(renderer.videoId ?? '').trim()
    if (!videoId || seen.has(videoId)) continue
    seen.add(videoId)
    const thumbnails = Array.isArray(record(renderer.thumbnail).thumbnails)
      ? record(renderer.thumbnail).thumbnails as unknown[]
      : []
    const thumbnail = thumbnails.length ? record(thumbnails[thumbnails.length - 1]) : {}
    const snippets = Array.isArray(renderer.detailedMetadataSnippets)
      ? renderer.detailedMetadataSnippets as unknown[]
      : []
    const firstSnippet = snippets.length ? record(snippets[0]) : {}
    candidates.push({
      videoId,
      title: textOf(renderer.title) || 'Untitled',
      channel: textOf(renderer.ownerText) || textOf(renderer.longBylineText) || 'Unknown',
      viewCount: parseViewCount(textOf(renderer.viewCountText) || textOf(renderer.shortViewCountText)),
      publishedRelative: textOf(renderer.publishedTimeText),
      durationText: textOf(renderer.lengthText) || 'N/A',
      thumbnailUrl: String(thumbnail.url ?? '').trim(),
      descriptionSnippet: collapse(textOf(firstSnippet.snippetText)),
    })
    if (candidates.length >= YOUTUBE_SEARCH_POOL) break
  }
  return candidates
}

/** Pure watch-page parser exported for the deterministic probe. */
export function parseYouTubeWatchHtml(html: string): WatchMetadata {
  const date =
    html.match(/"publishDate"\s*:\s*"(\d{4}-\d{2}-\d{2})/)?.[1] ??
    html.match(/itemprop=["']datePublished["'][^>]*content=["'](\d{4}-\d{2}-\d{2})/)?.[1] ??
    html.match(/content=["'](\d{4}-\d{2}-\d{2})[^"']*["'][^>]*itemprop=["']datePublished["']/)?.[1] ??
    ''
  const views = html.match(/"viewCount"\s*:\s*"(\d+)"/)?.[1]
  return { publishedText: date, viewCount: views ? normalizeViewCount(views) : null }
}

function cacheRoot(): string {
  const appData = process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming')
  return join(appData, 'BudgetTerminalElectron', 'youtube-cache')
}

function cachePath(ticker: string): string {
  const key = ticker.replace(/[^A-Z0-9._-]+/g, '_') || 'UNKNOWN'
  return join(cacheRoot(), `${key}.json`)
}

function normalizeStoredVideo(value: unknown): YouTubeVideo | null {
  const input = record(value)
  const publishedText = String(input.publishedText ?? '').trim()
  const publishedDays = daysSincePublished(publishedText)
  const viewCount = normalizeViewCount(input.viewCount)
  const videoId = String(input.videoId ?? '').trim()
  const url = String(input.url ?? '').trim()
  if ((!videoId && !url) || publishedDays === null || publishedDays > YOUTUBE_MAX_AGE_DAYS) return null
  if (viewCount === null || viewCount < YOUTUBE_MIN_VIEW_COUNT) return null
  return {
    videoId,
    ticker: String(input.ticker ?? '').trim().toUpperCase(),
    title: String(input.title ?? 'Untitled').trim() || 'Untitled',
    channel: String(input.channel ?? 'Unknown').trim() || 'Unknown',
    viewCount,
    viewCountText: formatViewCount(viewCount),
    publishedText,
    publishedDays,
    publishedDaysText: formatPublishedDays(publishedDays),
    durationText: String(input.durationText ?? 'N/A').trim() || 'N/A',
    url: url || `https://www.youtube.com/watch?v=${videoId}`,
    thumbnailUrl: String(input.thumbnailUrl ?? '').trim(),
    descriptionSnippet: collapse(input.descriptionSnippet),
  }
}

async function loadCache(ticker: string): Promise<TickerCacheEntry | null> {
  try {
    const parsed = record(JSON.parse(await readFile(cachePath(ticker), 'utf8')))
    if (Number(parsed.version) !== CACHE_VERSION) return null
    const items = Array.isArray(parsed.items)
      ? parsed.items.flatMap((item) => {
          const normalized = normalizeStoredVideo(item)
          return normalized ? [normalized] : []
        }).slice(0, YOUTUBE_RESULTS_PER_TICKER)
      : []
    const warning = String(parsed.warning ?? '').trim()
    const fetchedAt = Number(parsed.fetchedAt)
    if ((!items.length && !warning) || !Number.isFinite(fetchedAt)) return null
    return { version: CACHE_VERSION, ticker, items, warning, fetchedAt }
  } catch {
    return null
  }
}

async function saveCache(result: TickerResult): Promise<void> {
  const target = cachePath(result.ticker)
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  const entry: TickerCacheEntry = {
    version: CACHE_VERSION,
    ticker: result.ticker,
    items: result.items.slice(0, YOUTUBE_RESULTS_PER_TICKER),
    warning: result.warning,
    fetchedAt: result.fetchedAt,
  }
  await writeFile(temporary, JSON.stringify(entry, null, 2), 'utf8')
  await rename(temporary, target)
}

async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9',
      Cookie: 'CONSENT=YES+cb; SOCS=CAI',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = await response.text()
  if (Buffer.byteLength(body, 'utf8') > MAX_PAGE_BYTES) throw new Error('YouTube response exceeded the size cap.')
  return body
}

function obviouslyTooOld(relative: string): boolean {
  const text = relative.toLowerCase()
  if (/\byears? ago\b/.test(text)) return true
  const months = text.match(/(\d+)\s+months? ago/)
  return months ? Number(months[1]) >= 4 : false
}

async function fetchTicker(ticker: string): Promise<TickerResult> {
  const fetchedAt = Date.now()
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${ticker} stock`)}&hl=en`
    const candidates = parseYouTubeSearchHtml(await fetchPage(searchUrl))
    if (!candidates.length) {
      return { ticker, items: [], warning: `${ticker}: no matching YouTube videos found.`, fetchedAt, fromCache: false }
    }

    const items: YouTubeVideo[] = []
    for (const candidate of candidates) {
      if (candidate.viewCount === null || candidate.viewCount < YOUTUBE_MIN_VIEW_COUNT) continue
      if (obviouslyTooOld(candidate.publishedRelative)) continue
      let watch: WatchMetadata
      try {
        watch = parseYouTubeWatchHtml(
          await fetchPage(`https://www.youtube.com/watch?v=${encodeURIComponent(candidate.videoId)}&hl=en`),
        )
      } catch {
        continue
      }
      const publishedDays = daysSincePublished(watch.publishedText)
      const viewCount = watch.viewCount ?? candidate.viewCount
      if (publishedDays === null || publishedDays > YOUTUBE_MAX_AGE_DAYS) continue
      if (viewCount === null || viewCount < YOUTUBE_MIN_VIEW_COUNT) continue
      items.push({
        videoId: candidate.videoId,
        ticker,
        title: candidate.title,
        channel: candidate.channel,
        viewCount,
        viewCountText: formatViewCount(viewCount),
        publishedText: watch.publishedText,
        publishedDays,
        publishedDaysText: formatPublishedDays(publishedDays),
        durationText: candidate.durationText,
        url: `https://www.youtube.com/watch?v=${candidate.videoId}`,
        thumbnailUrl: candidate.thumbnailUrl,
        descriptionSnippet: candidate.descriptionSnippet,
      })
      if (items.length >= YOUTUBE_RESULTS_PER_TICKER) break
    }
    const warning = items.length
      ? ''
      : `${ticker}: no YouTube videos met the filter (>= ${YOUTUBE_MIN_VIEW_COUNT.toLocaleString('en-US')} views and <= ${YOUTUBE_MAX_AGE_DAYS} days old).`
    return { ticker, items, warning, fetchedAt, fromCache: false }
  } catch {
    return {
      ticker,
      items: [],
      warning: `${ticker}: YouTube search temporarily failed. Try refreshing again later.`,
      fetchedAt,
      fromCache: false,
    }
  }
}

async function resolveTicker(ticker: string, force: boolean): Promise<TickerResult> {
  if (!force) {
    const cached = await loadCache(ticker)
    if (cached && Date.now() - cached.fetchedAt < YOUTUBE_CACHE_TTL_MS) {
      return { ...cached, fromCache: true }
    }
  }
  const result = await fetchTicker(ticker)
  await saveCache(result).catch(() => undefined)
  return result
}

async function mapTickers(tickers: string[], force: boolean): Promise<TickerResult[]> {
  const results = new Array<TickerResult>(tickers.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < tickers.length) {
      const index = cursor
      cursor += 1
      results[index] = await resolveTicker(tickers[index], force)
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_TICKER_WORKERS, tickers.length) }, worker))
  return results
}

export async function getYouTube(request: YouTubeRequest): Promise<YouTubeFetchResult> {
  const tickers = [...new Set(request.tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))]
  if (!tickers.length) {
    return {
      payload: {
        items: [],
        warnings: ['No saved portfolio tickers are available yet.'],
        fetchedAt: Date.now(),
        fromCacheCount: 0,
        fetchedCount: 0,
        tickersTotal: 0,
      },
      cacheAgeSeconds: 0,
    }
  }
  const results = await mapTickers(tickers, Boolean(request.force))
  const cached = results.filter((result) => result.fromCache)
  return {
    payload: {
      items: results.flatMap((result) => result.items),
      warnings: results.map((result) => result.warning).filter(Boolean),
      fetchedAt: Date.now(),
      fromCacheCount: cached.length,
      fetchedCount: results.length - cached.length,
      tickersTotal: tickers.length,
    },
    cacheAgeSeconds: cached.length
      ? Math.max(...cached.map((result) => (Date.now() - result.fetchedAt) / 1_000))
      : 0,
  }
}

export async function clearYouTubeCache(): Promise<void> {
  try {
    const files = await readdir(cacheRoot(), { withFileTypes: true })
    await Promise.all(
      files
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => unlink(join(cacheRoot(), entry.name)).catch(() => undefined)),
    )
  } catch {
    // No cache directory yet is already the desired state.
  }
}
