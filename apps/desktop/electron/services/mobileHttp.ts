import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import type { Socket } from 'node:net'
import { MOBILE_BODY_LIMIT, MOBILE_HTTP_PORT } from '../shared/mobileAccess.js'
import type { MobileTailnet } from './mobileTailscale.js'
import { startMobileDirect } from './mobileDirect.js'

export type MobileRequest = (channel: string, args: unknown[]) => unknown
type MobileAccess = { getTailnet: () => MobileTailnet | null; port?: number; directPort?: number } | { localToken: string }
export const LOCAL_MOBILE_HEADER = 'x-budget-terminal-local-mobile'
export class MobileRequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}
export class MobileDownload {
  constructor(readonly body: Buffer, readonly contentType: 'application/pdf' | 'application/zip') {}
}

const contentTypes: Record<string, string> = { js: 'text/javascript', css: 'text/css', png: 'image/png', svg: 'image/svg+xml', woff2: 'font/woff2', json: 'application/json', wasm: 'application/wasm' }
const compress = promisify(gzip)
const policy = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "connect-src 'self'", "worker-src 'self' blob:", "frame-src https://www.youtube-nocookie.com",
  "frame-ancestors 'none'", "base-uri 'none'", "object-src 'none'", "form-action 'none'",
].join('; ')

async function readArgs(request: IncomingMessage): Promise<unknown[]> {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw new MobileRequestError('Send JSON.', 415)
  if (request.headers['transfer-encoding']) throw new MobileRequestError('Send a request with a fixed length.', 413)
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  let value: unknown
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new MobileRequestError('Invalid JSON.') }
  if (!Array.isArray(value) || value.length > 1) throw new MobileRequestError('Invalid arguments.')
  return value
}

export async function createMobileHttp(directory: string, run: MobileRequest, access: MobileAccess) {
  const html = await readFile(join(directory, 'mobile.html'))
  const assets = new Map<string, { file: string; type: string; compressed?: Promise<Buffer> }>()
  for (const name of await readdir(join(directory, 'assets'))) {
    const extension = name.split('.').at(-1) ?? ''
    if (/^[a-z\d_.-]+$/i.test(name) && Object.hasOwn(contentTypes, extension)) {
      assets.set(`/assets/${name}`, { file: join(directory, 'assets', name), type: contentTypes[extension] })
    }
  }
  assets.set('/budget-terminal-icon.png', { file: join(directory, 'budget-terminal-icon.png'), type: 'image/png' })
  const subscribers = new Map<ServerResponse, IncomingMessage>()
  const directSources = new WeakMap<Socket, string>()
  // Short polling keeps provider waits off Safari's limited HTTP connections.
  // Results are session-only, authenticated, origin-bound and bounded in memory.
  const jobs = new Map<string, { origin: string; expires: number; result?: { status: number; type: string; body: Buffer } }>()
  let resultBytes = 0
  const discardJob = (id: string) => {
    resultBytes -= jobs.get(id)?.result?.body.length ?? 0
    jobs.delete(id)
  }
  const errorResult = (error: unknown) => ({
    status: error instanceof MobileRequestError ? error.status : 500,
    type: 'application/json',
    body: Buffer.from(JSON.stringify({ message: error instanceof MobileRequestError ? error.message : 'Budget Terminal could not complete this request.' })),
  })
  function authorizedOrigin(request: IncomingMessage) {
    if ('localToken' in access) {
      const host = `127.0.0.1:${request.socket.localPort}`
      return request.headers.host === host && request.headers[LOCAL_MOBILE_HEADER] === access.localToken
        ? `http://${host}` : null
    }
    const tailnet = access.getTailnet()
    const source = directSources.get(request.socket)
    if (source) {
      const route = tailnet?.direct
      return route?.owners.has(source) && request.headers.host === new URL(route.origin).host ? route.origin : null
    }
    return tailnet?.serving && request.headers.host === new URL(tailnet.origin).host &&
      request.headers['tailscale-user-login'] === tailnet.login && request.headers['x-forwarded-proto'] === 'https'
      ? tailnet.origin : null
  }
  let pending = 0
  let bodyBytes = 0
  const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000, maxHeaderSize: 16_384 }, (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Security-Policy', policy)
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    response.setHeader('X-Frame-Options', 'DENY')
    void (async () => {
      const origin = authorizedOrigin(request)
      if (!origin) {
        const message = 'localToken' in access ? 'Open the Budget Terminal mobile window.'
          : 'Connect to Tailscale with the same account as the Budget Terminal computer.'
        response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end(message)
        return
      }
      const path = request.url ?? ''
      if (request.method === 'GET') {
        if (path.startsWith('/api/results/')) {
          if (request.headers['x-budget-terminal'] !== 'mobile' || request.headers['sec-fetch-site'] === 'cross-site') throw new MobileRequestError('Open Budget Terminal from its original page.', 403)
          const id = path.slice('/api/results/'.length)
          const job = jobs.get(id)
          if (!job || job.origin !== origin || job.expires < Date.now()) throw new MobileRequestError('This mobile request expired. Refresh the page.', 404)
          if (!job.result) response.writeHead(202, { 'Content-Type': 'application/json' }).end('{}')
          else {
            response.writeHead(job.result.status, { 'Content-Type': job.result.type }).end(job.result.body)
            discardJob(id)
          }
          return
        }
        if (path === '/') {
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html)
          return
        }
        if (path === '/api/events' && request.headers['sec-fetch-site'] !== 'cross-site' && request.headers.accept === 'text/event-stream') {
          if (subscribers.size >= 12) throw new MobileRequestError('Too many open mobile tabs.', 503)
          response.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' })
          response.write('retry: 5000\n\n')
          subscribers.set(response, request)
          response.once('close', () => subscribers.delete(response))
          return
        }
        const asset = assets.get(path)
        if (asset) {
          if (path.startsWith('/assets/')) response.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
          if (/\.(js|css|json|svg|wasm)$/.test(path)) {
            response.setHeader('Vary', 'Accept-Encoding')
            if (/(?:^|,\s*)gzip(?:\s*,|$)/i.test(request.headers['accept-encoding'] ?? '')) {
              asset.compressed ??= readFile(asset.file).then(bytes => compress(bytes))
              const bytes = await asset.compressed
              response.writeHead(200, { 'Content-Type': asset.type, 'Content-Encoding': 'gzip' }).end(bytes)
              return
            }
          }
          response.writeHead(200, { 'Content-Type': asset.type }).end(await readFile(asset.file))
          return
        }
      }
      if (request.method !== 'POST' || !path.startsWith('/api/call/')) throw new MobileRequestError('Not found.', 404)
      if (request.headers.origin !== origin || request.headers['x-budget-terminal'] !== 'mobile') {
        throw new MobileRequestError('Open Budget Terminal from its original page.', 403)
      }
      const channel = path.slice('/api/call/'.length)
      if (!/^[a-zA-Z0-9:-]{1,80}$/.test(channel)) throw new MobileRequestError('Invalid route.')
      const length = Number(request.headers['content-length'] ?? 0)
      if (!Number.isSafeInteger(length) || length > MOBILE_BODY_LIMIT) throw new MobileRequestError('Request is too large.', 413)
      if (pending >= 512 || bodyBytes + length > 24_000_000) throw new MobileRequestError('Budget Terminal is busy. Try again shortly.', 503)
      pending++
      bodyBytes += length
      try {
        const args = await readArgs(request)
        if (request.headers.prefer === 'respond-async') {
          if (jobs.size >= 512) throw new MobileRequestError('Budget Terminal is busy. Try again shortly.', 503)
          const id = randomUUID()
          const job: { origin: string; expires: number; result?: { status: number; type: string; body: Buffer } } = { origin, expires: Date.now() + 1_800_000 }
          jobs.set(id, job)
          response.writeHead(202, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id }))
          try {
            const result = await run(channel, args)
            job.result = result instanceof MobileDownload
              ? { status: 200, type: result.contentType, body: result.body }
              : { status: 200, type: 'application/json', body: Buffer.from(JSON.stringify(result ?? null)) }
          } catch (error) { job.result = errorResult(error) }
          if (jobs.get(id) !== job) return
          if (resultBytes + job.result.body.length > 64_000_000) job.result = errorResult(new MobileRequestError('Mobile results are too large. Refresh the page.', 503))
          resultBytes += job.result.body.length
          job.expires = Date.now() + 120_000
          return
        }
        const result = await run(channel, args)
        if (authorizedOrigin(request) !== origin) throw new MobileRequestError('Mobile access changed. Reopen Budget Terminal.', 403)
        if (result instanceof MobileDownload) response.writeHead(200, { 'Content-Type': result.contentType }).end(result.body)
        else response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result ?? null))
      } finally {
        pending--
        bodyBytes -= length
      }
    })().catch(error => {
      if (response.headersSent || response.destroyed) { response.destroy(); return }
      const status = error instanceof MobileRequestError ? error.status : 500
      const message = error instanceof MobileRequestError ? error.message : 'Budget Terminal could not complete this request.'
      response.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' }).end(JSON.stringify({ message }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen('localToken' in access ? 0 : access.port ?? MOBILE_HTTP_PORT, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const direct = 'getTailnet' in access && access.directPort !== undefined ? await startMobileDirect(() => access.getTailnet()?.direct, (socket, address) => {
    directSources.set(socket, address)
    server.emit('connection', socket)
  }, access.directPort).catch(() => undefined) : undefined
  const disconnect = () => {
    jobs.clear()
    resultBytes = 0
    for (const response of subscribers.keys()) response.end()
    subscribers.clear()
  }
  const send = (response: ServerResponse, request: IncomingMessage, event: string) => {
    if (!authorizedOrigin(request)) response.end()
    else if (response.writableLength > 262_144) response.destroy()
    else response.write(event)
  }
  const broadcast = (channel: string, payload?: unknown) => {
    if (!subscribers.size) return
    const event = `data: ${JSON.stringify({ channel, payload })}\n\n`
    for (const [response, request] of subscribers) send(response, request, event)
  }
  const heartbeat = setInterval(() => {
    for (const [id, job] of jobs) if (job.expires < Date.now()) discardJob(id)
    for (const [response, request] of subscribers) send(response, request, ': ping\n\n')
  }, 15_000)
  heartbeat.unref()
  return {
    port: (server.address() as { port: number }).port, directPort: direct?.port, broadcast, disconnect,
    close: async () => {
      clearInterval(heartbeat)
      disconnect()
      const closed = new Promise<void>(resolve => server.close(() => resolve()))
      server.closeAllConnections()
      await Promise.all([closed, direct?.close()])
    },
  }
}
