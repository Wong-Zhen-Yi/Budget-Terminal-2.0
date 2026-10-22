import { constants } from 'node:fs'
import { assertPrivateBrowserStorage } from '../services/browserStorage.js'
import { setBrowserPrivacy } from '../services/browser.js'
import { app, BrowserWindow, dialog } from 'electron'
import { access, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { McpStatus } from '../shared/contract.js'
import { startBridge } from './bridge.js'
import { createServiceRoutes } from './routes.js'
import { createScreenshotService } from './screenshot.js'
import { McpDispatcher, mcpPolicySchema } from './dispatcher.js'
import { invokeBridge, runtimePath } from '../../mcp/runtime.js'
import { connectionTool } from '../../mcp/catalog.js'

let status: McpStatus = { available: false, error: 'MCP is starting.' }
let dispatcher: McpDispatcher | undefined
export function getMcpStatus(): McpStatus { return { ...status, diagnostics: dispatcher?.diagnostics() } }
export async function configureMcp(value: unknown): Promise<McpStatus> {
  if (!dispatcher || !status.available) throw new Error('Local MCP is unavailable.')
  await dispatcher.configure(value)
  setBrowserPrivacy(dispatcher.diagnostics().policy.browserRequireApproval ?? false)
  return getMcpStatus()
}
export async function cancelMcpCall(id: number): Promise<McpStatus> {
  if (!dispatcher) throw new Error('Local MCP is unavailable.')
  dispatcher.cancel(id)
  return getMcpStatus()
}
async function inspectSetup(): Promise<NonNullable<McpStatus['setup']>> {
  const descriptorPath = runtimePath()
  const dataDirectory = dirname(dirname(descriptorPath))
  try {
    assertPrivateBrowserStorage(dataDirectory, app.getAppPath())
    await access(dirname(descriptorPath), constants.R_OK | constants.W_OK)
    if (!(await stat(descriptorPath)).isFile()) throw new Error('Missing runtime descriptor')
    // The adapter discovers the token at runtime. Never include token/port in copied setup.
    const configuration = JSON.stringify({ mcpServers: { 'budget-terminal': {
      command: 'node', args: [join(app.getAppPath(), 'out', 'mcp', 'server.mjs')],
      env: { BUDGET_TERMINAL_DATA_DIR: dataDirectory },
    } } }, null, 2)
    return { valid: true, message: 'Local data folder is outside source repositories and the runtime descriptor is readable.', descriptorPath, configuration }
  } catch {
    return { valid: false, message: 'Local MCP setup is invalid. Use a writable application-data folder outside source and Git repositories, rebuild and restart Budget Terminal.' }
  }
}
export async function testMcpConnection(): Promise<McpStatus> {
  status.setup = await inspectSetup()
  if (!status.setup.valid) throw new Error(status.setup.message)
  await invokeBridge(connectionTool.name, {})
  return getMcpStatus()
}
export async function invokeMcpTool(name: string, args: unknown, signal?: AbortSignal): Promise<unknown> {
  if (!dispatcher || !status.available) throw new Error('Local MCP is unavailable.')
  return dispatcher.invoke(name, args, 'agent', signal)
}
// One capture queue across embedded agents and external MCP clients.
export const captureTerminalScreenshot = createScreenshotService(() => BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()))

export async function startMcpHost(): Promise<() => Promise<void>> {
  try {
    const descriptorPath = runtimePath()
    assertPrivateBrowserStorage(dirname(dirname(descriptorPath)), app.getAppPath())
    const policyPath = join(dirname(descriptorPath), 'access.json')
    let policy
    let policyError
    try { policy = mcpPolicySchema.parse(JSON.parse(await readFile(policyPath, 'utf8'))) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') policyError = 'MCP permissions could not be loaded. Read-only defaults are active; save permissions locally to recover.'
    }
    dispatcher = new McpDispatcher({
      routes: createServiceRoutes(captureTerminalScreenshot), policy, policyError,
      persistPolicy: async value => {
        // The bridge creates this directory with owner-only permissions before IPC can save here.
        const temporary = `${policyPath}.${process.pid}.tmp`
        await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
        await rename(temporary, policyPath)
      },
      approve: async (tool, request, signal) => {
        const detail = JSON.stringify(request, null, 2)
        // Never ask users to approve a silently truncated financial edit.
        if (detail.length > 12_000) return false
        const window = BrowserWindow.getAllWindows().find(window => !window.isDestroyed())
        if (!window || signal.aborted) return false
        const result = await dialog.showMessageBox(window, {
          type: 'warning', title: 'Approve Budget Terminal MCP edit',
          message: `Allow ${tool} to edit saved records?`,
          detail: `Only approve changes you requested. This edits local records, not broker orders.\n\n${detail}\n\nThis approval expires after 60 seconds.`,
          buttons: ['Deny', 'Approve edit'], defaultId: 0, cancelId: 0, noLink: true, signal,
        })
        return !signal.aborted && result.response === 1
      },
    })
    setBrowserPrivacy(dispatcher.diagnostics().policy.browserRequireApproval ?? false)
    // Shared service handlers publish mutations once to the desktop renderer.
    const bridge = await startBridge({ dispatcher, descriptorPath, onChanged: () => {} })
    status = bridge.status
    status.setup = await inspectSetup()
    return async () => { status = { available: false, error: 'MCP is shutting down.' }; await bridge.stop() }
  } catch {
    dispatcher?.close()
    dispatcher = undefined
    status = { available: false, error: 'Local MCP could not start. Check local data-folder permissions and restart Budget Terminal.' }
    console.warn(status.error)
    return async () => {}
  }
}
