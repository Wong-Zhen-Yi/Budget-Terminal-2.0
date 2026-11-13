import assert from 'node:assert/strict'
import { TelegramService } from '../electron/services/telegram.js'
import { agentFailureReason } from '../electron/shared/agentRuns.js'
import type { ScreenshotPayload } from '../electron/shared/screenshot.js'
import { ok } from '../electron/shared/envelope.js'
import { formatTelegramText } from '../electron/shared/telegram.js'

const formattedReply = '## Market update\n\n**Revenue** grew 12.5% — *profit* reached $1,234.\n* Watch #AAPL\n\n\nSource: https://example.com/report#results 😀'
const plainReply = 'Market update\n\nRevenue grew 12.5%, profit reached $1,234.\nWatch AAPL\n\nSource: https://example.com/report#results 😀'
assert.equal(formatTelegramText(formattedReply), plainReply)
assert.equal(formatTelegramText(plainReply), plainReply, 'Formatting is stable across repeated delivery preparation')

// Synthetic credentials and an in-memory store: never contact Telegram or touch real profiles.
const token = '123456:' + 'synthetic_'.repeat(4)
const requests: { method: string; body: Record<string, unknown> }[] = []
let stored: unknown = null
let fail = false
let updates: unknown[] = []
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
let captures = 0
let captureResult = ok<ScreenshotPayload>({ screenshots: [{ pageId: 'charts', label: 'Charts', obscured: false, startupLoading: false, status: 'ready', capturedAt: Date.now(), width: 1, height: 1, mimeType: 'image/png', base64: png.toString('base64') }] })
const uploads: FormData[] = []
let dispatched = 0
let resets = 0
const commands: { command: string; argument: string }[] = []
const adapter = new TelegramService({
  load: async () => stored,
  save: async config => { stored = structuredClone(config) },
  reset: async () => { resets++ },
  screenshot: async (page, signal) => { assert(!signal.aborted); assert(['current', 'charts', 'all'].includes(page)); captures++; return captureResult },
  models: async () => [{ id: 'fixture', name: 'Fixture model', current: true, reasoning: [{ id: 'default', name: 'Default', current: true }] }],
  command: async (command, argument) => { commands.push({ command, argument }); return `${command} command result` },
  reply: async text => {
    dispatched++
    assert(['research', 'send me a screenshot of global page'].includes(text))
    if (text === 'send me a screenshot of global page') {
      await adapter.sendScreenshots(captureResult)
      return 'Logging description: screenshot sent successfully.'
    }
    return 'research result'
  },
  fetch: (async (url, init) => {
    const method = String(url).split('/').pop()!
    const body = init?.body instanceof FormData ? { chat_id: init.body.get('chat_id') } : JSON.parse(String(init?.body))
    if (init?.body instanceof FormData) {
      uploads.push(init.body)
      assert.equal(method, 'sendPhoto')
      assert(!new Headers(init.headers).has('content-type'), 'Fetch must add the multipart boundary')
    }
    requests.push({ method, body })
    if (fail) throw new Error(String(url))
    let result: unknown = { username: 'fixture_bot' }
    if (method === 'getChat') result = { id: 123, type: 'private' }
    if (method === 'getUpdates') {
      result = updates; updates = []
      if (body.timeout && !(result as unknown[]).length) {
        await new Promise<void>((_resolve, reject) => {
          const signal = init!.signal!
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          if (signal.aborted) reject(new Error('aborted'))
        })
      }
    }
    return new Response(JSON.stringify({ ok: true, result }))
  }) as typeof fetch,
})
await adapter.initialize()
assert.equal(adapter.snapshot().configured, false)
await assert.rejects(adapter.send('hello'), /disabled/)
await assert.rejects(adapter.configure({ token: 'private-invalid-value', chatId: '123', enabled: true, receive: false }), error => !String(error).includes('private-invalid-value'))
await adapter.configure({ token, chatId: '123', enabled: true, receive: false })
assert.equal(adapter.snapshot().connected, true)
assert(!JSON.stringify(adapter.snapshot()).includes(token))
await adapter.send('a'.repeat(3500) + '😀'.repeat(1000))
const parts = requests.filter(request => request.method === 'sendMessage')
assert.equal(parts.length, 2)
assert.equal(parts.map(part => part.body.text).join(''), 'a'.repeat(3500) + '😀'.repeat(1000))
assert(parts.every(part => !('parse_mode' in part.body) && part.body.chat_id === '123'))
fail = true
await assert.rejects(adapter.send('uncertain'), error => !String(error).includes(token) && /uncertain/.test(String(error)))
assert.equal(requests.filter(request => request.method === 'sendMessage').length, 3, 'Never retry a send automatically')
fail = false
await adapter.send(formattedReply)
assert.equal(requests.at(-1)?.body.text, plainReply, 'Every delivery path formats text before posting to Telegram')
await assert.rejects(adapter.send('*** ###'), /readable text/)
await adapter.sendScreenshot('charts')
assert.equal(uploads.length, 1)
assert.equal(uploads[0].get('chat_id'), '123')
const photo = uploads[0].get('photo') as File
assert.equal(photo.type, 'image/png')
assert.deepEqual(Buffer.from(await photo.arrayBuffer()), png)
assert.equal(uploads[0].has('caption'), false, 'Screenshot photos have no caption or diagnostic description')
fail = true
await assert.rejects(adapter.sendScreenshot(), error => !String(error).includes(token) && /0 photos confirmed sent/.test(String(error)))
assert.equal(uploads.length, 2, 'Uncertain photo delivery is never retried')
fail = false
await assert.rejects(adapter.sendScreenshot('../private'), /page ID/)
const savedCapture = captureResult
captureResult = ok({ screenshots: [] })
await assert.rejects(adapter.sendScreenshot(), /No screenshot/)
captureResult = { ...savedCapture, data: { screenshots: [{ ...savedCapture.data.screenshots[0], width: 10001 }] } }
await assert.rejects(adapter.sendScreenshot(), /photo limits/)
captureResult = savedCapture
const beforeAll = uploads.length
captureResult = { ...savedCapture, data: { screenshots: [savedCapture.data.screenshots[0], { ...savedCapture.data.screenshots[0], pageId: 'portfolio', label: 'Portfolio' }] }, errors: [{ source: 'fixture', operation: 'screenshot', reason: 'Synthetic missing page' }] }
assert.deepEqual(await adapter.sendScreenshot('all'), { sent: true, photos: 2, incomplete: true })
assert.equal(uploads.length, beforeAll + 2)
assert.equal(uploads.at(-1)?.has('caption'), false, 'Partial-capture details stay out of the photo caption')
captureResult = savedCapture
const beforeCapturedDelivery = captures
await adapter.sendScreenshots(savedCapture)
assert.equal(captures, beforeCapturedDelivery, 'MCP screenshot delivery uploads the captured image without recapturing')
const cancelled = new AbortController()
cancelled.abort()
const beforeCancel = captures
await assert.rejects(adapter.sendScreenshot('current', cancelled.signal), /cancelled/)
assert.equal(captures, beforeCancel, 'Cancelled deliveries do not capture private content')
const now = Math.floor(Date.now() / 1000)
const update = (id: number, from: number, type = 'private', date = now, text = 'research') => ({ update_id: id, message: { date, text, chat: { id: 123, type }, from: { id: from } } })
// Supply updates only after the initial queue-drop call.
const originalFetch = (adapter as unknown as { options: { fetch: typeof fetch } }).options.fetch
let seeded = false
;(adapter as unknown as { options: { fetch: typeof fetch } }).options.fetch = (async (url, init) => {
  const body = init?.body instanceof FormData ? {} : JSON.parse(String(init?.body))
  if (String(url).endsWith('/getUpdates') && body.timeout && !seeded) {
    seeded = true
    updates = [update(1, 999), update(2, 123, 'group', now, '/screenshot'), update(3, 123, 'private', now - 600),
      ...['/start', '/new@fixture_bot', '/reset', '/status', '/history', '/resume saved-id', '/models', '/help', '/model fixture', '/model', '/reasoning', '/reasoning high', '/unknown', '/new@other_bot', '/screenshot charts', '/new research', 'send me a screenshot of global page', 'research'].map((text, index) => update(index + 4, 123, 'private', now, text))]
  }
  return originalFetch(url, init)
}) as typeof fetch
await adapter.configure({ chatId: '123', enabled: true, receive: true })
for (let i = 0; i < 100 && requests.filter(request => request.body.text === 'research result').length < 2; i++) await new Promise(resolve => setTimeout(resolve, 5))
assert.equal(dispatched, 3, 'Only questions and /new questions reach research; commands and other bot mentions do not')
assert.equal((stored as { offset: number }).offset, 22)
assert.equal(resets, 4, 'Only configuration and /new reset conversation context; removed aliases do nothing')
assert.deepEqual(commands, [], 'Slash commands only open model buttons; reasoning is selected through callbacks')
const menu = requests.find(request => request.method === 'setMyCommands')!
assert(requests.some(request => request.method === 'sendMessage' && !!request.body.reply_markup), '/model sends selectable buttons')
assert.deepEqual(menu.body.scope, { type: 'chat', chat_id: '123' })
assert.deepEqual((menu.body.commands as { command: string }[]).map(command => command.command), ['new', 'model'])
assert.equal(requests.filter(request => request.body.text === 'Available commands: /new, /model. Ask naturally for a screenshot of a page.').length, 10)
assert.equal(uploads.length, 6, 'Natural screenshot requests deliver a photo through the model')
assert(!requests.some(request => String(request.body.text).includes('Logging description')), 'Do not post model descriptions after sending a screenshot')
assert.equal(requests.filter(request => request.body.text === 'research result').length, 2, 'The next ordinary question still receives its text answer')
await adapter.disconnect()
assert.equal(stored, null)
assert.equal(adapter.snapshot().configured, false)
let failurePolls = 0
const failureMessages: string[] = []
const failedCommands = new TelegramService({
  load: async () => ({ token, chatId: '123', enabled: true, receive: true, offset: 0 }),
  save: async () => {},
  reset: async () => { throw new Error('private reset failure ' + token) },
  command: async () => { throw new Error('private command failure ' + token) },
  reply: async () => { assert.fail('A failed reset must never send its question with old context') },
  fetch: (async (url, init) => {
    const method = String(url).split('/').pop()
    const body = JSON.parse(String(init?.body))
    let result: unknown = { username: 'fixture_bot' }
    if (method === 'getChat') result = { id: 123, type: 'private' }
    if (method === 'getUpdates') {
      if (failurePolls++) await new Promise<void>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
      })
      result = [update(1, 123, 'private', now, '/new research'), update(2, 123, 'private', now, '/model')]
    }
    if (method === 'sendMessage') failureMessages.push(body.text)
    return new Response(JSON.stringify({ ok: true, result }))
  }) as typeof fetch,
})
await failedCommands.initialize()
for (let i = 0; i < 100 && failureMessages.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 5))
assert.equal(failureMessages.length, 2)
assert.match(failureMessages[0], /Could not confirm a new chat/)
assert.match(failureMessages[1], /command could not complete/)
assert(!failureMessages.join('').includes(token))
await failedCommands.close()

// Exercise actual callback updates, including authorization and stale-button rejection.
const pickerRequests: { method: string; body: any }[] = []
const selections: string[] = []
const reasoningSelections: string[] = []
const longModelId = 'fixture-model-' + 'long-name-'.repeat(12)
let pickerPoll = 0
let pickerMessageId = 0
let pickerToken = ''
const callback = (id: number, from = 123, type = 'private', data = pickerToken, messageId = pickerMessageId) => ({
  update_id: id, callback_query: { id: `callback-${id}`, data, from: { id: from },
    message: { message_id: messageId, date: now, chat: { id: 123, type } } },
})
const picker = new TelegramService({
  load: async () => ({ token, chatId: '123', enabled: true, receive: true, offset: 0 }),
  save: async () => {}, reset: async () => {},
  models: async () => [{ id: longModelId, name: 'Research model', current: true, reasoning: [
    { id: 'default', name: 'Model default (low)', current: true }, { id: 'high', name: 'high', current: false },
  ] }],
  command: async (command, argument) => {
    if (command === 'model') selections.push(argument)
    else reasoningSelections.push(argument)
    return 'Model and reasoning selected. Context retained.'
  },
  reply: async () => { assert.fail('Button selection must never become a research prompt') },
  fetch: (async (url, init) => {
    const method = String(url).split('/').pop()!
    const body = JSON.parse(String(init?.body))
    pickerRequests.push({ method, body })
    let result: unknown = { username: 'fixture_bot' }
    if (method === 'getChat') result = { id: 123, type: 'private' }
    if (method === 'sendMessage') {
      pickerMessageId++
      if (body.reply_markup) pickerToken = (body.reply_markup.inline_keyboard[1] ?? body.reply_markup.inline_keyboard[0])[0].callback_data
      result = { message_id: pickerMessageId }
    }
    if (method === 'getUpdates') {
      assert(body.allowed_updates.includes('callback_query'))
      pickerPoll++
      if (pickerPoll === 1) result = [update(1, 123, 'private', now, '/model')]
      else if (pickerPoll === 2) result = [callback(2, 999), callback(3, 123, 'group'), callback(4, 123, 'private', 'forged'), callback(5, 123, 'private', pickerToken, -1), callback(6), callback(7)]
      else if (pickerPoll === 3) result = [callback(8, 999), callback(9, 123, 'group'), callback(10, 123, 'private', 'forged'), callback(11, 123, 'private', pickerToken, -1), callback(12), callback(13)]
      else if (pickerPoll === 4) result = [update(14, 123, 'private', now, '/model')]
      else if (pickerPoll === 5) result = [callback(15)]
      else if (pickerPoll === 6) result = [update(16, 123, 'private', now, '/new'), callback(17)]
      else if (pickerPoll === 7) result = [update(18, 123, 'private', now, '/model')]
      else if (pickerPoll === 8) result = [callback(19)]
      else if (pickerPoll === 9) {
        ;(picker as unknown as { modelPicker: { expiresAt: number } }).modelPicker.expiresAt = Date.now() - 1
        result = [callback(20)]
      } else await new Promise<void>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
      })
    }
    return new Response(JSON.stringify({ ok: true, result }))
  }) as typeof fetch,
})
await picker.initialize()
for (let i = 0; i < 100 && pickerPoll < 10; i++) await new Promise(resolve => setTimeout(resolve, 5))
assert.equal(pickerPoll, 10)
assert.deepEqual(selections, [longModelId, longModelId, longModelId], 'Each fresh model selection starts its reasoning step')
assert.deepEqual(reasoningSelections, ['high'], 'Only the authorized fresh reasoning button applies once; /new and expiry invalidate it')
const pickerButtons = pickerRequests.filter(request => request.body.reply_markup?.inline_keyboard?.length)
assert.equal(pickerButtons.length, 6)
assert.equal(pickerButtons[0].body.reply_markup.inline_keyboard[0][0].text, 'Research model (current)')
assert.deepEqual(pickerButtons[1].body.reply_markup.inline_keyboard.map((row: { text: string }[]) => row[0].text), ['Model default (low) (current)', 'high'])
assert(pickerButtons.every(request => Buffer.byteLength(request.body.reply_markup.inline_keyboard[0][0].callback_data) <= 64), 'Long catalog IDs fit Telegram callback limits using opaque tokens')
assert(pickerRequests.some(request => request.method === 'answerCallbackQuery' && request.body.callback_query_id === 'callback-6'))
assert(pickerRequests.some(request => request.method === 'answerCallbackQuery' && request.body.callback_query_id === 'callback-20' && request.body.text.includes('expired')))
assert.equal(pickerRequests.filter(request => request.method === 'editMessageReplyMarkup').length, 4)
assert.equal(pickerRequests.filter(request => request.body.text === 'Model and reasoning selected. Context retained.').length, 1)
await picker.close()
for (const [code, description, expected] of [
  [400, 'Bad Request: chat not found', /personal numeric user ID/],
  [403, 'Forbidden: bot was blocked by the user', /Unblock/],
  [401, 'Unauthorized', /bot token was rejected/],
  [409, 'Conflict: terminated by other getUpdates request', /Another gateway/],
  [429, 'Too Many Requests', /rate limit/],
] as const) {
  let polls = 0
  const test = new TelegramService({
    load: async () => ({ token, chatId: '123', enabled: true, receive: true, offset: 0 }),
    save: async () => {}, reset: async () => {}, reply: async () => 'unused',
    fetch: (async (url, init) => {
      const method = String(url).split('/').pop()
      if (method === 'getChat' || method === 'sendMessage') return new Response(JSON.stringify({ ok: false, error_code: code, description: description + token }), { status: code })
      if (method === 'getUpdates') {
        if (++polls > 1) await new Promise<void>((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
        })
        return new Response(JSON.stringify({ ok: true, result: [] }))
      }
      return new Response(JSON.stringify({ ok: true, result: { username: 'fixture_bot' } }))
    }) as typeof fetch,
  })
  await test.initialize()
  assert.match(test.snapshot().error, expected)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.match(test.snapshot().error, expected, 'Successful incoming polling must not erase a delivery failure')
  await assert.rejects(test.send('fixture'), error => {
    assert.match(agentFailureReason(error), expected)
    assert(!agentFailureReason(error).includes(token))
    return true
  })
  await test.close()
}
console.log('PASS: Telegram configuration, redaction, Unicode splitting, no send retries, private allowlist, stale-message rejection, persisted offset and cancellation')
console.log('PASS: private-chat validation, actionable errors retained across successful polling, and safe agent diagnostics')
console.log('PASS: two-command menu, bot mentions, /new question, model picker routing and removed-command rejection')
console.log('PASS: failed reset never dispatches a question with old context; command errors never expose private details')
console.log('PASS: natural Telegram plain text removes asterisks, heading/hash symbols and em dashes while preserving numbers, Unicode and source links')
console.log('PASS: model then reasoning buttons, supported/current/default choices, callback acknowledgement, short tokens, private-chat authorization, one-time selection, expiry and /new invalidation')


console.log('PASS: inline multipart screenshot photos, original PNG bytes, private recipient, photo-only natural replies, photo limits, cancellation and no delivery retries')
