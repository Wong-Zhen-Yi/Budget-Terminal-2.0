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
  demo?: true
  signInPending?: boolean
  authState?: 'restoring' | 'signedOut' | 'signingIn' | 'authenticated' | 'offline' | 'reauthRequired' | 'keyringUnavailable' | 'storageError'
  credentialCleanupRequired?: boolean
  googleEmail?: string
  /** Provider of the connected account. */
  accountProvider?: 'google'
  /** Provider of the browser approval currently in progress. */
  signInProvider?: 'google'
  workspaceApprovalRequired?: boolean
  revocation?: 'complete' | 'unconfirmed'
}

export type CloudSyncCommand =
  | { type: 'signInGoogle' }
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

/**
 * Fresh installs restore the server copy; existing unsynced work needs a choice.
 * A device holding only factory defaults never uploads them: it waits for a device with
 * saved data. A cloud copy holding only factory defaults is not competing work, so a device
 * that has never synced with this account replaces it instead of reporting a conflict.
 */
export function syncDecision(local: string, remote: CloudSnapshot | null, baseline?: string, pristine = false,
  isFactoryDefault: (payload: string) => boolean = () => false) {
  if (!remote) return pristine ? 'wait' as const : 'upload' as const
  if (local === remote.payload) return 'equal' as const
  if (baseline === undefined) return pristine ? 'download' as const : isFactoryDefault(remote.payload) ? 'upload' as const : 'conflict' as const
  if (local === baseline) return 'download' as const
  if (remote.payload === baseline) return 'upload' as const
  return 'conflict' as const
}
