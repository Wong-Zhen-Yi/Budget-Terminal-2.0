import type {
  Candle,
  ChartStats,
  IndicatorPoint,
  StocksCompany,
  StocksMetrics,
  StocksPayload,
  StocksTargets,
} from './contract.js'

export const STOCKS_MFI_PERIOD = 14
export const STOCKS_MFI_OVERBOUGHT = 80
export const STOCKS_MFI_OVERSOLD = 20
export const STOCKS_DEFAULT_VISIBLE_BARS = 120
export const STOCKS_AUTO_ANCHOR = 0.85

export interface StocksRawFacts {
  companyName?: unknown
  exchange?: unknown
  sector?: unknown
  industry?: unknown
  description?: unknown
  marketCap?: unknown
  revenue?: unknown
  netIncome?: unknown
  eps?: unknown
  grossMargin?: unknown
  operatingMargin?: unknown
  netMargin?: unknown
  sharesOutstanding?: unknown
  pe?: unknown
  forwardPe?: unknown
  dividendRate?: unknown
  dividendYield?: unknown
  exDividendDate?: unknown
  volume?: unknown
  beta?: unknown
  earningsDates?: unknown[]
  targetLow?: unknown
  targetMean?: unknown
  targetHigh?: unknown
  analystCount?: unknown
  currentPrice?: unknown
}

export function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function firstFinite(...values: unknown[]): number | null {
  for (const value of values) {
    const numeric = finiteNumber(value)
    if (numeric !== null) return numeric
  }
  return null
}

/** `fmt_num` from the reference, including its one-decimal K branch. */
export function stocksCompact(value: unknown): string {
  const numeric = finiteNumber(value)
  if (numeric === null) return 'N/A'
  const sign = numeric < 0 ? '-' : ''
  const absolute = Math.abs(numeric)
  if (absolute >= 1e12) return `${sign}${(absolute / 1e12).toFixed(2)}T`
  if (absolute >= 1e9) return `${sign}${(absolute / 1e9).toFixed(2)}B`
  if (absolute >= 1e6) return `${sign}${(absolute / 1e6).toFixed(2)}M`
  if (absolute >= 1e3) return `${sign}${(absolute / 1e3).toFixed(1)}K`
  return `${sign}${absolute.toFixed(2)}`
}

export function stocksCurrency(value: unknown): string {
  const numeric = finiteNumber(value)
  if (numeric === null) return 'N/A'
  return Math.abs(numeric) >= 1000
    ? `$${stocksCompact(numeric)}`
    : `$${numeric.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function stocksDecimal(value: unknown): string {
  const numeric = finiteNumber(value)
  return numeric === null ? 'N/A' : numeric.toFixed(2)
}

export function stocksRatio(value: unknown): string {
  const numeric = finiteNumber(value)
  return numeric === null ? 'N/A' : `${numeric.toFixed(2)}x`
}

export function stocksPercentage(value: unknown): string {
  const numeric = finiteNumber(value)
  return numeric === null ? 'N/A' : `${(numeric * 100).toFixed(2)}%`
}

export function stocksHolderPercentage(value: unknown): string {
  const numeric = finiteNumber(value)
  if (numeric === null) return 'N/A'
  const percentage = Math.abs(numeric) > 1 ? numeric : numeric * 100
  return `${percentage.toFixed(2)}%`
}

/** Yahoo reports this field as a fraction. It must never be capped at +/-100%. */
export function stocksHolderChange(value: unknown): string {
  const numeric = finiteNumber(value)
  if (numeric === null) return 'N/A'
  const percentage = numeric * 100
  return `${percentage > 0 ? '+' : ''}${percentage.toFixed(2)}%`
}

export function stocksShares(value: unknown): string {
  const numeric = finiteNumber(value)
  if (numeric === null) return 'N/A'
  return Math.abs(numeric) >= 1000
    ? stocksCompact(numeric)
    : Math.trunc(numeric).toLocaleString('en-US')
}

export function stocksInteger(value: unknown): string {
  const numeric = finiteNumber(value)
  return numeric === null ? 'N/A' : Math.trunc(numeric).toLocaleString('en-US')
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (value === null || value === undefined || value === '' || value === 'N/A') return null
  const numeric = finiteNumber(value)
  const parsed = numeric !== null
    ? new Date(Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric)
    : new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function stocksDate(value: unknown): string {
  const date = toDate(value)
  if (!date) return 'N/A'
  return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
}

export function stocksEarningsDate(values: unknown[] | undefined, now = new Date()): string {
  const dates = (values ?? []).map(toDate).filter((date): date is Date => date !== null)
  if (!dates.length) return 'N/A'
  const future = dates.filter((date) => date.getTime() >= now.getTime())
  const chosen = (future.length ? future : dates).sort((a, b) => a.getTime() - b.getTime())[0]
  return stocksDate(chosen)
}

export function stocksDividend(rateValue: unknown, yieldValue: unknown): string {
  const rate = finiteNumber(rateValue)
  const dividendYield = finiteNumber(yieldValue)
  const rateText = rate === null ? '' : stocksCurrency(rate)
  const yieldText = dividendYield === null ? '' : `${(dividendYield * 100).toFixed(2)}%`
  if (rateText && yieldText) return `${rateText} (${yieldText})`
  return rateText || yieldText || 'N/A'
}

export function targetUpside(currentValue: unknown, targetValue: unknown): {
  text: string
  value: number | null
} {
  const current = finiteNumber(currentValue)
  const target = finiteNumber(targetValue)
  if (current === null || target === null || current === 0) return { text: 'N/A', value: null }
  const value = ((target - current) / current) * 100
  return { text: `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`, value }
}

export function normalizeStocksFacts(symbol: string, facts: StocksRawFacts): {
  company: StocksCompany
  metrics: StocksMetrics
  targets: StocksTargets
} {
  const earningsDates = Array.isArray(facts.earningsDates) ? facts.earningsDates : []
  const upside = targetUpside(facts.currentPrice, facts.targetMean)
  return {
    company: {
      name: String(facts.companyName || symbol).trim() || symbol,
      exchange: String(facts.exchange || '').trim(),
      sector: String(facts.sector || '').trim(),
      industry: String(facts.industry || '').trim(),
      description: String(facts.description || '').trim() || 'No company description available.',
    },
    metrics: {
      marketCap: stocksCompact(facts.marketCap),
      revenue: stocksCompact(facts.revenue),
      netIncome: stocksCompact(facts.netIncome),
      eps: stocksDecimal(facts.eps),
      grossMargin: stocksPercentage(facts.grossMargin),
      operatingMargin: stocksPercentage(facts.operatingMargin),
      netMargin: stocksPercentage(facts.netMargin),
      sharesOutstanding: stocksCompact(facts.sharesOutstanding),
      pe: stocksRatio(facts.pe),
      forwardPe: stocksRatio(facts.forwardPe),
      dividend: stocksDividend(facts.dividendRate, facts.dividendYield),
      exDividendDate: stocksDate(facts.exDividendDate),
      volume: stocksCompact(facts.volume),
      beta: stocksDecimal(facts.beta),
      earningsDate: stocksEarningsDate(earningsDates),
    },
    targets: {
      low: stocksCurrency(facts.targetLow),
      mean: stocksCurrency(facts.targetMean),
      high: stocksCurrency(facts.targetHigh),
      upsideToMean: upside.text,
      upsidePct: upside.value,
      analysts: stocksInteger(facts.analystCount),
    },
  }
}

/** Exact rolling-sum MFI used by `_stocks_calculate_mfi`. */
export function calculateMfi(candles: Candle[], period = STOCKS_MFI_PERIOD): IndicatorPoint[] {
  if (period <= 0 || candles.length < period) return []
  const typical = candles.map((row) => (row.high + row.low + row.close) / 3)
  const positive = new Array<number>(candles.length).fill(0)
  const negative = new Array<number>(candles.length).fill(0)
  for (let index = 1; index < candles.length; index += 1) {
    const flow = typical[index] * candles[index].volume
    if (typical[index] > typical[index - 1]) positive[index] = flow
    else if (typical[index] < typical[index - 1]) negative[index] = Math.abs(flow)
  }

  const points: IndicatorPoint[] = []
  let positiveSum = 0
  let negativeSum = 0
  for (let index = 0; index < candles.length; index += 1) {
    positiveSum += positive[index]
    negativeSum += negative[index]
    if (index >= period) {
      positiveSum -= positive[index - period]
      negativeSum -= negative[index - period]
    }
    if (index < period - 1) continue
    let value = 50
    if (negativeSum === 0 && positiveSum > 0) value = 100
    else if (positiveSum === 0 && negativeSum > 0) value = 0
    else if (negativeSum > 0) value = 100 - 100 / (1 + positiveSum / negativeSum)
    points.push({ time: candles[index].time, value: Math.min(100, Math.max(0, value)) })
  }
  return points
}

export function buildStocksStats(symbol: string, candles: Candle[], currency = 'USD', longName = symbol): ChartStats {
  if (!candles.length) throw new Error(`No chart data returned for ${symbol}.`)
  const latest = candles[candles.length - 1]
  const previous = candles.length > 1 ? candles[candles.length - 2] : latest
  const absChange = latest.close - previous.close
  return {
    symbol,
    price: latest.close,
    change: previous.close ? (absChange / previous.close) * 100 : 0,
    absChange,
    open: latest.open,
    high: latest.high,
    low: latest.low,
    close: latest.close,
    volume: latest.volume,
    currency,
    longName,
  }
}

export function stocksExportEscape(value: unknown): string {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim().replaceAll('|', '\\|')
}

export function buildStocksLlmExport(
  payload: StocksPayload,
  { autoFollow, mfiEnabled }: { autoFollow: boolean; mfiEnabled: boolean },
  exportedAt = new Date(),
): string {
  const lines = [
    `# Stocks Export - ${payload.symbol}`,
    '',
    `- Symbol: ${payload.symbol}`,
    `- Company: ${payload.company.name}`,
    `- Exported at: ${exportedAt.toLocaleString('sv-SE')}`,
    '- Chart period: 3y',
    '- Chart interval: 1d',
    `- Auto: ${autoFollow ? 'On' : 'Off'}`,
    `- MFI: ${mfiEnabled ? 'On' : 'Off'}`,
  ]
  if (mfiEnabled) {
    const latest = payload.chart.mfi.at(-1)?.value
    lines.push(`- Latest MFI(${STOCKS_MFI_PERIOD}): ${latest === undefined ? 'N/A' : latest.toFixed(2)}`)
  }
  lines.push(
    `- Chart rows exported: ${payload.chart.candles.length}`,
    '',
    '## Latest Quote Snapshot',
    '',
    `- Open: ${stocksCurrency(payload.chart.stats.open)}`,
    `- High: ${stocksCurrency(payload.chart.stats.high)}`,
    `- Low: ${stocksCurrency(payload.chart.stats.low)}`,
    `- Close: ${stocksCurrency(payload.chart.stats.close)}`,
    `- Volume: ${stocksInteger(payload.chart.stats.volume)}`,
    `- Change: ${payload.chart.stats.absChange >= 0 ? '+' : '-'}$${Math.abs(payload.chart.stats.absChange).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${payload.chart.stats.change >= 0 ? '+' : ''}${payload.chart.stats.change.toFixed(2)}%)`,
    '',
    '## Overview',
    '',
  )

  const overview: Array<[string, string]> = [
    ['Market cap', payload.metrics.marketCap],
    ['Revenue', payload.metrics.revenue],
    ['Net income', payload.metrics.netIncome],
    ['EPS', payload.metrics.eps],
    ['Gross margin', payload.metrics.grossMargin],
    ['Operating margin', payload.metrics.operatingMargin],
    ['Net margin', payload.metrics.netMargin],
    ['Shares outstanding', payload.metrics.sharesOutstanding],
    ['P/E', payload.metrics.pe],
    ['Forward P/E', payload.metrics.forwardPe],
    ['Dividend', payload.metrics.dividend],
    ['Ex-dividend date', payload.metrics.exDividendDate],
    ['Volume', payload.metrics.volume],
    ['Beta', payload.metrics.beta],
    ['Earnings date', payload.metrics.earningsDate],
  ]
  for (const [label, value] of overview) lines.push(`- ${label}: ${value}`)

  lines.push('', '## Price Targets', '')
  for (const [label, value] of [
    ['Low', payload.targets.low],
    ['Mean', payload.targets.mean],
    ['High', payload.targets.high],
    ['Upside to mean', payload.targets.upsideToMean],
    ['Analysts', payload.targets.analysts],
  ]) lines.push(`- ${label}: ${value}`)

  lines.push('', '## Description', '', payload.company.description, '', '## News', '')
  if (!payload.news.length) lines.push('(no news loaded)')
  else {
    lines.push('| Headline | Ticker | Source | Time | URL |', '| --- | --- | --- | --- | --- |')
    for (const row of [...payload.news].sort((a, b) => b.publishedAt - a.publishedAt)) {
      const time = row.publishedAt
        ? new Date(row.publishedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
        : '--:--'
      lines.push(`| ${stocksExportEscape(row.title)} | ${stocksExportEscape(row.ticker)} | ${stocksExportEscape(row.source)} | ${time} | ${stocksExportEscape(row.url)} |`)
    }
  }

  lines.push('', '## Top Institutional Holders', '')
  if (!payload.institutional.length) lines.push('(no institutional holders loaded)')
  else {
    lines.push('| Holder | % Held | Shares | Value | Change | Reported |', '| --- | ---: | ---: | ---: | ---: | --- |')
    for (const row of payload.institutional) {
      lines.push(`| ${stocksExportEscape(row.holder)} | ${row.pctHeld} | ${row.shares} | ${row.value} | ${row.pctChange} | ${row.reported} |`)
    }
  }

  lines.push('', '## Insider Transactions', '')
  if (!payload.insiders.length) lines.push('(no insider transactions loaded)')
  else {
    lines.push('| Date | Insider | Title/Relation | Transaction | Shares | Value |', '| --- | --- | --- | --- | ---: | ---: |')
    for (const row of payload.insiders) {
      lines.push(`| ${row.date} | ${stocksExportEscape(row.insider)} | ${stocksExportEscape(row.title)} | ${stocksExportEscape(row.transaction)} | ${row.shares} | ${row.value} |`)
    }
  }

  lines.push('', '## Chart History', '')
  const header = ['Date', 'Open', 'High', 'Low', 'Close', 'Volume']
  if (mfiEnabled) header.push(`MFI${STOCKS_MFI_PERIOD}`)
  lines.push(`| ${header.join(' | ')} |`)
  lines.push(`| --- | ---: | ---: | ---: | ---: | ---: |${mfiEnabled ? ' ---: |' : ''}`)
  const mfi = new Map(payload.chart.mfi.map((point) => [point.time, point.value]))
  for (const candle of payload.chart.candles) {
    const values = [
      new Date(candle.time * 1000).toISOString().slice(0, 10),
      candle.open.toFixed(2),
      candle.high.toFixed(2),
      candle.low.toFixed(2),
      candle.close.toFixed(2),
      stocksInteger(candle.volume),
    ]
    if (mfiEnabled) values.push(mfi.get(candle.time)?.toFixed(2) ?? '')
    lines.push(`| ${values.join(' | ')} |`)
  }
  return `${lines.join('\n').trimEnd()}\n`
}

export function emptyStocksPayload(symbol: string): StocksPayload {
  const normalized = normalizeStocksFacts(symbol, {})
  return {
    symbol,
    ...normalized,
    chart: {
      candles: [],
      stats: {
        symbol,
        price: 0,
        change: 0,
        absChange: 0,
        open: 0,
        high: 0,
        low: 0,
        close: 0,
        volume: 0,
        currency: 'USD',
        longName: symbol,
      },
      mfi: [],
    },
    news: [],
    institutional: [],
    insiders: [],
    missing: [],
    generatedAt: 0,
  }
}

/** Keep the last usable workspace when a new ticker's required chart failed. */
export function selectStocksPayload(
  candidate: StocksPayload | null | undefined,
  fallback: StocksPayload | null,
): StocksPayload | null {
  return candidate?.chart.candles.length ? candidate : fallback
}
