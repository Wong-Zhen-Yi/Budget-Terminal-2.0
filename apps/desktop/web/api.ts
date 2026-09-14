import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerServiceHandlers } from '../electron/ipc/serviceHandlers.js'
import { CHANNELS } from '../electron/shared/contract.js'
import { yahooProvider } from '../electron/services/provider.js'
import { watchPortfolios } from '../electron/services/portfolioStore.js'

const MAX_BODY_BYTES = 10 * 1024 * 1024

export function createWebApi() {
  const routes = new Map<string, (request: unknown) => unknown>()
  registerServiceHandlers((channel, run) => {
    routes.set(channel, run as (request: unknown) => unknown)
  })
  routes.set(CHANNELS.maintenance, async (request) => {
    const { action, contents } = request as { action: string; contents?: string }
    if (action === 'clearUserData') return yahooProvider.clearUserData()
    if (action === 'resetCache') return yahooProvider.resetCache()
    if (action !== 'exportUserData' && action !== 'importUserData') {
      throw new Error('Unknown maintenance action')
    }
    if (action === 'importUserData' && typeof contents !== 'string') {
      throw new Error('A JSON backup is required')
    }
    // Never accept a filesystem path from an HTTP client.
    const directory = await mkdtemp(join(tmpdir(), 'budget-terminal-backup-'))
    const path = join(directory, 'backup.json')
    try {
      if (action === 'importUserData') {
        await writeFile(path, contents!, 'utf8')
        const result = await yahooProvider.importUserData(path)
        result.data.path = ''
        if (result.data.performed) result.data.message = 'Backup imported.'
        return result
      }
      const result = await yahooProvider.exportUserData(path)
      const backup = result.data.performed ? await readFile(path, 'utf8') : null
      result.data.path = ''
      return { result, contents: backup }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  const clients = new Set<ServerResponse>()
  const stopWatching = watchPortfolios(() => {
    for (const client of clients) client.write('data: changed\n\n')
  })
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(': heartbeat\n\n')
  }, 25_000)
  heartbeat.unref()

  const json = (response: ServerResponse, status: number, value: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(value))
  }

  return {
    async handle(request: IncomingMessage, response: ServerResponse) {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
      if (pathname === '/__budget_api/events' && request.method === 'GET') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        })
        response.write(': connected\n\n')
        clients.add(response)
        request.on('close', () => clients.delete(response))
        return
      }
      const channel = decodeURIComponent(pathname.slice('/__budget_api/'.length))
      const run = routes.get(channel)
      if (!run) return json(response, 404, { error: 'Unknown API route' })
      if (request.method !== 'POST') return json(response, 405, { error: 'POST required' })
      if (request.headers['content-type'] !== 'application/json' || request.headers['x-budget-terminal'] !== 'browser') {
        return json(response, 403, { error: 'Browser API headers required' })
      }
      try {
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of request) {
          size += chunk.length
          if (size > MAX_BODY_BYTES) {
            json(response, 413, { error: 'Request exceeds 10 MB' })
            return
          }
          chunks.push(Buffer.from(chunk))
        }
        let args: unknown
        try {
          args = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          return json(response, 400, { error: 'Invalid JSON' })
        }
        if (!Array.isArray(args) || args.length > 1) {
          return json(response, 400, { error: 'Expected an array with at most one request' })
        }
        json(response, 200, await run(args[0]))
      } catch (error) {
        console.error('Browser API request failed:', channel, error)
        json(response, 500, { error: 'The request could not be completed. Check the server log.' })
      }
    },
    close() {
      clearInterval(heartbeat)
      stopWatching()
      for (const client of clients) client.end()
      clients.clear()
    },
  }
}
