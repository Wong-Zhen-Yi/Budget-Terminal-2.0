import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { defineTestApp } from 'convex-test'
import schema from '../convex/schema.js'
import * as backend from '../convex/sync.js'
import * as authLimits from '../convex/authLimits.js'
import * as authentication from '../convex/auth.js'
import { CloudRecordEngine, newRecordCheckpoint, type RecordCheckpoint } from '../electron/services/cloudRecordEngine.js'
import { BATCH_BYTES, PAGE_RECORDS, RECORD_BYTES, joinSnapshot, recordKey, splitSnapshot, stableJson, utf8Bytes } from '../electron/shared/syncRecords.js'
import type { RecordWrite } from '../electron/shared/syncRecords.js'

const directory = await mkdtemp(join(tmpdir(), 'budget-records-'))
const previous = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = directory; process.env.LOCALAPPDATA = directory
try {
  const { defaultSyncData } = await import('../electron/services/cloudSyncData.js')
  const defaults = defaultSyncData()
  assert.equal(joinSnapshot(splitSnapshot(defaults), defaults), defaults, 'Every synced default field must round trip')
  const combined = JSON.parse(defaults)
  combined.userData.activeId = 'combined'
  assert.equal(joinSnapshot(splitSnapshot(stableJson(combined)), defaults), stableJson(combined), 'Combined portfolio selection must be preserved')
  const app = defineTestApp({ schema }).defineModules({ sync: backend, authLimits, auth: authentication })
  const t = app.createTest({ transactionLimits: true })
  const idA = await t.run(ctx => ctx.db.insert('users', {}))
  const idB = await t.run(ctx => ctx.db.insert('users', {}))
  const a = t.withIdentity({ subject: `${idA}|device` })
  const b = t.withIdentity({ subject: `${idB}|device` })
  const archives: unknown[] = []
  let online = true
  let loseReply = false
  let duringRead: (() => void) | undefined
  let transfers = 0; let batches = 0; let pages = 0
  const device = (initial: string, stored?: RecordCheckpoint, pristine = false, api = a, reviewRequired = false) => {
    let local = initial
    let saved = stored ? structuredClone(stored) : newRecordCheckpoint(String(api === a ? idA : idB), reviewRequired)
    const network = () => { if (!online) throw Error('offline') }
    const engine = new CloudRecordEngine(structuredClone(saved), {
      defaults: () => defaults,
      readLocal: async () => ({ payload: local, pristine, updatedAt: pristine ? 0 : 1234 }),
      applyIfUnchanged: async (expected, value) => { if (local !== expected) return false; local = value; pristine = false; return true },
      prepare: async () => { network(); return api.mutation(app.api.sync.prepare, {}) },
      migrate: async epoch => { network(); return api.mutation(app.api.sync.migrate, { epoch }) },
      changes: async (epoch, cursor) => {
        network()
        const result = await api.query(app.api.sync.changes, { epoch, cursor })
        assert(result.records.length <= PAGE_RECORDS)
        result.records.forEach(row => assert(utf8Bytes(row.data ?? '') <= RECORD_BYTES))
        transfers += utf8Bytes(JSON.stringify(result)); pages++
        duringRead?.(); duringRead = undefined
        return result
      },
      push: async (epoch, records) => {
        network(); assert(utf8Bytes(JSON.stringify(records)) <= BATCH_BYTES)
        batches++
        const result = await api.mutation(app.api.sync.push, { epoch, records })
        if (loseReply) { loseReply = false; throw Error('Lost response after commit') }
        return result
      },
      saveCheckpoint: async value => { saved = structuredClone(value) },
      archive: async value => { archives.push(structuredClone(value)) },
      onFailure: error => { if (online && !(error instanceof Error && error.message === 'Lost response after commit')) throw error },
    })
    return { engine, saved: () => saved, local: () => local, edit: (run: (value: any) => void) => { const value = JSON.parse(local); run(value); local = stableJson(value); pristine = false } }
  }
  const first = device(defaults, undefined, true)
  await first.engine.sync()
  assert.equal(first.engine.state, 'synced', first.engine.message ?? 'Sync failed')
  const second = device(defaults, undefined, true)
  await second.engine.sync()
  assert.equal(second.local(), first.local())
  const beforeNoop = batches
  await first.engine.sync()
  assert.equal(batches, beforeNoop, 'Unchanged libraries must not be uploaded')

  first.edit(data => { data.userData.portfolios.portfolio_1.cashBalance = 123 })
  second.edit(data => { data.userData.personalFinance.cash.push({ id: 'bank', desc: 'Savings', amount: 555 }) })
  await first.engine.sync(); await second.engine.sync(); await first.engine.sync()
  assert.equal(first.engine.state, 'synced', first.engine.message ?? 'Sync failed')
  assert.equal(second.engine.state, 'synced', second.engine.message ?? 'Sync failed')
  assert.equal(first.local(), second.local(), 'Independent financial records must merge')
  assert.equal(JSON.parse(first.local()).userData.portfolios.portfolio_1.cashBalance, 123)
  assert.equal(JSON.parse(first.local()).userData.personalFinance.cash[0].amount, 555)

  online = false
  first.edit(data => { data.userData.personalFinance.cash[0].amount = 600 })
  await first.engine.sync()
  assert.equal(first.engine.state, 'error')
  const restarted = device(first.local(), first.saved())
  online = true; loseReply = true
  await restarted.engine.sync()
  assert.equal(restarted.engine.state, 'error')
  const lost = device(restarted.local(), restarted.saved())
  await lost.engine.sync(); await second.engine.sync()
  assert.equal(lost.local(), second.local(), 'Lost replies and restarts must converge without duplicate records')
  assert.equal(JSON.parse(lost.local()).userData.personalFinance.cash.length, 1)

  lost.edit(data => { data.userData.personalFinance.cash[0].amount = 700 })
  second.edit(data => { data.userData.personalFinance.cash[0].amount = 800 })
  await lost.engine.sync(); await second.engine.sync()
  assert.equal(second.engine.state, 'conflict', second.engine.message ?? 'Sync failed')
  const conflictKey = recordKey('cash', 'bank')
  assert.equal(JSON.parse(second.engine.checkpoint.conflicts[0].local!).amount, 800)
  lost.edit(data => { data.userData.personalFinance.cash[0].amount = 900 })
  await lost.engine.sync()
  await second.engine.sync('local', conflictKey, second.engine.checkpoint.conflicts[0]?.token)
  assert.equal(second.engine.state, 'conflict', 'A stale choice must require review again')
  await second.engine.sync('local', conflictKey, second.engine.checkpoint.conflicts[0]?.token); await lost.engine.sync()
  assert.equal(second.local(), lost.local())
  assert(archives.length > 0, 'Conflict versions must be archived before a choice is applied')

  const longOffline = device(second.local(), second.saved())
  second.edit(data => { data.userData.personalFinance.cash = [] })
  await second.engine.sync(); await longOffline.engine.sync()
  assert.equal(JSON.parse(longOffline.local()).userData.personalFinance.cash.length, 0, 'Offline devices must honor permanent deletion markers')
  const editingOffline = device(lost.local(), lost.saved())
  editingOffline.edit(data => { data.userData.personalFinance.cash[0].amount = 999 })
  await editingOffline.engine.sync()
  assert.equal(editingOffline.engine.state, 'conflict', 'An offline edit competing with a deletion must be preserved for review')
  await editingOffline.engine.sync('cloud', conflictKey, editingOffline.engine.checkpoint.conflicts[0]?.token)
  assert.equal(JSON.parse(editingOffline.local()).userData.personalFinance.cash.length, 0)

  const switcher = device(lost.local(), undefined, false, b, true)
  await switcher.engine.sync()
  assert.equal(switcher.engine.state, 'review')
  const signalB = await b.query(app.api.sync.watch, {})
  assert.equal(signalB?.seq, 0, 'Account switching must not upload the previous account’s records')
  const staleImportToken = switcher.engine.checkpoint.reviewToken
  switcher.edit(data => { data.userData.portfolios.portfolio_1.cashBalance += 1 })
  await switcher.engine.sync('cloud', undefined, staleImportToken)
  assert.equal(switcher.engine.state, 'review', 'A changed local library must invalidate an import confirmation')
  await switcher.engine.sync('cloud', undefined, switcher.engine.checkpoint.reviewToken)
  assert.equal(JSON.parse(switcher.local()).userData.personalFinance.cash.length, 0)
  const importDevice = device(lost.local(), undefined, false, b, true)
  await importDevice.engine.sync(); await importDevice.engine.sync('local', undefined, importDevice.engine.checkpoint.reviewToken)
  assert.equal(importDevice.engine.state, 'synced', importDevice.engine.message ?? 'Sync failed')

  const stateA = await a.mutation(app.api.sync.prepare, {})
  const invalidCursor = device(first.local(), { ...first.saved(), cursor: stateA.seq + 1000 })
  await invalidCursor.engine.sync()
  assert.equal(invalidCursor.engine.state, 'review', 'A cursor rollback requires review before any library replacement')
  assert.equal(invalidCursor.local(), first.local())
  const stateB = await b.mutation(app.api.sync.prepare, {})
  const record = splitSnapshot(defaults).find(row => row.kind === 'portfolio')!
  const value = JSON.parse(record.data!)
  const forged: RecordWrite = { ...record, data: stableJson({ ...value, userId: idA }), expectedRevision: 0 }
  await assert.rejects(b.mutation(app.api.sync.push, { epoch: stateB.epoch, records: [forged] }), 'Forged owner fields must be rejected')
  await assert.rejects(b.query(app.api.sync.changes, { epoch: stateA.epoch, cursor: 0 }), 'Another account’s cursor/epoch cannot grant access')
  await assert.rejects(t.query(app.api.sync.changes, { epoch: stateA.epoch, cursor: 0 }), 'Anonymous reads must be rejected')
  await assert.rejects(t.mutation(app.api.sync.push, { epoch: stateA.epoch, records: [{ ...record, expectedRevision: 0 }] }))
  const secretParent = { ...record, key: recordKey('portfolio', 'only-a'), data: stableJson({ ...value, id: 'only-a' }), expectedRevision: 0 }
  await a.mutation(app.api.sync.push, { epoch: stateA.epoch, records: [secretParent] })
  const child = { kind: 'holding' as const, key: recordKey('holding', 'only-a', 'SPY'), data: stableJson({ portfolioId: 'only-a', ticker: 'SPY', shares: 1, avgPrice: 100, includeInWeight: true }), expectedRevision: 0 }
  await assert.rejects(b.mutation(app.api.sync.push, { epoch: stateB.epoch, records: [child] }), 'Cross-account parent references must be rejected')
  const guessed = { ...secretParent, expectedRevision: 1, data: null }
  await assert.rejects(b.mutation(app.api.sync.push, { epoch: stateB.epoch, records: [guessed] }))
  assert((await a.query(app.api.sync.changes, { epoch: stateA.epoch, cursor: stateA.seq })).records.some(row => row.key === secretParent.key && row.data !== null))
  await assert.rejects(a.mutation(app.api.sync.write, { expectedRevision: 0, payload: defaults }), 'Old clients must be gated')
  await assert.rejects(a.mutation(app.api.sync.push, { epoch: stateA.epoch, records: Array.from({ length: 17 }, () => ({ ...record, expectedRevision: 0 })) }))
  await assert.rejects(a.mutation(app.api.sync.push, { epoch: stateA.epoch, records: [{ ...record, data: 'x'.repeat(RECORD_BYTES + 1), expectedRevision: 0 }] }))
  const beforeDomainLimit = await a.query(app.api.sync.watch, {})
  await assert.rejects(a.mutation(app.api.sync.push, { epoch: stateA.epoch, records: Array.from({ length: 4 }, (_, index) => ({
    ...record, key: recordKey('portfolio', `quota-${index}`), data: stableJson({ ...value, id: `quota-${index}` }), expectedRevision: 0,
  })) }), /limit/)
  assert.equal((await a.query(app.api.sync.watch, {}))?.seq, beforeDomainLimit?.seq, 'A rejected domain batch must roll back all its writes')
  const rateRow = await t.run(ctx => ctx.db.query('syncAccounts').withIndex('by_user', q => q.eq('userId', idA)).unique())
  await t.run(ctx => ctx.db.patch(rateRow!._id, { writes: 600, windowStart: Date.now() }))
  await assert.rejects(a.mutation(app.api.sync.push, { epoch: stateA.epoch, records: [{ ...record, expectedRevision: 0 }] }), /busy/)
  await t.run(ctx => ctx.db.patch(rateRow!._id, { writes: 0 }))
  for (let attempt = 0; attempt < 11; attempt++) assert.equal((await t.action(app.api.auth.signIn, { params: { email: 'rate-test@example.invalid', code: 'INVALID' }, verifier: 'fixture' })).tokens, null)
  const failedSignIns = await t.run(ctx => ctx.db.query('authRateLimits').collect())
  assert(failedSignIns.some(row => row.attemptsLeft < 1), 'Failed sign-in attempts must exercise the configured Auth limit')

  const migrationId = await t.run(ctx => ctx.db.insert('users', {}))
  const migrationApi = t.withIdentity({ subject: `${migrationId}|device` })
  const library = JSON.parse(defaults)
  // Unique article chunks, option rows, all finance domains and watchlists exceed the old package limit.
  library.userData.portfolios.portfolio_1.holdings.SPY = { ticker: 'SPY', shares: 3, avgPrice: 400, includeInWeight: true }
  library.userData.portfolios.portfolio_1.tickers = ['SPY']
  library.userData.portfolios.portfolio_1.options = [{ rowId: 'option-1', ticker: 'SPY', strategy: 'Calls', expiry: '2027-01-01', strike: 500, contracts: 1, premium: 2, status: 'Open', openDate: '2026-01-01' }]
  library.userData.personalFinance.debt = [{ id: 'loan', desc: 'Loan', amount: 42 }]
  library.userData.personalFinance.recurringBills = [{ id: 'bill', desc: 'Bill', amount: 12, frequency: 'monthly', currency: 'SGD' }]
  library.userData.chartsWatchlists.watchlist = ['SPY', 'QQQ']
  for (let index = 0; index < 12; index++) library.articles.articles.push({ id: `article-${index}`, title: `Article ${index}`, topic: 'Research', content: Array.from({ length: 9000 }, (_, row) => `${index}:${row}: saved article text 🧪\n`).join(''), status: 'draft', createdAt: index, updatedAt: index, revision: 1 })
  const large = stableJson(library)
  assert(utf8Bytes(large) > 750_000)
  assert.equal(joinSnapshot(splitSnapshot(large), defaults), large, 'Every saved field, including Unicode article text, must round trip')
  // Old snapshots had a 750 KB cap; migrate a realistic smaller library with interruption.
  const legacyLibrary = stableJson({ ...library, articles: { articles: library.articles.articles.slice(0, 2) } })
  await t.run(ctx => ctx.db.insert('syncSnapshots', { userId: migrationId, revision: 7, payload: legacyLibrary, updatedAt: 12345 }))
  let migration = await migrationApi.mutation(app.api.sync.prepare, {})
  assert.equal(migration.migrated, false)
  await migrationApi.mutation(app.api.sync.migrate, { epoch: migration.epoch })
  assert.equal((await migrationApi.mutation(app.api.sync.prepare, {})).migrated, false, 'An interrupted migration must not mark completion')
  for (let count = 0; !migration.migrated && count < 100; count++) migration = await migrationApi.mutation(app.api.sync.migrate, { epoch: migration.epoch })
  assert(migration.migrated)
  assert.equal((await migrationApi.query(app.api.sync.read, {}))?.payload, legacyLibrary, 'Original snapshot must remain preserved')
  const migratedDevice = device(defaults, undefined, true, migrationApi)
  await migratedDevice.engine.sync()
  assert.equal(migratedDevice.engine.state, 'synced', migratedDevice.engine.message ?? 'Sync failed')
  assert.equal(migratedDevice.local(), legacyLibrary)
  await migrationApi.mutation(app.api.sync.migrate, { epoch: migration.epoch })
  assert.equal((await migrationApi.query(app.api.sync.watch, {}))?.seq, migration.seq, 'Migration retries must not duplicate records')

  const started = performance.now()
  migratedDevice.edit(data => { data.articles = library.articles })
  await t.run(async ctx => {
    const row = await ctx.db.query('syncAccounts').withIndex('by_user', q => q.eq('userId', migrationId)).unique()
    await ctx.db.patch(row!._id, { writes: 0 })
  })
  await migratedDevice.engine.sync()
  assert.equal(migratedDevice.engine.state, 'synced', migratedDevice.engine.message ?? 'Sync failed')
  const largeFresh = device(defaults, undefined, true, migrationApi)
  await largeFresh.engine.sync()
  assert.equal(largeFresh.engine.state, 'synced', largeFresh.engine.message ?? 'Sync failed')
  assert.equal(largeFresh.local(), large)
  duringRead = () => largeFresh.edit(data => { data.settings.time12h = false })
  migratedDevice.edit(data => { data.settings.clockCountry = 'US' })
  await migratedDevice.engine.sync(); await largeFresh.engine.sync()
  assert.equal(JSON.parse(largeFresh.local()).settings.time12h, false, 'Network reads cannot overwrite edits made during download')
  await largeFresh.engine.sync(); await migratedDevice.engine.sync()
  assert.equal(largeFresh.local(), migratedDevice.local())

  migratedDevice.edit(data => {
    data.userData.portfolios.other = { ...data.userData.portfolios.portfolio_1, id: 'other', name: 'Other portfolio', tickers: [], holdings: {}, options: [] }
    data.userData.order.push('other')
  })
  await migratedDevice.engine.sync()
  const deletingPortfolio = device(migratedDevice.local(), migratedDevice.saved(), false, migrationApi)
  const editingHolding = device(migratedDevice.local(), migratedDevice.saved(), false, migrationApi)
  deletingPortfolio.edit(data => { delete data.userData.portfolios.portfolio_1; data.userData.order = []; data.userData.activeId = null; data.userData.mainId = null })
  editingHolding.edit(data => { data.userData.portfolios.portfolio_1.holdings.SPY.shares = 99 })
  await deletingPortfolio.engine.sync(); await editingHolding.engine.sync()
  assert.equal(editingHolding.engine.state, 'conflict', 'Deleting a portfolio must conflict with unsynced holding edits')
  assert.equal(JSON.parse(editingHolding.local()).userData.portfolios.portfolio_1.holdings.SPY.shares, 99)
  const parentKey = recordKey('portfolio', 'portfolio_1')
  await editingHolding.engine.sync('local', parentKey, editingHolding.engine.checkpoint.conflicts.find(row => row.key === parentKey)?.token)
  assert.equal(editingHolding.engine.state, 'synced', editingHolding.engine.message ?? 'Portfolio restoration failed')
  assert.equal(JSON.parse(editingHolding.local()).userData.portfolios.portfolio_1.holdings.SPY.shares, 99)
  await deletingPortfolio.engine.sync()
  assert.equal(deletingPortfolio.local(), editingHolding.local(), 'Explicit portfolio restoration must converge')

  const exported = await migrationApi.query(app.api.sync.exportInfo, {})
  assert.equal(exported.legacySnapshot?.payload, legacyLibrary)
  assert(exported.storageBytes > 750_000)
  assert(!JSON.stringify(exported).includes('refreshToken'), 'Account exports must exclude credentials')

  await b.mutation(app.api.sync.deleteAccount, { confirmation: 'DELETE MY ACCOUNT' })
  await assert.rejects(b.query(app.api.sync.changes, { epoch: stateB.epoch, cursor: 0 }))
  await assert.rejects(b.mutation(app.api.sync.push, { epoch: stateB.epoch, records: [{ ...record, expectedRevision: 0 }] }), 'An old connected device cannot re-upload deleted data')
  assert(await a.query(app.api.sync.watch, {}), 'Deleting one account cannot affect another account')
  await t.finishAllScheduledFunctions(() => {}, 1000)
  const remaining = await t.run(ctx => ctx.db.query('syncRecords').withIndex('by_user_seq', q => q.eq('userId', idB)).collect())
  assert.equal(remaining.length, 0)
  console.log(`PASS: record isolation, ownership/reference attacks, two-device/offline/restart/lost-reply convergence, conflicts, deletions, account switching/deletion, resumable migration, quotas and failed sign-in budgets. Synthetic library ${utf8Bytes(large)} bytes; ${batches} bounded writes, ${pages} pages, ${transfers} response bytes; large-library round trip ${Math.round(performance.now() - started)} ms. In-memory measurements are not production capacity or cost.`)
} finally {
  for (const key of ['APPDATA', 'LOCALAPPDATA'] as const) {
    if (previous[key] === undefined) delete process.env[key]
    else process.env[key] = previous[key]
  }
  await rm(directory, { recursive: true, force: true })
}
