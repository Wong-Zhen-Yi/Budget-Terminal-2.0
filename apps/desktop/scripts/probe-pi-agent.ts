import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { fauxAssistantMessage, fauxProvider, fauxText, fauxThinking, fauxToolCall, getSystemMessageText, InMemoryCredentialStore, type SystemMessage, type TranscriptContext } from '@earendil-works/pi-ai'
import { AgentsService } from '../electron/services/agents.js'
import { PiClient, piArguments, piFailure, piModels, piToolResult } from '../electron/services/piClient.js'
import { htmlToText, parseSearchResults, webFetch } from '../electron/services/agentWebTools.js'
import { ok } from '../electron/shared/envelope.js'
import type { Operation } from '../mcp/operations.js'

// Offline: Pi's faux provider stands in for a model API. No network request is made.
const directory = await mkdtemp(join(tmpdir(), 'budget-pi-agent-'))
const previous = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
const wait = async (check: () => boolean, label: string) => {
  const until = Date.now() + 10_000
  while (!check() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10))
  assert(check(), `Timed out waiting for ${label}`)
}

try {
  // Tool arguments and results.
  assert.deepEqual(piArguments({ request: '{"tickers":["AAPL"]}', other: 1 }), { request: { tickers: ['AAPL'] }, other: 1 })
  assert.deepEqual(piArguments({ request: '{"broken"' }), { request: '{"broken"' }, 'Unparseable JSON text is left for validation to reject')
  assert.deepEqual(piArguments({ request: '[1]' }), { request: '[1]' })
  assert.deepEqual(piToolResult({ result: { contentItems: [{ type: 'inputText', text: 'ok' }, { type: 'inputImage', imageUrl: 'data:image/png;base64,cGl4' }] } }),
    [{ type: 'text', text: 'ok' }, { type: 'image', mimeType: 'image/png', data: 'cGl4' }])
  assert.throws(() => piToolResult({ result: { contentItems: [{ type: 'inputText', text: 'denied' }], success: false } }), /denied/)
  assert.throws(() => piToolResult({ error: { message: 'Only Budget Terminal tools' } }), /Only Budget Terminal tools/)
  assert.match(piToolResult({ result: { contentItems: [{ type: 'inputText', text: 'x'.repeat(250_000) }] } })[0].type === 'text' ? (piToolResult({ result: { contentItems: [{ type: 'inputText', text: 'x'.repeat(250_000) }] } })[0] as { text: string }).text : '', /truncated at 200000/)
  assert.match(piFailure(new Error('401 invalid x-api-key sk-ant-abcdef1234567890')), /rejected the credentials/)
  assert(!piFailure(new Error('boom sk-ant-abcdef1234567890 failed')).includes('1234567890'), 'Failures never echo a full key')
  console.log('PASS: JSON-text arguments, tool result conversion, failed results as tool errors, result truncation and credential-safe failures')

  // Web research helpers.
  const search = parseSearchResults(`<div class="result results_links"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Finvestor.apple.com%2Finvestor-relations%2F&amp;rut=x">Apple <b>Investor</b> Relations</a><a class="result__snippet" href="#">Quarterly &amp; annual reports</a></div>
    <div class="result"><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a></div>
    <div class="result"><a class="result__a" href="javascript:alert(1)">Bad</a></div>`)
  assert.deepEqual(search, [{ title: 'Apple Investor Relations', url: 'https://investor.apple.com/investor-relations/', snippet: 'Quarterly & annual reports' }])
  const page = htmlToText('<html><head><title>Q4 &amp; FY</title><script>steal()</script></head><body><h1>Results</h1><p>Revenue was $1.2&nbsp;B.</p><ul><li>One</li></ul><a href="/pr.pdf">Release</a><a href="mailto:x@y">Mail</a></body></html>', 'https://example.com/news/')
  assert.equal(page.title, 'Q4 & FY')
  assert(page.text.includes('Revenue was $1.2 B.') && page.text.includes('- One') && !page.text.includes('steal'))
  assert.deepEqual(page.links, [{ text: 'Release', url: 'https://example.com/pr.pdf' }])
  for (const url of ['http://127.0.0.1/', 'http://192.168.1.1/', 'file:///etc/passwd', 'http://user:pass@example.com/']) await assert.rejects(() => webFetch(url), `${url} must be refused`)
  console.log('PASS: web search parsing without ads or scripts, readable page text and links, and refusal of private, file and credential URLs')

  // No provider connected: a clear setup message, and nothing is started.
  const empty = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null })
  for (const provider of empty.getProviders()) assert.equal((await empty.getAvailable(provider.id)).length, 0)
  const unconfigured = new PiClient(async () => ({ runtime: empty }), directory, () => {})
  await assert.rejects(() => unconfigured.request('account/read', {}), /No model provider is connected to Pi/)
  console.log('PASS: no connected provider explains setup without creating Pi files')

  // A connected provider: the real Agents service drives Pi through the transport.
  const faux = fauxProvider({ provider: 'faux', models: [
    { id: 'quick', name: 'Faux Quick', reasoning: false, input: ['text'] },
    { id: 'deep', name: 'Faux Deep', reasoning: true, input: ['text', 'image'] },
  ] })
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null })
  runtime.registerNativeProvider(faux.provider)
  await runtime.setRuntimeApiKey('faux', 'fixture-key')
  const catalog = piModels(runtime, await runtime.getAvailable('faux'))
  assert.deepEqual(catalog.map(model => model.model), ['faux/quick', 'faux/deep'])
  assert.deepEqual(catalog[0].supportedReasoningEfforts.map(mode => mode.reasoningEffort), ['off'])
  assert.equal(catalog[1].defaultReasoningEffort, 'medium')
  assert.deepEqual(catalog[1].inputModalities, ['text', 'image'])

  const contexts: TranscriptContext[] = []
  const portfolioRequests: unknown[] = []
  const routes = new Map<Operation, (request: unknown) => unknown>([['portfolio', request => { portfolioRequests.push(request); return ok({ portfolios: [], evidenceTail: 'PI_EVIDENCE_31' }, 'fixture') }]])
  let client: PiClient | null = null
  const service = new AgentsService({ cwd: directory, routes, clientFactory: receive => (client = new PiClient(async () => ({ runtime, defaults: { defaultProvider: 'faux', defaultModel: 'deep' } }), directory, receive)) })
  await service.command({ type: 'connect' })
  assert(service.snapshot().connected, service.snapshot().error)
  assert.equal(service.snapshot().model, 'faux/deep', 'With no saved model, Pi uses the user\'s Pi default')
  assert.equal(service.snapshot().thinking, null, 'The model default thinking level is shown as Default')
  assert.equal(service.snapshot().imageGeneration, false)

  faux.setResponses([
    context => { contexts.push(structuredClone(context)); return fauxAssistantMessage([fauxThinking('plan'), fauxText('Checking the portfolio.'), fauxToolCall('budget_terminal_portfolio', { request: '{}' })], { stopReason: 'toolUse' }) },
    context => { contexts.push(structuredClone(context)); return fauxAssistantMessage([fauxToolCall('web_fetch', { url: 'http://127.0.0.1:9/private' })], { stopReason: 'toolUse' }) },
    context => { contexts.push(structuredClone(context)); return fauxAssistantMessage('Final answer with PI_EVIDENCE_31 and missing web coverage.') },
  ])
  await service.command({ type: 'send', text: 'Review my portfolio' })
  await wait(() => !service.snapshot().busy, 'the first Pi run')
  assert.equal(service.snapshot().error, '')
  const systemMessages = contexts[0].messages.filter(message => message.role === 'system')
  const system = systemMessages.map(message => getSystemMessageText(message as SystemMessage)).join('\n')
  assert(system.includes('inside Budget Terminal') && system.includes('You are running on Pi'), 'Budget Terminal supplies the whole system prompt')
  assert(!/AGENTS\.md|skills|read, bash, edit, write/i.test(system.replace(/agent-evaluated|Skills/g, '')), 'No Pi coding prompt, context files or skills are loaded')
  const toolNames = systemMessages.flatMap(message => (message as SystemMessage).toolsAdded ?? []).map(tool => tool.name)
  assert(toolNames.includes('budget_terminal_portfolio') && toolNames.includes('terminal_show_page') && toolNames.includes('web_search') && toolNames.includes('web_fetch'))
  assert(!toolNames.some(name => ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'].includes(name)), 'Pi file and shell tools are off')
  assert.deepEqual(portfolioRequests, [{}], 'JSON-text request arguments are parsed before service validation')
  const toolResult = contexts[1].messages.find(message => message.role === 'toolResult')
  assert(JSON.stringify(toolResult).includes('PI_EVIDENCE_31'), 'The service result reaches the model')
  const webResult = contexts[2].messages.filter(message => message.role === 'toolResult').at(-1) as { isError?: boolean; content: { text?: string }[] }
  assert.equal(webResult.isError, true, 'A refused web fetch is a tool error, not a crash')
  const run = service.snapshot().messages.findLast(message => message.run)?.run
  assert.deepEqual(run?.tools.map(tool => [tool.name, tool.status]), [['budget_terminal_portfolio', 'succeeded'], ['web_search', 'failed']])
  assert.equal(run?.status, 'partial', 'A failed web source marks the run partial')
  const answers = service.snapshot().messages.filter(message => message.role === 'assistant').map(message => message.text)
  assert.deepEqual(answers, ['Checking the portfolio.', 'Final answer with PI_EVIDENCE_31 and missing web coverage.'])
  console.log('PASS: Pi default model, Budget Terminal-only system prompt and tools, validated tool routing, web tool failures, streamed answers and partial-run diagnostics')

  // Model and thinking changes apply to the running conversation.
  await service.command({ type: 'configure', model: 'faux/deep', thinking: 'high' })
  faux.setResponses([context => { contexts.push(structuredClone(context)); return fauxAssistantMessage('Second answer.') }])
  await service.command({ type: 'send', text: 'Follow up' })
  await wait(() => !service.snapshot().busy, 'the second Pi run')
  assert.equal(service.snapshot().error, '')
  assert(JSON.stringify(contexts.at(-1)!.messages).includes('Review my portfolio'), 'The Pi conversation keeps earlier turns')
  await service.command({ type: 'configure', model: 'faux/quick', thinking: null })
  faux.setResponses([(_context, _options, _state, model) => fauxAssistantMessage(`Answered by ${model.id}.`)])
  await service.command({ type: 'send', text: 'Switch' })
  await wait(() => !service.snapshot().busy, 'the switched-model run')
  assert.equal(service.snapshot().messages.filter(message => message.role === 'assistant').at(-1)?.text, 'Answered by quick.')
  console.log('PASS: conversation continuity, thinking selection and model switching in the same Pi session')

  // Provider errors end the run with an explanation and keep the connection.
  faux.setResponses([fauxAssistantMessage('', { stopReason: 'error', errorMessage: '400 Bad request: unsupported parameter top_k' })])
  await service.command({ type: 'send', text: 'Fail please' })
  await wait(() => !service.snapshot().busy, 'the failed run')
  assert.match(service.snapshot().error, /unsupported parameter top_k/)
  assert.equal(service.snapshot().messages.findLast(message => message.run)?.run?.status, 'failed')
  console.log('PASS: provider errors end the run with a useful explanation')

  // Stop during a tool call releases the pending call and closes the session.
  await service.command({ type: 'connect' })
  assert(service.snapshot().connected, service.snapshot().error)
  let release: () => void = () => {}
  routes.set('portfolio', () => new Promise(resolve => { release = () => resolve(ok({ portfolios: [] }, 'fixture')) }))
  faux.setResponses([fauxAssistantMessage([fauxToolCall('budget_terminal_portfolio', { request: {} })], { stopReason: 'toolUse' }), fauxAssistantMessage('Should not be reached.')])
  await service.command({ type: 'send', text: 'Slow tool' })
  await wait(() => service.snapshot().activity === 'researching', 'the slow tool call')
  await service.command({ type: 'stop' })
  release()
  assert.equal(service.snapshot().busy, false)
  assert.equal(service.snapshot().connected, false)
  assert.throws(() => client!.write({ id: 'late', result: {} }), /not connected/)
  console.log('PASS: Stop releases pending tool calls and closes the Pi session')
  service.close()
} finally {
  process.env.APPDATA = previous.APPDATA
  process.env.LOCALAPPDATA = previous.LOCALAPPDATA
  await rm(directory, { recursive: true, force: true })
}
