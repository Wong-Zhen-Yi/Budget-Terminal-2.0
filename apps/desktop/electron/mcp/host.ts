import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { McpStatus } from '../shared/contract.js'
import { startBridge } from './bridge.js'
import { createServiceRoutes } from './routes.js'
import { createScreenshotService } from './screenshot.js'

let status: McpStatus = { available: false, error: 'MCP is starting.' }
export function getMcpStatus(): McpStatus { return status }
// One capture queue across embedded agents and external MCP clients.
export const captureTerminalScreenshot = createScreenshotService(() => BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()))

export async function startMcpHost(): Promise<() => Promise<void>> {
  try {
    // Shared service handlers publish mutations once to the desktop renderer.
    const bridge = await startBridge({ routes: createServiceRoutes(captureTerminalScreenshot), descriptorPath: join(process.env.APPDATA!, 'BudgetTerminalElectron', '.mcp', 'runtime.json'), onChanged: () => {} })
    status = bridge.status
    return async () => { status = { available: false, error: 'MCP is shutting down.' }; await bridge.stop() }
  } catch (error) {
    status = { available: false, error: `Local MCP could not start: ${error instanceof Error ? error.message : 'Unknown error'}` }
    console.warn(status.error)
    return async () => {}
  }
}
