/**
 * `csv.reader` / `csv.DictReader`, for the two issuer feeds that publish CSV.
 *
 * Quoting is not optional here: iShares writes `"Apple Inc, Class A"` and ARK writes
 * market values as `"1,234,567.89"`, so a naive split on commas would shift every column
 * after the first quoted one. This is the same trade `xlsx.ts` and `html.ts` make — the
 * stdlib does it in Python, so a dependency is not warranted for one reader.
 */

/** One CSV document into rows of raw cells. Handles quotes, escaped quotes and CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character !== '"') {
        field += character
      } else if (text[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        quoted = false
      }
      continue
    }
    if (character === '"') {
      quoted = true
    } else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n' || character === '\r') {
      // A bare \r, a bare \n and a \r\n pair all end exactly one row.
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** `utf-8-sig`: ARK's file carries a byte-order mark that would poison its first header. */
export function decodeCsv(buffer: Buffer): string {
  const text = buffer.toString('utf8')
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * `csv.DictReader`: the first row names the columns, and every later row becomes a map
 * keyed by the lower-cased header, which is how `_parse_holdings_csv` reads ARK's file.
 */
export function parseCsvRecords(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text)
  if (!rows.length) return []
  const headers = rows[0].map((cell) => cell.replace(/\s+/g, ' ').trim().toLowerCase())
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {}
    headers.forEach((header, index) => {
      if (header) record[header] = row[index] ?? ''
    })
    return record
  })
}
