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
  revocation?: 'complete' | 'unconfirmed'
}

export type CloudSyncCommand =
  | { type: 'signInGoogle' }
  | { type: 'cancelSignIn' }
  | { type: 'sync' }
  | { type: 'resolve'; use: 'local' | 'cloud' }
  | { type: 'disconnect' }
  | { type: 'revokeOtherSessions' }
  | { type: 'retrySession' }
  | { type: 'retryCredentialCleanup' }

export interface CloudSnapshot { revision: number; payload: string; updatedAt: number }
export interface LocalSyncSnapshot { payload: string; updatedAt: number; pristine: boolean }

/**
 * Signing in with Google is the only consent sync needs. The first sync between a device and
 * an account follows the new-device rules: a cloud copy holding saved records is restored (the
 * engine backs up this device first), and a cloud copy holding none is replaced by this
 * device's data. A device holding only factory defaults never uploads them to an empty cloud;
 * it waits for a device with saved data. Only edits made on two devices after they last synced
 * need a choice.
 */
export function syncDecision(local: string, remote: CloudSnapshot | null, baseline?: string, pristine = false,
  isFactoryDefault: (payload: string) => boolean = () => false) {
  if (!remote) return pristine ? 'wait' as const : 'upload' as const
  if (local === remote.payload) return 'equal' as const
  if (baseline === undefined) return !pristine && isFactoryDefault(remote.payload) ? 'upload' as const : 'download' as const
  if (local === baseline) return 'download' as const
  if (remote.payload === baseline) return 'upload' as const
  return 'conflict' as const
}
