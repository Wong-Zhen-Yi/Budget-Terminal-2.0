import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type {
  EnvelopeError,
  PoliticsExportPayload,
  PoliticsPagePayload,
  PoliticsTrade,
} from '../shared/contract.js'
import { err } from '../shared/envelope.js'
import {
  normalizePoliticsTrade,
  parsePoliticsHtml,
  POLITICS_CACHE_TTL_MS,
  POLITICS_PAGE_SIZE,
} from '../shared/politics.js'
import { httpGet } from './news/http.js'

export const POLITICS_SOURCE = 'capitol trades'
export const POLITICS_SOURCE_URL = 'https://www.capitoltrades.com/trades'

const REQUEST_TIMEOUT_MS = 30_000
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const CACHE_VERSION = 1

const REQUEST_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

interface DiskDocument {
  version: number
  storedAt: number
  value: PoliticsPagePayload
}

function cachePath(page: number): string {
  const appData = process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming')
  return join(appData, 'BudgetTerminalElectron', 'politics-cache', `page-${page}.json`)
}

function normalizePage(value: unknown, page: number): PoliticsPagePayload | null {
  if (!value || typeof value !== 'object') return null
  const payload = value as Partial<PoliticsPagePayload>
  const trades = Array.isArray(payload.trades)
    ? payload.trades.flatMap((row) => {
        const trade = normalizePoliticsTrade(row)
        return trade ? [trade] : []
      })
    : []
  const rawCount = Number(payload.rawCount)
  const fetchedAt = Number(payload.fetchedAt)
  return {
    page,
    trades,
    rawCount: Number.isFinite(rawCount) ? Math.max(Math.trunc(rawCount), 0) : trades.length,
    fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : 0,
    fromCache: false,
    cacheAgeSeconds: null,
    stale: false,
    warning: '',
  }
}

async function readDisk(page: number): Promise<{ payload: PoliticsPagePayload; ageMs: number } | null> {
  try {
    const document = JSON.parse(await readFile(cachePath(page), 'utf8')) as DiskDocument
    if (document.version !== CACHE_VERSION || !Number.isFinite(document.storedAt)) return null
    const payload = normalizePage(document.value, page)
    if (!payload) return null
    return { payload, ageMs: Math.max(Date.now() - document.storedAt, 0) }
  } catch {
    return null
  }
}

async function writeDisk(page: number, payload: PoliticsPagePayload): Promise<void> {
  const target = cachePath(page)
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  const document: DiskDocument = {
    version: CACHE_VERSION,
    storedAt: Date.now(),
    value: payload,
  }
  await writeFile(temporary, JSON.stringify(document), 'utf8')
  await rename(temporary, target)
}

export async function clearPoliticsCache(): Promise<void> {
  await rm(dirname(cachePath(1)), { recursive: true, force: true })
}

export async function fetchPoliticsLivePage(
  page: number,
): Promise<{ trades: PoliticsTrade[]; rawCount: number }> {
  const url = `${POLITICS_SOURCE_URL}?page=${page}&pageSize=${POLITICS_PAGE_SIZE}`
  let status = 0
  let html = ''

  // The desktop app uses Chromium's network stack when available. Capitol Trades' Vercel
  // edge currently challenges Node's bare TLS client while accepting ordinary browser and
  // Python clients. The headless probe falls back to `httpGet`; the page itself remains a
  // normal main-process request and never exposes the host to renderer code.
  try {
    const electron = await import('electron')
    if (electron.net && typeof electron.net.fetch === 'function') {
      const response = await electron.net.fetch(url, {
        headers: REQUEST_HEADERS,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      status = response.status
      html = await response.text()
      if (Buffer.byteLength(html, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new Error('Capitol Trades response exceeded the size limit')
      }
    }
  } catch (error) {
    if (status || html) throw error
  }

  if (!status) {
    const response = await httpGet(url, {
      headers: REQUEST_HEADERS,
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxBytes: MAX_RESPONSE_BYTES,
    })
    status = response.status
    html = response.body.toString('utf8')
  }
  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
  const parsed = parsePoliticsHtml(html)
  if (!parsed.rawCount && !html.includes('"data":[]')) {
    throw new Error('Capitol Trades response did not contain a trade payload')
  }
  return parsed
}

export interface PoliticsPageFetchResult {
  payload: PoliticsPagePayload
  errors: EnvelopeError[]
}

export async function getPoliticsPage(
  requestedPage: number,
  force = false,
): Promise<PoliticsPageFetchResult> {
  const page = Math.max(1, Math.trunc(requestedPage) || 1)
  const cached = await readDisk(page)
  const fromCache = (
    entry: { payload: PoliticsPagePayload; ageMs: number },
    stale = false,
    warning = '',
  ): PoliticsPagePayload => ({
    ...entry.payload,
    page,
    fromCache: true,
    cacheAgeSeconds: entry.ageMs / 1000,
    stale,
    warning,
  })

  if (!force && cached && cached.ageMs < POLITICS_CACHE_TTL_MS) {
    return { payload: fromCache(cached), errors: [] }
  }

  try {
    const result = await fetchPoliticsLivePage(page)
    const payload: PoliticsPagePayload = {
      page,
      trades: result.trades,
      rawCount: result.rawCount,
      fetchedAt: Date.now(),
      fromCache: false,
      cacheAgeSeconds: 0,
      stale: false,
      warning: '',
    }
    await writeDisk(page, payload)
    return { payload, errors: [] }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (cached) {
      return {
        payload: fromCache(cached, true, reason),
        errors: [err(POLITICS_SOURCE, reason, `politics-page-${page}`)],
      }
    }
    throw error
  }
}

export interface PoliticsExportFetchResult {
  payload: PoliticsExportPayload
  errors: EnvelopeError[]
}

export async function getPoliticsExport(requestedPages = 5): Promise<PoliticsExportFetchResult> {
  const pages = Math.min(Math.max(Math.trunc(requestedPages) || 5, 1), 5)
  const trades: PoliticsTrade[] = []
  const errors: EnvelopeError[] = []
  let pagesFetched = 0
  for (let page = 1; page <= pages; page += 1) {
    try {
      const result = await fetchPoliticsLivePage(page)
      if (!result.trades.length) break
      trades.push(...result.trades)
      pagesFetched = page
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      errors.push(err(POLITICS_SOURCE, reason, `politics-export-${page}`))
      break
    }
  }
  trades.sort((left, right) => right.transactionDate.localeCompare(left.transactionDate))
  return { payload: { trades, pagesFetched, fetchedAt: Date.now() }, errors }
}

export function emptyPoliticsPage(page = 1): PoliticsPagePayload {
  return {
    page,
    trades: [],
    rawCount: 0,
    fetchedAt: 0,
    fromCache: false,
    cacheAgeSeconds: null,
    stale: false,
    warning: '',
  }
}
