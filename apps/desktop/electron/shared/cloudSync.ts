export interface CloudSyncStatus {
  url: string
  signedIn: boolean
  encryptionAvailable: boolean
  state: 'disconnected' | 'idle' | 'syncing' | 'synced' | 'conflict' | 'error'
  lastSyncedAt?: number
  localUpdatedAt?: number
  cloudUpdatedAt?: number
  revision?: number
  pending: boolean
  message?: string
  signInPending?: boolean
  authState?: 'restoring' | 'signedOut' | 'signingIn' | 'authenticated' | 'offline' | 'reauthRequired' | 'keyringUnavailable' | 'storageError'
  credentialCleanupRequired?: boolean
  githubLogin?: string
  workspaceApprovalRequired?: boolean
  revocation?: 'complete' | 'unconfirmed'
}

export type CloudSyncCommand =
  | { type: 'signInGitHub'; url: string }
  | { type: 'cancelSignIn' }
  | { type: 'sync' }
  | { type: 'resolve'; use: 'local' | 'cloud' }
  | { type: 'disconnect' }
  | { type: 'confirmWorkspace'; use: 'local' | 'cloud' }
  | { type: 'revokeOtherSessions' }
  | { type: 'retrySession' }
  | { type: 'retryCredentialCleanup' }

export interface CloudSnapshot { revision: number; payload: string; updatedAt: number }
export interface LocalSyncSnapshot { payload: string; updatedAt: number; pristine: boolean }

/** Fresh installs restore the server copy; existing unsynced work needs a choice. */
export function syncDecision(local: string, remote: CloudSnapshot | null, baseline?: string, pristine = false) {
  if (!remote) return 'upload' as const
  if (local === remote.payload) return 'equal' as const
  if (baseline === undefined) return pristine ? 'download' as const : 'conflict' as const
  if (local === baseline) return 'download' as const
  if (remote.payload === baseline) return 'upload' as const
  return 'conflict' as const
}
