import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MOBILE_DIRECT_LOCAL_PORT, type MobileAccessStatus } from '../shared/mobileAccess.js'
import { createMobileHttp, type MobileRequest } from './mobileHttp.js'
import { readMobileTailnet, type MobileTailnet } from './mobileTailscale.js'

let server: Awaited<ReturnType<typeof createMobileHttp>> | undefined
let localServer: Awaited<ReturnType<typeof createMobileHttp>> | undefined
let tailnet: MobileTailnet | null = null
let enabled = false
let stopped = false
let error = ''
let initialization: Promise<void> | undefined
let changes = Promise.resolve()
let refresh: ReturnType<typeof setInterval> | undefined
let checking: Promise<void> | undefined
const localSetting = () => join(app.getPath('userData'), 'mobile-access.json')
const demo = () => Boolean(process.env.BUDGET_TERMINAL_DEMO_DIR)

async function refreshTailnet() {
  if (!enabled || stopped) return
  checking ??= readMobileTailnet().then(next => {
    if (!enabled || stopped) return
    if (tailnet?.origin !== next?.origin || tailnet?.login !== next?.login || tailnet?.direct?.origin !== next?.direct?.origin) server?.disconnect()
    tailnet = next
  }).finally(() => { checking = undefined })
  await checking
}

async function listen() {
  if (stopped || !enabled) return
  try {
    const [{ createMobileRoutes }, { telegramProfile }] = await Promise.all([import('./mobileRoutes.js'), import('./agentsHost.js')])
    if (stopped || !enabled) return
    server = await createMobileHttp(join(import.meta.dirname, '../renderer'), createMobileRoutes(telegramProfile), {
      getTailnet: () => tailnet, directPort: MOBILE_DIRECT_LOCAL_PORT,
    })
    refresh = setInterval(() => { void refreshTailnet() }, 15_000)
    refresh.unref()
    await refreshTailnet()
    error = ''
  } catch {
    error = 'Could not start Mobile Access. Rebuild Budget Terminal and check that local port 4387 is free.'
  }
}

export function startMobileAccess() {
  return initialization ??= (async () => {
    if (demo() || stopped) return
    try { enabled = JSON.parse(await readFile(localSetting(), 'utf8'))?.enabled === true }
    catch (reason) { if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') error = 'The local Mobile Access preference could not be read.' }
    if (enabled) await listen()
  })()
}

export async function startLocalMobileAccess(run: MobileRequest) {
  if (stopped) throw new Error('Budget Terminal is closing.')
  const token = randomUUID()
  const listener = await createMobileHttp(join(import.meta.dirname, '../renderer'), run, { localToken: token })
  if (stopped) {
    await listener.close()
    throw new Error('Budget Terminal is closing.')
  }
  localServer = listener
  return {
    origin: `http://127.0.0.1:${listener.port}`, token,
    close: async () => {
      if (localServer !== listener) return
      localServer = undefined
      await listener.close()
    },
  }
}

function snapshot(): MobileAccessStatus {
  const url = enabled && server && tailnet?.serving ? `${tailnet.origin}/` : ''
  const directUrl = enabled && server?.directPort && tailnet?.direct ? `${tailnet.direct.origin}/` : ''
  return {
    enabled,
    available: !demo(),
    url,
    directUrl,
    message: demo() ? 'Mobile Access is disabled for demo profiles.' : error ||
      (!enabled ? 'Mobile Access is off.' : !server ? 'Mobile Access is starting.' : !tailnet ? 'Sign in to Tailscale on this computer with a personal Tailscale account.' :
        url || directUrl ? 'Mobile Access is configured on this computer.' : 'Configure a private Tailscale proxy on this computer, then check again.'),
  }
}

export async function mobileAccessStatus() {
  await startMobileAccess()
  await refreshTailnet()
  return snapshot()
}

async function closeListener() {
  clearInterval(refresh)
  tailnet = null
  const active = server
  server = undefined
  await active?.close()
}

export async function configureMobileAccess(value: unknown) {
  await startMobileAccess()
  if (typeof value !== 'boolean' || demo() || stopped) return snapshot()
  const change = changes.then(async () => {
    try {
      if (value) {
        await writeFile(localSetting(), '{"enabled":true}\n', { mode: 0o600 })
        enabled = true
        if (!server) await listen()
      } else {
        enabled = false
        await closeListener()
        await rm(localSetting(), { force: true })
        error = ''
      }
    } catch {
      error = 'Could not save the Mobile Access preference.'
    }
    return snapshot()
  })
  changes = change.then(() => undefined)
  return change
}

export function broadcastMobile(channel: string, payload?: unknown) {
  server?.broadcast(channel, payload)
  localServer?.broadcast(channel, payload)
}

export async function stopMobileAccess() {
  stopped = true
  await initialization
  await changes
  const local = localServer
  localServer = undefined
  await Promise.all([closeListener(), local?.close()])
}

export async function telegramMobileLink() {
  const { url, directUrl, enabled } = await mobileAccessStatus()
  if (directUrl) {
    return `Connect Tailscale on your iPhone or iPad, then open this direct link in Safari: ${directUrl}\nIt works without Tailscale DNS. Keep Budget Terminal open on the computer.${url ? `\nHTTPS link for devices using MagicDNS: ${url}` : ''}`
  }
  return url ? `Open Budget Terminal in Safari on your iPhone or iPad: ${url}\nConnect Tailscale with the same account as this computer. If Safari can’t find the address, enable Use Tailscale DNS in the Tailscale app and reconnect.`
    : enabled ? 'The private Tailscale link is unavailable. Check Mobile Access under Settings → Labs on the computer.'
      : 'Enable Mobile Access under Settings → Labs on the computer, then send /mobile again.'
}
