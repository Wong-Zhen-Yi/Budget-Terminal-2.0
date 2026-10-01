import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { catalog, connectionTool, failed, validateCall } from './catalog.js'
import { invokeBridge } from './runtime.js'

const server = new Server({ name: 'budget-terminal', version: '0.1.0' }, {
  capabilities: { tools: {} },
  instructions: 'Budget Terminal must be open. Read tools expose saved data and market research with source and freshness metadata. Writes edit local records, never broker orders. Use request for tool arguments. Keep partial/stale data limitations visible. Do not repeat interrupted writes: read the saved record first. Research shares the app provider rate gate; reuse cached results unless fresh data is needed.',
})
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...catalog.map((entry) => entry.tool), connectionTool] }))
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    const args = params.arguments ?? {}
    if (params.name === connectionTool.name) {
      if (Object.keys(args).length) throw new Error('Connection status takes no arguments.')
    } else validateCall(params.name, args)
    const result = await invokeBridge(params.name, args)
    const structuredContent = result && typeof result === 'object' && !Array.isArray(result)
      ? result as Record<string, unknown> : { data: result }
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent, isError: failed(result) }
  } catch (error) {
    return { content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Budget Terminal call failed.' }], isError: true }
  }
})

// Only initialized MCP clients renew the connection lease. Heartbeats do not
// count as tool activity, and retry automatically if the app restarts.
let heartbeat: ReturnType<typeof setInterval> | undefined
let checking = false
async function keepConnected() {
  if (checking) return
  checking = true
  try { await invokeBridge(connectionTool.name, {}) } catch { /* App may be closed. */ }
  finally { checking = false }
}
server.oninitialized = () => {
  void keepConnected()
  heartbeat = setInterval(() => void keepConnected(), 5_000)
  heartbeat.unref()
}
server.onclose = () => { clearInterval(heartbeat) }
await server.connect(new StdioServerTransport())
