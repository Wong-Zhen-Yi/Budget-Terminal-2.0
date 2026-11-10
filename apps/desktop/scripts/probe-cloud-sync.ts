import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CloudSyncEngine, type SyncCheckpoint } from '../electron/services/cloudSyncEngine.js'
import { ConvexError } from 'convex/values'
import type { CloudSnapshot } from '../electron/shared/cloudSync.js'

const directory = await mkdtemp(join(tmpdir(), 'budget-cloud-sync-'))
const previous = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
try {
  let remote: CloudSnapshot | null = null
  let online = true
  let duringRead: (() => void) | undefined
  let duringWrite: (() => void) | undefined
  let serverTime = 1000
  const device = (initial: string, stored?: SyncCheckpoint, pristine = false, updatedAt = Date.now()) => {
    let local = initial
    let saved: SyncCheckpoint | undefined = stored
    const engine = new CloudSyncEngine(stored ?? { account: 'fixture', revision: 0 }, {
      readLocal: async () => ({ payload: local, pristine, updatedAt }),
      applyIfUnchanged: async (expected, payload, serverUpdatedAt) => {
        if (local !== expected) return false
        local = payload; pristine = false; updatedAt = serverUpdatedAt
        return true
      },
      readRemote: async () => {
        if (!online) throw Error('offline')
        const snapshot = remote ? { ...remote } : null
        duringRead?.(); duringRead = undefined
        return snapshot
      },
      writeRemote: async (expected, payload) => {
        duringWrite?.(); duringWrite = undefined
        if (!online) throw Error('offline')
        if ((remote?.revision ?? 0) !== expected) return { accepted: false, revision: remote?.revision ?? 0, updatedAt: remote?.updatedAt ?? 0 }
        remote = { revision: expected + 1, payload, updatedAt: ++serverTime }
        return { accepted: true, revision: remote.revision, updatedAt: remote.updatedAt }
      },
      saveCheckpoint: async value => { saved = structuredClone(value) },
    })
    return { engine, edit: (value: string) => { local = value; pristine = false; updatedAt++ }, local: () => local, saved: () => saved }
  }
  const first = device('original')
  await first.engine.sync()
  assert.equal(first.engine.state, 'synced')
  const fresh = device('factory defaults', undefined, true)
  await fresh.engine.sync()
  assert.equal(fresh.local(), 'original', 'A fresh device must automatically download the newest server snapshot')
  assert.equal(fresh.engine.state, 'synced')
  assert.equal(fresh.saved()?.cloudUpdatedAt, remote!.updatedAt, 'Checkpoints must preserve the server data timestamp')
  const second = device('new device')
  await second.engine.sync()
  assert.equal(second.engine.state, 'conflict', 'First connection must not overwrite local or cloud data')
  assert.equal(second.local(), 'new device')
  await second.engine.sync('cloud')
  assert.equal(second.local(), 'original')
  first.edit('first edit')
  await first.engine.sync()
  await second.engine.sync()
  assert.equal(second.local(), 'first edit', 'A device with no local edits must receive cloud updates')

  online = false
  first.edit('offline edit')
  await first.engine.sync()
  assert.equal(first.engine.state, 'error')
  assert.equal(first.local(), 'offline edit')
  const restarted = device(first.local(), first.saved())
  online = true
  await restarted.engine.sync()
  assert.equal(restarted.engine.state, 'synced', 'Pending edits must survive process restarts')
  assert.equal(remote!.payload, 'offline edit')
  const latestNewMachine = device('new factory defaults', undefined, true, Date.now() + 86_400_000)
  await latestNewMachine.engine.sync()
  assert.equal(latestNewMachine.local(), 'offline edit', 'A new machine must fetch the newest uploaded edit even when its clock is ahead')
  assert.equal(latestNewMachine.saved()?.cloudUpdatedAt, remote!.updatedAt)
  second.edit('competing edit')
  await second.engine.sync()
  assert.equal(second.engine.state, 'conflict')
  assert.equal(second.local(), 'competing edit')
  restarted.edit('even newer edit')
  await restarted.engine.sync()
  await second.engine.sync('local')
  assert.equal(second.engine.state, 'conflict', 'A choice made against a stale cloud revision must be reconfirmed')
  assert.equal(remote!.payload, 'even newer edit')
  await second.engine.sync('local')
  assert.equal(remote!.payload, 'competing edit')
  duringRead = () => restarted.edit('typed during download')
  await restarted.engine.sync()
  assert.equal(restarted.local(), 'typed during download', 'Network reads must not overwrite new local edits')
  assert.equal(restarted.engine.pending, true)

  const racer = device(remote!.payload)
  await racer.engine.sync()
  racer.edit('race edit')
  duringWrite = () => { remote = { payload: 'another device won', revision: remote!.revision + 1, updatedAt: ++serverTime } }
  await racer.engine.sync()
  assert.equal(remote!.payload, 'another device won', 'Compare-and-set must preserve a concurrent remote write')
  assert.equal(racer.engine.pending, true)
  await racer.engine.sync()
  assert.equal(racer.engine.state, 'conflict')
  const newest = remote!
  const staleReader = device(newest.payload, { account: 'fixture', baseline: newest.payload, revision: newest.revision, cloudUpdatedAt: newest.updatedAt })
  remote = { payload: 'outdated snapshot', revision: newest.revision - 1, updatedAt: newest.updatedAt - 1 }
  await staleReader.engine.sync()
  assert.equal(staleReader.local(), newest.payload, 'An older server revision must never replace the last acknowledged data')
  assert.equal(staleReader.engine.state, 'error')
  remote = newest

  const incompatible = new CloudSyncEngine({ account: 'fixture', revision: 0 }, {
    readLocal: async () => ({ payload: 'pending edit', pristine: false, updatedAt: 1 }),
    readRemote: async () => null,
    writeRemote: async () => { throw new ConvexError({ code: 'UPGRADE_REQUIRED', message: 'private provider details', token: 'private-fixture-token' }) },
    applyIfUnchanged: async () => { throw Error('A rejected upload must not replace local data') },
    saveCheckpoint: async () => { throw Error('A rejected upload must not be acknowledged') },
  })
  await incompatible.sync()
  assert.equal(incompatible.state, 'error')
  assert.equal(incompatible.pending, true)
  assert(incompatible.message?.includes('snapshot-sync backend'), 'A record-only backend must report the configuration mismatch')
  assert(!incompatible.message?.includes('private'), 'Provider details must not reach the UI')

  const data = await import('../electron/services/cloudSyncData.js')
  const { withSavedDataLock, withAutomaticBackup } = await import('../electron/services/automaticBackup.js')
  const { mutateSettings } = await import('../electron/services/settingsStore.js')
  const { mutateArticles } = await import('../electron/services/articlesStore.js')
  const { mutatePortfolios, readPortfolios } = await import('../electron/services/portfolioStore.js')
  const { ok } = await import('../electron/shared/envelope.js')
  const baseline = await withSavedDataLock(data.readSyncData)
  const freshLocal = await withSavedDataLock(data.readLocalSyncData)
  assert.equal(freshLocal.pristine, true, 'Generated defaults must not be mistaken for newer user work')
  assert.equal(freshLocal.updatedAt, 0)
  assert(!baseline.includes(directory), 'Snapshots must exclude device paths')
  await withAutomaticBackup(async () => ok(await mutateSettings({ type: 'setTime12h', value: false })))
  await withAutomaticBackup(async () => ok(await mutateArticles({ type: 'add', title: 'Fixture', topic: '', content: 'Offline work', status: 'draft' })))
  const chartsWatchlists = { watchlist: ['SPY', 'QQQ'], multiCustomSymbols: ['MSFT'], multiOrder: ['MSFT'] }
  await withAutomaticBackup(async () => ok(await mutatePortfolios({ type: 'setChartsWatchlists', value: chartsWatchlists })))
  const modified = await withSavedDataLock(data.readSyncData)
  assert.deepEqual(JSON.parse(modified).userData.chartsWatchlists, chartsWatchlists)
  const editedLocal = await withSavedDataLock(data.readLocalSyncData)
  assert.equal(editedLocal.pristine, false)
  assert(editedLocal.updatedAt > 0, 'Offline saves must record their edit time without a cloud connection')
  assert.equal((await data.readLocalSyncData()).updatedAt, editedLocal.updatedAt, 'Reading or retrying must not bump the edit time')
  await withAutomaticBackup(async () => ok(await mutateSettings({ type: 'setTime12h', value: true })))
  assert.equal((await data.readLocalSyncData()).pristine, false, 'Returning a setting to its default must not reset device history')
  await withAutomaticBackup(async () => ok(await mutateSettings({ type: 'setTime12h', value: false })))
  assert.notEqual(modified, baseline)
  await withSavedDataLock(() => data.applySyncData(baseline, 123456789))
  assert.equal((await data.readLocalSyncData()).updatedAt, 123456789, 'A download must retain its server timestamp')
  assert.equal(await data.readSyncData(), baseline, 'Downloading must round-trip all stores without spurious edits')
  assert.deepEqual((await readPortfolios()).chartsWatchlists, { watchlist: [], multiCustomSymbols: [], multiOrder: [] })
  const backups = await readdir(data.cloudDataPath('sync-backups'))
  const { app, exportedAt, ...recoveryCopy } = JSON.parse(await readFile(join(data.cloudDataPath('sync-backups'), backups[0]), 'utf8'))
  assert.equal(app, 'budget-terminal-electron')
  assert(Number.isFinite(Date.parse(exportedAt)))
  assert.equal(data.canonical(recoveryCopy), modified)
  const invalid = JSON.parse(baseline)
  invalid.articles = { articles: [{ id: 'broken' }] }
  await assert.rejects(withSavedDataLock(() => data.applySyncData(JSON.stringify(invalid))))
  assert.equal(await data.readSyncData(), baseline, 'Invalid remote stores must be rejected before changing any local file')
  await data.atomicSyncFile(data.cloudDataPath('sync-apply-journal.json'), { before: modified })
  await withSavedDataLock(data.recoverSyncData)
  assert.equal(await data.readSyncData(), modified, 'An interrupted multi-store download must recover on startup')

  // Exercise the actual Convex handlers with an isolated in-memory database.
  const backend = await import('../convex/sync.js')
  type Row = { _id: string; userId: string; revision: number; payload: string; updatedAt: number }
  const rows = new Map<string, Row>()
  let owner: string | null = 'owner-a'
  const ctx = { auth: { getUserIdentity: async () => owner ? { subject: `${owner}|session` } : null }, db: {
    query: () => ({ withIndex: (_index: string, select: (q: { eq: (key: string, value: string) => void }) => void) => {
      let selected = ''
      select({ eq: (_key, value) => { selected = value } })
      return { unique: async () => [...rows.values()].find(row => row.userId === selected) ?? null }
    } }),
    insert: async (_table: string, value: Omit<Row, '_id'>) => { rows.set(value.userId, { ...value, _id: value.userId }); return value.userId },
    replace: async (id: string, value: Omit<Row, '_id'>) => { rows.set(id, { ...value, _id: id }) },
  } }
  const read = (backend.read as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<CloudSnapshot | null> })._handler
  const write = (backend.write as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<{ accepted: boolean; revision: number; updatedAt: number }> })._handler
  const initialWrite = await write(ctx, { expectedRevision: 0, payload: baseline })
  assert.equal(initialWrite.accepted, true)
  assert.equal(initialWrite.revision, 1)
  assert(initialWrite.updatedAt > 0)
  assert.deepEqual(await write(ctx, { expectedRevision: 0, payload: baseline }), initialWrite, 'Lost responses must not change the data timestamp')
  assert.deepEqual(await write(ctx, { expectedRevision: 0, payload: modified }), { accepted: false, revision: 1, updatedAt: initialWrite.updatedAt })
  assert.equal((await read(ctx, {}))?.updatedAt, initialWrite.updatedAt)
  owner = 'owner-b'
  assert.equal(await read(ctx, {}), null, 'Accounts must never see each other’s snapshots')
  await write(ctx, { expectedRevision: 0, payload: modified })
  owner = 'owner-a'
  assert.equal((await read(ctx, {}))?.payload, baseline)
  const laterWrite = await write(ctx, { expectedRevision: 1, payload: modified })
  assert.equal(laterWrite.revision, 2)
  assert(laterWrite.updatedAt > initialWrite.updatedAt, 'Accepted updates must have a strictly increasing server timestamp')
  await assert.rejects(write(ctx, { expectedRevision: 1, payload: 'x'.repeat(750_001) }))
  owner = null
  await assert.rejects(read(ctx, {}))
  await assert.rejects(write(ctx, { expectedRevision: 0, payload: baseline }))
  console.log('PASS: automatic fresh-device restore, persisted offline timestamps, monotonic server timestamps, stale-revision protection, two-device sync, conflicts, retries, account isolation, backups and interrupted-download recovery')
} finally {
  for (const key of ['APPDATA', 'LOCALAPPDATA'] as const) {
    if (previous[key] === undefined) delete process.env[key]
    else process.env[key] = previous[key]
  }
  await rm(directory, { recursive: true, force: true })
}
