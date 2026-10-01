import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { catalog, connectionTool, failed, validateCall } from '../../mcp/catalog.js'
import { BRIDGE_VERSION, runtimePath } from '../../mcp/runtime.js'
import { mutationDomains, type Operation } from '../../mcp/operations.js'
import type { McpStatus, SavedDataDomain } from '../shared/contract.js'

export interface BridgeOptions {
  routes: Map<Operation, (request: unknown) => unknown>
  onChanged: (domains: SavedDataDomain[]) => void
  descriptorPath?: string
}

/** This bridge owns no stores; every operation executes in the existing Electron owner. */
export async function startBridge({ routes, onChanged, descriptorPath = runtimePath() }: BridgeOptions) {
  for (const entry of catalog) if (!routes.has(entry.operation)) throw new Error(`Missing MCP service route: ${entry.operation}`)
  const token = randomBytes(32).toString('hex')
  const expected = Buffer.from(`Bearer ${token}`)
  let closing = false
  let lastSeen = 0
  let lastActivity = 0
  let activeCalls = 0
  const status: McpStatus = {
    available: true,
    tools: catalog.length + 1,
    get connected() { return !closing && (activeCalls > 0 || Date.now() - lastSeen < 15_000) },
    get active() { return !closing && (activeCalls > 0 || Date.now() - lastActivity < 1_500) },
  }
  const pending = new Set<Promise<void>>()
  const server = createServer((request, response) => {
    const send = (status: number, value: unknown) => {
      if (!response.destroyed) {
        response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        response.end(JSON.stringify(value))
      }
    }
    const run = async () => {
      if (closing) return send(503, { error: 'Budget Terminal is shutting down.' })
      const actual = Buffer.from(request.headers.authorization ?? '')
      if (request.headers.origin !== undefined || request.headers.host !== `127.0.0.1:${port}` || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        request.resume()
        return send(403, { error: 'Unauthorized Budget Terminal request.' })
      }
      if (request.method !== 'POST' || request.url !== '/invoke') {
        request.resume()
        return send(404, { error: 'Unknown bridge endpoint.' })
      }
      if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
        request.resume()
        return send(415, { error: 'Expected application/json.' })
      }
      const maximum = 2 * 1024 * 1024
      if (Number(request.headers['content-length'] ?? 0) > maximum) {
        request.resume()
        return send(413, { error: 'Request body too large.' })
      }
      const chunks: Buffer[] = []
      let length = 0
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        length += chunk.length
        if (length > maximum) { request.resume(); send(413, { error: 'Request body too large.' }); return }
        chunks.push(chunk)
      }
      let call: { name: string; arguments: unknown }
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
          Object.keys(parsed).some((key) => !['name', 'arguments'].includes(key)) ||
          typeof (parsed as { name?: unknown }).name !== 'string') throw new Error('Malformed call')
        call = parsed as typeof call
      } catch { return send(400, { error: 'Malformed bridge call.' }) }
      if (call.name === connectionTool.name) {
        if (!call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments) || Object.keys(call.arguments).length) return send(400, { error: 'Connection status takes no arguments.' })
        lastSeen = Date.now()
        return send(200, { available: true, version: BRIDGE_VERSION, tools: catalog.length + 1 })
      }
      let validated: ReturnType<typeof validateCall>
      try { validated = validateCall(call.name, call.arguments) } catch (error) {
        return send(400, { error: error instanceof Error ? error.message : 'Invalid call.' })
      }
      lastSeen = Date.now()
      activeCalls += 1
      try {
        const result = await routes.get(validated.operation)!(validated.request)
        if (validated.operation in mutationDomains && !failed(result)) {
          const domain = mutationDomains[validated.operation as keyof typeof mutationDomains]
          onChanged(domain === 'settings' ? ['settings'] : [domain, 'settings'])
        }
        send(200, result)
      } catch { send(500, { error: 'Budget Terminal service failed. Read saved records before repeating a write.' }) }
      finally {
        activeCalls -= 1
        lastSeen = Date.now()
        lastActivity = lastSeen
      }
    }
    const task = run().catch(() => send(400, { error: 'Could not read bridge request.' }))
    pending.add(task)
    void task.finally(() => pending.delete(task))
  })
  server.requestTimeout = 10_000
  server.headersTimeout = 10_000
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve((server.address() as { port: number }).port)
    })
  })
  server.on('error', () => { closing = true; status.available = false; status.error = 'The local MCP bridge stopped accepting requests.' })
  try {
    const directory = dirname(descriptorPath)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    if (process.platform === 'win32') {
      const execute = promisify(execFile)
      const { stdout } = await execute('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true })
      const sid = stdout.match(/S-1-[\d-]+/)?.[0]
      if (!sid) throw new Error('Could not identify the runtime descriptor owner.')
      await execute('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { windowsHide: true })
    } else await chmod(directory, 0o700)
    const temporary = `${descriptorPath}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify({ version: BRIDGE_VERSION, port, token, pid: process.pid }), { mode: 0o600 })
    await rename(temporary, descriptorPath)
  } catch (error) {
    server.close()
    await rm(`${descriptorPath}.${process.pid}.tmp`, { force: true })
    throw error
  }
  let stopped: Promise<void> | undefined
  return {
    status,
    stop(): Promise<void> {
      stopped ??= (async () => {
        closing = true
        status.available = false
        const closed = new Promise<void>((resolve) => server.close(() => resolve()))
        server.closeIdleConnections()
        await Promise.allSettled([...pending])
        await closed
        await rm(descriptorPath, { force: true })
      })()
      return stopped
    },
  }
}
