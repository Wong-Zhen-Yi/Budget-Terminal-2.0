import type { EnvelopeError, NewsThumbnailPayload } from '../../shared/contract.js'
import { err } from '../../shared/envelope.js'
import { cache, TTL } from '../cache.js'
import { isSafeExternalUrl } from '../urls.js'
import { BROWSER_USER_AGENT } from '../userAgent.js'
import { httpGet } from './http.js'

/**
 * The thumbnail proxy.
 *
 * The renderer's CSP is `img-src 'self' data:` (`src/index.html`), so a card cannot point
 * an `<img>` at a publisher's CDN — the request is blocked silently and looks like a bug.
 * The main process fetches the image instead and hands back a `data:` URI, which is the
 * only shape the page can render. Relaxing the CSP to allow remote images would let any
 * feed-supplied URL become a tracking beacon for whoever is reading, which is a poor trade
 * for a 200px thumbnail.
 *
 * Not paced — publisher CDNs, not Yahoo.
 */

/**
 * Per-image ceiling. Publishers routinely serve a 300KB hero image where a card wants a
 * thumbnail, and an earlier 192KB cap rejected three of every five, so the real bound is
 * the budget below rather than this.
 */
const MAX_IMAGE_BYTES = 640 * 1024
/**
 * Total raw bytes held across every cached image, oldest evicted first.
 *
 * A budget rather than a count, because image sizes vary by a factor of thirty: two hundred
 * entries is either 4MB or 100MB depending on the day's feeds, and only one of those is
 * acceptable. Base64 inflates this by about a third in the renderer's own cache, which is
 * separately bounded by React Query's `gcTime`.
 */
const MAX_CACHED_BYTES = 24 * 1024 * 1024
const IMAGE_TIMEOUT_MS = 5_000

interface CachedImage {
  dataUri: string
  bytes: number
}

/**
 * Insertion-ordered keys and their sizes. `TtlCache` is unbounded — fine for a few
 * kilobytes of JSON per entry, not for images, which are the only entries big enough to
 * matter.
 */
const held = new Map<string, number>()
let heldBytes = 0

function remember(key: string, bytes: number): void {
  if (held.has(key)) heldBytes -= held.get(key) as number
  held.delete(key)
  held.set(key, bytes)
  heldBytes += bytes

  while (heldBytes > MAX_CACHED_BYTES && held.size > 1) {
    const oldest = held.keys().next().value
    if (oldest === undefined) break
    heldBytes -= held.get(oldest) as number
    held.delete(oldest)
    cache.delete(oldest)
  }
}

async function fetchDataUri(url: string): Promise<CachedImage> {
  const response = await httpGet(url, {
    headers: {
      'User-Agent': BROWSER_USER_AGENT,
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
    },
    timeoutMs: IMAGE_TIMEOUT_MS,
    maxBytes: MAX_IMAGE_BYTES,
  })

  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`)
  if (!response.contentType.startsWith('image/')) {
    throw new Error(`Not an image (${response.contentType || 'unknown type'})`)
  }
  // A truncated image would decode as a half-drawn strip, which is worse than no image.
  if (response.truncated) throw new Error('Image over the size cap.')

  return {
    dataUri: `data:${response.contentType};base64,${response.body.toString('base64')}`,
    bytes: response.body.length,
  }
}

/**
 * Never throws. A card whose image is missing draws its fallback tile at the same size, so
 * a dead thumbnail costs nothing but the picture.
 */
export async function getNewsThumbnail(
  url: string,
): Promise<{ payload: NewsThumbnailPayload; errors: EnvelopeError[] }> {
  const blank: NewsThumbnailPayload = { url, dataUri: '', bytes: 0 }
  if (!isSafeExternalUrl(url)) {
    return {
      payload: blank,
      errors: [err('news image', 'Not an http(s) image link.', 'newsThumbnail', url)],
    }
  }

  const key = `news-image:${url}`
  try {
    const image = await cache
      .resolve<CachedImage>(key, TTL.newsImage, () => fetchDataUri(url), {})
      .then((result) => result.value)
    remember(key, image.bytes)
    return { payload: { url, ...image }, errors: [] }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { payload: blank, errors: [err('news image', reason, 'newsThumbnail', url)] }
  }
}
