import type { CloudSnapshot, CloudSyncStatus, LocalSyncSnapshot } from '../shared/cloudSync.js'
import { syncDecision } from '../shared/cloudSync.js'
import { ConvexError } from 'convex/values'

const writeAllowanceMessage = 'This account reached its cloud write allowance. Local changes are saved and sync will retry automatically after the allowance resets.'

export interface SyncCheckpoint { account: string; baseline?: string; revision: number; lastSyncedAt?: number; cloudUpdatedAt?: number }

export interface SyncDependencies {
  readLocal: () => Promise<LocalSyncSnapshot>
  applyIfUnchanged: (expected: string, payload: string, updatedAt: number) => Promise<boolean>
  readRemote: () => Promise<CloudSnapshot | null>
  writeRemote: (revision: number, payload: string) => Promise<{ accepted: boolean; revision: number; updatedAt: number }>
  saveCheckpoint: (checkpoint: SyncCheckpoint) => Promise<void>
}

/** No credentials, UI or timers: local files remain the source for every application read. */
export class CloudSyncEngine {
  state: CloudSyncStatus['state'] = 'idle'
  pending = false
  message: string | undefined
  localUpdatedAt: number | undefined
  cloudUpdatedAt: number | undefined
  cloudRevision: number | undefined
  private conflict: { local: string; remote: CloudSnapshot } | undefined
  private retryAt = 0

  constructor(public checkpoint: SyncCheckpoint, private readonly deps: SyncDependencies) {}

  private async remember(payload: string, revision: number, cloudUpdatedAt: number) {
    const next = { account: this.checkpoint.account, baseline: payload, revision, cloudUpdatedAt, lastSyncedAt: Date.now() }
    await this.deps.saveCheckpoint(next)
    this.checkpoint = next
    const local = await this.deps.readLocal()
    this.localUpdatedAt = local.updatedAt
    this.cloudUpdatedAt = cloudUpdatedAt
    this.cloudRevision = revision
    this.pending = local.payload !== payload
    this.state = this.pending ? 'idle' : 'synced'
    this.message = undefined
    this.conflict = undefined
  }

  async sync(resolve?: 'local' | 'cloud'): Promise<void> {
    this.state = 'syncing'
    this.message = undefined
    try {
      const localState = await this.deps.readLocal()
      const local = localState.payload
      this.localUpdatedAt = localState.updatedAt
      this.pending = local !== this.checkpoint.baseline
      const remote = await this.deps.readRemote()
      this.cloudUpdatedAt = remote?.updatedAt
      this.cloudRevision = remote?.revision
      if (remote && remote.revision < this.checkpoint.revision) {
        this.state = 'error'
        this.message = 'The cloud returned an older revision than this device last synced. Local data was preserved; retry sync after checking the backend.'
        return
      }
      let decision = syncDecision(local, remote, this.checkpoint.baseline, localState.pristine)
      if (resolve) {
        // The choice applies only to the copies shown when the conflict was reported.
        // If either changed since then, require a new explicit decision.
        if (!this.conflict || this.conflict.local !== local || this.conflict.remote.revision !== remote?.revision) {
          decision = 'conflict'
        } else decision = resolve === 'local' ? 'upload' : 'download'
      }
      if (decision === 'conflict') {
        if (!remote) { this.state = 'idle'; return }
        this.conflict = { local, remote }
        this.state = 'conflict'
        this.message = 'Local and cloud copies differ. Choose which complete copy to keep. A cloud download backs up this device first.'
        return
      }
      if (decision === 'equal') { await this.remember(local, remote!.revision, remote!.updatedAt); return }
      if (decision === 'download') {
        if (!await this.deps.applyIfUnchanged(local, remote!.payload, remote!.updatedAt)) {
          this.state = 'idle'
          this.pending = true
          return
        }
        await this.remember(remote!.payload, remote!.revision, remote!.updatedAt)
        return
      }
      // A write allowance must never prevent cloud downloads or conflict inspection.
      if (Date.now() < this.retryAt) {
        this.state = 'error'
        this.pending = true
        this.message = writeAllowanceMessage
        return
      }
      const result = await this.deps.writeRemote(remote?.revision ?? 0, local)
      if (!result.accepted) {
        this.state = 'idle'
        this.pending = true
        this.message = 'Cloud changed during sync. Checking again on the next sync.'
        return
      }
      await this.remember(local, result.revision, result.updatedAt)
    } catch (error) {
      this.state = 'error'
      // Never send provider errors, request arguments, tokens or user data to diagnostics/UI.
      const code = error instanceof ConvexError && error.data && typeof error.data === 'object'
        && !Array.isArray(error.data) ? error.data.code : undefined
      if (code === 'SYNC_RATE_LIMITED' && error instanceof ConvexError) {
        const retryAfterMs = (error.data as { retryAfterMs?: unknown }).retryAfterMs
        // Only a bounded duration is accepted; provider text and payloads stay private.
        const delay = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs)
          ? Math.min(24 * 60 * 60_000, Math.max(1000, retryAfterMs)) : 60_000
        this.retryAt = Date.now() + delay
        this.pending = true
        this.message = writeAllowanceMessage
        return
      }
      this.message = code === 'SNAPSHOT_INVALID'
        ? 'Saved data does not match the supported cloud format. Local data is preserved. Update the app or check your saved data before retrying.'
        : code === 'SNAPSHOT_TOO_LARGE'
          ? 'Saved data exceeds the 750 KB cloud sync limit. Local saves remain available.'
          : code === 'UPGRADE_REQUIRED'
            ? 'This Convex server still uses record sync. Restore its snapshot-sync backend to match this app, then retry. Local data is still available.'
            : 'Sync could not complete. Local data is still available. Check your connection, sign-in and Convex setup; snapshots must be under 750 KB.'
    }
  }
}
