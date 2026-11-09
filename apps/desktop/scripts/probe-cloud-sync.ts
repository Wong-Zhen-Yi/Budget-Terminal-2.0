import { syncBuiltinESMExports } from 'node:module'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const directory = await mkdtemp(join(tmpdir(), 'budget-cloud-sync-'))
const previous = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
try {
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
  await withSavedDataLock(() => data.applySyncData(modified, editedLocal.updatedAt, true))
  assert.equal(await data.readSyncData(), modified, 'Cloud records must round trip through the real local store normalizers without losing fields')
  const tooManyRows = JSON.parse(modified)
  tooManyRows.userData.personalFinance.cash = Array.from({ length: 41 }, (_, index) => ({ id: `row-${index}`, desc: 'Fixture', amount: 1 }))
  await assert.rejects(withSavedDataLock(() => data.applySyncData(JSON.stringify(tooManyRows), editedLocal.updatedAt, true)))
  assert.equal(await data.readSyncData(), modified, 'A cloud download cannot silently lose rows through local normalization')
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
  await withSavedDataLock(() => data.importBackupData({ userData: JSON.parse(modified).userData }))
  assert.deepEqual(JSON.parse(await data.readSyncData()).userData, JSON.parse(modified).userData)
  await withSavedDataLock(() => data.applySyncData(baseline))
  const invalid = JSON.parse(baseline)
  invalid.articles = { articles: [{ id: 'broken' }] }
  await assert.rejects(withSavedDataLock(() => data.applySyncData(JSON.stringify(invalid))))
  assert.equal(await data.readSyncData(), baseline, 'Invalid remote stores must be rejected before changing any local file')
  await assert.rejects(withSavedDataLock(() => data.importBackupData({ userData: JSON.parse(modified).userData, articles: invalid.articles })))
  assert.equal(await data.readSyncData(), baseline)
  // Fail a later store write once, allowing the journal rollback to succeed.
  const fs = await import('node:fs/promises')
  const originalRename = fs.default.rename
  let injected = false
  fs.default.rename = async (from, to) => {
    if (!injected && String(to).endsWith('articles.json')) { injected = true; throw Error('Injected article write failure') }
    return originalRename(from, to)
  }
  syncBuiltinESMExports()
  try {
    await assert.rejects(withSavedDataLock(() => data.importBackupData(JSON.parse(modified))))
    assert(injected)
    assert.equal(await data.readSyncData(), baseline, 'Failed imports restore every store')
  } finally { fs.default.rename = originalRename; syncBuiltinESMExports() }
  await data.atomicSyncFile(data.cloudDataPath('sync-apply-journal.json'), { before: modified })
  await withSavedDataLock(data.recoverSyncData)
  assert.equal(await data.readSyncData(), modified, 'An interrupted multi-store download must recover on startup')

  console.log('PASS: offline saved-data timestamps, complete backup imports, validation, failed-write rollback and interrupted-apply recovery')
} finally {
  for (const key of ['APPDATA', 'LOCALAPPDATA'] as const) {
    if (previous[key] === undefined) delete process.env[key]
    else process.env[key] = previous[key]
  }
  await rm(directory, { recursive: true, force: true })
}
