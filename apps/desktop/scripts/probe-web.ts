import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHANNELS } from '../electron/shared/contract.js'
import { createApi } from '../electron/shared/createApi.js'

const scratch = await mkdtemp(join(tmpdir(), 'bt-web-probe-'))
process.env.APPDATA = scratch
process.env.LOCALAPPDATA = scratch
const { startWebServer } = await import('../web/server.js')
const production = !process.argv.includes('--dev')
const server = await startWebServer({ port: 0, production })
const headers = { 'Content-Type': 'application/json', 'X-Budget-Terminal': 'browser' }
const call = async (channel: string, ...args: unknown[]) => {
  const response = await fetch(`${server.url}/__budget_api/${encodeURIComponent(channel)}`, {
    method: 'POST', headers, body: JSON.stringify(args),
  })
  assert.equal(response.status, 200)
  return response.json()
}
const api = createApi(call, () => () => {})

try {
  const html = await fetch(server.url).then((response) => response.text())
  assert.match(html, /Budget Terminal/)
  const script = html.match(/src="([^"]+\.(?:js|tsx))"/)?.[1]
  assert.ok(script)
  assert.equal((await fetch(new URL(script, server.url))).status, 200)
  if (!production) {
    // Renderer modules under src/api must not be intercepted by HTTP service routes.
    const module = await fetch(`${server.url}/api/client.ts`)
    assert.equal(module.status, 200)
    assert.match(await module.text(), /createBrowserApi/)
  }
  assert.equal((await fetch(`${server.url}/__budget_api/missing`)).status, 404)
  assert.equal((await fetch(`${server.url}/__budget_api/${CHANNELS.settings}`)).status, 405)
  assert.equal((await fetch(`${server.url}/__budget_api/${CHANNELS.settings}`, {
    method: 'POST', headers: { ...headers, Origin: 'https://example.com' }, body: '[]',
  })).status, 403)
  assert.equal((await fetch(`${server.url}/__budget_api/${CHANNELS.settings}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[]',
  })).status, 403)
  assert.equal((await fetch(`${server.url}/__budget_api/${CHANNELS.settings}`, {
    method: 'POST', headers, body: '{broken',
  })).status, 400)

  await api.mutateSettings({ type: 'setTime12h', value: false })
  assert.equal((await api.settings()).data.time12h, false)
  const portfolio = (await api.portfolio()).data.portfolios[0]
  assert.ok(portfolio)
  const events = await fetch(`${server.url}/__budget_api/events`, { signal: AbortSignal.timeout(10_000) })
  const reader = events.body!.getReader()
  await reader.read()
  await api.mutatePortfolio({ type: 'setCash', portfolioId: portfolio.id, cashBalance: 1234 })
  const change = await reader.read()
  assert.match(new TextDecoder().decode(change.value), /data: changed/)
  await reader.cancel()
  assert.equal((await api.portfolio()).data.portfolios[0].cashBalance, 1234)
  const backup = await call(CHANNELS.maintenance, { action: 'exportUserData' })
  assert.equal(backup.result.data.performed, true)
  assert.equal(JSON.parse(backup.contents).app, 'budget-terminal-electron')
  await api.mutateSettings({ type: 'setTime12h', value: true })
  const imported = await call(CHANNELS.maintenance, { action: 'importUserData', contents: backup.contents })
  assert.equal(imported.data.performed, true)
  assert.equal((await api.settings()).data.time12h, false)
  const invalid = await call(CHANNELS.maintenance, { action: 'importUserData', contents: '{}' })
  assert.equal(invalid.data.performed, false)
  assert.equal((await api.settings()).data.time12h, false)
  console.log('PASS: browser assets, API restrictions, persistence, backup round trip, invalid import and change events')
} finally {
  await server.close()
  await rm(scratch, { recursive: true, force: true })
}
