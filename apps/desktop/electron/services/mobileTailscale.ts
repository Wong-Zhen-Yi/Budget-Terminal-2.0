import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isIPv4 } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { MOBILE_DIRECT_PORT, MOBILE_DIRECT_TARGET, MOBILE_HTTPS_PORT, MOBILE_PROXY_TARGET } from '../shared/mobileAccess.js'

const macCli = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'

export interface MobileTailnet {
  origin: string
  login: string
  serving: boolean
  direct?: { origin: string; address: string; owners: ReadonlySet<string> }
}

interface TailnetNode {
  UserID?: number
  Tags?: string[]
  TailscaleIPs?: string[]
  Expired?: boolean
}

function isTailnetIPv4(address: string) {
  if (!isIPv4(address)) return false
  const [first, second] = address.split('.').map(Number)
  return first === 100 && second >= 64 && second <= 127
}

const exec = promisify(execFile)

async function tailscale(args: string[]): Promise<unknown> {
  const executable = process.platform === 'win32'
    ? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Tailscale', 'tailscale.exe')
    : process.platform === 'darwin' && existsSync(macCli) ? macCli : 'tailscale'
  const { stdout } = await exec(executable, args, { windowsHide: true, timeout: 4000, maxBuffer: 8 * 1024 * 1024 })
  return stdout.trim() ? JSON.parse(stdout) : {}
}

export function mobileTailnet(status: unknown, serve: unknown): MobileTailnet | null {
  if (!status || typeof status !== 'object' || !serve || typeof serve !== 'object') return null
  const { BackendState, Self, User, Peer } = status as {
    BackendState?: string
    Self?: TailnetNode & { DNSName?: string }
    User?: Record<string, { LoginName?: string }>
    Peer?: Record<string, TailnetNode>
  }
  const name = Self?.DNSName?.replace(/\.$/, '').toLowerCase()
  const login = Self?.UserID === undefined ? undefined : User?.[Self.UserID]?.LoginName
  if (BackendState !== 'Running' || !Self || !name || !/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(name) ||
      !login || !/^[\x21-\x7e]+$/.test(login) || Self?.Tags?.length) return null
  const authority = `${name}:${MOBILE_HTTPS_PORT}`
  const config = serve as {
    TCP?: Record<string, { HTTPS?: boolean; TCPForward?: string; ProxyProtocol?: number }>
    Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>
    AllowFunnel?: Record<string, boolean>
    Foreground?: Record<string, { TCP?: Record<string, unknown> }>
  }
  const isPrivate = (port: number) =>
    !Object.entries(config.AllowFunnel ?? {}).some(([host, allowed]) => allowed && host.endsWith(`:${port}`)) &&
    !Object.values(config.Foreground ?? {}).some(entry => Object.hasOwn(entry.TCP ?? {}, port))
  const serving = config.TCP?.[MOBILE_HTTPS_PORT]?.HTTPS === true &&
    config.Web?.[authority]?.Handlers?.['/']?.Proxy === MOBILE_PROXY_TARGET && isPrivate(MOBILE_HTTPS_PORT)
  const result: MobileTailnet = { origin: `https://${authority}`, login, serving }
  const address = Self.TailscaleIPs?.find(isTailnetIPv4)
  const direct = config.TCP?.[MOBILE_DIRECT_PORT]
  if (address && direct?.TCPForward === MOBILE_DIRECT_TARGET && direct.ProxyProtocol === 1 && isPrivate(MOBILE_DIRECT_PORT)) {
    const owners = [Self, ...Object.values(Peer ?? {})]
      .filter(node => node.UserID === Self.UserID && !node.Tags?.length && node.Expired !== true)
      .flatMap(node => node.TailscaleIPs?.filter(isTailnetIPv4) ?? [])
    result.direct = { origin: `http://${address}:${MOBILE_DIRECT_PORT}`, address, owners: new Set(owners) }
  }
  return result
}

export function mobileTailnetIssue(status: unknown): string | undefined {
  const { BackendState, Health } = (status ?? {}) as { BackendState?: unknown; Health?: unknown }
  if (BackendState === 'Running') return
  if (BackendState === 'NeedsLogin') return 'Sign in to Tailscale on this computer, then check the connection again.'
  if (BackendState === 'NeedsMachineAuth') return 'Approve this computer in Tailscale, then check the connection again.'
  if (Array.isArray(Health) && Health.some(warning => typeof warning === 'string' && /unable to connect.*coordination server/i.test(warning))) {
    return 'Tailscale on this computer can’t reach its coordination server. Open the Tailscale app to reconnect.'
  }
  return 'Open the Tailscale app on this computer and connect it to your tailnet.'
}

export async function readMobileTailnet(): Promise<{ tailnet: MobileTailnet | null; message: string }> {
  let status: unknown
  try {
    status = await tailscale(['status', '--json'])
  } catch (error) {
    return { tailnet: null, message: (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? 'Install and connect Tailscale on this computer, then check the connection again.'
      : 'Could not check Tailscale on this computer. Open the Tailscale app, then check the connection again.' }
  }
  const message = mobileTailnetIssue(status)
  if (message) return { tailnet: null, message }
  try {
    const tailnet = mobileTailnet(status, await tailscale(['serve', 'status', '--json']))
    return { tailnet, message: tailnet ? '' : 'Connect this computer with a personal Tailscale account that can identify your devices.' }
  } catch {
    return { tailnet: null, message: 'Could not check Tailscale Serve on this computer. Check the connection again.' }
  }
}
