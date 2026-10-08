import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { WebAccessStatus } from '../shared/contract.js'
import { subscribeSavedDataChanged } from '../services/savedDataEvents.js'
import { createWebRoutes } from './routes.js'
import { startWebServer } from './server.js'

const PORT = 4317
let listenPort = PORT
let enabled = false
let error: string | undefined
let tailscaleOrigin: string | undefined
let rendererDirectory = ''
let configurationPath = ''
let server: Awaited<ReturnType<typeof startWebServer>> | undefined
let queue: Promise<unknown> = Promise.resolve()
let closing = false

async function discoverTailscaleOrigin(): Promise<string | undefined> {
  try {
    const { stdout } = await promisify(execFile)('tailscale', ['status', '--json'], { windowsHide: true, timeout: 5_000, maxBuffer: 2 * 1024 * 1024 })
    const status = JSON.parse(stdout) as { Self?: { DNSName?: string } }
    const hostname = status.Self?.DNSName?.replace(/\.$/, '').toLowerCase()
    if (hostname && /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(hostname)) return `https://${hostname}`
  } catch { /* Local browser use still works without Tailscale. */ }
  return undefined
}

async function start(): Promise<void> {
  if (server || !enabled || closing) return
  error = undefined
  tailscaleOrigin = await discoverTailscaleOrigin()
  try {
    server = await startWebServer({ port: listenPort, rendererDirectory, tailscaleOrigin, sessionFile: join(dirname(configurationPath), 'remote-sessions.json'), invoke: createWebRoutes(), subscribe: subscribeSavedDataChanged })
  } catch {
    error = 'Could not start Remote. Build the app with npm run build, check saved approvals and that port 4317 is free, then enable it again.'
  }
}

export function getWebAccessStatus(): WebAccessStatus {
  const live = server?.status()
  const port = live?.port ?? listenPort
  return { enabled, running: false, port, localUrl: `http://127.0.0.1:${port}`, tailscaleUrl: tailscaleOrigin, sessionCount: 0, error, ...live }
}

export async function initializeWebAccess(directory: string, dataDirectory: string, port = PORT): Promise<void> {
  rendererDirectory = directory
  configurationPath = join(dataDirectory, 'web-access.json')
  listenPort = port
  closing = false
  try { enabled = (JSON.parse(await readFile(configurationPath, 'utf8')) as { enabled?: unknown }).enabled === true }
  catch { enabled = false }
  await start()
}

export function configureWebAccess(value: boolean): Promise<WebAccessStatus> {
  if (typeof value !== 'boolean') return Promise.reject(new Error('Invalid Remote setting.'))
  const run = async () => {
    if (closing || !configurationPath) throw new Error('Remote is unavailable during shutdown.')
    // Pairing codes and pending requests are never persisted.
    await mkdir(dirname(configurationPath), { recursive: true })
    const temporary = `${configurationPath}.tmp`
    await writeFile(temporary, `${JSON.stringify({ enabled: value })}\n`, { mode: 0o600 })
    await rename(temporary, configurationPath)
    enabled = value
    if (!enabled) {
      await server?.revoke()
      await server?.stop()
      server = undefined
      await rm(join(dirname(configurationPath), 'remote-sessions.json'), { force: true })
      error = undefined
    }
    else await start()
    return getWebAccessStatus()
  }
  const result = queue.then(run)
  queue = result.catch(() => {})
  return result
}

export function rotateWebPairingCode(): WebAccessStatus {
  server?.rotate()
  return getWebAccessStatus()
}

export async function revokeWebSessions(): Promise<WebAccessStatus> {
  if (server) await server.revoke()
  else if (configurationPath) await rm(join(dirname(configurationPath), 'remote-sessions.json'), { force: true })
  return getWebAccessStatus()
}

export async function stopWebAccess(): Promise<void> {
  closing = true
  await queue
  await server?.stop()
  server = undefined
}

export function decideWebAccess(id: string, approve: boolean): WebAccessStatus {
  if (!server || closing) throw new Error('Remote is unavailable.')
  server.decideAccess(id, approve)
  return getWebAccessStatus()
}
