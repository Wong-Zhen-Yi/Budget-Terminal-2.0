import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { request as httpRequest } from 'node:http'
import { startWebServer } from '../electron/web/server.js'
import { CHANNELS } from '../electron/shared/contract.js'
import type { SavedDataChanged } from '../electron/shared/contract.js'

const directory = await mkdtemp(join(tmpdir(), 'budget-web-'))
process.env.APPDATA = join(directory, 'data')
process.env.LOCALAPPDATA = join(directory, 'cache')
let web: Awaited<ReturnType<typeof startWebServer>> | undefined
try {
  const renderer = join(directory, 'renderer')
  await mkdir(renderer)
  await writeFile(join(renderer, 'index.html'), '<!doctype html><title>Budget Terminal probe</title>')
  await writeFile(join(renderer, 'private.map'), 'must not be served')
  const { createWebRoutes } = await import('../electron/web/routes.js')
  const { cache } = await import('../electron/services/cache.js')
  const { publishSavedDataChanged, subscribeSavedDataChanged } = await import('../electron/services/savedDataEvents.js')
  const invoke = createWebRoutes()
  const observed: SavedDataChanged[] = []
  const unsubscribe = subscribeSavedDataChanged((event) => observed.push(event))
  const tailOrigin = 'https://probe.tail-test.ts.net'
  web = await startWebServer({ port: 0, rendererDirectory: renderer, tailscaleOrigin: tailOrigin, invoke, subscribe: subscribeSavedDataChanged })
  const origin = `http://127.0.0.1:${web.status().port}`
  const call = (path: string, init: RequestInit = {}) => fetch(`${origin}${path}`, init)
  const rawStatus = (headers: Record<string, string>) => new Promise<number>((resolve, reject) => {
    const request = httpRequest(origin, { headers }, (response) => { response.resume(); resolve(response.statusCode!) })
    request.on('error', reject)
    request.end()
  })
  assert.equal((await call('/')).status, 200)
  assert.equal((await call('/private.map')).status, 404)
  assert.equal((await call('/%2e%2e%5csecret')).status, 404)
  assert.equal(await rawStatus({ Host: 'evil.test' }), 403)
  assert.equal((await call('/api/session', { headers: { Origin: 'https://evil.test' } })).status, 403)
  assert.equal(await rawStatus({ 'Sec-Fetch-Site': 'cross-site' }), 403)
  assert.deepEqual(await (await call('/api/session')).json(), { authenticated: false })
  const pairHeaders = { Origin: origin, 'Content-Type': 'application/json', 'X-Budget-Terminal': 'browser' }
  const code = web.status().pairingCode!
  assert.match(code, /^\d{4}$/, 'pairing code must have exactly four digits')
  assert.equal((await call('/api/pair', { method: 'POST', headers: pairHeaders, body: JSON.stringify({ code: 'WRONG' }) })).status, 401)
  assert.equal((await call('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })).status, 403)
  const paired = await call('/api/pair', { method: 'POST', headers: pairHeaders, body: JSON.stringify({ code }) })
  assert.equal(paired.status, 200)
  const cookie = paired.headers.get('set-cookie')!.split(';')[0]
  assert.match(paired.headers.get('set-cookie')!, /HttpOnly/)
  const { csrf } = await paired.json() as { csrf: string }
  assert.equal(web.status().sessionCount, 1)
  assert.notEqual(web.status().pairingCode, code, 'pairing codes must be single-use')
  assert.equal((await call('/api/pair', { method: 'POST', headers: pairHeaders, body: JSON.stringify({ code }) })).status, 401)
  assert.equal((await call('/api/invoke', { method: 'POST', headers: pairHeaders, body: '{}' })).status, 401)
  const headers = { ...pairHeaders, Cookie: cookie, 'X-Budget-CSRF': csrf }
  const rpc = (channel: string, args: unknown[] = []) => call('/api/invoke', { method: 'POST', headers, body: JSON.stringify({ channel, args }) })
  assert.equal((await call('/api/invoke', { method: 'POST', headers: { ...headers, 'X-Budget-CSRF': 'wrong' }, body: '{}' })).status, 403)
  assert.equal((await rpc(CHANNELS.windowControl, ['close'])).status, 400)
  assert.equal((await rpc(CHANNELS.maintenance, ['clearUserData'])).status, 400)
  assert.equal((await rpc(CHANNELS.webStatus)).status, 400, 'desktop pairing codes must never cross the web API')
  assert.equal((await rpc(CHANNELS.decideWebAccess)).status, 400, 'access decisions must be desktop-only')
  assert.equal((await rpc(CHANNELS.portfolioMutate, [{ type: 'setCashBalance', amount: 'bad' }])).status, 400)
  assert.equal((await rpc(CHANNELS.chart, [{ symbol: 'AAPL', background: 'bad' }])).status, 400)
  assert.equal((await rpc(CHANNELS.settings, [{ unexpected: true }])).status, 400)
  const settings = await rpc(CHANNELS.settings)
  assert.equal(settings.status, 200)
  assert.equal((await settings.json() as { data: { sourcePath: string } }).data.sourcePath, '')
  assert.equal((await rpc(CHANNELS.settings, [{ background: true, backgroundOrder: 1 }])).status, 200)
  const changed = await rpc(CHANNELS.settingsMutate, [{ type: 'setTime12h', value: true }])
  assert.equal(changed.status, 200)
  assert.equal((await changed.json() as { data: { time12h: boolean } }).data.time12h, true)
  assert(observed.some((event) => event.domains.includes('settings')), 'web writes must notify desktop and browser clients')
  const events = await call('/api/events', { headers: { Cookie: cookie } })
  assert.equal(events.status, 200)
  const reader = events.body!.getReader()
  await reader.read()
  publishSavedDataChanged(['cards'])
  const event = await reader.read()
  assert.match(new TextDecoder().decode(event.value), /saved-data-changed/)
  await web.revoke()
  const expired = await reader.read()
  assert.match(new TextDecoder().decode(expired.value), /session-expired/)
  await reader.cancel()
  assert.equal((await rpc(CHANNELS.portfolio)).status, 401)
  // Verify Serve's forwarded origin and HTTPS cookie policy without altering the tailnet.
  const forwarded = { 'X-Forwarded-Host': 'probe.tail-test.ts.net', 'X-Forwarded-Proto': 'https', Origin: tailOrigin, 'X-Budget-Terminal': 'browser', 'Content-Type': 'application/json' }
  const securePair = await call('/api/pair', { method: 'POST', headers: forwarded, body: JSON.stringify({ code: web.status().pairingCode }) })
  assert.equal(securePair.status, 200)
  assert.match(securePair.headers.get('set-cookie')!, /; Secure/)
  assert.equal((await call('/api/session', { headers: { ...forwarded, 'X-Forwarded-Host': 'evil.ts.net' } })).status, 403)
  const secureCookie = securePair.headers.get('set-cookie')!.split(';')[0]
  assert.deepEqual(await (await call('/api/session', { headers: { Cookie: secureCookie } })).json(), { authenticated: false }, 'sessions must be bound to their origin')
  const secureSession = await securePair.json() as { csrf: string }
  assert.equal((await call('/api/logout', { method: 'POST', headers: { ...forwarded, Cookie: secureCookie, 'X-Budget-CSRF': secureSession.csrf } })).status, 200)
  assert.equal(web.status().sessionCount, 0)
  // Approval requires the private request cookie and the desktop decision.
  assert.equal((await call('/api/access-request', { method: 'POST', headers: { ...pairHeaders, Origin: 'https://evil.test' }, body: '{}' })).status, 403)
  assert.equal((await call('/api/access-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403)
  assert.equal((await call('/api/access-request', { method: 'POST', headers: pairHeaders, body: '{"approve":true}' })).status, 400)
  const requested = await call('/api/access-request', { method: 'POST', headers: { ...pairHeaders, 'User-Agent': 'iPad Chrome' }, body: '{}' })
  assert.equal(requested.status, 200)
  assert.match(requested.headers.get('set-cookie')!, /HttpOnly/)
  const requestCookie = requested.headers.get('set-cookie')!.split(';')[0]
  const access = await requested.json() as { state: string; id: string; expiresAt: number }
  assert.equal(access.state, 'pending')
  assert.equal(web.status().accessRequests[0].label, 'iPad browser')
  assert.equal(web.status().accessRequests[0].id, access.id)
  const duplicate = await call('/api/access-request', { method: 'POST', headers: { ...pairHeaders, Cookie: requestCookie }, body: '{}' })
  assert.equal((await duplicate.json() as { id: string }).id, access.id)
  assert.equal(web.status().accessRequests.length, 1)
  assert.deepEqual(await (await call('/api/session', { headers: { Cookie: requestCookie } })).json(), { authenticated: false })
  assert.equal((await call('/api/invoke', { method: 'POST', headers: { ...pairHeaders, Cookie: requestCookie }, body: '{}' })).status, 401)
  web.decideAccess(access.id, true)
  assert.throws(() => web!.decideAccess(access.id, true), /already reviewed/)
  assert.deepEqual(await (await call('/api/access-request')).json(), { state: 'expired' }, 'public reference cannot claim approval')
  assert.deepEqual(await (await call('/api/access-request', { headers: { ...forwarded, Cookie: requestCookie } })).json(), { state: 'expired' }, 'request must be bound to its origin')
  const approved = await call('/api/access-request', { headers: { Cookie: requestCookie } })
  assert.equal((await approved.json() as { state: string }).state, 'approved')
  assert.match(approved.headers.get('set-cookie')!, /BudgetTerminalSession=.*HttpOnly/)
  assert.deepEqual(await (await call('/api/access-request', { headers: { Cookie: requestCookie } })).json(), { state: 'expired' }, 'approval can only be claimed once')
  assert.equal(web.status().sessionCount, 1)
  const denied = await call('/api/access-request', { method: 'POST', headers: pairHeaders, body: '{}' })
  const deniedCookie = denied.headers.get('set-cookie')!.split(';')[0]
  web.decideAccess((await denied.json() as { id: string }).id, false)
  assert.equal((await (await call('/api/access-request', { headers: { Cookie: deniedCookie } })).json() as { state: string }).state, 'denied')
  const expiring = await call('/api/access-request', { method: 'POST', headers: pairHeaders, body: '{}' })
  const expiringCookie = expiring.headers.get('set-cookie')!.split(';')[0]
  const expiringAccess = await expiring.json() as { id: string; expiresAt: number }
  const oldNow = Date.now
  try {
    Date.now = () => expiringAccess.expiresAt + 1
    assert.deepEqual(await (await call('/api/access-request', { headers: { Cookie: expiringCookie } })).json(), { state: 'expired' })
    assert.throws(() => web!.decideAccess(expiringAccess.id, true), /expired/)
  } finally { Date.now = oldNow }
  const revoked = await call('/api/access-request', { method: 'POST', headers: pairHeaders, body: '{}' })
  const revokedCookie = revoked.headers.get('set-cookie')!.split(';')[0]
  web.decideAccess((await revoked.json() as { id: string }).id, true)
  await web.revoke()
  assert.deepEqual(await (await call('/api/access-request', { headers: { Cookie: revokedCookie } })).json(), { state: 'expired' })
  // Repeated requests are also bounded, even without a request cookie.
  for (let i = 0; i < 5; i++) await call('/api/access-request', { method: 'POST', headers: pairHeaders, body: '{}' })
  assert.equal((await call('/api/access-request', { method: 'POST', headers: pairHeaders, body: '{}' })).status, 429)
  for (let i = 0; i < 10; i++) await call('/api/pair', { method: 'POST', headers: pairHeaders, body: JSON.stringify({ code: 'WRONG' }) })
  assert.equal((await call('/api/pair', { method: 'POST', headers: pairHeaders, body: JSON.stringify({ code: 'WRONG' }) })).status, 429)
  unsubscribe()
  await web.stop()
  web = undefined
  const host = await import('../electron/web/host.js')
  const hostData = join(directory, 'host')
  try {
    await host.initializeWebAccess(renderer, hostData, 0)
    assert.equal(host.getWebAccessStatus().enabled, false)
    const started = await host.configureWebAccess(true)
    assert.equal(started.running, true)
    assert(started.port > 0)
    assert.deepEqual(JSON.parse(await readFile(join(hostData, 'web-access.json'), 'utf8')), { enabled: true }, 'configuration contains only the enable flag')
    const hostPair = await fetch(`${started.localUrl}/api/pair`, { method: 'POST', headers: { ...pairHeaders, Origin: started.localUrl }, body: JSON.stringify({ code: started.pairingCode }) })
    assert.equal(hostPair.status, 200)
    const hostPairCookie = hostPair.headers.get('set-cookie')!.split(';')[0]
    const hostPairCsrf = (await hostPair.json() as { csrf: string }).csrf
    assert.equal(host.getWebAccessStatus().sessionCount, 1)
    const hostRequest = await fetch(`${started.localUrl}/api/access-request`, { method: 'POST', headers: { ...pairHeaders, Origin: started.localUrl }, body: '{}' })
    const hostRequestCookie = hostRequest.headers.get('set-cookie')!.split(';')[0]
    const hostRequestId = (await hostRequest.json() as { id: string }).id
    assert.equal(host.getWebAccessStatus().accessRequests?.length, 1)
    host.decideWebAccess(hostRequestId, true)
    const hostApproval = await fetch(`${started.localUrl}/api/access-request`, { headers: { Cookie: hostRequestCookie } })
    assert.equal((await hostApproval.json() as { state: string }).state, 'approved')
    const hostApprovedCookie = hostApproval.headers.get('set-cookie')!.split(';')[0]
    const sessionFile = join(hostData, 'remote-sessions.json')
    const saved = await readFile(sessionFile, 'utf8')
    assert.equal(JSON.parse(saved).length, 2)
    for (const secret of [hostPairCookie.split('=')[1], hostApprovedCookie.split('=')[1], hostPairCsrf, started.pairingCode!, hostRequestId]) {
      assert(!saved.includes(secret), 'credentials, codes and pending requests must not be persisted')
    }
    await host.stopWebAccess()
    await host.initializeWebAccess(renderer, hostData, started.port)
    assert.equal(host.getWebAccessStatus().running, true, 'enabled Remote must restart with the app')
    assert.equal(host.getWebAccessStatus().sessionCount, 2, 'pairing and approved requests must survive an app restart')
    assert.equal(host.getWebAccessStatus().connectionCount, 0, 'remembered browsers are not currently connected')
    for (const remembered of [hostPairCookie, hostApprovedCookie]) {
      const restored = await fetch(`${started.localUrl}/api/session`, { headers: { Cookie: remembered } })
      assert.equal((await restored.json() as { authenticated: boolean }).authenticated, true, 'remembered browsers reconnect without approval')
      assert.match(restored.headers.get('set-cookie')!, /Max-Age=2592000/, 'reopening renews the browser cookie for 30 days')
    }
    assert.equal((await fetch(`${started.localUrl}/api/invoke`, { method: 'POST', headers: { ...pairHeaders, Origin: started.localUrl, Cookie: hostPairCookie, 'X-Budget-CSRF': hostPairCsrf }, body: '{}' })).status, 403, 'CSRF credentials rotate across restarts')
    const restored = await (await fetch(`${started.localUrl}/api/session`, { headers: { Cookie: hostPairCookie } })).json() as { csrf: string }
    assert.equal((await fetch(`${started.localUrl}/api/logout`, { method: 'POST', headers: { Origin: started.localUrl, Cookie: hostPairCookie, 'X-Budget-CSRF': restored.csrf } })).status, 200)
    await host.stopWebAccess()
    await host.initializeWebAccess(renderer, hostData, started.port)
    assert.equal(host.getWebAccessStatus().sessionCount, 1, 'logout must remain effective after restart')
    assert.equal((await (await fetch(`${started.localUrl}/api/session`, { headers: { Cookie: hostPairCookie } })).json() as { authenticated: boolean }).authenticated, false)
    await host.revokeWebSessions()
    await host.stopWebAccess()
    await host.initializeWebAccess(renderer, hostData, started.port)
    assert.equal(host.getWebAccessStatus().sessionCount, 0, 'revoked approvals must not return after restart')
    assert.equal((await (await fetch(`${started.localUrl}/api/session`, { headers: { Cookie: hostApprovedCookie } })).json() as { authenticated: boolean }).authenticated, false)
    assert.match(host.getWebAccessStatus().pairingCode!, /^\d{4}$/)
    const beforeDisable = await fetch(`${started.localUrl}/api/pair`, { method: 'POST', headers: { ...pairHeaders, Origin: started.localUrl }, body: JSON.stringify({ code: host.getWebAccessStatus().pairingCode }) })
    const disabledCookie = beforeDisable.headers.get('set-cookie')!.split(';')[0]
    await host.configureWebAccess(false)
    assert.equal(host.getWebAccessStatus().running, false)
    await host.configureWebAccess(true)
    assert.equal(host.getWebAccessStatus().sessionCount, 0, 'disabling Remote forgets approved browsers')
    assert.equal((await (await fetch(`${host.getWebAccessStatus().localUrl}/api/session`, { headers: { Cookie: disabledCookie } })).json() as { authenticated: boolean }).authenticated, false)
    const expirePair = await fetch(`${started.localUrl}/api/pair`, { method: 'POST', headers: { ...pairHeaders, Origin: started.localUrl }, body: JSON.stringify({ code: host.getWebAccessStatus().pairingCode }) })
    assert.equal(expirePair.status, 200)
    await host.stopWebAccess()
    const expiry = (JSON.parse(await readFile(sessionFile, 'utf8')) as Array<{ expires: number }>)[0].expires
    try {
      Date.now = () => expiry + 1
      await host.initializeWebAccess(renderer, hostData, started.port)
      assert.equal(host.getWebAccessStatus().sessionCount, 0, 'expired approvals must not be restored')
    } finally { Date.now = oldNow }
    await host.configureWebAccess(false)
    await host.stopWebAccess()
    await host.initializeWebAccess(join(directory, 'missing-renderer'), hostData, 0)
    const unavailable = await host.configureWebAccess(true)
    assert.equal(unavailable.enabled, true)
    assert.equal(unavailable.running, false)
    assert(unavailable.error, 'startup failures must be visible')
  } finally { await host.stopWebAccess() }
  cache.close()
  console.log('Remote probe passed: pairing, persistent approvals, renewal, logout/revocation/disable across restarts, expiry, origin/CSRF, validation, mutations, events and HTTPS proxy.')
} finally {
  await web?.stop()
  assert.ok(!relative(tmpdir(), directory).startsWith('..'))
  await rm(directory, { recursive: true, force: true })
}
