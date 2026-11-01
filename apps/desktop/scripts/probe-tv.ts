import assert from 'node:assert/strict'
import { TV_CHANNELS, TV_MAX_AGE_MS, isStockMarketVideo, recentTvVideos } from '../electron/shared/tv.js'
import { getTv, parseTvFeed } from '../electron/services/tv.js'
import { cache } from '../electron/services/cache.js'
import { TABS } from '../electron/shared/contract.js'
import { startupPages, workspaceFor } from '../electron/shared/navigation.js'
import { createApi } from '../electron/shared/createApi.js'

const now = Date.now()
const ids = ['newest12345', 'older123456', 'oldxx123456']
function feed(channelId: string, index = 0): string {
  return `<feed><yt:channelId>${channelId}</yt:channelId>
    <entry><yt:videoId>${ids[index]}</yt:videoId><title>Stock market &amp; earnings &#x2014; today</title>
    <published>${new Date(now - index * 60_000).toISOString()}</published>
    <media:description>Markets, rates and shares. No minimum views.</media:description></entry></feed>`
}

const parsed = parseTvFeed(feed(TV_CHANNELS[0].id), TV_CHANNELS[0])
assert.equal(parsed.length, 1)
assert.equal(parsed[0].title, 'Stock market & earnings — today')
assert.equal(parsed[0].publishedAt, now)
assert.equal(parseTvFeed(feed(TV_CHANNELS[0].id).replace('<yt:channelId>' + TV_CHANNELS[0].id, '<yt:channelId>' + TV_CHANNELS[0].id.slice(2)), TV_CHANNELS[0]).length, 1)
assert.match(parsed[0].url, /^https:\/\/www\.youtube\.com\/watch\?v=newest12345$/)
assert.throws(() => parseTvFeed('<html>Blocked</html>', TV_CHANNELS[0]), /Invalid/)
assert.throws(() => parseTvFeed(feed('wrong-channel'), TV_CHANNELS[0]), /identity/)
assert.equal(parseTvFeed(feed(TV_CHANNELS[0].id).replace(ids[0], 'bad-id'), TV_CHANNELS[0]).length, 0)
assert.equal(isStockMarketVideo('Nasdaq earnings outlook'), true)
assert.equal(isStockMarketVideo('A weekend travel guide', 'Visit these destinations.'), false)
const older = { ...parsed[0], videoId: ids[1], publishedAt: now - 60_000 }
assert.deepEqual(recentTvVideos([older, parsed[0], parsed[0],
  { ...older, videoId: ids[2], publishedAt: now - TV_MAX_AGE_MS - 1 },
  { ...older, videoId: 'future12345', publishedAt: now + 1 },
  { ...older, videoId: 'travel12345', title: 'A travel guide', descriptionSnippet: '' },
], now).map(item => item.videoId), ids.slice(0, 2))
assert(TABS.some(tab => tab.id === 'tv' && tab.implemented))
assert(TABS.some(tab => tab.id === 'youtube' && tab.implemented))
assert(startupPages('dashboard', [], []).includes('tv'))
assert.equal(workspaceFor('tv')?.id, 'overview')
const invoked: string[] = []
const api = createApi(async channel => { invoked.push(channel); return undefined as never }, () => () => {}, 'win32')
await api.tv({ force: true })
assert.deepEqual(invoked, ['tv:read'])

if (process.argv.includes('--live')) {
  const result = await getTv({ force: true })
  assert.equal(result.meta.freshness, 'fresh', JSON.stringify(result.errors))
  assert.equal(result.data.channelsLoaded, TV_CHANNELS.length)
  assert(result.data.items.length, 'Expected recent stock market coverage in live feeds')
  assert.deepEqual(result.data.items, recentTvVideos(result.data.items))
  console.log(`TV live: ${result.data.items.length} recent market videos across ${result.data.channelsLoaded} channels; newest ${new Date(result.data.items[0].publishedAt).toISOString()}.`)
} else {
  const originalFetch = globalThis.fetch
  let calls = 0
  let mode = 'ok'
  globalThis.fetch = async input => {
    calls++
    const url = new URL(String(input))
    const channelId = url.searchParams.get('channel_id')!
    const index = TV_CHANNELS.findIndex(channel => channel.id === channelId)
    assert.equal(url.hostname, 'www.youtube.com')
    if (mode === 'fail' || (mode === 'partial' && index === 0)) return new Response('Unavailable', { status: 503 })
    return new Response(mode === 'invalid' ? '<html>Consent</html>' : mode === 'empty'
      ? `<feed><yt:channelId>${channelId}</yt:channelId></feed>` : feed(channelId, index))
  }
  try {
    await cache.clear()
    const first = await getTv()
    assert.equal(first.meta.freshness, 'fresh')
    assert.equal(first.data.items.length, 3)
    assert.deepEqual(first.data.items.map(item => item.videoId), ids)
    await getTv()
    assert.equal(calls, 3, 'Fresh channel feeds must reuse cache')
    await getTv({ force: true })
    assert.equal(calls, 6, 'Manual refresh bypasses channel cache')
    mode = 'fail'
    const saved = await getTv({ force: true })
    assert.equal(saved.meta.freshness, 'stale')
    assert.equal(saved.data.items.length, 3, 'Outages retain recent saved coverage')
    assert.equal(saved.data.warnings.length, 3)
    await cache.clear()
    mode = 'partial'
    const partial = await getTv({ force: true })
    assert.equal(partial.meta.freshness, 'partial')
    assert.equal(partial.data.channelsLoaded, 2)
    assert.equal(partial.data.items.length, 2)
    await cache.clear()
    mode = 'fail'
    assert.equal((await getTv({ force: true })).meta.freshness, 'failed')
    await cache.clear()
    mode = 'invalid'
    assert.equal((await getTv({ force: true })).meta.freshness, 'failed', 'Consent and block pages cannot count as a loaded channel')
    await cache.clear()
    mode = 'empty'
    const empty = await getTv({ force: true })
    assert.equal(empty.meta.freshness, 'fresh')
    assert.equal(empty.data.items.length, 0)
  } finally {
    globalThis.fetch = originalFetch
    await cache.clear()
  }
}
console.log('TV parser, relevance, timestamps, newest-first ordering, deduplication, navigation, IPC and feed checks passed.')
