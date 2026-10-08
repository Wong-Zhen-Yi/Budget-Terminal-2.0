import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import type { SavedDataChanged } from '../shared/contract.js'

const SESSION_MS = 30 * 24 * 60 * 60_000
const PAIRING_MS = 10 * 60_000
const MAX_BODY = 2 * 1024 * 1024
const COOKIE = 'BudgetTerminalSession'
const REQUEST_COOKIE = 'BudgetTerminalAccessRequest'
const ACCESS_REQUEST_MS = 5 * 60_000

export interface WebServerOptions {
  port: number
  rendererDirectory: string
  tailscaleOrigin?: string
  sessionFile?: string
  invoke: (channel: string, args: unknown[]) => Promise<unknown>
  subscribe: (listener: (event: SavedDataChanged) => void) => () => void
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

function equal(actual: string, expected: string): boolean {
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function cookie(request: IncomingMessage, name: string): string {
  return (request.headers.cookie ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? ''
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new HttpError(415, 'Expected application/json.')
  if (Number(request.headers['content-length'] ?? 0) > MAX_BODY) throw new HttpError(413, 'Request too large.')
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length
    if (length > MAX_BODY) throw new HttpError(413, 'Request too large.')
    chunks.push(chunk)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    return parsed as Record<string, unknown>
  } catch { throw new HttpError(400, 'Invalid JSON request.') }
}

/** Browser credentials stay in HttpOnly cookies; only their hashes are saved on the PC. */
export async function startWebServer(options: WebServerOptions) {
  const root = await realpath(options.rendererDirectory)
  await readFile(resolve(root, 'index.html'))
  const sessions = new Map<string, { csrf: string; expires: number; origin: string }>()
  const sessionKey = (token: string) => createHash('sha256').update(token).digest('hex')
  if (options.sessionFile) {
    try {
      const saved: unknown = JSON.parse(await readFile(options.sessionFile, 'utf8'))
      if (!Array.isArray(saved) || saved.length > 10) throw new Error('Invalid saved Remote sessions.')
      for (const record of saved) {
        if (!record || typeof record !== 'object' || typeof record.hash !== 'string' || !/^[a-f0-9]{64}$/.test(record.hash) ||
          typeof record.expires !== 'number' || !Number.isFinite(record.expires) || typeof record.origin !== 'string') throw new Error('Invalid saved Remote session.')
        if (record.expires > Date.now()) sessions.set(record.hash, { csrf: randomBytes(32).toString('hex'), expires: record.expires, origin: record.origin })
      }
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Could not read saved Remote approvals.')
    }
  }
  let writes: Promise<void> = Promise.resolve()
  const saveSessions = () => {
    const file = options.sessionFile
    if (!file) return Promise.resolve()
    const contents = JSON.stringify([...sessions].map(([hash, { expires, origin }]) => ({ hash, expires, origin })))
    const result = writes.then(async () => {
      await mkdir(dirname(file), { recursive: true })
      const temporary = `${file}.tmp`
      await writeFile(temporary, `${contents}\n`, { mode: 0o600 })
      await rename(temporary, file)
    })
    writes = result.catch(() => {})
    return result
  }
  const accessRequests = new Map<string, { id: string; label: string; requestedAt: number; expiresAt: number; origin: string; state: 'pending' | 'approved' | 'denied' }>()
  const streams = new Map<ServerResponse, string>()
  const pending = new Set<Promise<void>>()
  let closing = false
  let pairingCode = ''
  let pairingExpiresAt = 0
  let attempts = 0
  let attemptsResetAt = 0
  let codeAttempts = 0
  let requestAttempts = 0
  let requestAttemptsResetAt = 0
  let port = options.port

  const rotate = () => {
    let next: string
    do { next = randomInt(10_000).toString().padStart(4, '0') } while (next === pairingCode)
    pairingCode = next
    codeAttempts = 0
    pairingExpiresAt = Date.now() + PAIRING_MS
  }
  rotate()
  const send = (response: ServerResponse, status: number, value: unknown) => {
    if (response.destroyed || response.writableEnded) return
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify(value ?? null))
  }
  const expireStreams = () => {
    for (const [response, token] of streams) {
      if (!sessions.has(token)) {
        response.end('event: session-expired\ndata: {}\n\n')
        streams.delete(response)
      }
    }
  }
  const prune = () => {
    for (const [token, session] of sessions) if (session.expires <= Date.now()) sessions.delete(token)
    for (const [token, access] of accessRequests) if (access.expiresAt <= Date.now()) accessRequests.delete(token)
    expireStreams()
  }
  const setSessionCookie = (response: ServerResponse, token: string, origin: string) => {
    response.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${origin.startsWith('https:') ? '; Secure' : ''}`)
  }
  const issueSession = async (response: ServerResponse, origin: string) => {
    if (sessions.size >= 10) throw new HttpError(409, 'Session limit reached. Revoke sessions on the desktop.')
    const newToken = randomBytes(32).toString('hex')
    const csrf = randomBytes(32).toString('hex')
    const key = sessionKey(newToken)
    const session = { csrf, expires: Date.now() + SESSION_MS, origin }
    sessions.set(key, session)
    try { await saveSessions() }
    catch { sessions.delete(key); throw new HttpError(500, 'Could not remember this browser. Check storage on the PC and try again.') }
    if (closing || sessions.get(key) !== session) throw new HttpError(401, 'Remote access ended while connecting. Request access again.')
    setSessionCookie(response, newToken, origin)
    return { authenticated: true, csrf }
  }
  const originFor = (request: IncomingMessage): string => {
    // Serve rewrites Host and supplies the original HTTPS host in forwarded headers.
    const forwarded = request.headers['x-forwarded-host']
    if (forwarded !== undefined || request.headers['x-forwarded-proto'] !== undefined) {
      if (typeof forwarded !== 'string' || request.headers['x-forwarded-proto'] !== 'https' ||
        !options.tailscaleOrigin || `https://${forwarded}` !== options.tailscaleOrigin) throw new HttpError(403, 'Unrecognized HTTPS proxy.')
      return options.tailscaleOrigin
    }
    if (options.tailscaleOrigin && `https://${request.headers.host}` === options.tailscaleOrigin) throw new HttpError(403, 'HTTPS proxy headers required.')
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(request.headers.host ?? '')) throw new HttpError(403, 'Unrecognized host.')
    return `http://${request.headers.host}`
  }
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'same-origin')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob: https:; worker-src 'self' blob:; frame-src https://www.youtube.com https://www.youtube-nocookie.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
    const run = async () => {
      if (closing) throw new HttpError(503, 'Budget Terminal is shutting down.')
      const origin = originFor(request)
      if (request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site request rejected.')
      if (request.headers.origin !== undefined && request.headers.origin !== origin) throw new HttpError(403, 'Cross-site request rejected.')
      const url = new URL(request.url ?? '/', origin)
      const rawToken = cookie(request, COOKIE)
      const token = sessionKey(rawToken)
      prune()
      const session = sessions.get(token)
      const authenticated = session?.origin === origin
      if (url.pathname === '/api/session' && request.method === 'GET') {
        if (authenticated) {
          session.expires = Date.now() + SESSION_MS
          await saveSessions()
          if (closing || sessions.get(token) !== session) throw new HttpError(401, 'Remote access ended.')
          setSessionCookie(response, rawToken, origin)
        }
        return send(response, 200, authenticated ? { authenticated: true, csrf: session.csrf } : { authenticated: false })
      }
      if (url.pathname === '/api/access-request' && ['GET', 'POST'].includes(request.method ?? '')) {
        const accessToken = cookie(request, REQUEST_COOKIE)
        const access = accessRequests.get(accessToken)
        if (request.method === 'GET') {
          if (authenticated) return send(response, 200, { state: 'approved', authenticated: true, csrf: session.csrf })
          if (!access || access.origin !== origin) return send(response, 200, { state: 'expired' })
          if (access.state === 'approved') {
            // Consume approval before awaiting disk writes so parallel polls cannot claim it twice.
            accessRequests.delete(accessToken)
            const session = await issueSession(response, origin)
            return send(response, 200, { state: 'approved', ...session })
          }
          return send(response, 200, { state: access.state, id: access.id, expiresAt: access.expiresAt })
        }
        if (request.headers.origin !== origin || request.headers['x-budget-terminal'] !== 'browser') throw new HttpError(403, 'Request access from the Budget Terminal page.')
        const input = await body(request)
        if (Object.keys(input).length) throw new HttpError(400, 'Invalid access request.')
        if (closing) throw new HttpError(503, 'Budget Terminal is shutting down.')
        if (access?.origin === origin && access.state !== 'denied' && access.expiresAt > Date.now()) return send(response, 200, { state: 'pending', id: access.id, expiresAt: access.expiresAt })
        if (Date.now() >= requestAttemptsResetAt) { requestAttempts = 0; requestAttemptsResetAt = Date.now() + 60_000 }
        if (++requestAttempts > 5) throw new HttpError(429, 'Too many access requests. Wait a minute before trying again.')
        if (accessRequests.size >= 10) throw new HttpError(429, 'Access request queue is full. Try again after the desktop reviews requests.')
        const requestToken = randomBytes(32).toString('hex')
        const id = randomBytes(8).toString('hex').toUpperCase()
        const agent = request.headers['user-agent'] ?? ''
        const label = /iPad/i.test(agent) ? 'iPad browser' : /iPhone/i.test(agent) ? 'iPhone browser' : 'Web browser'
        const requestedAt = Date.now()
        const expiresAt = requestedAt + ACCESS_REQUEST_MS
        accessRequests.set(requestToken, { id, label, requestedAt, expiresAt, origin, state: 'pending' })
        response.setHeader('Set-Cookie', `${REQUEST_COOKIE}=${requestToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ACCESS_REQUEST_MS / 1000}${origin.startsWith('https:') ? '; Secure' : ''}`)
        return send(response, 200, { state: 'pending', id, expiresAt })
      }
      if (url.pathname === '/api/pair' && request.method === 'POST') {
        if (request.headers.origin !== origin || request.headers['x-budget-terminal'] !== 'browser') throw new HttpError(403, 'Pair from the Budget Terminal page.')
        if (Date.now() >= attemptsResetAt) { attempts = 0; attemptsResetAt = Date.now() + 60_000 }
        if (++attempts > 10) throw new HttpError(429, 'Too many attempts. Wait a minute before pairing again.')
        if (codeAttempts >= 10) throw new HttpError(429, 'Too many attempts for this code. Generate a new code on the desktop.')
        codeAttempts++
        const input = await body(request)
        if (typeof input.code !== 'string' || Object.keys(input).some((key) => key !== 'code') ||
          Date.now() >= pairingExpiresAt || !equal(input.code.trim(), pairingCode)) throw new HttpError(401, 'Pairing code is invalid or expired. Get a new code on the desktop.')
        if (closing) throw new HttpError(503, 'Budget Terminal is shutting down.')
        rotate()
        const result = await issueSession(response, origin)
        const accessCookie = cookie(request, REQUEST_COOKIE)
        if (accessRequests.get(accessCookie)?.origin === origin) accessRequests.delete(accessCookie)
        return send(response, 200, result)
      }
      if (url.pathname.startsWith('/api/')) {
        if (!authenticated) throw new HttpError(401, 'Pair this browser with Budget Terminal.')
        if (request.method === 'POST') {
          if (request.headers.origin !== origin || typeof request.headers['x-budget-csrf'] !== 'string' || !equal(request.headers['x-budget-csrf'], session.csrf)) throw new HttpError(403, 'Invalid browser session request.')
          if (url.pathname === '/api/logout') {
            sessions.delete(token)
            expireStreams()
            await saveSessions()
            response.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${origin.startsWith('https:') ? '; Secure' : ''}`)
            return send(response, 200, { authenticated: false })
          }
          if (url.pathname === '/api/invoke') {
            const input = await body(request)
            if (typeof input.channel !== 'string' || !Array.isArray(input.args) || input.args.length > 1 || Object.keys(input).some((key) => !['channel', 'args'].includes(key))) throw new HttpError(400, 'Invalid service call.')
            // Authorization can expire while a request body is being uploaded.
            if (sessions.get(token) !== session || session.expires <= Date.now()) throw new HttpError(401, 'Browser session expired.')
            let result: unknown
            try { result = await options.invoke(input.channel, input.args) }
            catch (error) {
              if (error instanceof TypeError) throw new HttpError(400, error.message)
              throw new HttpError(500, 'Service failed. Check saved records before repeating an edit.')
            }
            return send(response, 200, result)
          }
        }
        if (url.pathname === '/api/events' && request.method === 'GET') {
          if (streams.size >= 20) throw new HttpError(429, 'Too many event connections.')
          response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
          response.write(': connected\n\n')
          streams.set(response, token)
          response.on('close', () => streams.delete(response))
          return
        }
        throw new HttpError(404, 'Unknown API endpoint.')
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.')
      let decoded: string
      try { decoded = decodeURIComponent(url.pathname) } catch { throw new HttpError(400, 'Invalid asset path.') }
      if (decoded.includes('\\') || decoded.includes('\0')) throw new HttpError(404, 'Asset not found.')
      const candidate = resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`)
      if (!candidate.startsWith(`${root}${sep}`)) throw new HttpError(404, 'Asset not found.')
      let filename: string
      let contents: Buffer
      try {
        filename = await realpath(candidate)
        if (!filename.startsWith(`${root}${sep}`) || filename.endsWith('.map')) throw new Error()
        contents = await readFile(filename)
      } catch { throw new HttpError(404, 'Asset not found.') }
      const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.mjs': 'text/javascript' }
      response.writeHead(200, { 'Content-Type': types[extname(filename)] ?? 'application/octet-stream', 'Content-Length': contents.length })
      response.end(request.method === 'HEAD' ? undefined : contents)
    }
    const task = run().catch((error: unknown) => {
      request.resume()
      send(response, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'Web request failed.' })
    })
    pending.add(task)
    void task.finally(() => pending.delete(task))
  })
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); port = (server.address() as { port: number }).port; resolve() })
  })
  let serverError: string | undefined
  server.on('error', () => { serverError = 'Web server stopped accepting connections.' })
  const stopListening = options.subscribe((event) => {
    prune()
    for (const response of streams.keys()) {
      response.write(`event: saved-data-changed\ndata: ${JSON.stringify(event)}\n\n`)
      if (event.domains.includes('portfolio')) response.write('event: portfolio-changed\ndata: {}\n\n')
    }
  })
  const heartbeat = setInterval(() => {
    prune()
    for (const response of streams.keys()) response.write(': heartbeat\n\n')
  }, 15_000)
  heartbeat.unref()
  let stopped: Promise<void> | undefined
  return {
    status() {
      prune()
      return { running: !closing && !serverError, port, pairingCode: Date.now() < pairingExpiresAt && codeAttempts < 10 ? pairingCode : undefined, pairingExpiresAt, sessionCount: sessions.size, connectionCount: new Set(streams.values()).size, accessRequests: [...accessRequests.values()].filter(access => access.state === 'pending').map(({ id, label, requestedAt, expiresAt }) => ({ id, label, requestedAt, expiresAt })), error: serverError }
    },
    rotate,
    decideAccess(id: string, approve: boolean) {
      prune()
      if (typeof id !== 'string' || typeof approve !== 'boolean') throw new Error('Invalid access decision.')
      const access = [...accessRequests.values()].find(access => access.id === id && access.state === 'pending')
      if (!access) throw new Error('Access request expired or was already reviewed.')
      access.state = approve ? 'approved' : 'denied'
    },
    async revoke() { sessions.clear(); accessRequests.clear(); expireStreams(); await saveSessions() },
    stop(): Promise<void> {
      stopped ??= (async () => {
        closing = true
        clearInterval(heartbeat)
        stopListening()
        sessions.clear()
        accessRequests.clear()
        expireStreams()
        const closed = new Promise<void>((resolve) => server.close(() => resolve()))
        server.closeIdleConnections()
        await Promise.allSettled([...pending])
        await writes
        server.closeAllConnections()
        await closed
      })()
      return stopped
    },
  }
}
