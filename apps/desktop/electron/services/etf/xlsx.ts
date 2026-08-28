/**
 * The first worksheet of an `.xlsx`, as a grid of strings.
 *
 * A port of `_parse_xlsx_rows` in the PySide6 `etf_holdings.py`, which reads SSGA's
 * daily holdings workbook with the standard library alone. The same rule applies here:
 * an xlsx is a zip of XML, and `node:zlib` already inflates deflate streams, so the one
 * file this app has to read does not justify a dependency.
 *
 * Only what SSGA's file actually uses is implemented — one sheet, shared strings, inline
 * strings and raw values. Nothing here interprets number formats, so a date cell comes
 * back as its serial; the holdings reader does not read one.
 */

import { inflateRawSync } from 'node:zlib'

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const EOCD_HEADER = 0x06054b50

/** Every entry of a zip archive, decompressed, keyed by its path. */
export function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  let eocd = -1
  // The end-of-central-directory record is last, but a trailing comment can push it back.
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === EOCD_HEADER) {
      eocd = index
      break
    }
  }
  if (eocd < 0) throw new Error('Not a zip archive: no end-of-central-directory record.')

  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const entries = new Map<string, Buffer>()

  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_HEADER) {
      throw new Error('Corrupt zip central directory.')
    }
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)

    if (buffer.readUInt32LE(localOffset) === LOCAL_HEADER) {
      // The local header's own name and extra fields are sized independently of the
      // central directory's, so the payload offset has to be read from the local one.
      const localNameLength = buffer.readUInt16LE(localOffset + 26)
      const localExtraLength = buffer.readUInt16LE(localOffset + 28)
      const start = localOffset + 30 + localNameLength + localExtraLength
      const raw = buffer.subarray(start, start + compressedSize)
      entries.set(name, method === 0 ? raw : inflateRawSync(raw))
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

function decodeXml(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(parseInt(entity.slice(2), 16))
    }
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)))
    return ENTITIES[entity] ?? match
  })
}

/** All `<t>` runs inside one element, joined — `_read_shared_strings`. */
function textRuns(xml: string): string {
  return [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
    .map((match) => decodeXml(match[1]))
    .join('')
}

function readSharedStrings(entries: Map<string, Buffer>): string[] {
  const source = entries.get('xl/sharedStrings.xml')
  if (!source) return []
  const xml = source.toString('utf8')
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) => textRuns(match[1]))
}

/** `_excel_col_to_index`: `AB12` -> column 27. */
export function excelColumnToIndex(label: string): number {
  let result = 0
  for (const char of label.toUpperCase()) {
    if (char >= 'A' && char <= 'Z') result = result * 26 + (char.charCodeAt(0) - 64)
  }
  return Math.max(result - 1, 0)
}

function cellValue(cell: string, shared: string[]): string {
  const type = /\st="([^"]+)"/.exec(cell)?.[1]
  if (type === 'inlineStr') return textRuns(cell).trim()
  const raw = /<v[^>]*>([\s\S]*?)<\/v>/.exec(cell)?.[1]
  if (raw === undefined) return ''
  if (type === 's') return shared[Number(raw)] ?? ''
  return decodeXml(raw).trim()
}

/**
 * The first worksheet as rows of strings, with gaps padded so a row's column indexes
 * still line up with its header row. Empty `<c/>` cells carry no `<v>` and become ''.
 */
export function parseXlsxRows(buffer: Buffer): string[][] {
  const entries = readZipEntries(buffer)
  const shared = readSharedStrings(entries)
  const sheet = entries.get('xl/worksheets/sheet1.xml')
  if (!sheet) return []
  const xml = sheet.toString('utf8')

  const rows: string[][] = []
  for (const rowMatch of xml.matchAll(/<row(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const body = rowMatch[1] ?? ''
    const values: string[] = []
    for (const cellMatch of body.matchAll(/<c(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/c>)/g)) {
      const cell = cellMatch[0]
      const reference = /\sr="([A-Z]+)\d+"/.exec(cell)?.[1]
      if (reference) {
        const column = excelColumnToIndex(reference)
        while (values.length < column) values.push('')
      }
      values.push(cellValue(cell, shared))
    }
    rows.push(values)
  }
  return rows
}
