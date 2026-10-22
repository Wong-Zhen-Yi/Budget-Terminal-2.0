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

export async function invokeBridge(name: string, args: unknown, options: { signal?: AbortSignal; progress?: (completed: number, total?: number) => void; timeoutMs?: number } = {}): Promise<unknown> {
  let runtime: RuntimeDescriptor
  try { runtime = JSON.parse(await readFile(runtimePath(), 'utf8')) as RuntimeDescriptor } catch { throw new Error(APP_CLOSED) }
  if (runtime.version !== BRIDGE_VERSION) throw new Error('Budget Terminal MCP version mismatch. Rebuild the app and MCP server.')
  if (!Number.isInteger(runtime.port) || runtime.port < 1 || runtime.port > 65535 || !/^[a-f0-9]{64}$/.test(runtime.token)) throw new Error('Invalid Budget Terminal MCP runtime descriptor.')
  let response: Response
  try {
    response = await fetch(`http://127.0.0.1:${runtime.port}/invoke`, {
      method: 'POST', headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify({ name, arguments: args }), signal: AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? (name === 'budget_terminal_connection_status' ? 5000 : 600_000)), ...(options.signal ? [options.signal] : [])]), redirect: 'error',
    })
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code
    if (cause === 'ECONNREFUSED') throw new Error(APP_CLOSED)
    throw new Error('Budget Terminal connection interrupted. A write may have completed; read the saved record before trying again.')
  }
  let payload: unknown
  try {
    if (response.headers.get('content-type')?.includes('application/x-ndjson') && response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let received = false
      while (true) {
        const { value, done } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        let end: number
        while ((end = buffer.indexOf('\n')) >= 0) {
          const event = JSON.parse(buffer.slice(0, end)) as { progress?: number; total?: number; result?: unknown; error?: string }
          buffer = buffer.slice(end + 1)
          if (event.progress !== undefined) options.progress?.(event.progress, event.total)
          if ('result' in event) { payload = event.result; received = true }
          if (event.error) { payload = { error: event.error }; received = true }
        }
        if (done) break
      }
      if (!received) throw new Error('Incomplete bridge stream')
    } else payload = await response.json()
  } catch {
    throw new Error('Budget Terminal response interrupted. A write may have completed; read the saved record before trying again.')
  }
  if (!response.ok || (payload && typeof payload === 'object' && 'error' in payload)) throw new Error((payload as { error?: string }).error ?? `Budget Terminal request failed (${response.status}).`)
  return payload
}
