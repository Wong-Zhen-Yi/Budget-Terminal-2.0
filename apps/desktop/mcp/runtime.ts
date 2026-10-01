import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'

export const BRIDGE_VERSION = 1
export const APP_CLOSED = 'Open Budget Terminal to use this tool.'
export function runtimePath(): string {
  return join(process.env.BUDGET_TERMINAL_DATA_DIR ?? join(process.env.APPDATA ??
    (process.platform === 'win32' ? join(homedir(), 'AppData', 'Roaming') : join(homedir(), '.budget-terminal', 'data')),
  'BudgetTerminalElectron'), '.mcp', 'runtime.json')
}

export interface RuntimeDescriptor { version: number; port: number; token: string; pid: number }

export async function invokeBridge(name: string, args: unknown): Promise<unknown> {
  let runtime: RuntimeDescriptor
  try { runtime = JSON.parse(await readFile(runtimePath(), 'utf8')) as RuntimeDescriptor } catch { throw new Error(APP_CLOSED) }
  if (runtime.version !== BRIDGE_VERSION) throw new Error('Budget Terminal MCP version mismatch. Rebuild the app and MCP server.')
  if (!Number.isInteger(runtime.port) || runtime.port < 1 || runtime.port > 65535 || !/^[a-f0-9]{64}$/.test(runtime.token)) throw new Error('Invalid Budget Terminal MCP runtime descriptor.')
  let response: Response
  try {
    response = await fetch(`http://127.0.0.1:${runtime.port}/invoke`, {
      method: 'POST', headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, arguments: args }), signal: AbortSignal.timeout(180_000), redirect: 'error',
    })
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code
    if (cause === 'ECONNREFUSED') throw new Error(APP_CLOSED)
    throw new Error('Budget Terminal connection interrupted. A write may have completed; read the saved record before trying again.')
  }
  let payload: unknown
  try { payload = await response.json() } catch {
    throw new Error('Budget Terminal response interrupted. A write may have completed; read the saved record before trying again.')
  }
  if (!response.ok) throw new Error((payload as { error?: string }).error ?? `Budget Terminal request failed (${response.status}).`)
  return payload
}
