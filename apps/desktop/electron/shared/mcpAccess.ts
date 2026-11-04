/** Local controls are intentionally not part of the agent-editable settings contract. */
export interface McpPolicy {
  readOnly: boolean
  requireApproval: boolean
  browserRequireApproval?: boolean
  /** Omitted categories retain existing access; explicit false denies access. */
  permissions?: Partial<Record<McpPermission, boolean>>
}
export type McpPermission = 'marketResearch' | 'portfolioRead' | 'personalFinanceRead' | 'savedContentRead' | 'screenshots' | 'browserContent' | 'recordEdits'

export type McpCallSource = 'external' | 'agent'
export interface McpActivity {
  id: number
  tool: string
  source: McpCallSource
  startedAt: number
  durationMs?: number
  state: 'running' | 'approval' | 'success' | 'partial' | 'failed' | 'blocked' | 'replayed' | 'cancelled'
}

export interface McpDiagnostics {
  policy: McpPolicy
  policyError?: string
  /** Session-only metadata. Never includes arguments, results, URLs, or client-supplied IDs. */
  activity: McpActivity[]
  writeReceipts: number
  writeReceiptLimit: number
  journalError?: string
}
