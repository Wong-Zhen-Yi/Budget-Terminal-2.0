import { crc32 } from 'node:zlib'
import { articleFilename, type ArticlePdfRequest } from '../shared/articles.js'
import { renderArticlePdf } from './articlePdf.js'
import { MobileRequestError } from './mobileHttp.js'

/** PDFs already compress their streams. Store them as UTF-8 entries in a ZIP. */
export async function renderMobileArticleArchive(articles: ArticlePdfRequest['articles']) {
  const entries: Buffer[] = []
  const directory: Buffer[] = []
  const filenames = new Set<string>()
  let offset = 0
  for (const article of articles) {
    const pdf = await renderArticlePdf(article.html)
    if (offset + pdf.length > 64_000_000) throw new MobileRequestError('This PDF archive is too large. Export individual articles on mobile.', 413)
    const base = articleFilename(article.title).replace(/\.pdf$/i, '')
    let filename = `${base}.pdf`
    for (let suffix = 2; filenames.has(filename.toLowerCase()); suffix++) filename = `${base}-${suffix}.pdf`
    filenames.add(filename.toLowerCase())
    const name = Buffer.from(filename, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 filename
    local.writeUInt16LE(0x0021, 12) // 1980-01-01, the earliest ZIP date
    local.writeUInt32LE(crc32(pdf), 14)
    local.writeUInt32LE(pdf.length, 18)
    local.writeUInt32LE(pdf.length, 22)
    local.writeUInt16LE(name.length, 26)
    entries.push(local, name, pdf)

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    local.copy(entry, 6, 4)
    entry.writeUInt32LE(offset, 42)
    directory.push(entry, name)
    offset += local.length + name.length + pdf.length
  }
  const central = Buffer.concat(directory)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(articles.length, 8)
  end.writeUInt16LE(articles.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...entries, central, end])
}
