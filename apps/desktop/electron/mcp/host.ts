import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { CHANNELS, type McpStatus } from '../shared/contract.js'
import { startBridge } from './bridge.js'
import { createServiceRoutes } from './routes.js'
import { createScreenshotService } from './screenshot.js'

let status: McpStatus = { available: false, error: 'MCP is starting.' }
export function getMcpStatus(): McpStatus { return status }

export async function startMcpHost(): Promise<() => Promise<void>> {
  try {
    const screenshot = createScreenshotService(() => BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()))
    const bridge = await startBridge({ routes: createServiceRoutes(screenshot), descriptorPath: join(process.env.APPDATA!, 'BudgetTerminalElectron', '.mcp', 'runtime.json'), onChanged: (domains) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(CHANNELS.savedDataChanged, { domains })
    } })
    status = bridge.status
    return async () => { status = { available: false, error: 'MCP is shutting down.' }; await bridge.stop() }
  } catch (error) {
    status = { available: false, error: `Local MCP could not start: ${error instanceof Error ? error.message : 'Unknown error'}` }
    console.warn(status.error)
    return async () => {}
  }
}
