import { createHash } from 'node:crypto'
import type { AnthropicPayload, AnthropicRequest } from '../shared/anthropic.js'
import { ANTHROPIC_NEWS, ANTHROPIC_SOURCES, anthropicResearch, anthropicReviewReasons, parseAnthropicNews } from '../shared/anthropic.js'
import type { Envelope, EnvelopeError } from '../shared/contract.js'
import { describeError, err } from '../shared/envelope.js'
import { cache, TTL, type TtlCache } from './cache.js'
import { fetchSecFilingSnapshot } from './secEdgar.js'
import { anthropicReviewedHashes } from '../shared/anthropicReviewedHashes.js'

export function anthropicDocumentHash(html: string): string {
  const body = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  const main = body.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]
  if (!main || main.length < 200) throw new Error('Anthropic document content unavailable or layout changed.')
  return createHash('sha256').update(main.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).digest('hex')
}

async function fetchDocument(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'error', headers: { Accept: 'text/html' } })
  if (!response.ok) throw new Error(`Anthropic source HTTP ${response.status}`)
  const text = await response.text()
  if (text.length > 3_000_000) throw new Error('Anthropic document exceeds the research size limit.')
  return text
}

export interface AnthropicFetchers { document: typeof fetchDocument; filings: typeof fetchSecFilingSnapshot }
const defaults: AnthropicFetchers = { document: fetchDocument, filings: fetchSecFilingSnapshot }

/** Reviewed facts never silently change when a news headline or source document changes. */
export async function getAnthropic({ force = false }: AnthropicRequest = {}, fetchers: AnthropicFetchers = defaults, storage: TtlCache = cache): Promise<Envelope<AnthropicPayload>> {
  const data = anthropicResearch()
  const errors: EnvelopeError[] = []
  const times: number[] = []
  let cached = false, stale = false
  const lane = async <T>(id: string, load: () => Promise<T>, apply: (value: T) => void, changed: (value: T) => boolean = () => false) => {
    try {
      const result = await storage.resolveWithStaleFallback(`anthropic:v1:${id}`, TTL.anthropic,
        async () => ({ value: await load(), fetchedAt: Date.now() }), { force })
      apply(result.value.value)
      times.push(result.value.fetchedAt)
      cached ||= result.fromCache
      stale ||= result.stale
      const error = result.stale ? 'Source check failed; showing the previous successful check.' : undefined
      data.checks.push({ id, checkedAt: result.value.fetchedAt, changed: changed(result.value.value), ...(error ? { error } : {}) })
      if (error) errors.push(err('Anthropic public sources', error, `anthropic-${id}`))
    } catch (error) {
      const reason = describeError(error)
      data.checks.push({ id, checkedAt: null, changed: false, error: reason })
      errors.push(err('Anthropic public sources', reason, `anthropic-${id}`))
    }
  }
  await Promise.all([
    lane('announcements', async () => parseAnthropicNews(await fetchers.document(ANTHROPIC_NEWS)), value => { data.announcements = value }),
    lane('SEC filings', async () => {
      const result = await fetchers.filings('2130357', force, true)
      if (result.warnings.length || result.freshness === 'stale') throw new Error(result.warnings.join(' · ') || 'SEC submissions are stale.')
      if (!result.filings.length) throw new Error('No Anthropic SEC filings returned.')
      return result.filings.slice(0, 20)
    }, value => { data.filings = value }),
    ...Object.keys(anthropicReviewedHashes).map(id => lane(id,
      async () => anthropicDocumentHash(await fetchers.document(ANTHROPIC_SOURCES.find(source => source.id === id)!.url)),
      () => undefined, hash => hash !== anthropicReviewedHashes[id])),
  ])
  data.checks.sort((a, b) => a.id.localeCompare(b.id))
  data.reviewReasons = anthropicReviewReasons(data)
  const fetchedAt = times.length ? Math.min(...times) : Date.now()
  return { data, errors, meta: { source: 'Reviewed Anthropic disclosures · live official announcements & SEC checks',
    asOf: Date.parse(`${data.reviewedAt}T00:00:00Z`), fetchedAt, expiresAt: fetchedAt + TTL.anthropic,
    freshness: stale ? 'stale' : errors.length ? 'partial' : cached ? 'cached' : 'fresh',
    ...(errors.length ? { failureReason: errors.map(error => error.reason).join(' · ') } : {}) } }
}
