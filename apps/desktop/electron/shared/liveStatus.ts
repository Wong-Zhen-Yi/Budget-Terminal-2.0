export type LiveStatusKind = 'agents' | 'notifications' | 'browser'
export interface LiveStatusChanged { kind: LiveStatusKind; revision: number }
