export const SYNC_DATASETS = ['portfolio', 'personalFinance', 'cards'] as const
export type SyncDataset = typeof SYNC_DATASETS[number]
export interface SyncConflict {
  token: string
  dataset: SyncDataset
  local: unknown
  cloud: unknown
  updatedAt: string
}
export interface SyncStatus {
  email: string | null
  state: 'signedOut' | 'syncing' | 'ready' | 'error' | 'conflict'
  pending: SyncDataset[]
  conflicts: SyncConflict[]
  lastSyncedAt?: string
  message?: string
}
export type SyncAction =
  | { type: 'signIn' | 'signUp'; email: string; password: string }
  | { type: 'confirmEmail'; email: string; code: string }
  | { type: 'signOut' | 'sync' }
  | { type: 'resolve'; dataset: SyncDataset; choice: 'local' | 'cloud'; token: string }
