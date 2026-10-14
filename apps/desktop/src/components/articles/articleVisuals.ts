import { z } from 'zod'

const label = z.string().trim().min(1).max(200)
const source = z.object({ label, url: z.string().url().refine(url => /^https?:\/\//.test(url)) })
const common = {
  title: label,
  subtitle: z.string().max(500),
  note: z.string().max(1000),
  sources: z.array(source).max(8),
}
export const articleVisualSchema = z.discriminatedUnion('type', [
  z.object({
    ...common,
    type: z.literal('comparison'),
    unit: z.enum(['USD million', '%']),
    metrics: z.array(z.object({ label, values: z.array(z.object({ label, value: z.number().finite().nonnegative() })).min(1).max(6) })).min(1).max(8),
  }),
  z.object({
    ...common,
    type: z.literal('flow'),
    lanes: z.array(z.object({ label, steps: z.array(label).min(2).max(8), outcome: label })).min(1).max(4),
  }),
  z.object({
    ...common,
    type: z.literal('sensitivity'),
    growth: z.array(z.number().finite().min(-100).max(500)).min(2).max(6),
    multipleChange: z.array(z.number().finite().min(-100).max(500)).min(2).max(6),
  }),
])
export type ArticleVisualData = z.infer<typeof articleVisualSchema>

export function parseArticleVisual(text: string): ArticleVisualData | null {
  try { return articleVisualSchema.parse(JSON.parse(text.replace(/^```article-visual\s*\n/, '').replace(/\n?```$/, ''))) }
  catch { return null }
}

export function sensitivityReturn(growth: number, multipleChange: number): number {
  return ((1 + growth / 100) * (1 + multipleChange / 100) - 1) * 100
}
