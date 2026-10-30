import { z } from 'zod'

export const agentToolRunSchema = z.object({
  name: z.string().max(120), startedAt: z.number().nonnegative(),
  durationMs: z.number().nonnegative().optional(), attempts: z.number().int().min(1).max(3),
  status: z.enum(['running', 'succeeded', 'partial', 'failed', 'timedOut', 'cancelled']),
  error: z.string().max(300).optional(),
}).strict()
export const agentRunSchema = z.object({
  id: z.string().max(100), startedAt: z.number().nonnegative(), endedAt: z.number().nonnegative().optional(),
  status: z.enum(['running', 'completed', 'partial', 'failed', 'stopped']),
  limitMinutes: z.number().int().min(5).max(30), wrappingUp: z.boolean(),
  error: z.string().max(300).optional(), runtimeRetries: z.number().int().nonnegative(),
  tools: z.array(agentToolRunSchema).max(80),
}).strict()
export type AgentRun = z.infer<typeof agentRunSchema>
export type AgentToolRun = z.infer<typeof agentToolRunSchema>

// Checkpoints stay in the private workspace file, never in polled state/history summaries.
export const agentCheckpointSchema = z.object({
  runId: z.string().max(100), request: z.string().max(20_000),
  results: z.array(z.object({ tool: z.string().max(120), at: z.number().nonnegative(), json: z.string().max(16_000) }).strict()).max(8),
}).strict().refine(value => value.results.reduce((size, result) => size + result.json.length, 0) <= 48_000, 'Research checkpoint is too large.')
export type AgentCheckpoint = z.infer<typeof agentCheckpointSchema>

/** Persist fixed diagnostic categories, never arbitrary provider text, URLs, arguments or secrets. */
export function agentFailureReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (/run reached its .*minute limit/i.test(text)) return 'The run reached its time limit.'
  if (/80-tool limit/i.test(text)) return 'The run reached its tool limit.'
  if (/without (an answer|a response)/i.test(text)) return 'The provider completed without an answer.'
  if (/sign.in|unauthori[sz]ed|authentication|\b401\b|codex login/i.test(text)) return 'Sign in to Codex, then continue research.'
  if (/429|rate.?limit|quota|allowance|usage.?limit/i.test(text)) return 'The provider rate or usage limit was reached.'
  if (/permission|denied|forbidden|\b403\b/i.test(text)) return 'Access was denied. Review local permissions.'
  if (/timed? ?out|timeout|deadline/i.test(text)) return 'The research request timed out.'
  if (/abort|cancel|stopped|budget ended/i.test(text)) return 'The research request was cancelled.'
  if (/disconnect|connection|ECONN|EPIPE|fetch failed|network|socket|process exited/i.test(text)) {
    const code = text.match(/process exited \(code (-?\d+)/i)?.[1]
    return code ? `Codex disconnected (exit code ${code}).` : 'The connection was interrupted.'
  }
  if (/\b50[0234]\b|temporar|unavailable|overloaded/i.test(text)) return 'The research provider is temporarily unavailable.'
  return 'The request failed. Continue research or check provider access.'
}

export function transientResearchFailure(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  // Permission, validation and quota failures need user action, not automatic retries.
  return !/quota|allowance|usage.?limit|unauthori[sz]ed|forbidden|denied|permission|invalid|\b40[0134]\b/i.test(text)
    && /429|rate.?limit|\b50[0234]\b|temporar|unavailable|overloaded|timeout|timed out|ECONN|EPIPE|fetch failed|network|socket/i.test(text)
}

export function researchToolTimeout(name: string): number {
  if (/quant_scan|technical_scan/.test(name)) return 5 * 60_000
  if (/options_expirations|defeatbeta/.test(name)) return 3 * 60_000
  return 60_000
}
