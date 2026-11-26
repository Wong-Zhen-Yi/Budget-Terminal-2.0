export type LiveStatusKind = 'agents' | 'notifications' | 'browser' | 'mcpStatus' | 'mobileAccess'
export interface LiveStatusChanged { kind: LiveStatusKind; revision: number }
