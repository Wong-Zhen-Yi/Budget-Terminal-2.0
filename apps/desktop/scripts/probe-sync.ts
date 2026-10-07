import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { SyncEngine } from '../electron/services/syncEngine.js'
import type { CloudDocument, SyncCheckpoint, SyncAdapter } from '../electron/services/syncEngine.js'
import { SYNC_DATASETS } from '../electron/shared/sync.js'
import type { SyncDataset } from '../electron/shared/sync.js'

const directory = await mkdtemp(join(tmpdir(), 'budget-sync-'))
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory

try {
  const book = await import('../electron/services/portfolioStore.js')
  const cards = await import('../electron/services/cardsStore.js')
  const local = new Map<SyncDataset, unknown>()
  for (const dataset of SYNC_DATASETS) local.set(dataset,
    dataset === 'cards' ? await cards.exportCards() : await book.readSyncBook(dataset))
  const remote = new Map<SyncDataset, CloudDocument>()
  let persisted: SyncCheckpoint | undefined
  let online = true
  let failSave = false
  let racePush = false
  let pushes = 0
  const adapter: SyncAdapter = {
    async read(dataset) { return structuredClone(local.get(dataset)) },
    async apply(dataset, value, expected) {
      assert.deepEqual(local.get(dataset), expected)
      local.set(dataset, structuredClone(value))
    },
    async fetch() {
      if (!online) throw new Error('offline')
      return structuredClone([...remote.values()])
    },
    async push(dataset, payload, revision) {
      if (racePush) { racePush = false; throw new Error('revision conflict') }
      assert.equal(remote.get(dataset)?.revision ?? 0, revision)
      pushes++
      const row = { dataset, payload: structuredClone(payload), revision: revision + 1, updated_at: new Date().toISOString() }
      remote.set(dataset, row)
      return structuredClone(row)
    },
    async save(value) {
      if (failSave) throw new Error('disk failure')
      persisted = structuredClone(value)
    },
  }
  let engine = new SyncEngine({ owner: 'test-owner', bases: {} }, adapter)
  await engine.run()
  assert.equal(remote.size, 3)
  assert.equal(engine.pending.length, 0)
  assert.ok(persisted?.lastSyncedAt)

  // Separate changes on two PCs do not conflict across datasets.
  const changedPortfolio = { ...(local.get('portfolio') as object), mainId: 'changed-local' }
  local.set('portfolio', changedPortfolio)
  const cloudFinance = { ...(remote.get('personalFinance')!.payload as object), totalsCurrency: 'USD' }
  remote.set('personalFinance', { ...remote.get('personalFinance')!, payload: cloudFinance, revision: 2 })
  await engine.run()
  assert.deepEqual(local.get('personalFinance'), cloudFinance)
  assert.deepEqual(remote.get('portfolio')!.payload, changedPortfolio)

  online = false
  local.set('cards', { ...(local.get('cards') as object), cardOrder: [] })
  await assert.rejects(engine.run(), /offline/)
  engine = new SyncEngine(structuredClone(persisted!), adapter)
  await engine.inspect()
  assert.deepEqual(engine.pending, ['cards'])
  online = true
  await engine.run()
  assert.equal(engine.pending.length, 0)

  // Both PCs edited the same dataset: review before either copy is overwritten.
  local.set('personalFinance', { ...cloudFinance, cash: [{ id: 'local', desc: 'Local', amount: 1 }] })
  remote.set('personalFinance', { ...remote.get('personalFinance')!, revision: 3, payload: { ...cloudFinance, debt: [{ id: 'remote', desc: 'Remote', amount: 2 }] } })
  const localBeforeConflict = structuredClone(local.get('personalFinance'))
  await engine.run()
  assert.equal(engine.conflicts.length, 1)
  assert.deepEqual(local.get('personalFinance'), localBeforeConflict)
  await engine.run({ dataset: 'personalFinance', choice: 'local', token: engine.conflicts[0].token })
  assert.equal(engine.conflicts.length, 0)
  assert.deepEqual(remote.get('personalFinance')!.payload, localBeforeConflict)

  local.set('cards', { ...(local.get('cards') as object), hiddenPortfolioIds: ['local'] })
  const remoteCards = { ...(remote.get('cards')!.payload as object), intervals: { 'builtin:index': '1y' } }
  remote.set('cards', { ...remote.get('cards')!, payload: remoteCards, revision: 3 })
  await engine.run()
  assert.equal(engine.conflicts[0].dataset, 'cards')
  // A stale conflict button cannot overwrite a newer local edit.
  local.set('cards', { ...remoteCards, hiddenPortfolioIds: ['changed-again'] })
  await assert.rejects(engine.run({ dataset: 'cards', choice: 'cloud', token: engine.conflicts[0].token }), /copies changed/)
  await engine.run()
  await assert.rejects(engine.run({ dataset: 'cards', choice: 'cloud', token: 'stale-ui-token' }), /conflict changed/)
  await engine.run({ dataset: 'cards', choice: 'cloud', token: engine.conflicts[0].token })
  assert.deepEqual(local.get('cards'), remoteCards)

  local.set('portfolio', { ...changedPortfolio, order: ['new'] })
  racePush = true
  await assert.rejects(engine.run(), /revision conflict/)
  await engine.inspect()
  assert.ok(engine.pending.includes('portfolio'))
  await engine.run()

  // Server accepted an upload but the PC crashed before saving its acknowledgement.
  const beforeCrash = structuredClone(persisted!)
  local.set('personalFinance', { ...cloudFinance, cash: [], debt: [], recurringBills: [] })
  failSave = true
  await assert.rejects(engine.run(), /disk failure/)
  failSave = false
  const pushesBeforeRecovery = pushes
  engine = new SyncEngine(beforeCrash, adapter)
  await engine.run()
  assert.equal(pushes, pushesBeforeRecovery, 'An accepted upload was unnecessarily replayed')
  assert.equal(engine.pending.length, 0)

  // A second PC with existing divergent records must choose explicitly.
  local.set('portfolio', { ...changedPortfolio, mainId: 'second-pc' })
  engine = new SyncEngine({ owner: 'test-owner', bases: {} }, adapter)
  await engine.run()
  assert.ok(engine.conflicts.some((item) => item.dataset === 'portfolio'))

  // Real store projection excludes file paths, active page state, and market data.
  const portfolio = await book.readSyncBook('portfolio')
  assert.deepEqual(Object.keys(portfolio as object).sort(), ['mainId', 'order', 'portfolios', 'version'])
  const finance = await book.readSyncBook('personalFinance')
  const cardPayload = await cards.exportCards()
  assert.ok(!JSON.stringify([portfolio, finance, cardPayload]).includes('sourcePath'))
  assert.throws(() => book.syncPortfolioSchema.parse({ ...(portfolio as object), settings: {} }))
  assert.throws(() => cards.syncCardsSchema.parse({ ...(cardPayload as object), prices: {} }))
  assert.throws(() => book.syncFinanceSchema.parse({ ...(finance as object), cash: 'broken' }))

  // Downloading and a rapid local edit share the store queue.
  const first = (await book.readPortfolios()).portfolios[0]
  const editing = book.mutatePortfolios({ type: 'setCash', portfolioId: first.id, cashBalance: 123 })
  await assert.rejects(book.applySyncBook('portfolio', portfolio, portfolio), /Local data changed/)
  await editing
  assert.equal((await book.readPortfolios()).portfolios[0].cashBalance, 123)
  const newBaseline = await book.readSyncBook('portfolio')
  await book.applySyncBook('portfolio', portfolio, newBaseline)
  assert.ok((await readdir(join(directory, 'BudgetTerminalElectron'))).some((file) => file.includes('before-sync')))
  assert.equal((await book.readPortfolios()).portfolios[0].cashBalance, 0)

  const cardEditing = cards.mutateCards({ type: 'setInterval', id: 'builtin:index', interval: '1y' })
  await assert.rejects(cards.applySyncCards(cardPayload, cardPayload), /Local cards changed/)
  await cardEditing
  const updatedCards = await cards.exportCards()
  await cards.applySyncCards(cardPayload, updatedCards)
  assert.deepEqual(await cards.exportCards(), cardPayload)

  // A clear is a synced empty document, not removal of the remote checkpoint.
  await book.clearUserData()
  await cards.clearCards()
  assert.deepEqual((await cards.exportCards() as { customCards: unknown[] }).customCards, [])
  assert.equal((await book.readPersonalFinance()).cash.length, 0)
  const disk = JSON.parse(await readFile(book.storePath(), 'utf8'))
  assert.ok(isDeepStrictEqual(disk.personalFinance, await book.readSyncBook('personalFinance')))
  console.log('PASS: initial seed, independent datasets, offline restart, conflicts, stale choices, revision races, crash recovery, strict payloads, serialized downloads, backups and clear')
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
