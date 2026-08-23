import type { EnvelopeError, NewsPreviewPayload, NewsPreviewRequest } from '../../shared/contract.js'
import { err } from '../../shared/envelope.js'
import { cache, TTL } from '../cache.js'
import { isSafeExternalUrl } from '../urls.js'
import { BROWSER_USER_AGENT } from '../userAgent.js'
import { extractReadableText } from './extract.js'
import { httpGet } from './http.js'

/**
 * The reader pane's article fetch, ported from `workers/news_preview.py`.
 *
 * Not paced: these are publisher hosts, not Yahoo, and one fires only when someone clicks
 * a card — the same reasoning that keeps `services/fearGreed.ts` outside the gate.
 */

const PREVIEW_TIMEOUT_MS = 8_000
/**
 * The reference reads the whole response. A long-tail page can be tens of megabytes, and
 * the extractor's regex work happens on the main process's only thread, so the body is
 * capped before any of it runs — `httpGet` stops the download rather than truncating
 * after the fact.
 */
const MAX_HTML_BYTES = 2 * 1024 * 1024

const PREVIEW_HEADERS = {
  'User-Agent': BROWSER_USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

async function fetchArticleHtml(url: string): Promise<string> {
  const response = await httpGet(url, {
    headers: PREVIEW_HEADERS,
    timeoutMs: PREVIEW_TIMEOUT_MS,
    maxBytes: MAX_HTML_BYTES,
  })
  // 401 and 403 are paywalls, which are the normal answer from several of these
  // publishers. They fall through to the summary like any other unreadable page.
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`)
  return response.body.toString('utf8')
}

/** What the pane shows when the page cannot be read: the summary, else the bare facts. */
function fallbackText(request: NewsPreviewRequest): string {
  if (request.summary.trim()) return request.summary.trim()
  return [
    'Preview unavailable. Open the article externally to read it in full.',
    '',
    request.title,
    '',
    request.url,
  ].join('\n')
}

export async function getNewsPreview(
  request: NewsPreviewRequest,
): Promise<{ payload: NewsPreviewPayload; errors: EnvelopeError[] }> {
  const fallback: NewsPreviewPayload = {
    url: request.url,
    text: fallbackText(request),
    origin: 'fallback',
    truncated: false,
  }

  if (!isSafeExternalUrl(request.url)) {
    return {
      payload: fallback,
      errors: [err('news preview', 'Not an http(s) article link.', 'newsPreview', request.url)],
    }
  }

  try {
    const extracted = await cache
      .resolve(
        `news-preview:${request.url}`,
        TTL.newsPreview,
        async () => extractReadableText(await fetchArticleHtml(request.url)),
        { force: request.force ?? false },
      )
      .then((result) => result.value)

    if (!extracted.text.trim()) {
      // A JS-rendered body or a paywall. Normal, and not worth a red status — the reader
      // simply shows the summary and points at the Open Externally button.
      return {
        payload: fallback,
        errors: [
          err('news preview', 'No readable body on the page.', 'newsPreview', request.url),
        ],
      }
    }

    return {
      payload: { url: request.url, text: extracted.text, origin: 'article', truncated: extracted.truncated },
      errors: [],
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      payload: fallback,
      errors: [err('news preview', reason, 'newsPreview', request.url)],
    }
  }
}
