export type LiveStatusKind = 'agents' | 'notifications' | 'browser' | 'mcpStatus'
export interface LiveStatusChanged { kind: LiveStatusKind; revision: number }
