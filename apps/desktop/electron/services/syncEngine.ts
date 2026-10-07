import { isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
import type { SyncConflict, SyncDataset } from '../shared/sync.js'
import { SYNC_DATASETS } from '../shared/sync.js'

export interface CloudDocument {
  dataset: SyncDataset
  payload: unknown
  revision: number
  updated_at: string
}
export interface SyncCheckpoint {
  owner: string
  bases: Partial<Record<SyncDataset, CloudDocument>>
  lastSyncedAt?: string
}
export interface SyncAdapter {
  read(dataset: SyncDataset): Promise<unknown>
  apply(dataset: SyncDataset, payload: unknown, expected: unknown): Promise<void>
  fetch(): Promise<CloudDocument[]>
  push(dataset: SyncDataset, payload: unknown, expectedRevision: number): Promise<CloudDocument>
  save(checkpoint: SyncCheckpoint): Promise<void>
}

/** Persisted local files are the durable outbox: differences from the acknowledged
 * baseline remain pending across crashes, even if a cloud response was lost. */
export class SyncEngine {
  conflicts: SyncConflict[] = []
  pending: SyncDataset[] = []
  constructor(readonly checkpoint: SyncCheckpoint, private readonly adapter: SyncAdapter) {}

  async inspect(): Promise<void> {
    this.pending = []
    for (const dataset of SYNC_DATASETS) {
      const base = this.checkpoint.bases[dataset]
      if (!base || !isDeepStrictEqual(await this.adapter.read(dataset), base.payload)) this.pending.push(dataset)
    }
  }

  async run(resolution?: { dataset: SyncDataset; choice: 'local' | 'cloud'; token: string }): Promise<void> {
    const resolving = resolution && this.conflicts.find((item) => item.dataset === resolution.dataset)
    if (resolution && (!resolving || resolving.token !== resolution.token)) {
      throw new Error('The conflict changed since you opened it. Sync again to review the latest copies.')
    }
    const cloud = await this.adapter.fetch()
    this.conflicts = []
    for (const dataset of SYNC_DATASETS) {
      const local = await this.adapter.read(dataset)
      const remote = cloud.find((row) => row.dataset === dataset)
      const base = this.checkpoint.bases[dataset]
      const localChanged = !base || !isDeepStrictEqual(local, base.payload)
      const remoteChanged = remote && (!base || remote.revision !== base.revision)
      const equal = remote && isDeepStrictEqual(local, remote.payload)
      const choice = resolution?.dataset === dataset ? resolution.choice : undefined
      if (choice && (!resolving || !remote || !isDeepStrictEqual(local, resolving.local) ||
        !isDeepStrictEqual(remote.payload, resolving.cloud) || remote.updated_at !== resolving.updatedAt)) {
        throw new Error('The copies changed since you opened the conflict. Sync again to review the latest copies.')
      }
      if (remote && !equal && localChanged && remoteChanged && !choice) {
        const token = createHash('sha256').update(JSON.stringify({ dataset, local, remote })).digest('hex')
        this.conflicts.push({ token, dataset, local, cloud: remote.payload, updatedAt: remote.updated_at })
        continue
      }
      let acknowledged: CloudDocument
      if (remote && (equal || choice === 'cloud' || (!localChanged && remoteChanged))) {
        if (!equal) await this.adapter.apply(dataset, remote.payload, local)
        acknowledged = remote
      } else if (!remote || localChanged || choice === 'local') {
        acknowledged = await this.adapter.push(dataset, local, remote?.revision ?? 0)
      } else {
        acknowledged = remote
      }
      this.checkpoint.bases[dataset] = acknowledged
      if (!isDeepStrictEqual(base, acknowledged)) {
        try { await this.adapter.save(this.checkpoint) }
        catch (error) {
          if (base) this.checkpoint.bases[dataset] = base
          else delete this.checkpoint.bases[dataset]
          throw error
        }
      }
    }
    await this.inspect()
    if (!this.pending.length && !this.conflicts.length) {
      this.checkpoint.lastSyncedAt = new Date().toISOString()
      await this.adapter.save(this.checkpoint)
    }
  }
}
