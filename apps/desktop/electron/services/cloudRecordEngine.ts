import { ConvexError } from 'convex/values'
import { digest, joinSnapshot, recordBatches, splitSnapshot, stableJson, utf8Bytes, validateRecord } from '../shared/syncRecords.js'
import type { RecordPage, RecordValue, RecordWrite, RemoteRecord, SyncSignal, WriteResult } from '../shared/syncRecords.js'
import type { CloudSyncStatus, LocalSyncSnapshot } from '../shared/cloudSync.js'

export interface RecordConflict { key: string; kind: string; local: string | null; cloud: string | null; revision: number; groupHash?: string; token: string }
export interface RecordCheckpoint {
  version: 2
  account: string
  epoch?: string
  cursor: number
  initialized: boolean
  reviewRequired?: boolean
  reviewToken?: string
  baseline: Record<string, string | null>
  remote: Record<string, RemoteRecord>
  pending: RecordWrite[]
  conflicts: RecordConflict[]
  lastSyncedAt?: number
  cloudUpdatedAt?: number
}
export const newRecordCheckpoint = (account: string, reviewRequired = false): RecordCheckpoint => ({
  version: 2, account, cursor: 0, initialized: false, reviewRequired, baseline: {}, remote: {}, pending: [], conflicts: [],
})
interface Dependencies {
  readLocal: () => Promise<LocalSyncSnapshot>
  defaults: () => string
  applyIfUnchanged: (expected: string, payload: string, updatedAt: number) => Promise<boolean>
  prepare: () => Promise<SyncSignal>
  migrate: (epoch: string) => Promise<SyncSignal>
  changes: (epoch: string, cursor: number) => Promise<RecordPage>
  push: (epoch: string, records: RecordWrite[]) => Promise<WriteResult>
  saveCheckpoint: (checkpoint: RecordCheckpoint) => Promise<void>
  archive: (value: unknown) => Promise<void>
  onFailure?: (error: unknown) => void
  onFinished?: (state: CloudSyncStatus['state'], metrics: NonNullable<CloudSyncStatus['metrics']>) => void
}
const valueOf = (value: { data: string | null } | undefined) => value?.data ?? null

/** Local files plus the durable acknowledged baseline are the offline queue. No cloud reads on application paths. */
export class CloudRecordEngine {
  state: CloudSyncStatus['state'] = 'idle'
  pending = false
  message: string | undefined
  localUpdatedAt: number | undefined
  cloudRevision: number | undefined
  cloudUpdatedAt: number | undefined
  metrics = { attempts: 0, failures: 0, lastDurationMs: 0, sentRecords: 0, receivedRecords: 0, sentBytes: 0, receivedBytes: 0 }
  constructor(public checkpoint: RecordCheckpoint, private readonly deps: Dependencies) {}
  private persist() { return this.deps.saveCheckpoint(this.checkpoint) }

  async sync(resolve?: 'local' | 'cloud', key?: string, token?: string): Promise<void> {
    this.state = 'syncing'
    this.message = undefined
    const started = Date.now()
    this.metrics.attempts++
    try {
      let localState = await this.deps.readLocal()
      this.localUpdatedAt = localState.updatedAt
      let local = new Map(splitSnapshot(localState.payload).map(row => [row.key, row]))
      this.pending = [...local].some(([key, row]) => row.data !== this.checkpoint.baseline[key]) || this.checkpoint.pending.length > 0
      let signal = await this.deps.prepare()
      if (signal.protocol !== 2 || signal.deleted) throw Error('Cloud account unavailable.')
      if (this.checkpoint.epoch && this.checkpoint.epoch !== signal.epoch) {
        // A backend restore/epoch change requires a review, preserving the old queue and both copies.
        await this.deps.archive({ reason: 'cloud-history-changed', checkpoint: this.checkpoint, local: localState.payload })
        this.checkpoint = newRecordCheckpoint(this.checkpoint.account, true)
      }
      this.checkpoint.epoch = signal.epoch
      // Bound each sync turn. Large migrations resume automatically on the next retry.
      for (let count = 0; !signal.migrated && count < 40; count++) signal = await this.deps.migrate(signal.epoch)
      if (!signal.migrated) { this.message = 'Upgrading your cloud library. Local saves remain available.'; this.state = 'idle'; return }
      if (this.checkpoint.cursor > signal.seq) {
        await this.deps.archive({ reason: 'cursor-reset', checkpoint: this.checkpoint })
        this.checkpoint = newRecordCheckpoint(this.checkpoint.account, true)
        this.checkpoint.epoch = signal.epoch
      }
      let done = false
      for (let count = 0; !done && count < 100; count++) {
        const page = await this.deps.changes(signal.epoch, this.checkpoint.cursor)
        this.metrics.receivedRecords += page.records.length
        this.metrics.receivedBytes += utf8Bytes(JSON.stringify(page))
        for (const row of page.records) {
          validateRecord(row)
          const previous = this.checkpoint.remote[row.key]
          if (previous && previous.revision > row.revision) throw Error('Older cloud revision.')
          this.checkpoint.remote[row.key] = row
        }
        this.checkpoint.cursor = page.cursor
        signal = page.signal
        done = page.done
        await this.persist() // Cursor and received records commit together; crashes cannot skip changes.
      }
      this.cloudRevision = signal.seq
      this.cloudUpdatedAt = signal.updatedAt
      this.checkpoint.cloudUpdatedAt = signal.updatedAt
      if (!done) { this.state = 'idle'; this.message = 'Receiving your cloud library. Local saves remain available.'; return }
      const remote = this.checkpoint.remote
      const hasCloud = Object.values(remote).some(row => row.data !== null && row.kind !== 'chunk')

      if (!this.checkpoint.initialized) {
        const reviewToken = digest(stableJson([digest(localState.payload), signal.epoch, signal.seq]))
        if ((this.checkpoint.reviewRequired || !localState.pristine) && (!resolve || token !== reviewToken)) {
          this.checkpoint.reviewToken = reviewToken
          await this.persist()
          this.state = 'review'; this.pending = true
          this.message = `${resolve ? 'Data changed while you were choosing. Review and confirm again. ' : ''}Review before connecting: local data stays on this device after sign-out. It may belong to a previous account. Import it into this account only if it is yours, or use this account’s cloud library. A local recovery backup is saved before changes.`
          return
        }
        const chosen = resolve === 'local' ? new Map([...Object.values(remote).map(row => [row.key, row] as const), ...local]) :
          hasCloud ? new Map(Object.values(remote).map(row => [row.key, row])) : resolve === 'cloud' ? new Map<string, RecordValue>() : local
        const payload = resolve === 'cloud' && !hasCloud ? this.deps.defaults() : hasCloud || resolve ? joinSnapshot(chosen.values(), this.deps.defaults()) : localState.payload
        if (resolve) await this.deps.archive({ reason: 'account-library-choice', local: localState.payload, cloud: Object.values(remote), choice: resolve })
        if (payload !== localState.payload && !await this.deps.applyIfUnchanged(localState.payload, payload, signal.updatedAt)) { this.state = 'idle'; return }
        localState = await this.deps.readLocal()
        local = new Map(splitSnapshot(localState.payload).map(row => [row.key, row]))
        this.checkpoint.baseline = Object.fromEntries(Object.values(remote).map(row => [row.key, row.data]))
        this.checkpoint.initialized = true
        this.checkpoint.reviewRequired = false
        this.checkpoint.reviewToken = undefined
        await this.persist()
        resolve = undefined
      }

      const merged = new Map<string, RecordValue>()
      const baseline = { ...this.checkpoint.baseline }
      const writes: RecordWrite[] = []
      const conflicts: RecordConflict[] = []
      const keys = new Set([...local.keys(), ...Object.keys(remote), ...Object.keys(baseline)])
      const previousChoice = this.checkpoint.conflicts.find(row => row.key === key)
      const childParent = (recordKey: string) => {
        const [kind, parent] = JSON.parse(recordKey) as string[]
        return ['holding', 'option', 'ticker'].includes(kind) ? JSON.stringify(['portfolio', parent]) : undefined
      }
      // Deleting a portfolio competes with edits to its children. A choice covers that portfolio's
      // children too, and is bound to their exact versions so a stale dialog cannot discard new work.
      const groups = new Map<string, { hash: string; choice?: 'local' | 'cloud' }>()
      for (const parentKey of keys) {
        if ((local.get(parentKey)?.kind ?? remote[parentKey]?.kind) !== 'portfolio' || !baseline[parentKey]) continue
        const left = valueOf(local.get(parentKey)); const right = valueOf(remote[parentKey])
        if ((left === null) === (right === null)) continue
        const children = [...keys].filter(child => childParent(child) === parentKey).sort()
        const changed = children.some(child => (left === null ? valueOf(remote[child]) : valueOf(local.get(child))) !== (baseline[child] ?? null))
        if (!changed) continue
        const hash = digest(stableJson(children.map(child => [child, valueOf(local.get(child)), valueOf(remote[child])])) )
        const choice = resolve && key === parentKey && token === previousChoice?.token && previousChoice?.groupHash === hash && previousChoice.local === left &&
          previousChoice.cloud === right && previousChoice.revision === remote[parentKey]?.revision ? resolve : undefined
        groups.set(parentKey, { hash, choice })
      }
      for (const currentKey of keys) {
        const left = local.get(currentKey)
        const right = remote[currentKey]
        const kind = left?.kind ?? right?.kind
        if (!kind) continue
        const localValue = valueOf(left)
        const cloudValue = valueOf(right)
        const base = baseline[currentKey] ?? null
        const record = { key: currentKey, kind, data: localValue }
        const group = groups.get(childParent(currentKey) ?? '')
        if (group) {
          if (!group.choice) { merged.set(currentKey, record); continue }
          const selected = group.choice === 'local' ? localValue : cloudValue
          merged.set(currentKey, { ...record, data: selected })
          if (selected !== cloudValue) writes.push({ ...record, data: selected, expectedRevision: right?.revision ?? 0 })
          else baseline[currentKey] = selected
          continue
        }
        // Content chunks are immutable and retained until account deletion, never interpreted as user deletions.
        if (kind === 'chunk') {
          merged.set(currentKey, left ?? right)
          if (left && !right) writes.push({ ...left, expectedRevision: 0 })
          if (right) baseline[currentKey] = right.data
          continue
        }
        const parentGroup = groups.get(currentKey)
        const competing = Boolean(parentGroup) || localValue !== base && cloudValue !== base && localValue !== cloudValue
        const validChoice = parentGroup ? parentGroup.choice : resolve && currentKey === key && token === previousChoice?.token && previousChoice?.local === localValue && previousChoice.cloud === cloudValue && previousChoice.revision === right?.revision
        if (competing && !validChoice) {
          const conflict = { key: currentKey, kind, local: localValue, cloud: cloudValue, revision: right?.revision ?? 0, groupHash: parentGroup?.hash }
          conflicts.push({ ...conflict, token: digest(stableJson(conflict)) })
          merged.set(currentKey, record)
          continue
        }
        const selected = validChoice ? resolve === 'local' ? localValue : cloudValue : localValue === base ? cloudValue : localValue
        merged.set(currentKey, { ...record, data: selected })
        if (selected !== cloudValue) writes.push({ ...record, data: selected, expectedRevision: right?.revision ?? 0 })
        else baseline[currentKey] = selected
      }
      if (resolve && previousChoice && key) await this.deps.archive({ reason: 'record-conflict-choice', conflict: previousChoice, choice: resolve,
        localSnapshot: localState.payload, cloudRecords: Object.values(remote) })
      this.checkpoint.pending = writes
      this.checkpoint.conflicts = conflicts
      await this.persist() // Exact pending operations survive a crash before the network request.
      // Order dependencies with the same order as the snapshot splitter; put deletions last.
      const order = new Map(splitSnapshot(localState.payload).map((row, index) => [row.key, index]))
      const priority = (row: RecordWrite) => row.data === null ? 4 : row.kind === 'chunk' ? 0 : row.kind === 'portfolio' ? 1 : row.kind === 'article' ? 3 : 2
      writes.sort((a, b) => priority(a) - priority(b) || (order.get(a.key) ?? 1e9) - (order.get(b.key) ?? 1e9))
      for (const batch of recordBatches(writes).slice(0, 40)) {
        const result = await this.deps.push(signal.epoch, batch)
        this.metrics.sentRecords += batch.length
        this.metrics.sentBytes += utf8Bytes(JSON.stringify(batch))
        for (const row of result.records) {
          remote[row.key] = row
          baseline[row.key] = row.data
          this.checkpoint.baseline[row.key] = row.data
          this.checkpoint.pending = this.checkpoint.pending.filter(value => value.key !== row.key)
        }
        for (const row of result.conflicts) remote[row.key] = row
        await this.persist()
        if (result.conflicts.length) { this.state = 'idle'; this.pending = true; this.message = 'Another device saved changes. Sync again to review them.'; return }
      }
      const payload = joinSnapshot(merged.values(), this.deps.defaults())
      if (payload !== localState.payload && !await this.deps.applyIfUnchanged(localState.payload, payload, signal.updatedAt)) {
        this.state = 'idle'; this.pending = true; return
      }
      this.checkpoint.baseline = baseline
      this.checkpoint.lastSyncedAt = Date.now()
      await this.persist()
      const latest = await this.deps.readLocal()
      this.localUpdatedAt = latest.updatedAt
      this.pending = conflicts.length > 0 || this.checkpoint.pending.length > 0 || latest.payload !== payload
      this.state = conflicts.length ? 'conflict' : this.pending ? 'idle' : 'synced'
      if (conflicts.length) this.message = 'Different edits to the same record need your choice. Other records sync automatically. Both versions are kept until you choose.'
    } catch (error) {
      this.metrics.failures++
      this.deps.onFailure?.(error)
      this.state = 'error'
      // Only explicitly allowlisted structured service messages can reach Settings; never raw provider errors.
      const data = error instanceof ConvexError && error.data && typeof error.data === 'object' ? error.data as { code?: string } : undefined
      const messages: Record<string, string> = {
        RATE_LIMIT: 'Sync is busy. Wait a minute and retry. Local changes are saved.',
        ACCOUNT_LIMIT: 'Cloud storage is full. Export your data or contact the service operator. Local saves continue.',
        DOMAIN_LIMIT: 'This library reached the portfolio or finance row limit. Local changes are retained. Remove an unwanted record explicitly and retry sync.',
        LAST_PORTFOLIO: 'Keep at least one portfolio. Clear its holdings instead of deleting the last portfolio.',
        ACCOUNT_DELETED: 'This cloud account was deleted. Local data is retained and will not be uploaded. Disconnect to continue locally.',
        MIGRATION_CONFLICT: 'Cloud migration needs operator recovery. The original cloud snapshot and local data are preserved.',
      }
      this.message = messages[data?.code ?? ''] ?? 'Sync could not complete. Local data is safe. Check your connection and retry, or sign in again. If this continues, contact the service operator.'
    } finally {
      this.metrics.lastDurationMs = Date.now() - started
      this.deps.onFinished?.(this.state, { ...this.metrics })
    }
  }
}
