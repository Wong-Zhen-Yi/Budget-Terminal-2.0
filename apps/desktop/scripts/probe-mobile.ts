import assert from 'node:assert/strict'
import { Agent, createServer, request } from 'node:http'
import { createHash } from 'node:crypto'
import { connect } from 'node:net'
import { resolve } from 'node:path'
import { createMobileHttp, LOCAL_MOBILE_HEADER, MobileDownload, MobileRequestError } from '../electron/services/mobileHttp.js'
import { mobileTailnet, mobileTailnetIssue, type MobileTailnet } from '../electron/services/mobileTailscale.js'
import { MOBILE_BODY_LIMIT, MOBILE_DIRECT_LOCAL_PORT, MOBILE_DIRECT_PORT, MOBILE_DIRECT_TARGET, MOBILE_HTTPS_PORT, MOBILE_PROXY_TARGET } from '../electron/shared/mobileAccess.js'

const host = `fixture.test-tailnet.ts.net:${MOBILE_HTTPS_PORT}`
const origin = `https://${host}`
const login = 'fixture-owner'
const address = '100.64.1.1'
const ownerPhone = '100.64.1.2'
const outsider = '100.64.1.3'
const directHost = `${address}:${MOBILE_DIRECT_PORT}`
const directOrigin = `http://${directHost}`
const status = { BackendState: 'Running', Self: { DNSName: 'fixture.test-tailnet.ts.net.', UserID: 22, TailscaleIPs: [address] },
  User: { 22: { LoginName: login } }, Peer: {
    phone: { UserID: 22, TailscaleIPs: [ownerPhone] }, visitor: { UserID: 23, TailscaleIPs: [outsider] },
    expired: { UserID: 22, TailscaleIPs: ['100.64.1.4'], Expired: true },
    tagged: { UserID: 22, TailscaleIPs: ['100.64.1.5'], Tags: ['tag:test'] },
  } }
const serve = { TCP: { [MOBILE_HTTPS_PORT]: { HTTPS: true } }, Web: { [host]: { Handlers: { '/': { Proxy: MOBILE_PROXY_TARGET } } } } }
const configured = mobileTailnet(status, serve)
assert.deepEqual(configured, { origin, login, serving: true })
assert.equal(mobileTailnet(status, {})?.serving, false)
assert.equal(mobileTailnet(status, { ...serve, AllowFunnel: { [host]: true } })?.serving, false)
assert.equal(mobileTailnet({ ...status, Self: { ...status.Self, Tags: ['tag:test'] } }, serve), null)
assert.equal(mobileTailnetIssue(status), undefined)
assert.match(mobileTailnetIssue({ BackendState: 'NeedsLogin' }) ?? '', /Sign in to Tailscale/)
const disconnected = { BackendState: 'NoState', Health: [
  'Unable to connect to the Tailscale coordination server to synchronize the state of your tailnet.',
  'Fixture text that should not be shown',
] }
assert.match(mobileTailnetIssue(disconnected) ?? '', /coordination server.*reconnect/)
assert.doesNotMatch(mobileTailnetIssue(disconnected) ?? '', /Fixture text/)
const directServe = { ...serve, TCP: { ...serve.TCP, [MOBILE_DIRECT_PORT]: { TCPForward: MOBILE_DIRECT_TARGET, ProxyProtocol: 1 } } }
const directConfigured = mobileTailnet(status, directServe)
assert.deepEqual(directConfigured?.direct, { origin: directOrigin, address, owners: new Set([address, ownerPhone]) })
assert.equal(mobileTailnet(status, { ...directServe, AllowFunnel: { [directHost]: true } })?.direct, undefined)

let tailnet: MobileTailnet | null = directConfigured
let called = 0
let finishSlow!: () => void
const slow = new Promise<void>(resolve => { finishSlow = resolve })
const renderer = resolve(import.meta.dirname, '../out/renderer')
function echo(channel: string, args: unknown[]) {
  if (channel === 'test:slow') return slow.then(() => ({ loaded: true }))
  if (channel === 'test:download') return new MobileDownload(Buffer.from('%PDF-fixture'), 'application/pdf')
  if (channel !== 'test:echo') throw new MobileRequestError('Not found.', 404)
  called++
  return { args }
}
const server = await createMobileHttp(renderer, echo, { getTailnet: () => tailnet, port: 0, directPort: 0 })
try {
  const headers = { Host: host, 'tailscale-user-login': login, 'x-forwarded-proto': 'https' }
  const post = { ...headers, Origin: origin, 'x-budget-terminal': 'mobile', 'Content-Type': 'application/json', 'Content-Length': '2' }
  const send = (path: string, hdrs: Record<string, string>, method = 'GET', body?: string) =>
    new Promise<{ status?: number; body: string; csp?: string }>((resolveResponse, reject) => {
      const req = request({ host: '127.0.0.1', port: server.port, path, headers: hdrs, method }, res => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', chunk => { data += chunk })
        res.on('end', () => resolveResponse({ status: res.statusCode, body: data, csp: String(res.headers['content-security-policy'] ?? '') }))
      })
      req.on('error', reject).end(body)
    })
  assert.equal((await send('/', {})).status, 403, 'Direct loopback access requires a Serve identity')
  assert.equal((await send('/', { ...headers, 'tailscale-user-login': 'another-user' })).status, 403)
  assert.equal((await send('/', { ...headers, Host: 'foreign.test:8443' })).status, 403)
  const html = await send('/', headers)
  assert.equal(html.status, 200)
  assert.match(html.body, /data-terminal-mobile/)
  assert.match(html.csp ?? '', /frame-ancestors 'none'/)
  // Add to Home Screen opens the workspace full screen.
  assert.match(html.body, /rel="manifest" href="\.?\/manifest\.webmanifest"/)
  const manifest = await send('/manifest.webmanifest', headers)
  assert.equal(manifest.status, 200)
  assert.deepEqual((({ display, start_url, scope }) => ({ display, start_url, scope }))(JSON.parse(manifest.body)), { display: 'standalone', start_url: '/', scope: '/' })
  assert.equal((await send('/manifest.webmanifest', { ...headers, 'tailscale-user-login': 'another-user' })).status, 403)
  assert.equal((await send('/index.html', headers)).status, 404)
  assert.equal((await send('/%2e%2e/package.json', headers)).status, 404)
  assert.equal((await send('/api/call/test:echo', { ...post, Origin: 'https://foreign.test' }, 'POST', '[]')).status, 403)
  assert.equal((await send('/api/call/test:echo', { ...post, 'x-budget-terminal': '' }, 'POST', '[]')).status, 403)
  assert.equal((await send('/api/call/test:echo', { ...post, 'Content-Length': String(MOBILE_BODY_LIMIT + 1) }, 'POST')).status, 413)
  assert.equal((await send('/api/call/test:echo', post, 'POST', '{}')).status, 400)
  assert.equal((await send('/api/call/test:echo', post, 'POST', '[]')).body, '{"args":[]}')
  assert.equal((await send('/api/call/window:control', post, 'POST', '[]')).status, 404)
  assert.equal(called, 1)
  assert(server.directPort)
  function wire(header: string, http: string) {
    return new Promise<string>((resolveWire, reject) => {
      const socket = connect(server.directPort!, '127.0.0.1')
      let result = ''
      socket.setEncoding('utf8')
      socket.setTimeout(3500, () => socket.destroy(new Error('No direct response')))
      socket.on('connect', () => { socket.write(header); socket.write(http) })
      socket.on('data', chunk => { result += chunk })
      socket.on('error', reject)
      socket.on('close', () => resolveWire(result))
    })
  }
  const get = `GET / HTTP/1.1\r\nHost: ${directHost}\r\nConnection: close\r\n\r\n`
  const proxy = (source: string, destination = address) => `PROXY TCP4 ${source} ${destination} 49201 ${MOBILE_DIRECT_LOCAL_PORT}\r\n`
  assert.match(await wire(proxy(ownerPhone), get), /^HTTP\/1.1 200/)
  assert.equal(await wire(proxy(outsider), get.replace('Connection:', `Tailscale-User-Login: ${login}\r\nConnection:`)), '')
  assert.equal(await wire(proxy(ownerPhone, '100.64.1.9'), get), '')
  assert.equal(await wire('', get), '')
  assert.match(await wire(proxy(ownerPhone), get.replace(directHost, host)), /^HTTP\/1.1 403/)
  const directPost = `POST /api/call/test:echo HTTP/1.1\r\nHost: ${directHost}\r\nOrigin: ${directOrigin}\r\nX-Budget-Terminal: mobile\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n[]`
  assert.match(await wire(proxy(ownerPhone), directPost), /^HTTP\/1.1 200/)
  assert.match(await wire(proxy(ownerPhone), directPost.replace(`Origin: ${directOrigin}`, `Origin: ${origin}`)), /^HTTP\/1.1 403/)
  assert.equal(called, 2)
  // Model Safari's HTTP/1 connection limit on the direct Tailscale link. Every
  // page must start preloading without holding a socket until its provider ends.
  const agent = new Agent({ keepAlive: true, maxSockets: 6 })
  const asyncSend = (path: string, method = 'GET', body?: string) => new Promise<{ status?: number; body: string }>((resolveResponse, reject) => {
    const req = request({ host: '127.0.0.1', port: server.port, path, agent,
      headers: { ...post, Prefer: 'respond-async', 'Content-Length': String(Buffer.byteLength(body ?? '')) }, method }, res => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { data += chunk })
      res.on('end', () => resolveResponse({ status: res.statusCode, body: data }))
    })
    req.setTimeout(3000, () => req.destroy(new Error('Startup occupied all mobile connections')))
    req.on('error', reject).end(body)
  })
  try {
    const started = await Promise.all(Array.from({ length: 80 }, () => asyncSend('/api/call/test:slow', 'POST', '[]')))
    assert(started.every(result => result.status === 202), 'All page loads start before providers finish')
    const slowPath = '/api/results/' + JSON.parse(started[0].body).id
    assert.equal((await asyncSend(slowPath)).status, 202)
    const foreground = await asyncSend('/api/call/test:echo', 'POST', '[]')
    assert.equal(foreground.status, 202)
    const foregroundPath = '/api/results/' + JSON.parse(foreground.body).id
    assert.equal((await send(foregroundPath, headers)).status, 403, 'Polling requires the mobile header')
    const loaded = await asyncSend(foregroundPath)
    assert.equal(loaded.status, 200)
    assert.equal(loaded.body, '{"args":[]}')
    assert.equal((await asyncSend(foregroundPath)).status, 404, 'Release consumed results')
    finishSlow()
    for (const result of started) assert.equal((await asyncSend('/api/results/' + JSON.parse(result.body).id)).status, 200)
    const failure = await asyncSend('/api/call/window:control', 'POST', '[]')
    assert.equal((await asyncSend('/api/results/' + JSON.parse(failure.body).id)).status, 404, 'Async calls preserve desktop-only exclusions')
    const download = await asyncSend('/api/call/test:download', 'POST', '[]')
    assert.equal((await asyncSend('/api/results/' + JSON.parse(download.body).id)).body, '%PDF-fixture', 'Async transport preserves binary downloads')
    const uncollected = await asyncSend('/api/call/test:echo', 'POST', '[]')
    const uncollectedPath = '/api/results/' + JSON.parse(uncollected.body).id
    server.disconnect()
    assert.equal((await asyncSend(uncollectedPath)).status, 404, 'Disconnect discards retained results')
  } finally { finishSlow(); agent.destroy() }
  console.log('PASS: 80 concurrent page loads release HTTP connections, foreground reads complete, and authenticated polling preserves errors and exclusions')
  tailnet = null
  assert.equal((await send('/', headers)).status, 403, 'Stop serving when the tailnet is unavailable')
} finally { await server.close() }
console.log('PASS: private HTTPS and direct Tailscale routing, owner/host checks, same-origin RPC, body limits, and static asset isolation')

const previewToken = 'fixture-preview-token'
const preview = await createMobileHttp(renderer, echo, { localToken: previewToken })
try {
  const previewOrigin = `http://127.0.0.1:${preview.port}`
  const headers = { [LOCAL_MOBILE_HEADER]: previewToken }
  assert.equal(preview.directPort, undefined)
  assert.equal((await fetch(previewOrigin)).status, 403)
  assert.equal((await fetch(previewOrigin, { headers: { [LOCAL_MOBILE_HEADER]: 'wrong' } })).status, 403)
  assert.match(await (await fetch(previewOrigin, { headers })).text(), /data-terminal-mobile/)
  const post = (origin: string) => fetch(`${previewOrigin}/api/call/test:echo`, {
    method: 'POST', headers: { ...headers, Origin: origin, 'x-budget-terminal': 'mobile', 'Content-Type': 'application/json' }, body: '[]',
  })
  assert.equal((await post('http://localhost')).status, 403)
  assert.deepEqual(await (await post(previewOrigin)).json(), { args: [] })
} finally { await preview.close() }
console.log('PASS: local preview authenticates its own window and retains same-origin RPC checks')

// Development builds proxy the phone UI and its HMR socket to the Vite dev server.
const preamble = 'import { injectIntoGlobalHook } from "/@react-refresh"; injectIntoGlobalHook(window)'
const preambleHash = `'sha256-${createHash('sha256').update(preamble).digest('base64')}'`
const viteRequests: { path?: string; host?: string; token?: string }[] = []
const vite = createServer((req, res) => {
  viteRequests.push({ path: req.url, host: req.headers.host, token: req.headers[LOCAL_MOBILE_HEADER] as string | undefined })
  if (req.url === '/mobile.html') res.writeHead(200, { 'Content-Type': 'text/html', ETag: '"fixture"' })
    .end(`<html data-terminal-mobile><script type="module">${preamble}</script><script type="module" src="/@vite/client"></script></html>`)
  else if (req.url === '/mobile/main.ts' || req.url === '/api/client.ts') res.writeHead(200, { 'Content-Type': 'text/javascript' }).end('export {}')
  else res.writeHead(404).end()
})
vite.on('upgrade', (req, socket) => {
  viteRequests.push({ path: req.url, host: req.headers.host, token: req.headers[LOCAL_MOBILE_HEADER] as string | undefined })
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Protocol: vite-hmr\r\n\r\n')
  socket.on('data', chunk => socket.write(`echo:${chunk}`))
  socket.once('end', () => socket.destroy())
})
await new Promise<void>(done => vite.listen(0, '127.0.0.1', done))
const viteOrigin = `http://127.0.0.1:${(vite.address() as { port: number }).port}`
await assert.rejects(createMobileHttp(renderer, echo, { localToken: 'x' }, { devServer: 'http://192.0.2.1:5173' }), /local HTTP address/)
const devToken = 'fixture-dev-token'
const devPreview = await createMobileHttp(resolve(import.meta.dirname, 'missing-renderer'), echo, { localToken: devToken }, { devServer: viteOrigin })
try {
  const devOrigin = `http://127.0.0.1:${devPreview.port}`
  const headers = { [LOCAL_MOBILE_HEADER]: devToken }
  assert.equal((await fetch(devOrigin)).status, 403, 'Dev proxy keeps the local token check')
  assert.equal(viteRequests.length, 0, 'Unauthenticated requests never reach Vite')
  const page = await fetch(devOrigin, { headers })
  assert.match(await page.text(), /@vite\/client/, 'The root serves Vite-transformed mobile.html')
  assert.equal(page.headers.get('etag'), '"fixture"')
  const pagePolicy = page.headers.get('content-security-policy') ?? ''
  assert(pagePolicy.includes(`script-src 'self' ${preambleHash};`), 'Dev pages allow only the hashed Vite preamble')
  assert.doesNotMatch(pagePolicy, /script-src[^;]*unsafe-inline/, 'Dev pages never allow arbitrary inline scripts')
  const module = await fetch(`${devOrigin}/mobile/main.ts`, { headers })
  assert.equal(await module.text(), 'export {}')
  assert.equal(module.headers.get('content-security-policy'), pagePolicy.replace(` ${preambleHash}`, ''), 'Modules keep the base CSP')
  assert.equal(await (await fetch(`${devOrigin}/api/client.ts`, { headers })).text(), 'export {}', 'Source modules under /api/ come from Vite')
  assert.deepEqual(viteRequests.map(entry => entry.path), ['/mobile.html', '/mobile/main.ts', '/api/client.ts'])
  assert(viteRequests.every(entry => entry.host === new URL(viteOrigin).host && !entry.token), 'Vite sees its own host and never the mobile credential')
  assert.deepEqual(await (await fetch(`${devOrigin}/api/call/test:echo`, {
    method: 'POST', headers: { ...headers, Origin: devOrigin, 'x-budget-terminal': 'mobile', 'Content-Type': 'application/json' }, body: '[1]',
  })).json(), { args: [1] }, 'RPC stays in the main process')
  const upgrade = (hdrs: Record<string, string>) => new Promise<string>((done, reject) => {
    const req = request({ host: '127.0.0.1', port: devPreview.port, path: '/?token=fixture', headers: {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'Zml4dHVyZS1rZXktMDAwMA==', ...hdrs,
    } })
    req.once('upgrade', (res, socket) => {
      socket.once('data', chunk => { socket.destroy(); done(`${res.statusCode} ${chunk}`) })
      socket.write('ping')
    })
    req.once('response', res => { res.resume(); done(String(res.statusCode)) })
    req.once('error', reject)
    req.end()
  })
  assert.equal(await upgrade({ ...headers, Origin: devOrigin, 'Sec-WebSocket-Protocol': 'other' }), '403')
  assert.equal(await upgrade({ ...headers, Origin: 'http://localhost', 'Sec-WebSocket-Protocol': 'vite-hmr' }), '403')
  assert.equal(await upgrade({ Origin: devOrigin, 'Sec-WebSocket-Protocol': 'vite-hmr' }), '403')
  assert.equal(await upgrade({ ...headers, Origin: devOrigin, 'Sec-WebSocket-Protocol': 'vite-hmr' }), '101 echo:ping', 'HMR socket reaches Vite')
  assert.equal(viteRequests.at(-1)?.path, '/?token=fixture')
  assert(!viteRequests.at(-1)?.token, 'HMR upgrade drops the mobile credential')
} finally {
  await devPreview.close()
  vite.closeAllConnections()
  await new Promise(done => vite.close(done))
}
console.log('PASS: development mobile UI proxies Vite pages and HMR behind the same token, origin and CSP checks')
