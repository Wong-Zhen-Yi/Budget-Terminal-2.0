/**
 * The small slice of HTML reading the issuer providers need, hand-rolled.
 *
 * `etf_holdings.py` reaches for BeautifulSoup, and four of its seven providers scrape a
 * table out of a fund page. This module is the same thing `xlsx.ts` is for SSGA's
 * workbook: the repo's ports do not add a dependency for one parser, and the shapes here
 * are narrow — find a `<table>` whose header row names a ticker and a weight column,
 * then read the `<td>`s below it.
 *
 * It is not a general HTML parser and must not grow into one. It reads issuer markup
 * that is already semantic, and every caller checks that the table it found actually had
 * the columns it wanted before trusting a row.
 */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
}

/** Named and numeric entities, which issuer pages use freely inside fund names. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1))
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match
    }
    return ENTITIES[body.toLowerCase()] ?? match
  })
}

/**
 * `get_text(' ', strip=True)` plus `_clean_text`: tags become a space, entities decode,
 * and runs of whitespace collapse. Script and style bodies go first — their contents are
 * not text, and a page's inline JSON would otherwise land in the middle of a cell.
 */
export function textOf(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

export interface HtmlTable {
  /** Lower-cased `<th>` text, in document order. */
  headers: string[]
  /** One entry per `<tr>` that carried `<td>`s; header-only rows are not included. */
  rows: string[][]
  /** The table's own opening tag, so a caller can match on a class name. */
  openTag: string
}

const TABLE_RE = /<table\b([^>]*)>([\s\S]*?)<\/table>/gi
const ROW_RE = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
const HEADER_CELL_RE = /<th\b[^>]*>([\s\S]*?)<\/th>/gi
const DATA_CELL_RE = /<td\b[^>]*>([\s\S]*?)<\/td>/gi

function cells(fragment: string, pattern: RegExp): string[] {
  const found: string[] = []
  pattern.lastIndex = 0
  let match = pattern.exec(fragment)
  while (match) {
    found.push(textOf(match[1]))
    match = pattern.exec(fragment)
  }
  return found
}

/**
 * Every top-level `<table>` on the page, headers and data rows separated.
 *
 * Nested tables are not handled: the non-greedy `</table>` match closes on the inner
 * one. No issuer page in the reference's provider set nests its holdings table, and a
 * caller that finds no ticker column simply falls through to the next provider.
 */
export function parseTables(html: string): HtmlTable[] {
  const tables: HtmlTable[] = []
  TABLE_RE.lastIndex = 0
  let match = TABLE_RE.exec(html)
  while (match) {
    const body = match[2]
    const headers = cells(body, HEADER_CELL_RE).map((cell) => cell.toLowerCase())
    const rows: string[][] = []
    ROW_RE.lastIndex = 0
    let row = ROW_RE.exec(body)
    while (row) {
      const data = cells(row[1], DATA_CELL_RE)
      if (data.length) rows.push(data)
      row = ROW_RE.exec(body)
    }
    tables.push({ headers, rows, openTag: match[1] })
    match = TABLE_RE.exec(html)
  }
  return tables
}

/** `soup.find('h1') or soup.find('title')`, in that order. */
export function headingText(html: string, fallback: string): string {
  const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html) ?? /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const text = heading ? textOf(heading[1]) : ''
  return text || fallback
}

/** `soup.find(['h1', 'title'])`: whichever comes *first* in the document, as Invesco's does. */
export function firstHeadingOrTitle(html: string, fallback: string): string {
  const match = /<(h1|title)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(html)
  const text = match ? textOf(match[2]) : ''
  return text || fallback
}
