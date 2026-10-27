import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock } from 'node:test'
import { catalog, validateCall } from '../mcp/catalog.js'
import { newsRefreshOperations, optionsRefreshOperations, toolName, type Operation } from '../mcp/operations.js'
import { McpDispatcher } from '../electron/mcp/dispatcher.js'
import { ok, failed } from '../electron/shared/envelope.js'
import { checkRecordRevision, mapMcpWork, mcpExecution, recordRevision } from '../electron/services/mcpContext.js'
import { shapeResponse } from '../mcp/response.js'
import { toolResult } from '../mcp/toolResult.js'

const directory = await mkdtemp(join(tmpdir(), 'budget-mcp-access-'))
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
const routes = new Map<Operation, (request: unknown) => unknown>(catalog.map(entry => [entry.operation, () => ok({}, 'fixture')]))
const name = 'budget_terminal_mutate_articles'
const request = { type: 'add', title: 'Private fixture title', content: 'Private fixture content', topic: 'Research', status: 'draft' }
const args = (requestId: string) => ({ request, requestId })
let writes = 0
routes.set('mutateArticles', () => { writes++; return ok({ saved: true }, 'fixture') })
const controllers: McpDispatcher[] = []
function create(options: Partial<ConstructorParameters<typeof McpDispatcher>[0]> = {}) {
  const dispatcher = new McpDispatcher({ routes, ...options })
  controllers.push(dispatcher)
  return dispatcher
}
const writable = { readOnly: false, requireApproval: false }
try {
  const access = create()
  assert.deepEqual(access.diagnostics().policy, { readOnly: true, requireApproval: true })
  const newsRequests: Partial<Record<Operation, object>> = {
    news: { tickers: ['AAPL'] }, newsPage: { tickers: ['AAPL'] }, newsTickerSearch: { tickers: ['AAPL'] },
    newsArticle: { url: 'https://example.com/story', title: 'Fixture headline', summary: 'Fixture preview' },
    forexNews: { pair: 'EUR/USD' },
    options: { symbol: 'AAPL' }, optionsChain: { symbol: 'AAPL' }, optionsExpirations: { symbol: 'AAPL' },
    optionQuotes: { positions: [{ rowId: 'option-fixture', ticker: 'AAPL', expiry: '2099-01-16', strike: 100, strategy: 'Calls' }] },
  }
  for (const operation of [...newsRefreshOperations, ...optionsRefreshOperations]) {
    const original = routes.get(operation)!
    let refreshes = 0
    routes.set(operation, request => {
      assert.equal((request as { force: boolean }).force, true, `${operation} must refresh before returning research`)
      refreshes++
      return ok({ refreshed: true }, 'fixture')
    })
    for (const source of ['external', 'agent'] as const) {
      for (const force of [undefined, false, true]) {
        const request = { ...newsRequests[operation], ...(force === undefined ? {} : { force }) }
        await access.invoke(toolName(operation), { request }, source)
        assert.equal(request.force, force, 'Freshness enforcement must not mutate caller-owned arguments')
      }
    }
    assert.equal(refreshes, 6, 'Every news/options call refreshes, including repeated requests in one session')
    const description = catalog.find(entry => entry.operation === operation)!.tool.description!
    assert(description.includes('Always refreshes') && !description.includes('Prefer cached data'))
    routes.set(operation, original)
  }
  await access.invoke('budget_terminal_portfolio', { request: {} })
  for (const source of ['external', 'agent'] as const) {
    await assert.rejects(access.invoke(name, args(`blocked-${source}`), source), /read only/)
    await assert.rejects(access.invoke('budget_terminal_browser_research', { request: { action: 'read' } }, source), /read only/)
  }
  assert.equal(writes, 0)
  assert.throws(() => validateCall(name, { request }), /requestId/)
  assert.throws(() => validateCall(name, args('contains spaces')), /Invalid/)
  assert.throws(() => validateCall('budget_terminal_stocks', { request: { symbol: 'TEST' }, requestId: 'read-id' }), /Invalid/)
  await assert.rejects(access.invoke('private-client-supplied-name', {}), /Unknown/)
  assert(!JSON.stringify(access.diagnostics()).includes('private-client-supplied-name'))
  await assert.rejects(access.configure({ readOnly: false }), /Invalid|expected/)
  await assert.rejects(access.configure({ ...writable, surprise: true }))
  await access.configure(writable)
  const first = await access.invoke(name, args('first'))
  const replay = await access.invoke(name, { requestId: 'first', request: Object.fromEntries(Object.entries(request).reverse()) }, 'agent')
  assert.deepEqual(replay, first)
  assert.equal(writes, 1, 'Same-session replay across external/agent callers must not execute twice')
  assert.equal(access.diagnostics().activity.at(-1)?.state, 'replayed')
  await assert.rejects(access.invoke(name, { ...args('first'), request: { ...request, title: 'Different' } }), /different arguments/)
  assert.equal(writes, 1)

  // Simultaneous retries share the in-flight outcome instead of racing two adds.
  let complete!: (value: unknown) => void
  routes.set('mutateArticles', () => { writes++; return new Promise(resolve => { complete = resolve }) })
  const writing = access.invoke(name, args('parallel'))
  const retrying = access.invoke(name, args('parallel'))
  assert.equal(writes, 2)
  assert.equal(access.diagnostics().activity.filter(entry => entry.durationMs === undefined).length, 2)
  complete(ok({ saved: true }, 'fixture'))
  assert.deepEqual(await writing, await retrying)

  routes.set('mutateArticles', () => { writes++; throw new Error('Private provider details') })
  await assert.rejects(access.invoke(name, args('throwing')), /Private provider/)
  await assert.rejects(access.invoke(name, args('throwing')), /already attempted/)
  assert.equal(writes, 3, 'A thrown or interrupted write must not be retried automatically')
  routes.set('mutateArticles', () => { writes++; return failed({}, 'Private failure details', 'fixture') })
  const failure = await access.invoke(name, args('failed'))
  assert.deepEqual(await access.invoke(name, args('failed')), failure)
  assert.equal(writes, 4)

  // Large result receipts remain bounded and retain failure classification.
  routes.set('mutateArticles', () => failed({ content: 'x'.repeat(70_000) }, 'failure', 'fixture'))
  await access.invoke(name, args('large'))
  const largeReplay = await access.invoke(name, args('large')) as { meta: { freshness: string } }
  assert.equal(largeReplay.meta.freshness, 'failed')
  assert(JSON.stringify(largeReplay).length < 1000)

  routes.set('mutateArticles', () => { writes++; return ok({}, 'fixture') })
  let approvals = 0
  const approved = create({ policy: { readOnly: false, requireApproval: true }, approve: async (tool, payload) => {
    approvals++
    assert.equal(tool, name)
    assert.deepEqual(payload, request)
    return true
  } })
  await approved.invoke(name, args('approved'))
  await approved.invoke(name, args('approved'))
  assert.equal(approvals, 1, 'An exact replay must not open another approval dialog')
  const beforeDenial = writes
  const denied = create({ policy: { readOnly: false, requireApproval: true }, approve: async () => false })
  await assert.rejects(denied.invoke(name, args('denied')), /not approved/)
  await assert.rejects(denied.invoke(name, args('denied')), /already attempted/)
  assert.equal(writes, beforeDenial)

  // Revoking permissions, stopping an agent or disconnecting a client cancels approval.
  let approvalSignal!: AbortSignal
  let approveLater!: (value: boolean) => void
  const pending = create({ policy: { readOnly: false, requireApproval: true }, approve: async (_tool, _payload, signal) => {
    approvalSignal = signal
    return new Promise(resolve => { approveLater = resolve; signal.addEventListener('abort', () => resolve(false), { once: true }) })
  } })
  const waiting = pending.invoke(name, args('revoked'))
  assert.equal(pending.diagnostics().activity.at(-1)?.state, 'approval')
  await pending.configure({ readOnly: true, requireApproval: true })
  approveLater(true)
  await assert.rejects(waiting, /not approved/)
  assert(approvalSignal.aborted)
  assert.equal(writes, beforeDenial)
  await pending.configure({ readOnly: false, requireApproval: true })
  const signal = new AbortController()
  const stopped = pending.invoke(name, args('stopped'), 'agent', signal.signal)
  signal.abort()
  await assert.rejects(stopped, /not approved/)
  assert(approvalSignal.aborted)
  assert.equal(writes, beforeDenial)
  const closing = pending.invoke(name, args('closing'))
  pending.close()
  await assert.rejects(closing, /not approved/)
  assert.equal(writes, beforeDenial)

  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const expired = create({ policy: { readOnly: false, requireApproval: true }, approve: async (_tool, _payload, signal) =>
      new Promise(resolve => signal.addEventListener('abort', () => resolve(false), { once: true })) })
    const waitingExpiry = expired.invoke(name, args('expired'))
    mock.timers.tick(60_000)
    await assert.rejects(waitingExpiry, /not approved/)
    assert.equal(writes, beforeDenial)
  } finally { mock.timers.reset() }

  // Persistence errors do not silently change access; requests cannot change the policy.
  const path = join(directory, 'access.json')
  const persisted = create({ persistPolicy: policy => writeFile(path, JSON.stringify(policy)) })
  await persisted.configure(writable)
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), writable)
  const diskFailure = create({ persistPolicy: async () => { throw new Error('Fixture disk unavailable') } })
  await assert.rejects(diskFailure.configure(writable), /disk unavailable/)
  assert.equal(diskFailure.diagnostics().policy.readOnly, true)
  assert.throws(() => validateCall('budget_terminal_configure_mcp', { request: writable }), /Unknown/)

  const capped = create({ policy: writable })
  for (let index = 0; index < 500; index++) await capped.invoke(name, args(`limit-${index}`))
  assert.equal(capped.diagnostics().writeReceipts, 500)
  assert.equal(capped.diagnostics().activity.length, 100)
  const beforeCapacity = writes
  await assert.rejects(capped.invoke(name, args('over-limit')), /limit was reached/)
  await capped.invoke(name, args('limit-0'))
  assert.equal(writes, beforeCapacity, 'Old receipts must not be evicted at capacity')
  const diagnostics = JSON.stringify(controllers.map(controller => controller.diagnostics()))
  for (const secret of ['Private fixture', 'Private provider', 'Private failure', 'requestId', 'content', 'parallel']) assert(!diagnostics.includes(secret), `Diagnostics leaked ${secret}`)
  // Revision checks execute in the actual store queue, including contention with UI writes.
  const portfolio = await import('../electron/services/portfolioStore.js')
  const cards = await import('../electron/services/cardsStore.js')
  const settings = await import('../electron/services/settingsStore.js')
  const initial = await portfolio.readPortfolios()
  const portfolioId = initial.mainId
  assert(portfolioId)
  const oldRevision = recordRevision(initial)
  const updates = await Promise.allSettled([10, 20].map(cashBalance => mcpExecution.run({ expectedRevision: oldRevision }, () => portfolio.mutatePortfolios({ type: 'setCash', portfolioId, cashBalance }))))
  assert.equal(updates.filter(update => update.status === 'fulfilled').length, 1)
  assert.equal(updates.filter(update => update.status === 'rejected').length, 1)
  const financeRevision = recordRevision(await portfolio.readPersonalFinance())
  await portfolio.mutatePersonalFinance({ type: 'addEntry', category: 'cash' })
  await assert.rejects(mcpExecution.run({ expectedRevision: financeRevision }, () => portfolio.mutatePersonalFinance({ type: 'addEntry', category: 'cash' })), /changed/)
  const cardsRevision = recordRevision(await cards.readCards())
  await cards.mutateCards({ type: 'add', name: 'Fixture', symbols: ['TEST'], weighting: 'equal', weights: {} })
  await assert.rejects(mcpExecution.run({ expectedRevision: cardsRevision }, () => cards.mutateCards({ type: 'add', name: 'Stale', symbols: ['TEST'], weighting: 'equal', weights: {} })), /changed/)
  const settingsSnapshot = await settings.readSettings()
  await settings.mutateSettings({ type: 'setTime12h', value: !settingsSnapshot.time12h })
  await assert.rejects(mcpExecution.run({ expectedRevision: recordRevision(settingsSnapshot) }, () => settings.mutateSettings({ type: 'setClockCountry', code: 'SG' })), /changed/)
  assert.equal(recordRevision({ ...settingsSnapshot, lastBackupAt: 123 }), recordRevision(settingsSnapshot))
  assert.throws(() => validateCall('budget_terminal_mutate_cards', { requestId: 'no-revision', request: { type: 'remove', id: 'fixture' } }), /expectedRevision/)
  checkRecordRevision({ fixture: true }) // Manual edits do not require MCP revisions.

  const research = { data: { rows: Array.from({ length: 8 }, (_, index) => ({ ticker: `T${index}`, value: index, source: 'fixture source', asOf: 123 })), description: 'x'.repeat(12_000) }, meta: { freshness: 'partial', source: 'fixture', fetchedAt: 456 }, errors: [{ reason: 'Missing coverage' }] }
  const shaped = shapeResponse(research, { collection: 'rows', fields: ['ticker'], offset: 2, limit: 2 }) as typeof research & { response: { page: { nextOffset: number }; provenance: unknown[] } }
  assert.deepEqual(shaped.data.rows, [{ ticker: 'T2' }, { ticker: 'T3' }])
  assert.equal(shaped.response.page.nextOffset, 4)
  assert.deepEqual(shaped.meta, research.meta)
  assert.deepEqual(shaped.errors, research.errors)
  assert(JSON.stringify(shaped.response.provenance).includes('fixture source'))
  const news = { data: { articles: [{ title: 'Earlier event', source: 'Fixture publisher', url: 'https://example.com/story', publishedAt: 123 }] }, meta: { freshness: 'fresh', fetchedAt: 456 }, errors: [] }
  const projectedNews = shapeResponse(news, { collection: 'articles', fields: ['title'] }) as { response: { provenance: unknown[] } }
  assert(projectedNews.response.provenance.some(row => (row as { publishedAt?: number }).publishedAt === 123), 'News publication dates must survive projection separately from retrieval time')
  const bounded = shapeResponse(research, { maxBytes: 4096 }) as { data: { omitted: boolean } }
  assert.equal(bounded.data.omitted, true)
  const summary = shapeResponse(research, { mode: 'summary' }) as typeof research
  assert.equal(summary.data.rows.length, 3)
  assert(summary.data.description.length < 600)
  assert.equal(research.data.rows.length, 8, 'Response shaping must not alter shared cached data')
  assert.throws(() => shapeResponse(research, { collection: 'missing' }), /path/)
  assert.throws(() => shapeResponse(research, { offset: 0 }), /array/)
  const formatted = toolResult('budget_terminal_stocks', research)
  assert(JSON.stringify(formatted.content).length < 2000, 'Large results must not be duplicated into text')
  assert.equal(formatted.structuredContent, research)

  const scanController = new AbortController()
  let scheduled = 0
  await assert.rejects(mcpExecution.run({ signal: scanController.signal }, () => mapMcpWork(Array.from({ length: 100 }, (_, index) => index), async index => {
    scheduled++
    if (index === 0) scanController.abort()
    return index
  })))
  assert(scheduled <= 4, 'Cancelled scans must stop scheduling new history reads')
  let runningSignal!: AbortSignal
  routes.set('stocks', async () => {
    runningSignal = mcpExecution.getStore()!.signal!
    await new Promise(resolve => runningSignal.addEventListener('abort', resolve, { once: true }))
    return ok({}, 'fixture')
  })
  const cancellable = create()
  const running = cancellable.invoke('budget_terminal_stocks', { request: { symbol: 'TEST' } })
  cancellable.cancel(cancellable.diagnostics().activity.at(-1)!.id)
  await assert.rejects(running, /cancelled/)
  assert(runningSignal.aborted)
  assert.equal(cancellable.diagnostics().activity.at(-1)?.state, 'cancelled')
  console.log('PASS: atomic revision guards for all four stores, concurrent stale-write refusal, response selection/pagination/summary/budgets/provenance, bounded text, scan cancellation and local cancellation')
  console.log('PASS: fail-closed permissions, both caller types, browser guard, exact approvals, denial, expiry, cancellation, persistence failure, required write IDs, concurrent replay, collision refusal, failed/large receipts, capacity and metadata-only diagnostics')
} finally {
  for (const controller of controllers) controller.close()
  await rm(directory, { recursive: true, force: true })
}
