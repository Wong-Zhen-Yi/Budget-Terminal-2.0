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

export const agentChartInstructions = `You can render native pie charts inline in your replies on Agents and Dashboard 2. When asked for a pie chart or allocation breakdown, include a fenced code block with language ${AGENT_PIE_LANGUAGE} containing only JSON, for example:
\`\`\`${AGENT_PIE_LANGUAGE}
{"title":"Allocation","unit":"USD","slices":[{"label":"Stocks","value":750},{"label":"Cash","value":250}],"caption":"Source and as-of date; explain any excluded or missing data."}
\`\`\`
The title and slices are required; unit and caption are optional. Use 1–30 slices with nonempty labels and finite nonnegative numeric values in the same unit, with a positive total. Percentages are computed by the app; do not mix amounts and percentages. Group small categories into an explicitly labelled Other slice if needed. Never put debt or short positions into a pie as positive assets; explain exclusions. Use tools for current portfolio/research values, never invent missing amounts, and keep source, freshness and partial coverage visible in the caption or surrounding text. Do not use remote image URLs, HTML, Mermaid, Python, or shell commands to draw pie charts. This display format does not modify saved data.`
