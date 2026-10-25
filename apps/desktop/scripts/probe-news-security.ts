import assert from 'node:assert/strict'
import http from 'node:http'
import { EventEmitter } from 'node:events'
import { syncBuiltinESMExports } from 'node:module'
import type { LookupFunction } from 'node:net'
import { PassThrough } from 'node:stream'
import { mock } from 'node:test'
import { httpGet } from '../electron/services/news/http.js'
import { getNewsThumbnail } from '../electron/services/news/images.js'
import { captureSources } from '../electron/services/sourceHealth.js'
import { cache } from '../electron/services/cache.js'
import { createPublicLookup, isPublicAddress, publicNewsUrl } from '../electron/services/news/publicNetwork.js'

export async function runNewsSecurityChecks(): Promise<void> {
  for (const address of [
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '192.0.0.1', '192.0.2.1', '192.88.99.1', '192.168.1.1',
    '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:8.8.8.8', '64:ff9b::a00:1',
    'fc00::1', 'fe80::1', 'ff02::1', '2001::1', '2001:2::1', '2001:db8::1',
    '2002:7f00:1::1', '3fff::1', '2001:4860::1%eth0', 'not-an-ip',
  ]) assert.equal(isPublicAddress(address), false, address)
  for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888']) {
    assert.equal(isPublicAddress(address), true, address)
  }
  for (const url of [
    'file:///private', 'ftp://publisher.example/article', 'https://user:pass@publisher.example/',
    'http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[2002:7f00:1::1]/',
  ]) assert.throws(() => publicNewsUrl(url), Error, url)
  assert.equal(publicNewsUrl('https://publisher.example/article').hostname, 'publisher.example')

  const resolveOnce = (lookup: LookupFunction, all = true, family = 0) => new Promise<string | unknown[]>((resolve, reject) => {
    lookup('publisher.example', { all, family }, (error, addresses) => error ? reject(error) : resolve(addresses))
  })
  for (const addresses of [
    [], [{ address: '127.0.0.1', family: 4 }], [{ address: '::1', family: 6 }],
    [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }],
    [{ address: '8.8.8.8', family: 4 }, { address: 'fe80::1', family: 6 }],
    [{ address: '8.8.8.8', family: 6 }],
  ]) {
    const lookup = createPublicLookup(async (_hostname, options) => {
      assert.equal(options.all, true)
      assert.equal(options.family, 0)
      return addresses
    })
    await assert.rejects(resolveOnce(lookup, false, 4), /public network/)
  }
  const publicAddresses = [{ address: '8.8.8.8', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }]
  const lookup = createPublicLookup(async () => publicAddresses)
  assert.deepEqual(await resolveOnce(lookup), publicAddresses)
  assert.equal(await resolveOnce(lookup, false, 4), '8.8.8.8')
  let resolutions = 0
  const rebinding = createPublicLookup(async () => ++resolutions === 1 ? publicAddresses : [{ address: '127.0.0.1', family: 4 }])
  await resolveOnce(rebinding)
  assert.equal(resolutions, 1, 'a connection must not validate and then resolve again')
  await assert.rejects(resolveOnce(rebinding), /public network/)
  await assert.rejects(resolveOnce(createPublicLookup(async () => { throw new Error('DNS fixture failure') })), /DNS fixture failure/)

  // Real requests must fail before reaching even an isolated local server.
  let hits = 0
  const server = http.createServer((_request, response) => { hits++; response.end('private fixture') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const options = { headers: {}, timeoutMs: 2_000, maxBytes: 1_024 }
  try {
    const port = (server.address() as { port: number }).port
    for (const host of ['127.0.0.1', '2130706433', 'localhost']) {
      await assert.rejects(httpGet(`http://${host}:${port}/private`, options), /public network/)
    }
    assert.equal(hits, 0)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }

  // A mock publisher response exercises the real redirect loop and body handling,
  // without exposing a local server as a permitted public destination.
  let destinations: string[] = []
  let responseFor: (url: URL) => { status: number; location?: string; body?: string; contentType?: string } = () => ({ status: 200, body: 'publisher fixture' })
  const send = ((target: URL, requestOptions: http.RequestOptions, onResponse: (response: http.IncomingMessage) => void) => {
    destinations.push(target.href)
    assert.equal(requestOptions.agent, false)
    assert.equal(typeof requestOptions.lookup, 'function')
    assert.ok(requestOptions.signal)
    const request = new EventEmitter() as http.ClientRequest
    request.setTimeout = () => request
    request.destroy = (error?: Error) => { if (error) request.emit('error', error); return request }
    request.end = (() => {
      queueMicrotask(() => {
        const fixture = responseFor(target)
        const stream = new PassThrough()
        const response = stream as unknown as http.IncomingMessage
        response.statusCode = fixture.status
        response.headers = { 'content-type': fixture.contentType ?? 'text/plain', ...(fixture.location ? { location: fixture.location } : {}) }
        onResponse(response)
        stream.end(fixture.body ?? '')
      })
      return request
    }) as http.ClientRequest['end']
    return request
  }) as unknown as typeof http.request
  mock.method(http, 'request', send)
  syncBuiltinESMExports()
  try {
    for (const location of ['http://127.0.0.1/private', 'http://[::1]/private', 'http://169.254.169.254/', 'https://user:pass@publisher.example/']) {
      destinations = []
      responseFor = () => ({ status: 302, location })
      await assert.rejects(httpGet('http://publisher.example/article', options), /public network|without credentials/)
      assert.equal(destinations.length, 1, 'unsafe redirect must never be dispatched')
    }
    destinations = []
    responseFor = target => target.pathname === '/article'
      ? { status: 302, location: '/final' } : { status: 200, body: 'publisher fixture' }
    const success = await httpGet('http://publisher.example/article', options)
    assert.equal(success.body.toString(), 'publisher fixture')
    assert.equal(success.url, 'http://publisher.example/final')
    assert.equal(destinations.length, 2)
    responseFor = () => ({ status: 302, location: '/again' })
    await assert.rejects(httpGet('http://publisher.example/article', options), /Too many redirects/)
    responseFor = () => ({ status: 200, body: 'x'.repeat(2_048) })
    const capped = await httpGet('http://publisher.example/article', options)
    assert.equal(capped.body.length, options.maxBytes)
    assert.equal(capped.truncated, true)

    const imageUrl = 'http://publisher.example/valid-hero.png'
    responseFor = () => ({ status: 200, contentType: 'image/png', body: 'x'.repeat(900 * 1024) })
    const image = await captureSources(() => getNewsThumbnail(imageUrl))
    assert.equal(image.value.payload.bytes, 900 * 1024, 'Ordinary publisher images above the old 640KB cap must load')
    assert(image.value.payload.dataUri.startsWith('data:image/png;base64,'))
    assert.deepEqual(image.value.errors, [])
    assert.deepEqual(image.snapshot?.failures, [], 'A usable thumbnail must not degrade News startup')
    const requests = destinations.length
    await getNewsThumbnail(imageUrl)
    assert.equal(destinations.length, requests, 'Loaded thumbnails should be reused')
    responseFor = () => ({ status: 200, contentType: 'image/png', body: 'x'.repeat(4 * 1024 * 1024 + 1) })
    const oversized = await getNewsThumbnail('http://publisher.example/oversized.png')
    assert.equal(oversized.payload.dataUri, '')
    assert(oversized.errors.some(error => error.reason.includes('size cap')), 'The bounded download ceiling must remain enforced')
    responseFor = () => ({ status: 200, contentType: 'text/html', body: '<html>not an image</html>' })
    assert((await getNewsThumbnail('http://publisher.example/not-image')).errors.some(error => error.reason.includes('Not an image')))
    responseFor = () => ({ status: 503 })
    assert((await getNewsThumbnail('http://publisher.example/image-outage')).errors.some(error => error.reason.includes('503')), 'Publisher failures must stay visible')
    for (const name of ['valid-hero.png', 'oversized.png', 'not-image', 'image-outage']) cache.delete('news-image:http://publisher.example/' + name)
  } finally { mock.restoreAll(); syncBuiltinESMExports() }
  console.log('PASS: news public-address validation, DNS rebinding/mixed answers, real loopback blocking, redirects, publisher images, caching and byte limits')
}
