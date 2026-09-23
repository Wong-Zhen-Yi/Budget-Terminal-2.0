import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { acquireDataSession } from '../electron/services/dataSession.js'

const appRoot = fileURLToPath(new URL('../', import.meta.url))

export async function startWebServer(options: { port?: number; production?: boolean } = {}) {
  const release = acquireDataSession()
  try {
    return await startLockedWebServer(options, release)
  } catch (error) {
    release()
    throw error
  }
}

async function startLockedWebServer(options: { port?: number; production?: boolean }, release: () => void) {
  const { createWebApi } = await import('./api.js')
  const { cache } = await import('../electron/services/cache.js')
  const production = options.production ?? false
  const staticRoot = join(appRoot, 'out', 'web')
  if (production) await readFile(join(staticRoot, 'index.html'))
  const api = createWebApi()
  const pending = new Set<Promise<void>>()
  const server = createServer((request, response) => {
    // This is a local, single-user server. Reject cross-site and DNS rebinding requests.
    const host = request.headers.host
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const allowedHosts = [`localhost:${port}`, `127.0.0.1:${port}`]
    if (!host || !allowedHosts.includes(host) ||
      (request.headers.origin && request.headers.origin !== `http://${host}`) ||
      request.headers['sec-fetch-site'] === 'cross-site') {
      response.writeHead(403)
      response.end('Local same-origin access required')
      return
    }
    if (request.url?.startsWith('/__budget_api/')) {
      const operation = api.handle(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(400)
        response.end()
      }).finally(() => pending.delete(operation))
      pending.add(operation)
    } else if (vite) {
      vite.middlewares(request, response)
    } else {
      void serveStatic(request.url ?? '/', response)
    }
  })
  // Keep ownership alive with the server, even if its caller discards the close handle.
  server.once('close', () => { void Promise.allSettled([...pending]).then(release) })
  let vite: Awaited<ReturnType<typeof import('vite')['createServer']>> | null = null

  async function serveStatic(url: string, response: import('node:http').ServerResponse) {
    try {
      const pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname)
      const path = resolve(staticRoot, `.${pathname === '/' ? '/index.html' : pathname}`)
      if (!path.startsWith(staticRoot + sep)) throw new Error('Invalid path')
      const types: Record<string, string> = {
        '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
        '.woff2': 'font/woff2', '.ico': 'image/x-icon',
      }
      const contents = await readFile(path)
      response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' })
      response.end(contents)
    } catch {
      response.writeHead(404)
      response.end('Not found')
    }
  }

  try {
    vite = production ? null : await (await import('vite')).createServer({
      configFile: join(appRoot, 'vite.web.config.ts'),
      server: { middlewareMode: true, hmr: { server } },
    })
    await new Promise<void>((done, reject) => {
      server.once('error', reject)
      server.listen(options.port ?? 3000, '127.0.0.1', done)
    })
  } catch (error) {
    api.close()
    await vite?.close()
    throw error
  }
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 3000
  return {
    url: `http://127.0.0.1:${port}`,
    async close() {
      api.close()
      server.closeAllConnections()
      try {
        await Promise.all([
          vite?.close(),
          new Promise<void>((done) => server.close(() => done())),
        ])
      } finally {
        // A disconnected client may still have a JSON-store mutation in flight.
        await Promise.allSettled([...pending])
        cache.close()
        release()
      }
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = await startWebServer({
    port: Number(process.env.PORT ?? 3000),
    production: process.argv.includes('--production'),
  })
  console.log(`Budget Terminal is running at ${server.url}`)
  if (process.argv.includes('--open')) {
    const command = process.platform === 'win32' ? 'rundll32.exe'
      : process.platform === 'darwin' ? 'open' : 'xdg-open'
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', server.url] : [server.url]
    execFile(command, args, { windowsHide: true }, (error) => {
      if (error) console.warn(`Could not open the browser automatically. Open ${server.url} manually.`)
    })
  }
  const stop = () => { void server.close().then(() => process.exit(0)) }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}
