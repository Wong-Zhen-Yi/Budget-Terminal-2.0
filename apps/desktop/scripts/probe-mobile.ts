import assert from 'node:assert/strict'
import { request } from 'node:http'
import { connect } from 'node:net'
import { resolve } from 'node:path'
import { createMobileHttp, LOCAL_MOBILE_HEADER, MobileRequestError } from '../electron/services/mobileHttp.js'
import { mobileTailnet, type MobileTailnet } from '../electron/services/mobileTailscale.js'
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
const directServe = { ...serve, TCP: { ...serve.TCP, [MOBILE_DIRECT_PORT]: { TCPForward: MOBILE_DIRECT_TARGET, ProxyProtocol: 1 } } }
const directConfigured = mobileTailnet(status, directServe)
assert.deepEqual(directConfigured?.direct, { origin: directOrigin, address, owners: new Set([address, ownerPhone]) })
assert.equal(mobileTailnet(status, { ...directServe, AllowFunnel: { [directHost]: true } })?.direct, undefined)

let tailnet: MobileTailnet | null = directConfigured
let called = 0
const renderer = resolve(import.meta.dirname, '../out/renderer')
function echo(channel: string, args: unknown[]) {
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
