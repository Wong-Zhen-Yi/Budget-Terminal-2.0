import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import type { Envelope } from '../electron/shared/contract.js'

const scratch = await mkdtemp(join(tmpdir(), 'budget-backup-'))
process.env.APPDATA = join(scratch, 'roaming')
process.env.LOCALAPPDATA = join(scratch, 'local')
const downloads = join(scratch, 'Downloads')
const { configureAutomaticBackup, initializeAutomaticBackup, automaticBackupStatus, flushAutomaticBackup } =
  await import('../electron/services/automaticBackup.js')
const { yahooProvider: provider } = await import('../electron/services/provider.js')
const { exportUserData, storePath } = await import('../electron/services/portfolioStore.js')
const { exportSettings } = await import('../electron/services/settingsStore.js')
const { exportCards } = await import('../electron/services/cardsStore.js')
configureAutomaticBackup(downloads)
const backup = join(downloads, 'budget-terminal-backup.json')

function succeeded<T>(result: Envelope<T>): void {
  assert.deepEqual(result.errors, [], result.meta.failureReason ?? 'Expected a successful save')
}

async function snapshot() {
  return JSON.parse(await readFile(backup, 'utf8'))
}

async function checkComplete(): Promise<void> {
  const bundle = await snapshot()
  assert.equal(bundle.app, 'budget-terminal-electron')
  assert.equal(bundle.version, 1)
  assert.ok(Number.isFinite(Date.parse(bundle.exportedAt)))
  assert.deepEqual(bundle.userData, await exportUserData())
  assert.deepEqual(bundle.settings, await exportSettings())
  assert.deepEqual(bundle.cards, await exportCards())
  assert.deepEqual(await readdir(downloads), ['budget-terminal-backup.json'])
}

try {
  await initializeAutomaticBackup()
  await checkComplete()
  const portfolioId = (await provider.portfolio()).data.mainId!
  succeeded(await provider.mutatePortfolio({ type: 'addPosition', portfolioId, ticker: 'TEST' }))
  succeeded(await provider.mutatePortfolio({ type: 'setPosition', portfolioId, ticker: 'TEST', shares: 9 }))
  assert.equal((await snapshot()).userData.portfolios[portfolioId].holdings.TEST.shares, 9)
  succeeded(await provider.mutatePersonalFinance({ type: 'addEntry', category: 'cash' }))
  const entryId = (await provider.personalFinance()).data.cash[0].id
  succeeded(await provider.mutatePersonalFinance({ type: 'setEntry', category: 'cash', id: entryId, amount: 456 }))
  assert.equal((await snapshot()).userData.personalFinance.cash[0].amount, 456)
  succeeded(await provider.mutateCards({ type: 'add', name: 'Backup card', symbols: ['TEST'], weighting: 'equal', weights: {} }))
  assert.ok((await snapshot()).cards.customCards.some((card: { name: string }) => card.name === 'Backup card'))
  succeeded(await provider.mutateSettings({ type: 'setClockCountry', code: 'SG' }))
  assert.equal((await snapshot()).settings.clockCountry, 'SG')
  assert.ok((await provider.settings()).data.automaticBackup?.savedAt)

  // Edits across different stores and manual export must not publish an older final snapshot.
  const edits = Array.from({ length: 20 }, (_, index) => provider.mutatePortfolio({ type: 'setCash', portfolioId, cashBalance: index }))
  edits.push(provider.mutatePortfolio({ type: 'setCash', portfolioId, cashBalance: 999 }))
  const financeEdit = provider.mutatePersonalFinance({ type: 'setEntry', category: 'cash', id: entryId, amount: 789 })
  const manualExport = provider.exportUserData(backup)
  const settingsEdit = provider.mutateSettings({ type: 'setTime12h', value: false })
  for (const result of await Promise.all(edits)) succeeded(result)
  succeeded(await financeEdit)
  succeeded(await manualExport)
  succeeded(await settingsEdit)
  assert.equal((await snapshot()).userData.portfolios[portfolioId].cashBalance, 999)
  assert.equal((await snapshot()).userData.personalFinance.cash[0].amount, 789)
  await checkComplete()

  const beforeRefusal = await readFile(backup, 'utf8')
  assert.ok((await provider.mutateSettings({ type: 'setTabHidden', id: 'settings', hidden: true })).errors.length)
  assert.equal(await readFile(backup, 'utf8'), beforeRefusal)

  // A failed local write must leave both the previous local book and backup intact.
  const blockedStore = `${storePath()}.${process.pid}.tmp`
  assert.ok(!relative(scratch, blockedStore).startsWith('..'))
  await mkdir(blockedStore)
  try {
    assert.ok((await provider.mutatePortfolio({ type: 'setCash', portfolioId, cashBalance: 111 })).errors.length)
    assert.equal(await readFile(backup, 'utf8'), beforeRefusal)
  } finally { await rm(blockedStore, { recursive: true }) }

  // Block the temporary backup path: the local edit still succeeds and the good backup survives.
  const blockedBackup = join(downloads, `.budget-terminal-backup.json.${process.pid}.tmp`)
  assert.ok(!relative(scratch, blockedBackup).startsWith('..'))
  await mkdir(blockedBackup)
  try {
    const result = await provider.mutatePortfolio({ type: 'setCash', portfolioId, cashBalance: 222 })
    assert.equal(result.data.portfolios.find(entry => entry.id === portfolioId)?.cashBalance, 222)
    assert.match(result.meta.failureReason!, /Saved locally.*automatic backup/)
    assert.ok(automaticBackupStatus()?.error)
    assert.equal(await readFile(backup, 'utf8'), beforeRefusal)
  } finally { await rm(blockedBackup, { recursive: true }) }
  succeeded(await provider.mutatePortfolio({ type: 'setCash', portfolioId, cashBalance: 333 }))
  assert.equal(automaticBackupStatus()?.error, undefined)
  await checkComplete()

  const portable = join(scratch, 'import.json')
  await writeFile(portable, await readFile(backup))
  const saved = await snapshot()
  succeeded(await provider.clearUserData())
  assert.equal((await snapshot()).userData.portfolios.portfolio_1.tickers.length, 0)
  assert.equal((await snapshot()).cards.customCards.length, 0)
  await checkComplete()
  succeeded(await provider.importUserData(portable))
  assert.deepEqual((await snapshot()).userData, saved.userData)
  assert.deepEqual((await snapshot()).cards, saved.cards)
  await checkComplete()
  await flushAutomaticBackup()
  const olderSnapshot = JSON.stringify({ ...(await snapshot()), exportedAt: '2000-01-01T00:00:00.000Z' })
  await writeFile(backup, olderSnapshot)
  await initializeAutomaticBackup()
  assert.equal(await readFile(backup, 'utf8'), olderSnapshot, 'Startup must preserve the previous backup')
  console.log('PASS: one complete backup after every edit, concurrent edits and exports, import/clear, rejected saves, backup failure preservation and recovery, startup preservation')
} finally {
  await flushAutomaticBackup()
  assert.ok(!relative(tmpdir(), scratch).startsWith('..'))
  await rm(scratch, { recursive: true, force: true })
}
