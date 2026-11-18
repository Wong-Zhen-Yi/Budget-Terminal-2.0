import type { Envelope, EnvelopeError } from '../shared/contract.js'
import { CHANNELS } from '../shared/contract.js'
import { describeError, err, meta } from '../shared/envelope.js'
import type { NvdaEarnings, NvdaPayload, NvdaRequest } from '../shared/nvda.js'
import { trackApiRequest } from './apiUsage.js'
import { cache, TTL, type TtlCache } from './cache.js'
import { publishPageProgress } from './pageProgress.js'
import { getStocks } from './yahoo/stocks.js'

const SOURCE = 'NVDA market providers · NVIDIA investor relations'
const NEWSROOM = 'https://nvidianews.nvidia.com'
const QUARTER_NAMES = ['first', 'second', 'third', 'fourth']

export function discoverNvdaRelease(html: string) {
  const releases = [...html.matchAll(/\/news\/nvidia-announces-financial-results-for-(first|second|third|fourth)-quarter-(?:and-)?fiscal(?:-year)?-(20\d{2})(?![\w-])/gi)]
    .map(([path, name, fiscalYear]) => ({ url: NEWSROOM + path, quarter: QUARTER_NAMES.indexOf(name.toLowerCase()) + 1, year: Number(fiscalYear) }))
    .sort((a, b) => b.year - a.year || b.quarter - a.quarter)
  return releases[0]
}

const quarterHeader = /\bQ([1-4])\s+FY(\d{2})\b/g
const period = (quarter: number, year: number) => `Q${quarter} FY${year}`

/** Parse the three comparative quarter columns of the CFO commentary. */
export function parseNvdaCommentary(input: string, sourceUrl: string, release: NonNullable<ReturnType<typeof discoverNvdaRelease>>): NvdaEarnings {
  const text = input.replace(/AI Clouds, Industrial,\s*&\s+Enterprise\s+(?=\$?\d)/g, 'AI Clouds, Industrial, & Enterprise ')
  const summary = text.match(/^GAAP\s*$([\s\S]+?)^Non-GAAP\s*$/m)?.[1] ?? ''
  const platforms = text.match(/^Revenue by Market Platform\s*$([\s\S]+?)^Total\s+([^\n]+)/m)
  const year = release.year
  const quarter = release.quarter
  const periods = [period(quarter, year), period(quarter === 1 ? 4 : quarter - 1, quarter === 1 ? year - 1 : year), period(quarter, year - 1)]
  const labels = (block: string) => [...block.matchAll(quarterHeader)].map(([, q, fy]) => period(Number(q), 2000 + Number(fy)))
  const table = platforms?.[1] ?? ''
  if ([summary, table].some(block => labels(block).join() !== periods.join())) throw Error('NVIDIA quarterly comparison columns changed.')

  function read(block: string, label: string, monetary = false) {
    const row = block.split('\n').find(line => line.startsWith(label + ' '))
    const numbers = row?.slice(label.length).match(/\(\d[\d,.]*\)|-?\d[\d,.]*|[—–]/g)?.map(value =>
      /^[—–]$/.test(value) ? 0 : Number(value.replace(/,/g, '').replace(/^\((.+)\)$/, '-$1'))) ?? []
    if (numbers.length !== 5 || numbers.some(value => !Number.isFinite(value))) throw Error(`NVIDIA ${label} row is unavailable or changed.`)
    const units = block.match(/\(\$ in (millions|billions)\b/)?.[1]
    if (monetary && !units) throw Error(`NVIDIA ${label} units are unavailable.`)
    const scale = !monetary ? 1 : units === 'millions' ? 1e6 : 1e9
    return { values: numbers.slice(0, 3).map(value => monetary ? Math.round(value * scale) : value), growth: numbers[4], scale }
  }

  const revenue = read(summary, 'Revenue', true)
  const grossMargin = read(summary, 'Gross margin')
  const operatingIncome = read(summary, 'Operating income', true)
  const dilutedEps = read(summary, 'Diluted earnings per share')
  const dataCenter = read(table, 'Data Center', true)
  const platformLabels = table.includes('Hyperscale') ? ['Hyperscale', 'AI Clouds, Industrial, & Enterprise', 'Edge Computing'] : ['Compute', 'Networking', 'Other markets']
  let platformRows
  if (platformLabels[0] === 'Hyperscale') {
    platformRows = platformLabels.map(label => read(table, label, true))
  } else {
    const other = revenue.values.map((total, index) => total - dataCenter.values[index])
    if (other[2] <= 0) throw Error('NVIDIA year-ago revenue outside Data Center is unavailable.')
    platformRows = [read(table, 'Compute', true), read(table, 'Networking', true), { values: other, growth: Math.round((other[0] / other[2] - 1) * 100) }]
  }
  const quarters = periods.map((period, index) => {
    const total = revenue.values[index]
    const dataCenterRevenue = dataCenter.values[index]
    const values = platformRows.map(row => row.values[index])
    // Rounded billion-dollar figures can differ by up to $0.2B when summed.
    const tolerance = Math.max(revenue.scale, dataCenter.scale) * 0.201
    if (total <= 0 || dataCenterRevenue <= 0 || values.some(value => value < 0)
      || Math.abs(values[0] + values[1] - dataCenterRevenue) > tolerance
      || Math.abs(values.reduce((sum, value) => sum + value, 0) - total) > tolerance) throw Error(`NVIDIA ${period} revenue does not reconcile.`)
    return { period, revenue: total, dataCenter: dataCenterRevenue, platforms: values, grossMargin: grossMargin.values[index],
      operatingIncome: operatingIncome.values[index], dilutedEps: dilutedEps.values[index] }
  })
  const guidance = /Revenue is expected to be\s+\$([\d,.]+)\s+billion,?\s+plus or minus\s+([\d.]+)\s*%/i.exec(text.replace(/\s+/g, ' '))
  return {
    sourceUrl, releaseUrl: release.url, platformLabels, quarters, revenueGrowthYoY: revenue.growth,
    platformGrowthYoY: platformRows.map(row => row.growth),
    guidance: guidance ? {
      period: period(quarter === 4 ? 1 : quarter + 1, quarter === 4 ? year + 1 : year),
      revenueMidpoint: Number(guidance[1].replace(/,/g, '')) * 1e9, rangePct: Number(guidance[2]),
    } : null,
  }
}

async function nvidiaDocument(url: string) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw Error(`NVIDIA returned HTTP ${response.status}.`)
  return response
}

export async function fetchNvdaEarnings(): Promise<NvdaEarnings> {
  return trackApiRequest('nvidia', async () => {
    const listings = await Promise.allSettled(['/news', '/news?page=1&q=earnings'].map(async path => (await nvidiaDocument(NEWSROOM + path)).text()))
    if (listings.every(result => result.status === 'rejected')) throw Error(`NVIDIA newsroom unavailable: ${describeError(listings[0].reason)}`)
    const release = discoverNvdaRelease(listings.flatMap(result => result.status === 'fulfilled' ? [result.value] : []).join('\n'))
    if (!release) throw Error('NVIDIA earnings release was not found in the newsroom.')
    const shortYear = release.year % 100
    const sourceUrl = `https://s201.q4cdn.com/141608511/files/doc_financials/${release.year}/Q${release.quarter}${shortYear}/Q${release.quarter}FY${shortYear}-CFO-Commentary.pdf`
    const response = await nvidiaDocument(sourceUrl)
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = getDocument({ data: new Uint8Array(await response.arrayBuffer()), useSystemFonts: true })
    try {
      const pdf = await task.promise
      const pages = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
        const content = await (await pdf.getPage(index + 1)).getTextContent()
        const rows = new Map<number, Array<{ x: number; text: string }>>()
        for (const item of content.items) {
          if (!('str' in item) || !item.str.trim()) continue
          const y = Math.round(item.transform[5])
          const cells = rows.get(y) ?? []
          cells.push({ x: item.transform[4], text: item.str.trim() })
          rows.set(y, cells)
        }
        // The PDF emits the wrapped platform label before its vertically centered numbers.
        return [...rows.values()].map(cells => cells.sort((a, b) => a.x - b.x).map(cell => cell.text).join(' ')).join('\n')
      }))
      return parseNvdaCommentary(pages.join('\n'), sourceUrl, release)
    } finally {
      await task.destroy()
    }
  })
}

export async function getNvda({ force = false }: NvdaRequest = {}, fetchers = { earnings: fetchNvdaEarnings, market: getStocks },
  storage: TtlCache = cache): Promise<Envelope<NvdaPayload>> {
  const data: NvdaPayload = { symbol: 'NVDA', market: null, earnings: null,
    progress: { market: 'unavailable', earnings: 'unavailable' }, laneFetchedAt: { market: null, earnings: null } }
  const errors: EnvelopeError[] = []
  let cached = false
  const lane = async <K extends 'earnings' | 'market'>(key: K, ttl: number, load: () => Promise<{ value: NonNullable<NvdaPayload[K]>; warnings: string[] }>) => {
    try {
      const result = await storage.resolveWithStaleFallback(`nvda:v1:${key}`, entry => entry.warnings.length ? 10_000 : ttl,
        async () => ({ ...await load(), fetchedAt: Date.now() }), { force })
      data[key] = result.value.value
      const warnings = result.value.warnings
      const stale = result.stale || warnings.some(warning => /showing cached/i.test(warning))
      data.progress[key] = stale ? 'stale' : warnings.length ? 'partial' : 'loaded'
      data.laneFetchedAt[key] = result.value.fetchedAt
      cached ||= result.fromCache
      for (const reason of warnings) errors.push(err(SOURCE, reason, `nvda-${key}`, key))
      if (result.stale) errors.push(err(SOURCE, result.snapshot?.failures?.at(-1) ?? 'Refresh failed; showing cached data.', `nvda-${key}`, key))
    } catch (error) {
      errors.push(err(SOURCE, describeError(error), `nvda-${key}`, key))
    } finally {
      publishPageProgress(data, SOURCE, errors, CHANNELS.nvda)
    }
  }
  await Promise.all([
    lane('earnings', TTL.nvdaReports, async () => ({ value: await fetchers.earnings(), warnings: [] })),
    lane('market', TTL.nvda, async () => {
      const result = await fetchers.market('NVDA', force)
      return { value: result.payload, warnings: result.failures.map(({ block, reason }) => `${block}: ${reason}`) }
    }),
  ])
  const failed = !data.earnings && !data.market
  const stale = Object.values(data.progress).includes('stale')
  const fetchedAt = Math.min(...Object.values(data.laneFetchedAt).filter((time): time is number => time !== null), Date.now())
  return { data, errors, meta: meta(SOURCE, failed ? 'failed' : stale ? 'stale' : errors.length ? 'partial' : cached ? 'cached' : 'fresh',
    { fetchedAt, ...(errors.length ? { failureReason: errors.map(error => error.reason).join(' · ') } : {}) }) }
}
