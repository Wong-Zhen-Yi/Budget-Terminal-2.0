import { cleanText } from './rss.js'

/**
 * A readable-text extractor for news articles, ported from `workers/news_preview.py`.
 *
 * The reference uses BeautifulSoup; this is regex and string scanning, because the only
 * job is "find the biggest run of paragraphs on the page" and a real HTML parser would be
 * a new runtime dependency for it. That makes it approximate by construction, so every
 * step is bounded and nothing here throws: a page it cannot read falls back to the
 * headline and the link, which is what the reference does on a paywall too.
 */

/** Paragraphs shorter than this are bylines, captions and cookie notices. */
const MIN_PARAGRAPH_CHARS = 40
/** `MAX_PREVIEW_CHARS`. */
const MAX_PREVIEW_CHARS = 6_000
/**
 * How many containers to score. The reference evaluates every match; a page with hundreds
 * of `class="content"` divs would make that quadratic, and since the winner is chosen by
 * text length the largest candidates decide the outcome anyway.
 */
const MAX_CANDIDATES = 12

/** Wrappers whose text is never the article. */
const NOISE_TAGS = [
  'script',
  'style',
  'noscript',
  'svg',
  'nav',
  'footer',
  'header',
  'aside',
  'form',
  'iframe',
]

/**
 * Drop comments and every noise block.
 *
 * Run twice: one pass leaves the outer element of a nested pair behind, because the
 * non-greedy match closes on the inner tag.
 */
function stripNoise(html: string): string {
  let text = html.replace(/<!--[\s\S]*?-->/g, ' ')
  for (let pass = 0; pass < 2; pass += 1) {
    for (const tag of NOISE_TAGS) {
      text = text.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), ' ')
    }
  }
  return text
}

/**
 * The substring from an opening tag to its matching close, counting nesting depth on the
 * same tag name. An element that never closes runs to the end of the document, which is
 * the common case on hand-written markup and still yields usable paragraphs.
 */
function elementAt(html: string, tag: string, openStart: number): string {
  const pattern = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'gi')
  pattern.lastIndex = openStart
  let depth = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html))) {
    const closing = match[1] === '/'
    const selfClosing = match[2] === '/'
    if (selfClosing) continue
    if (closing) {
      depth -= 1
      if (depth <= 0) return html.slice(openStart, match.index + match[0].length)
    } else {
      depth += 1
    }
  }
  return html.slice(openStart)
}

/** Every element worth scoring, largest first so the cap keeps the plausible ones. */
function candidates(html: string): string[] {
  const found: string[] = []

  const collect = (pattern: RegExp, tagOf: (match: RegExpExecArray) => string) => {
    for (const match of html.matchAll(pattern)) {
      if (match.index === undefined) continue
      found.push(elementAt(html, tagOf(match as RegExpExecArray), match.index))
    }
  }

  collect(/<(article|main)\b[^>]*>/gi, (match) => match[1] as string)
  collect(/<(\w+)\b[^>]*\brole\s*=\s*["']article["'][^>]*>/gi, (match) => match[1] as string)
  collect(
    /<(\w+)\b[^>]*\bclass\s*=\s*["'][^"']*(?:article|story|content)[^"']*["'][^>]*>/gi,
    (match) => match[1] as string,
  )

  const ranked = found.sort((a, b) => b.length - a.length).slice(0, MAX_CANDIDATES)

  // `candidates.append(soup.body or soup)` — the last resort, always considered.
  const bodyStart = /<body\b[^>]*>/i.exec(html)
  ranked.push(bodyStart?.index === undefined ? html : elementAt(html, 'body', bodyStart.index))
  return ranked
}

/** The paragraphs and list items inside one container, joined as the reference joins them. */
function readableText(element: string): string {
  const seen = new Set<string>()
  const paragraphs: string[] = []
  for (const match of element.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = cleanText(match[2] ?? '')
    if (text.length < MIN_PARAGRAPH_CHARS) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    paragraphs.push(text)
  }
  return paragraphs.join('\n\n')
}

export interface ExtractedArticle {
  text: string
  truncated: boolean
}

/** The longest readable run the page offers, capped. Returns empty text when it finds none. */
export function extractReadableText(html: string): ExtractedArticle {
  const cleaned = stripNoise(String(html ?? ''))

  let best = ''
  for (const element of candidates(cleaned)) {
    const text = readableText(element)
    if (text.length > best.length) best = text
  }

  if (best.length > MAX_PREVIEW_CHARS) {
    return { text: `${best.slice(0, MAX_PREVIEW_CHARS)}...`, truncated: true }
  }
  return { text: best, truncated: false }
}
