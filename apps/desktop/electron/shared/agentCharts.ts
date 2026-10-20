import { z } from 'zod'

export const AGENT_PIE_LANGUAGE = 'pie'
export const AGENT_PIE_MAX_LENGTH = 20_000

export const agentPieSchema = z.object({
  title: z.string().trim().min(1).max(160),
  unit: z.string().trim().min(1).max(40).optional(),
  caption: z.string().trim().max(1000).optional(),
  slices: z.array(z.object({
    label: z.string().trim().min(1).max(100),
    value: z.number().finite().nonnegative(),
  }).strict()).min(1).max(30),
}).strict().refine(chart => {
  const total = chart.slices.reduce((sum, slice) => sum + slice.value, 0)
  return Number.isFinite(total) && total > 0
}, 'Pie charts need a finite, positive total.')

export type AgentPie = z.infer<typeof agentPieSchema>

export function parseAgentPie(text: string): AgentPie | null {
  if (text.length > AGENT_PIE_MAX_LENGTH) return null
  try {
    const result = agentPieSchema.safeParse(JSON.parse(text))
    return result.success ? result.data : null
  } catch { return null }
}

export const AGENT_CANDLESTICK_LANGUAGE = 'candlestick'
export const AGENT_CANDLESTICK_MAX_LENGTH = 60_000
export const AGENT_CANDLESTICK_MAX_CANDLES = 200

// Symbols are references to trusted market-data services, never URLs or local paths.
export const agentChartSymbolSchema = z.string().trim().toUpperCase().min(1).max(32).regex(/^[A-Z0-9^][A-Z0-9.^=\-]*$/)
const candleTime = z.union([z.iso.date(), z.iso.datetime()])
export const agentCandlestickSchema = z.object({
  title: z.string().trim().min(1).max(160),
  symbol: agentChartSymbolSchema.optional(),
  unit: z.string().trim().min(1).max(40).optional(),
  caption: z.string().trim().max(1000).optional(),
  candles: z.array(z.object({
    time: candleTime,
    open: z.number().finite(),
    high: z.number().finite(),
    low: z.number().finite(),
    close: z.number().finite(),
  }).strict().refine(candle => candle.low <= Math.min(candle.open, candle.close)
    && candle.high >= Math.max(candle.open, candle.close), 'OHLC prices must lie within low and high.'))
    .min(1).max(AGENT_CANDLESTICK_MAX_CANDLES).optional(),
}).strict().refine(chart => Boolean(chart.symbol || chart.candles), 'Provide a market symbol or legacy OHLC data.')
  .refine(chart => !chart.candles || chart.candles.every((candle, index, candles) => index === 0
    || Date.parse(candle.time) > Date.parse(candles[index - 1].time)), 'Candles must have unique, increasing times.')

export type AgentCandlestick = z.infer<typeof agentCandlestickSchema>

export function parseAgentCandlestick(text: string): AgentCandlestick | null {
  if (text.length > AGENT_CANDLESTICK_MAX_LENGTH) return null
  try {
    const result = agentCandlestickSchema.safeParse(JSON.parse(text))
    return result.success ? result.data : null
  } catch { return null }
}

export const agentChartInstructions = `You can render native pie charts inline in your replies on Agents and Dashboard 2. When asked for a pie chart or allocation breakdown, include a fenced code block with language ${AGENT_PIE_LANGUAGE} containing only JSON, for example:
\`\`\`${AGENT_PIE_LANGUAGE}
{"title":"Allocation","unit":"USD","slices":[{"label":"Stocks","value":750},{"label":"Cash","value":250}],"caption":"Source and as-of date; explain any excluded or missing data."}
\`\`\`
The title and slices are required; unit and caption are optional. Use 1–30 slices with nonempty labels and finite nonnegative numeric values in the same unit, with a positive total. Percentages are computed by the app; do not mix amounts and percentages. Group small categories into an explicitly labelled Other slice if needed. Never put debt or short positions into a pie as positive assets; explain exclusions. Use tools for current portfolio/research values, never invent missing amounts, and keep source, freshness and partial coverage visible in the caption or surrounding text. Do not use remote image URLs, HTML, Mermaid, Python, or shell commands to draw pie charts. This display format does not modify saved data.

Always render requested price/history/candlestick charts directly in chat using an interactive, symbol-backed chart on Agents, Dashboard 2 and the top-bar dropdown. Use a fenced code block with language ${AGENT_CANDLESTICK_LANGUAGE} containing only JSON, for example:
\`\`\`${AGENT_CANDLESTICK_LANGUAGE}
{"title":"AAPL price history","symbol":"AAPL","caption":"Use the in-chat range and candle-interval controls to explore the history."}
\`\`\`
The title and actual provider symbol are required; unit and caption are optional. The app retrieves full available OHLC history through its trusted market-data service, defaults to Max daily history, and supplies range buttons, candle intervals, crosshair values, zoom, pan and exact OHLC inspection inside the conversation. Never truncate a price chart to the latest 200 bars or embed a hand-selected candles array for market charts. Even if discussing a short period, retain the full-history chart and let the user select a shorter view. Do not generate price charts as images or navigate away instead of showing the inline chart. Use tools to resolve an ambiguous ticker and to support any factual analysis; do not invent a ticker or prices. The chart fetches its own prices, so you need not copy OHLC data into the reply. If a symbol is unavailable, explain the limitation instead of fabricating data. Full available history means the provider's actual coverage, not a guarantee of inception coverage; intraday provider retention limits, stale data and failures remain visible. Legacy candles blocks remain readable as explicitly limited provided data, not full market history. Never use remote images, HTML, scripts, shell commands or executable chart code. These display blocks never modify saved data.`
