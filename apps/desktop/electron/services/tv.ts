import { publishPageProgress } from './pageProgress.js'
import { CHANNELS } from '../shared/contract.js'
import type { Envelope } from '../shared/contract.js'
import { describeError, err, failed, meta, ok, partial } from '../shared/envelope.js'
import { TV_CHANNELS, recentTvVideos, type TvPayload, type TvRequest, type TvVideo } from '../shared/tv.js'
import { cache, TTL } from './cache.js'
import { decodeEntities } from './news/rss.js'
import { BROWSER_USER_AGENT } from './userAgent.js'

export const TV_SOURCE = 'YouTube public channel feeds'
const MAX_FEED_BYTES = 2 * 1024 * 1024

function tag(block: string, name: string): string {
  const raw = new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)</' + name + '>', 'i').exec(block)?.[1] ?? ''
  return decodeEntities(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim()
}

/** Read the fixed public YouTube Atom shape; never accept remote watch/image URLs. */
export function parseTvFeed(xml: string, channel: { id: string; name: string }): TvVideo[] {
  if (!/<feed\b/i.test(xml) || !/<\/feed\s*>/i.test(xml)) throw new Error('Invalid YouTube channel feed.')
  const feedChannelId = tag(xml.split(/<entry\b/i)[0], 'yt:channelId')
  // YouTube's feed header can omit the UC prefix; entry channel IDs retain it.
  if (feedChannelId !== channel.id && 'UC' + feedChannelId !== channel.id) throw new Error('YouTube channel feed identity did not match.')
  const items: TvVideo[] = []
  for (const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const block = match[1]
    const videoId = tag(block, 'yt:videoId')
    const publishedAt = Date.parse(tag(block, 'published'))
    const title = tag(block, 'title')
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !title || !Number.isFinite(publishedAt)) continue
    items.push({ videoId, title, channel: channel.name, channelId: channel.id, publishedAt,
      descriptionSnippet: tag(block, 'media:description').slice(0, 1200),
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${videoId}` })
  }
  return items
}

async function fetchChannel(channel: typeof TV_CHANNELS[number]): Promise<TvVideo[]> {
  const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`, {
    headers: { 'User-Agent': BROWSER_USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  if (!response.body) throw new Error('YouTube returned an empty feed.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_FEED_BYTES) throw new Error('YouTube feed exceeded the size cap.')
      chunks.push(chunk.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return parseTvFeed(Buffer.concat(chunks).toString('utf8'), channel)
}

export async function getTv(request: TvRequest = {}): Promise<Envelope<TvPayload>> {
  const previewItems: TvVideo[] = []
  let previewChannels = 0
  const results = await Promise.allSettled(TV_CHANNELS.map(channel => cache.resolveWithStaleFallback(
    `tv-feed:v1:${channel.id}`, TTL.tv, () => fetchChannel(channel), { force: Boolean(request.force) },
  ).then(hit => {
    previewItems.push(...hit.value)
    previewChannels++
    publishPageProgress({ items: recentTvVideos(previewItems), warnings: [], fetchedAt: Date.now(), channelsLoaded: previewChannels, channelsTotal: TV_CHANNELS.length }, TV_SOURCE, [], CHANNELS.tv)
    return hit
  })))
  const warnings: string[] = []
  const items: TvVideo[] = []
  let channelsLoaded = 0
  let oldestAgeSeconds = 0
  results.forEach((result, index) => {
    const channel = TV_CHANNELS[index]
    if (result.status === 'rejected') {
      warnings.push(channel.name + ': ' + describeError(result.reason))
      return
    }
    const hit = result.value
    if (hit.stale) warnings.push(channel.name + ': refresh failed; showing saved uploads. ' + (hit.snapshot?.failures.join(' · ') ?? ''))
    else channelsLoaded++
    oldestAgeSeconds = Math.max(oldestAgeSeconds, hit.ageSeconds)
    items.push(...hit.value)
  })
  const payload: TvPayload = { items: recentTvVideos(items), warnings, fetchedAt: Date.now(), channelsLoaded, channelsTotal: TV_CHANNELS.length }
  const timing = { fetchedAt: Date.now() - oldestAgeSeconds * 1000, expiresAt: Date.now() + Math.max(0, TTL.tv - oldestAgeSeconds * 1000) }
  if (!channelsLoaded && !payload.items.length && warnings.length) return failed(payload, warnings.join(' · '), TV_SOURCE)
  if (warnings.length) return { ...partial(payload, warnings.map(reason => err(TV_SOURCE, reason, 'tv')), TV_SOURCE, warnings.join(' · ')),
    meta: meta(TV_SOURCE, channelsLoaded ? 'partial' : 'stale', { ...timing, failureReason: warnings.join(' · ') }) }
  return ok(payload, TV_SOURCE, timing)
}
