export interface CloudSyncStatus {
  url: string
  configured?: boolean
  signedIn: boolean
  accountLabel?: string
  encryptionAvailable: boolean
  state: 'disconnected' | 'idle' | 'syncing' | 'synced' | 'conflict' | 'review' | 'error'
  lastSyncedAt?: number
  localUpdatedAt?: number
  cloudUpdatedAt?: number
  revision?: number
  pending: boolean
  message?: string
  signInPending?: boolean
  conflicts?: { key: string; kind: string; local: string | null; cloud: string | null; token: string }[]
  reviewToken?: string
  conflictCount?: number
  pendingRecords?: number
  metrics?: { attempts: number; failures: number; lastDurationMs: number; sentRecords: number; receivedRecords: number; sentBytes: number; receivedBytes: number }
}

export type CloudSyncCommand =
  | { type: 'signInGitHub'; url: string }
  | { type: 'cancelSignIn' }
  | { type: 'sendCode'; url: string; email: string }
  | { type: 'verifyCode'; url: string; email: string; code: string }
  | { type: 'sync' }
  | { type: 'resolve'; use: 'local' | 'cloud'; key?: string; token?: string }
  | { type: 'exportAccount' }
  | { type: 'deleteAccount'; confirmation: 'DELETE MY ACCOUNT' }
  | { type: 'disconnect' }

export interface LocalSyncSnapshot { payload: string; updatedAt: number; pristine: boolean }
