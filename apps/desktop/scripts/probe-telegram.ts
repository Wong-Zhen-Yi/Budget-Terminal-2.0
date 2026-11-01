import assert from 'node:assert/strict'
import { TelegramService } from '../electron/services/telegram.js'
import { agentFailureReason } from '../electron/shared/agentRuns.js'

// Synthetic credentials and an in-memory store: never contact Telegram or touch real profiles.
const token = '123456:' + 'synthetic_'.repeat(4)
const requests: { method: string; body: Record<string, unknown> }[] = []
let stored: unknown = null
let fail = false
let updates: unknown[] = []
let dispatched = 0
let resets = 0
const adapter = new TelegramService({
  load: async () => stored,
  save: async config => { stored = structuredClone(config) },
  reset: async () => { resets++ },
  reply: async text => { dispatched++; assert.equal(text, 'research'); return 'research result' },
  fetch: (async (url, init) => {
    const method = String(url).split('/').pop()!
    const body = JSON.parse(String(init?.body))
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
const now = Math.floor(Date.now() / 1000)
const update = (id: number, from: number, type = 'private', date = now, text = 'research') => ({ update_id: id, message: { date, text, chat: { id: 123, type }, from: { id: from } } })
// Supply updates only after the initial queue-drop call.
const originalFetch = (adapter as unknown as { options: { fetch: typeof fetch } }).options.fetch
let seeded = false
;(adapter as unknown as { options: { fetch: typeof fetch } }).options.fetch = (async (url, init) => {
  const body = JSON.parse(String(init?.body))
  if (String(url).endsWith('/getUpdates') && body.timeout && !seeded) {
    seeded = true
    updates = [update(1, 999), update(2, 123, 'group'), update(3, 123, 'private', now - 600), update(4, 123)]
  }
  return originalFetch(url, init)
}) as typeof fetch
await adapter.configure({ chatId: '123', enabled: true, receive: true })
for (let i = 0; i < 100 && !requests.some(request => request.body.text === 'research result'); i++) await new Promise(resolve => setTimeout(resolve, 5))
assert.equal(dispatched, 1, 'Only the allowed user in the private home chat may dispatch a fresh message')
assert.equal((stored as { offset: number }).offset, 5)
assert(resets >= 2)
await adapter.disconnect()
assert.equal(stored, null)
assert.equal(adapter.snapshot().configured, false)
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

