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

  const realNow = Date.now
  let clock = realNow(), quotaCalls = 0, allowWrites = false
  let quotaRemote: CloudSnapshot | null = null
  const throttled = new CloudSyncEngine({ account: 'quota-fixture', revision: 0 }, {
    readLocal: async () => ({ payload: 'pending edit', pristine: false, updatedAt: 1 }),
    readRemote: async () => quotaRemote,
    writeRemote: async () => {
      quotaCalls++
      if (!allowWrites) throw new ConvexError({ code: 'SYNC_RATE_LIMITED', retryAfterMs: 60_000, message: 'private detail' })
      return { accepted: true, revision: 1, updatedAt: clock }
    },
    applyIfUnchanged: async () => { throw Error('Quota cannot replace local work') },
    saveCheckpoint: async () => {},
  })
  try {
    Date.now = () => clock
    await throttled.sync()
    assert.equal(throttled.pending, true)
    assert.equal(throttled.state, 'error')
    assert(throttled.message?.includes('allowance') && !throttled.message.includes('private'))
    await throttled.sync()
    assert.equal(quotaCalls, 1, 'Automatic retries respect the server cooldown without another upload')
    quotaRemote = { payload: 'competing edit', revision: 1, updatedAt: clock }
    await throttled.sync()
    assert.equal(throttled.state, 'conflict', 'Write cooldown does not suppress remote changes or conflict inspection')
    quotaRemote = null
    clock += 60_001
    allowWrites = true
    await throttled.sync()
    assert.equal(quotaCalls, 2)
    assert.equal(throttled.state, 'synced', 'Pending edits resume after the quota resets')
  } finally { Date.now = realNow }

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
  const { parseCloudSnapshot, CloudSnapshotError } = await import('../electron/shared/cloudSnapshot.js')
  assert.deepEqual(parseCloudSnapshot(baseline), JSON.parse(baseline), 'Generated defaults must pass the shared wire schema without changes')
  assert.deepEqual(parseCloudSnapshot(modified), JSON.parse(modified), 'Populated articles and watchlists must round-trip')
  const legacySnapshot = JSON.parse(baseline)
  legacySnapshot.userData.version = 1
  delete legacySnapshot.userData.personalFinance
  delete legacySnapshot.userData.chartsWatchlists
  assert.doesNotThrow(() => parseCloudSnapshot(JSON.stringify(legacySnapshot)), 'Older supported snapshots remain readable')
  const malformedSnapshots: unknown[] = [null, [], true, { version: 1, userData: true, settings: true, cards: true, articles: true }]
  const malformed = (path: string, replacement: unknown) => {
    const value: Record<string, unknown> = JSON.parse(baseline)
    const parts = path.split('.')
    let target = value
    for (const part of parts.slice(0, -1)) target = target[part] as Record<string, unknown>
    target[parts.at(-1)!] = replacement
    malformedSnapshots.push(value)
  }
  malformed('userData.portfolios.portfolio_1.holdings', { SPY: { ticker: 'SPY', shares: '10', avgPrice: 1, includeInWeight: true } })
  malformed('userData.portfolios.portfolio_1.options', [{ rowId: 'broken' }])
  malformed('userData.personalFinance.cash', [{ id: 'cash', desc: '', amount: 'secret-value' }])
  malformed('userData.personalFinance.cash', [{ id: 'cash', desc: '', amount: -1 }])
  malformed('userData.personalFinance.cash', Array.from({ length: 41 }, (_, index) => ({ id: `cash-${index}`, desc: '', amount: 1 })))
  malformed('userData.activeId', 'missing')
  malformed('userData.portfolios.portfolio_1.id', 'different')
  malformed('userData.portfolios', Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`portfolio_${index}`, { ...JSON.parse(baseline).userData.portfolios.portfolio_1, id: `portfolio_${index}` }])))
  malformed('settings.time12h', 'yes')
  malformed('settings.backtestPage.rows', [{ symbol: 'SPY', weight: '100' }])
  malformed('settings.apiKey', 'secret-value')
  malformed('cards.customCards.0.weighting', 'invalid')
  const starter = JSON.parse(baseline).cards.customCards[0]
  malformed('cards.customCards', [starter, starter])
  malformed('cards.intervals', { 'builtin:index': 'bad' })
  malformed('articles.articles', [{ id: 'broken' }])
  malformed('articles.articles', Array.from({ length: 10_001 }, () => ({})))
  malformed('version', 2)
  for (const value of malformedSnapshots) assert.throws(() => parseCloudSnapshot(JSON.stringify(value)), error =>
    error instanceof CloudSnapshotError && error.code === 'SNAPSHOT_INVALID' && !error.message.includes('secret-value'))
  assert.throws(() => parseCloudSnapshot('not json'), CloudSnapshotError)
  const populated = JSON.parse(modified)
  populated.userData.portfolios.portfolio_1.holdings = { SPY: { ticker: 'SPY', shares: 10, avgPrice: 100, includeInWeight: true } }
  populated.userData.portfolios.portfolio_1.options = [{ rowId: 'option-1', ticker: 'SPY', strategy: 'Calls', expiry: '',
    strike: 100, contracts: 1, premium: 2, status: 'Open', openDate: '' }]
  populated.userData.personalFinance.cash = [{ id: 'cash-1', desc: 'Cash', amount: 100 }]
  assert.deepEqual(parseCloudSnapshot(JSON.stringify(populated)), populated, 'Populated holdings, options and finance must round-trip')
  populated.userData.activeId = 'combined'
  assert.deepEqual(parseCloudSnapshot(JSON.stringify(populated)), populated, 'The virtual combined portfolio is a valid active view')
  const duplicateFinance = structuredClone(populated)
  duplicateFinance.userData.personalFinance.debt = [...duplicateFinance.userData.personalFinance.cash]
  assert.throws(() => parseCloudSnapshot(JSON.stringify(duplicateFinance)), CloudSnapshotError)
  const oversizedLocal = JSON.parse(modified)
  oversizedLocal.articles.articles[0].content = 'x'.repeat(750_001)
  const oversizedPayload = JSON.stringify(oversizedLocal)
  assert.throws(() => parseCloudSnapshot(oversizedPayload), error => error instanceof CloudSnapshotError && error.code === 'SNAPSHOT_TOO_LARGE')
  await withSavedDataLock(() => data.importBackupData(oversizedLocal))
  assert.equal(JSON.parse(await data.readSyncData()).articles.articles[0].content.length, 750_001, 'Large local backup imports remain available without cloud sync')
  await withSavedDataLock(() => data.applySyncData(modified))
  assert.throws(() => parseCloudSnapshot('é'.repeat(375_001)), error => error instanceof CloudSnapshotError && error.code === 'SNAPSHOT_TOO_LARGE', 'The cap counts UTF-8 bytes')
  type Row = { _id: string; userId: string; revision: number; payload: string; updatedAt: number }
  const rows = new Map<string, Row>()
  type LimitRow = { _id: string; userId: string; windowStart: number; writes: number; dayStart: number; dailyBytes: number }
  const limits = new Map<string, LimitRow>()
  let owner: string | null = 'owner-a'
  let revoked = false
  const ctx = { auth: { getUserIdentity: async () => owner ? { subject: 'v2-session' } : null },
    runQuery: async (_ref: unknown, args: { sessionId: string }) => {
      assert.equal(args.sessionId, 'v2-session', 'V2 must resolve the session through the auth component')
      return owner && !revoked ? { userId: owner } : null
    }, db: {
    query: (table: string) => ({ withIndex: (_index: string, select: (q: { eq: (key: string, value: string) => void }) => void) => {
      let selected = ''
      select({ eq: (_key, value) => { selected = value } })
      return { unique: async () => table === 'syncSnapshots' ? rows.get(selected) ?? null : limits.get(selected) ?? null }
    } }),
    insert: async (table: string, value: Omit<Row, '_id'> | Omit<LimitRow, '_id'>) => {
      if (table === 'syncSnapshots') rows.set(value.userId, { ...value, _id: value.userId } as Row)
      else limits.set(value.userId, { ...value, _id: `limit:${value.userId}` } as LimitRow)
      return value.userId
    },
    replace: async (id: string, value: Omit<Row, '_id'> | Omit<LimitRow, '_id'>) => {
      if (id.startsWith('limit:')) limits.set(value.userId, { ...value, _id: id } as LimitRow)
      else rows.set(id, { ...value, _id: id } as Row)
    },
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
  assert.equal(await read(ctx, {}), null, 'Accounts must never see each otherâ€™s snapshots')
  await write(ctx, { expectedRevision: 0, payload: modified })
  owner = 'owner-a'
  assert.equal((await read(ctx, {}))?.payload, baseline)
  const laterWrite = await write(ctx, { expectedRevision: 1, payload: modified })
  assert.equal(laterWrite.revision, 2)
  assert(laterWrite.updatedAt > initialWrite.updatedAt, 'Accepted updates must have a strictly increasing server timestamp')
  assert.equal(limits.get('owner-a')!.writes, 2, 'No-op retries and stale revisions do not consume writes')
  const protectedRow = structuredClone(rows.get('owner-a'))
  const protectedLimit = structuredClone(limits.get('owner-a'))
  for (const value of malformedSnapshots) await assert.rejects(write(ctx, { expectedRevision: 2, payload: JSON.stringify(value) }))
  assert.deepEqual(rows.get('owner-a'), protectedRow, 'Malformed writes cannot replace a valid cloud copy')
  assert.deepEqual(limits.get('owner-a'), protectedLimit, 'Invalid data cannot consume the account allowance')
  const allowance = limits.get('owner-a')!
  allowance.writes = 60
  assert.equal((await write(ctx, { expectedRevision: 0, payload: modified })).accepted, true, 'An acknowledged payload remains retryable at the quota')
  assert.equal((await write(ctx, { expectedRevision: 0, payload: baseline })).accepted, false, 'Conflicts remain distinguishable at the quota')
  const isRateLimited = (error: unknown) => error instanceof ConvexError && error.data && typeof error.data === 'object'
    && !Array.isArray(error.data) && error.data.code === 'SYNC_RATE_LIMITED' && Number(error.data.retryAfterMs) > 0
  await assert.rejects(write(ctx, { expectedRevision: 2, payload: baseline }), isRateLimited)
  assert.deepEqual(rows.get('owner-a'), protectedRow)
  owner = 'owner-b'
  assert.equal((await write(ctx, { expectedRevision: 1, payload: baseline })).accepted, true, 'One account cannot consume another account allowance')
  owner = 'owner-a'
  allowance.windowStart = Date.now() - 60_001
  assert.equal((await write(ctx, { expectedRevision: 2, payload: baseline })).revision, 3)
  assert.equal(limits.get('owner-a')!.writes, 1, 'The minute allowance resets')
  limits.get('owner-a')!.dailyBytes = 100_000_000
  await assert.rejects(write(ctx, { expectedRevision: 3, payload: modified }), isRateLimited)
  limits.get('owner-a')!.dayStart = Date.now() - 24 * 60 * 60_000 - 1
  assert.equal((await write(ctx, { expectedRevision: 3, payload: modified })).revision, 4)
  assert.equal(limits.get('owner-a')!.dailyBytes, new TextEncoder().encode(modified).length, 'The daily byte allowance resets')
  await assert.rejects(write(ctx, { expectedRevision: 1, payload: 'x'.repeat(750_001) }))
  revoked = true
  await assert.rejects(read(ctx, {}), 'A signed JWT must not authorize a revoked session')
  await assert.rejects(write(ctx, { expectedRevision: 2, payload: baseline }))
  owner = null
  await assert.rejects(read(ctx, {}))
  await assert.rejects(write(ctx, { expectedRevision: 0, payload: baseline }))
  const users = await import('../convex/users.js')
  const createUser = (users.createGithubUser as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<string> })._handler
  let legacy: { userId: string } | null = { userId: 'original-owner' }
  let userExists = true
  let inserts = 0
  const migrationCtx = { db: {
    query: (table: string) => {
      assert.equal(table, 'authAccounts')
      return { withIndex: (index: string, select: (q: unknown) => void) => {
        assert.equal(index, 'providerAndAccountId')
        const filters: Record<string, string> = {}
        const q = { eq: (key: string, value: string) => { filters[key] = value; return q } }
        select(q)
        assert.deepEqual(filters, { provider: 'github', providerAccountId: 'verified-github-id' })
        return { unique: async () => legacy }
      } }
    },
    get: async (id: string) => { assert.equal(id, 'original-owner'); return userExists ? { _id: id } : null },
    insert: async (table: string, data: unknown) => { assert.equal(table, 'users'); assert.deepEqual(data, {}); inserts++; return 'new-owner' },
  } }
  const verified = { method: { name: 'github', profile: { id: 'verified-github-id', login: 'fixture', email: 'untrusted@example.invalid', emailVerified: false } } }
  assert.equal(await createUser(migrationCtx, verified), 'original-owner', 'V2 must retain the existing owner and snapshots by GitHub provider ID')
  assert.equal(inserts, 0, 'Migration must not duplicate an existing account')
  userExists = false
  await assert.rejects(createUser(migrationCtx, verified), 'A broken legacy link must not create a competing account')
  legacy = null
  assert.equal(await createUser(migrationCtx, verified), 'new-owner', 'A new GitHub account must never link by matching email or login')
  assert.equal(inserts, 1)
  owner = 'owner-a'; revoked = false
  const account = (backend.account as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler
  assert.deepEqual(await account({ ...ctx, db: { get: async () => ({ githubLogin: 'fixture', email: 'private@example.invalid' }) } }, {}),
    { userId: 'owner-a', githubLogin: 'fixture' }, 'Account settings expose only the authenticated user ID and public login')
  const updateProfile = (users.updateGithubProfile as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<null> })._handler
  await updateProfile({ db: { patch: async (id: string, fields: unknown) => {
    assert.equal(id, 'new-owner')
    assert.deepEqual(fields, { githubLogin: 'fixture' }, 'Only the public GitHub login is persisted by the sign-in hook')
  } } }, { ...verified, userId: 'new-owner' })

  console.log('PASS: shared strict snapshot validation, UTF-8 limits, large local backups, account write quotas/cooldown/reset/isolation, ownership migration, revoked sessions, offline timestamps, conflicts, retries and recovery')
} finally {
  for (const key of ['APPDATA', 'LOCALAPPDATA'] as const) {
    if (previous[key] === undefined) delete process.env[key]
    else process.env[key] = previous[key]
  }
  await rm(directory, { recursive: true, force: true })
}
