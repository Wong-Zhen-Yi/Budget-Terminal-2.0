import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { mock } from 'node:test'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const scratch = await fs.mkdtemp(join(tmpdir(), 'budget-efficiency-'))
process.env.APPDATA = join(scratch, 'roaming')
process.env.LOCALAPPDATA = join(scratch, 'local')
const baseline = process.argv.includes('--baseline')
const reads: Record<string, number> = {}
const originalRead = fs.readFile
const reader = mock.method(fs, 'readFile', (...args: Parameters<typeof fs.readFile>) => {
  const name = basename(String(args[0]))
  reads[name] = (reads[name] ?? 0) + 1
  return originalRead(...args)
})
syncBuiltinESMExports()
const { cache } = await import('../electron/services/cache.js')
const { yahoo } = await import('../electron/services/yahoo/client.js')
const { getOptionQuotes } = await import('../electron/services/yahoo/optionQuotes.js')
const { rawOptionChain, optionExpiries } = await import('../electron/services/yahoo/optionChain.js')
const { yahooProvider } = await import('../electron/services/provider.js')
const { configureAutomaticBackup, initializeAutomaticBackup, flushAutomaticBackup } = await import('../electron/services/automaticBackup.js')
const { replaceArticles } = await import('../electron/services/articlesStore.js')
const { readSyncData } = await import('../electron/services/cloudSyncData.js')
const { watchPortfolios, storePath } = await import('../electron/services/portfolioStore.js')
let chains = 0, listings = 0
let failChain = false
const expiry = '2099-01-16'
const options = mock.method(yahoo, 'options', async (_ticker: string, request?: { date?: string }) => {
  if (request?.date) chains++; else listings++
  if (request?.date && failChain) return { expirationDates: [], options: [] }
  return { expirationDates: [new Date(`${expiry}T00:00:00Z`)], options: [{
    calls: [100, 105, 110].map(strike => ({ strike, lastPrice: strike / 100, lastTradeDate: new Date() })),
    puts: [100, 105, 110].map(strike => ({ strike, lastPrice: strike / 50, lastTradeDate: new Date() })),
  }] }
})
try {
  const positions = [100, 105, 110].map((strike, index) => ({ rowId: `row-${index}`, ticker: 'TEST', expiry, strike, strategy: 'Calls' }))
  const cold = await getOptionQuotes({ positions })
  assert.equal(Object.keys(cold.quotes).length, 3)
  const coldCounts = { chains, listings }
  await getOptionQuotes({ positions })
  assert.deepEqual({ chains, listings }, coldCounts, 'Warm marks must avoid provider calls')
  configureAutomaticBackup(join(scratch, 'Downloads'))
  await replaceArticles({ articles: Array.from({ length: 200 }, (_, index) => ({ id: `article-${index}`, title: `Synthetic ${index}`, topic: 'fixture', content: 'x'.repeat(1000), status: 'draft', createdAt: 1, updatedAt: 1, revision: 1 })) })
  await initializeAutomaticBackup()
  const id = (await yahooProvider.portfolio()).data.mainId!
  for (const key of Object.keys(reads)) delete reads[key]
  for (let index = 0; index < 5; index++) {
    const result = await yahooProvider.mutatePortfolio({ type: 'setCash', portfolioId: id, cashBalance: index + 1 })
    assert.deepEqual(result.errors, [])
  }
  await flushAutomaticBackup()
  const burstReads = { ...reads }
  const backup = JSON.parse(await fs.readFile(join(scratch, 'Downloads/budget-terminal-backup.json'), 'utf8'))
  assert.equal(backup.articles.articles.length, 200)
  const synced = JSON.parse(await readSyncData())
  assert.deepEqual(backup.userData, synced.userData)
  assert.deepEqual(backup.articles, synced.articles)
  console.log(JSON.stringify({ mode: baseline ? 'baseline' : 'optimized', positions: 3, cold: coldCounts, warmAdditionalCalls: chains + listings - coldCounts.chains - coldCounts.listings, edits: 5, articles: 200, articleContentBytes: 200_000, burstReads }))
  if (!baseline) {
    assert.deepEqual(coldCounts, { chains: 1, listings: 1 })
    assert.equal(burstReads['articles.json'], 5, 'One article-library read per acknowledged edit')
    assert((await optionExpiries(' test ')).every(date => date instanceof Date))
    const beforeConcurrent = chains
    await Promise.all([rawOptionChain(' TEST ', expiry, true), rawOptionChain('test', expiry, true), rawOptionChain('TEST', '2099-02-20', true)])
    assert.equal(chains - beforeConcurrent, 2, 'Concurrent consumers share normalized ticker/expiry; other expirations remain independent')
    const strategies = ['Calls', 'Covered Call', 'Puts', 'Cash Secured Put']
    const variants = await getOptionQuotes({ positions: strategies.map((strategy, index) => ({ ...positions[0], rowId: `strategy-${index}`, strategy })) })
    assert.deepEqual(Object.values(variants.quotes).map(quote => quote.currentPrice), [1, 1, 2, 2])
    assert(Object.values(variants.quotes).every(quote => quote.asOf && quote.source === 'Yahoo Finance last trade'))
    failChain = true
    const failed = await getOptionQuotes({ positions, force: true })
    assert.deepEqual(failed.missing, positions.map(position => position.rowId))
    assert.equal(failed.errors?.filter(error => error.operation === 'option mark').length, 3)
    failChain = false
    const now = Date.now()
    const time = mock.method(Date, 'now', () => now + 11_000)
    try {
      const recovered = await getOptionQuotes({ positions, force: true })
      assert.equal(Object.keys(recovered.quotes).length, 3, 'A later retry recovers every affected row')
      assert.deepEqual(recovered.errors, [])
    } finally { time.mock.restore() }

    const changes: Array<boolean | undefined> = []
    const stopWatching = watchPortfolios(metadataOnly => changes.push(metadataOnly))
    const wait = () => new Promise(resolve => setTimeout(resolve, 450))
    try {
      await wait()
      await yahooProvider.mutatePortfolio({ type: 'rename', id, name: 'Own synthetic rename' })
      await wait()
      assert.deepEqual(changes, [], 'The file watcher must not repeat a completed local mutation notification')
      const document = JSON.parse(await fs.readFile(storePath(), 'utf8'))
      document.portfolios[id].name = 'External synthetic rename'
      await fs.writeFile(storePath(), JSON.stringify(document, null, 2))
      await wait()
      assert.deepEqual(changes, [true], 'External metadata edits retain narrow invalidation')
      document.portfolios[id].cashBalance++
      await fs.writeFile(storePath(), JSON.stringify(document, null, 2))
      await wait()
      assert.deepEqual(changes, [true, false], 'External financial edits invalidate real dependents')
    } finally { stopWatching() }
    console.log('PASS: shared call/put/long/seller marks, timestamps, force, failures/retry, expiry isolation, watcher coalescing and external dependency classification')
  }
} finally {
  options.mock.restore(); reader.mock.restore(); syncBuiltinESMExports()
  await cache.close()
  await fs.rm(scratch, { recursive: true, force: true })
}
