import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { YouTubeVideo } from '../electron/shared/contract.js'
import {
  filterYouTubeVideos,
  formatViewCount,
  normalizeYouTubePageSettings,
  parseViewCount,
  sortYouTubeVideos,
  YOUTUBE_MAX_AGE_DAYS,
  YOUTUBE_MIN_VIEW_COUNT,
} from '../electron/shared/youtube.js'
import {
  getYouTube,
  parseYouTubeSearchHtml,
  parseYouTubeWatchHtml,
} from '../electron/services/youtube.js'

function video(patch: Partial<YouTubeVideo>): YouTubeVideo {
  return {
    videoId: 'abcdefghijk',
    ticker: 'AAA',
    title: 'Alpha outlook',
    channel: 'Market Desk',
    viewCount: 12_000,
    viewCountText: '12K',
    publishedText: '2026-08-20',
    publishedDays: 10,
    publishedDaysText: '10',
    durationText: '8:30',
    url: 'https://www.youtube.com/watch?v=abcdefghijk',
    thumbnailUrl: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
    descriptionSnippet: 'Alpha earnings discussion',
    ...patch,
  }
}

function offlineChecks(): void {
  const initialData = {
    contents: [{ videoRenderer: {
      videoId: 'alpha123456',
      title: { runs: [{ text: 'Alpha {outlook}' }] },
      ownerText: { runs: [{ text: 'Market Desk' }] },
      viewCountText: { simpleText: '12,345 views' },
      publishedTimeText: { simpleText: '2 weeks ago' },
      lengthText: { simpleText: '8:30' },
      thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/alpha123456/hqdefault.jpg' }] },
      detailedMetadataSnippets: [{ snippetText: { runs: [{ text: 'Alpha earnings discussion' }] } }],
    } }],
  }
  const parsed = parseYouTubeSearchHtml(`<script>var ytInitialData = ${JSON.stringify(initialData)};</script>`)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].title, 'Alpha {outlook}')
  assert.equal(parsed[0].viewCount, 12_345)
  assert.equal(parsed[0].durationText, '8:30')

  const watch = parseYouTubeWatchHtml(
    '<meta itemprop="datePublished" content="2026-08-20T10:00:00Z">' +
      '<script>{"viewCount":"54321","publishDate":"2026-08-20"}</script>',
  )
  assert.deepEqual(watch, { publishedText: '2026-08-20', viewCount: 54_321 })
  assert.equal(parseViewCount('1.2M views'), 1_200_000)
  assert.equal(formatViewCount(88_000), '88K')

  const items = [
    video({ ticker: 'AAA', publishedDays: 2, publishedText: '2026-08-28' }),
    video({ videoId: 'bbbbbbbbbbb', ticker: 'BBB', channel: 'Research Room', viewCount: 88_000, publishedDays: 6 }),
    video({ videoId: 'ccccccccccc', ticker: 'CCC', viewCount: 3_000, publishedDays: 12 }),
  ]
  assert.equal(sortYouTubeVideos(items, -1, false)[0].ticker, 'AAA')
  assert.equal(sortYouTubeVideos(items, 3, true)[0].ticker, 'BBB')
  assert.equal(filterYouTubeVideos(items, 'research room')[0].ticker, 'BBB')
  assert.deepEqual(normalizeYouTubePageSettings({ sortColumn: 99, sortDescending: 'yes' }), {
    sortColumn: -1,
    sortDescending: false,
  })
  console.log('YouTube offline parser, filter, sort and settings checks passed.')
}

async function liveCheck(ticker: string): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), 'budget-terminal-youtube-'))
  process.env.APPDATA = temporary
  try {
    const fresh = await getYouTube({ tickers: [ticker], force: true })
    assert.equal(fresh.payload.tickersTotal, 1)
    assert.equal(fresh.payload.fetchedCount, 1)
    assert.ok(fresh.payload.items.length > 0, fresh.payload.warnings.join(' | ') || 'No YouTube matches returned.')
    assert.ok(fresh.payload.items.length <= 3)
    for (const item of fresh.payload.items) {
      assert.equal(item.ticker, ticker)
      assert.ok((item.viewCount ?? 0) >= YOUTUBE_MIN_VIEW_COUNT)
      assert.ok((item.publishedDays ?? Infinity) <= YOUTUBE_MAX_AGE_DAYS)
      assert.match(item.url, /^https:\/\/www\.youtube\.com\/watch\?v=/)
    }

    const cached = await getYouTube({ tickers: [ticker] })
    assert.equal(cached.payload.fromCacheCount, 1)
    assert.equal(cached.payload.fetchedCount, 0)
    assert.deepEqual(cached.payload.items, fresh.payload.items)
    console.log(
      `YouTube live check passed for ${ticker}: ${fresh.payload.items.length} video(s), disk cache reused.`,
    )
  } finally {
    const target = resolve(temporary)
    const safeBase = resolve(tmpdir())
    if (target.startsWith(`${safeBase}\\`) || target.startsWith(`${safeBase}/`)) {
      await rm(target, { recursive: true, force: true })
    }
  }
}

async function main(): Promise<void> {
  offlineChecks()
  if (process.argv.includes('--offline')) return
  const raw = process.argv.slice(2).find((value) => !value.startsWith('--')) ?? 'AAPL'
  const ticker = raw.trim().toUpperCase()
  assert.match(ticker, /^[A-Z0-9.^=-]+$/)
  await liveCheck(ticker)
}

await main()
