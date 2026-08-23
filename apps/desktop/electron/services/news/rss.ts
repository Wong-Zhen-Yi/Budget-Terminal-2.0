import type { NewsArticle } from '../../shared/contract.js'
import {
  articleKey,
  extractTickers,
  formatNewsClock,
  parseNewsTimestamp,
  scoreArticle,
  type NewsFeedConfig,
} from '../../shared/news.js'

/**
 * An RSS 2.0 reader for the six market feeds, ported from `_parse_rss_item` and the
 * cleaning helpers in `workers/news_sources.py`.
 *
 * Hand-rolled rather than a dependency: `DOMParser` is renderer-only, and a real XML
 * parser would be a new runtime package for eight fields on six feeds whose shape is
 * known. Pure and network-free, so `probe-news.ts` can run it over a fixture.
 *
 * One addition the reference does not have: `media:content` / `media:thumbnail` /
 * `enclosure` are read for an image URL, which is what lets an RSS card carry a picture.
 */

export interface ParsedFeedItem {
  title: string
  link: string
  description: string
  categories: string[]
  published: string
  imageUrl: string
  /** RSS `<source>`. Empty on the market feeds; Yahoo's per-symbol feed names the publisher here. */
  source: string
}

/* ------------------------------------------------------------------ cleaning */

const NAMED_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  amp: '&',
}

/**
 * `html.unescape`, near enough for feed text.
 *
 * `&amp;` is decoded last and separately: doing it in the same pass turns `&amp;lt;` into
 * a literal `<`, which then reads as a tag to `cleanText` and swallows the rest of the line.
 */
export function decodeEntities(value: string): string {
  const once = value
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_match, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 10)),
    )
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => {
      const key = name.toLowerCase()
      return key === 'amp' ? match : (NAMED_ENTITIES[key] ?? match)
    })
  return once.replace(/&amp;/g, '&')
}

/** `_clean_text`, in the reference's order: entities, then tags, then whitespace. */
export function cleanText(value: string): string {
  return decodeEntities(String(value ?? ''))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** `_clean_url`: entities only — a link must keep its punctuation. */
function cleanUrl(value: string): string {
  return decodeEntities(String(value ?? '')).trim()
}

/* ------------------------------------------------------------------- parsing */

/**
 * Read one element's text, ignoring any namespace prefix.
 *
 * The optional `(?:[\w-]+:)?` is the `_namespaced_child_text` port and is what lets one
 * helper cover `pubDate`, `dc:date` and `content:encoded` without a special case each.
 */
function tagText(block: string, local: string): string {
  const pattern = new RegExp(
    `<(?:[\\w-]+:)?${local}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${local}>`,
    'i',
  )
  return pattern.exec(block)?.[1] ?? ''
}

function allTagText(block: string, local: string): string[] {
  const pattern = new RegExp(
    `<(?:[\\w-]+:)?${local}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${local}>`,
    'gi',
  )
  return [...block.matchAll(pattern)].map((match) => match[1] ?? '')
}

/** The first of several fields that carries anything, per `_first_text`. */
function firstText(...values: string[]): string {
  for (const value of values) if (value.trim()) return value
  return ''
}

const MEDIA_TAG = /<(?:media:(?:content|thumbnail)|enclosure)\b[^>]*>/gi
const ATTR_URL = /\burl\s*=\s*["']([^"']+)["']/i
const ATTR_TYPE = /\btype\s*=\s*["']([^"']+)["']/i

/**
 * The first usable image the item advertises. `enclosure` also carries audio and PDFs, so
 * that one has to declare an image type; the `media:*` tags are images by convention.
 */
function itemImage(block: string): string {
  for (const tag of block.match(MEDIA_TAG) ?? []) {
    const url = ATTR_URL.exec(tag)?.[1]
    if (!url) continue
    if (/^<enclosure/i.test(tag) && !ATTR_TYPE.exec(tag)?.[1]?.toLowerCase().startsWith('image/')) {
      continue
    }
    return cleanUrl(url)
  }
  return ''
}

/**
 * Every `<item>` in the document.
 *
 * CDATA is unwrapped once up front so no later pattern has to know about it, and
 * `[\s\S]` stands in for a dot-matches-newline flag JavaScript does not have.
 */
export function parseRssItems(xml: string): ParsedFeedItem[] {
  const body = String(xml ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  const items: ParsedFeedItem[] = []

  for (const match of body.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = match[1] ?? ''
    items.push({
      title: cleanText(tagText(block, 'title')),
      link: cleanUrl(firstText(tagText(block, 'link'), tagText(block, 'guid'))),
      description: cleanText(
        firstText(tagText(block, 'description'), tagText(block, 'encoded')),
      ),
      categories: allTagText(block, 'category').map(cleanText).filter(Boolean),
      published: firstText(
        tagText(block, 'pubDate'),
        tagText(block, 'published'),
        tagText(block, 'updated'),
        tagText(block, 'date'),
      ).trim(),
      imageUrl: itemImage(block),
      source: cleanText(tagText(block, 'source')),
    })
  }
  return items
}

/** `_parse_rss_item`: a parsed item becomes a scored, ticker-tagged article. */
export function toArticle(
  item: ParsedFeedItem,
  feed: NewsFeedConfig,
  universe: Set<string>,
): NewsArticle | null {
  if (!item.title) return null

  const tickers = extractTickers(item.title, item.description, item.categories, universe)
  const { score, signals } = scoreArticle(item.title, item.description, feed.scoreBonus, tickers)
  const publishedAt = parseNewsTimestamp(item.published)

  const article: NewsArticle = {
    id: '',
    ticker: tickers.length ? tickers.slice(0, 3).join(', ') : 'OTHER',
    title: item.title,
    source: feed.source,
    time: formatNewsClock(publishedAt),
    url: item.link,
    category: 'other',
    publishedAt,
    score,
    signals,
    imageUrl: item.imageUrl,
    summary: item.description,
  }
  article.id = articleKey(article)
  return article
}

/** Everything one feed's body yields, already scored. */
export function parseFeed(
  xml: string,
  feed: NewsFeedConfig,
  universe: Set<string>,
): { articles: NewsArticle[]; parsed: number } {
  const items = parseRssItems(xml)
  const articles: NewsArticle[] = []
  for (const item of items) {
    const article = toArticle(item, feed, universe)
    if (article) articles.push(article)
  }
  return { articles, parsed: items.length }
}
