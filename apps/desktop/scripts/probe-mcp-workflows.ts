import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Ajv from 'ajv'
import { catalog, validateCall } from '../mcp/catalog.js'
import { toolName, type Operation } from '../mcp/operations.js'
import { errorResult, McpError } from '../mcp/errors.js'
import { selectionFields } from '../mcp/output.js'
import { shapeResponse } from '../mcp/response.js'
import { McpDispatcher } from '../electron/mcp/dispatcher.js'
import { WriteJournal, receiptKey } from '../electron/mcp/journal.js'
import { ok } from '../electron/shared/envelope.js'
import { canonical, checkRecordRevision, recordRevision } from '../electron/services/mcpContext.js'
import { createHash } from 'node:crypto'
import type { Envelope, PortfolioPayload } from '../electron/shared/contract.js'

const directory = await mkdtemp(join(tmpdir(), 'budget-mcp-workflows-'))
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
const routes = new Map<Operation, (request: unknown) => unknown>(catalog.map(entry => [entry.operation, () => ok({}, 'fixture')]))
const dispatchers: McpDispatcher[] = []
const create = (options: Partial<ConstructorParameters<typeof McpDispatcher>[0]> = {}) => {
  const dispatcher = new McpDispatcher({ routes, ...options })
  dispatchers.push(dispatcher)
  return dispatcher
}
const invoke = (dispatcher: McpDispatcher, operation: Operation, request = {}, response?: object) => dispatcher.invoke(toolName(operation), { request, ...(response ? { response } : {}) })
const journalPath = join(directory, 'write-journal.json')
const edit = { requestId: 'restart-edit', request: { type: 'add', title: 'Private title', content: 'Private content', topic: 'Research', status: 'draft' } }
try {
  const ajv = new Ajv({ strict: false })
  for (const entry of catalog) {
    assert(entry.tool.outputSchema, entry.operation)
    const validate = ajv.compile(entry.tool.outputSchema)
    assert(validate(errorResult(new McpError('Fixture refusal', 'ACCESS_DENIED')).structuredContent), `${entry.operation}: structured errors must match output schema`)
  }
  assert(selectionFields('portfolio').has('portfolios'))
  assert(selectionFields('news', 'items').size > 0)
  assert.throws(() => validateCall(toolName('quotes'), { request: {}, response: { surprise: true } }), /Invalid/)

  let quoteCalls = 0
  let newsCalls = 0
  let fundamentalsCalls = 0
  routes.set('quotes', request => {
    quoteCalls++
    assert.equal((request as { force: boolean }).force, true)
    return ok({ rows: [{ symbol: 'TEST', price: quoteCalls, source: 'fixture', priceBasis: 'equity-perp-mark', asOf: 123 }] }, 'fixture')
  })
  routes.set('fundamentals', () => { fundamentalsCalls++; return ok({ rows: [{ symbol: 'TEST', revenue: 100 }] }, 'fixture') })
  routes.set('news', request => {
    newsCalls++
    assert.equal((request as { force: boolean }).force, true)
    return { ...ok({ items: [{ title: 'Fixture event', publishedAt: 123, url: 'https://example.com/story' }] }, 'fixture'), meta: { source: 'fixture', freshness: 'stale', fetchedAt: 456 }, errors: [{ source: 'fixture', operation: 'fetch', reason: 'Fixture source unavailable' }] }
  })
  const research = create()
  const overview = await invoke(research, 'companyOverview', { symbol: 'test' }) as Envelope<{ evidence: Record<string, unknown> }>
  assert.equal(overview.meta.freshness, 'partial')
  assert(overview.errors.some(error => error.reason.includes('stale')))
  assert(JSON.stringify(overview).includes('https://example.com/story'))
  assert(JSON.stringify(overview).includes('publishedAt'))
  assert.deepEqual([quoteCalls, fundamentalsCalls, newsCalls], [1, 1, 1])
  await invoke(research, 'companyOverview', { symbol: 'TEST', sections: ['quotes'] })
  assert.deepEqual([quoteCalls, fundamentalsCalls, newsCalls], [2, 1, 1], 'Narrow workflows must skip unrequested provider work')

  const portfolio = { id: 'fixture', name: 'Fixture', tickers: ['TEST'], holdings: {}, cashBalance: 10, marginDebt: 0, options: [], includeCashInWeight: true, readOnly: false }
  routes.set('portfolio', () => ok({ portfolios: [portfolio, { ...portfolio, id: 'private-other', name: 'Other private portfolio' }], activeId: 'fixture', mainId: 'fixture', sourcePath: '/private/fixture' }, 'fixture'))
  const briefing = await invoke(research, 'portfolioBriefing', { portfolioId: 'fixture', sections: ['quotes'] })
  assert(!JSON.stringify(briefing).includes('Other private portfolio'))
  for (const source of ['external', 'agent'] as const) {
    const denied = create({ policy: { readOnly: true, requireApproval: true, permissions: { portfolioRead: false, personalFinanceRead: false, browserContent: false } } })
    for (const [operation, request] of [['portfolio', {}], ['portfolioBriefing', { portfolioId: 'fixture' }], ['personalFinance', {}], ['screenshot', {}]] as const) {
      await assert.rejects(denied.invoke(toolName(operation), { request }, source), error => error instanceof McpError && error.code === 'ACCESS_DENIED')
    }
    await denied.invoke(toolName('companyOverview'), { request: { symbol: 'TEST', sections: ['quotes'] } }, source)
  }

  const startCalls = quoteCalls
  const first = await invoke(research, 'quotes', { holdings: ['TEST'] }, { collection: 'rows', limit: 1, snapshot: 'new' }) as { snapshotId: string; data: unknown }
  assert.match(first.snapshotId, /^[a-f0-9]{32}$/)
  const second = await invoke(research, 'quotes', { holdings: ['TEST'] }, { collection: 'rows', limit: 1, snapshot: first.snapshotId }) as typeof first
  assert.deepEqual(first.data, second.data)
  assert.equal(quoteCalls, startCalls + 1, 'Snapshot pages must not repeat provider work')
  await assert.rejects(invoke(research, 'quotes', { holdings: ['OTHER'] }, { snapshot: first.snapshotId }), /does not match/)
  await research.configure({ readOnly: true, requireApproval: true })
  await assert.rejects(invoke(research, 'quotes', { holdings: ['TEST'] }, { snapshot: first.snapshotId }), /expired/)
  const shaped = shapeResponse(ok({ rows: [{ symbol: 'A', volume: 3 }, { symbol: 'B', volume: 10 }, { symbol: 'C', volume: 7 }] }, 'fixture'), { collection: 'rows', sortBy: 'volume', descending: true, limit: 2 }) as { data: { rows: Array<{ symbol: string }> } }
  assert.deepEqual(shaped.data.rows.map(row => row.symbol), ['B', 'C'])
  assert.throws(() => shapeResponse(ok({ rows: [{ symbol: 'A' }] }, 'fixture'), { collection: 'rows', fields: ['symobl'] }), /Unknown response field/)

  let writes = 0
  routes.set('mutateArticles', () => { writes++; return ok({ saved: true }, 'fixture') })
  const writable = { readOnly: false, requireApproval: false }
  const original = create({ policy: writable, journalPath })
  await original.invoke(toolName('mutateArticles'), edit)
  original.close()
  const restarted = create({ policy: writable, journalPath })
  const replay = await restarted.invoke(toolName('mutateArticles'), edit) as { data: { writeAlreadyAttempted: boolean } }
  assert.equal(replay.data.writeAlreadyAttempted, true)
  assert.equal(writes, 1)
  const status = await invoke(restarted, 'operationStatus', { tool: toolName('mutateArticles'), requestId: edit.requestId }) as { data: { state: string } }
  assert.equal(status.data.state, 'completed')
  await assert.rejects(restarted.invoke(toolName('mutateArticles'), { ...edit, request: { ...edit.request, title: 'Changed' } }), /different arguments/)
  const disk = await readFile(journalPath, 'utf8')
  for (const secret of ['Private title', 'Private content', edit.requestId]) assert(!disk.includes(secret), 'Journal must contain only hashed IDs, fingerprints and states')
  const crashPath = join(directory, 'crash-journal.json')
  const journal = new WriteJournal(crashPath)
  const fingerprint = createHash('sha256').update(canonical({ request: edit.request, expectedRevision: undefined })).digest('hex')
  await journal.put(receiptKey(toolName('mutateArticles'), 'uncertain'), { fingerprint, state: 'uncertain', updatedAt: Date.now() })
  const crashed = create({ policy: writable, journalPath: crashPath })
  const uncertain = await invoke(crashed, 'operationStatus', { tool: toolName('mutateArticles'), requestId: 'uncertain' }) as typeof status
  assert.equal(uncertain.data.state, 'uncertain')
  const uncertainReplay = await crashed.invoke(toolName('mutateArticles'), { ...edit, requestId: 'uncertain' }) as Envelope<unknown>
  assert.equal(uncertainReplay.meta.freshness, 'failed')
  assert.equal(writes, 1, 'An uncertain write must not execute after restart')
  const corruptPath = join(directory, 'corrupt-journal.json')
  await writeFile(corruptPath, 'invalid')
  const corrupt = create({ policy: writable, journalPath: corruptPath })
  await assert.rejects(corrupt.invoke(toolName('mutateArticles'), edit), error => error instanceof McpError && error.code === 'JOURNAL_UNAVAILABLE')
  assert(corrupt.diagnostics().journalError)

  let saved: PortfolioPayload = { portfolios: [portfolio], activeId: 'fixture', mainId: 'fixture', sourcePath: '/private/fixture' }
  routes.set('mutatePortfolio', () => { checkRecordRevision(saved); throw new Error('Stale write reached execution') })
  const stale = create({ policy: { readOnly: false, requireApproval: true }, approve: async () => { saved = { ...saved, activeId: 'changed-in-ui' }; return true } })
  await assert.rejects(stale.invoke(toolName('mutatePortfolio'), { requestId: 'stale-ui-edit', expectedRevision: recordRevision(saved), request: { type: 'setCash', portfolioId: 'fixture', cashBalance: 20 } }), error => error instanceof McpError && error.code === 'STALE_REVISION')
  assert(Buffer.byteLength(JSON.stringify(overview)) < 8192, 'Compact workflow fixture should fit text-friendly results')
  console.log('PASS: published error schemas, selective workflows, freshness evidence, both caller permissions, stable snapshot paging, sorting, field validation, durable restart replay, uncertain/corrupt journals, private journal contents and UI revision conflicts')
} finally {
  for (const dispatcher of dispatchers) dispatcher.close()
  await rm(directory, { recursive: true, force: true })
}
