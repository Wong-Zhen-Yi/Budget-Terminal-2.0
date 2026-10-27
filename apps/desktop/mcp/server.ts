import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { catalog, connectionTool, validateCall } from './catalog.js'
import { invokeBridge } from './runtime.js'
import { toolResult } from './toolResult.js'
import { newsResearchInstructions, optionsResearchInstructions } from './operations.js'

const server = new Server({ name: 'budget-terminal', version: '0.1.0' }, {
  capabilities: { tools: {} },
  instructions: 'Budget Terminal must be open. Read tools expose saved data and market research with source and freshness metadata. Writes edit local records, never broker orders. Use request for tool arguments. Keep partial/stale data limitations visible. Saved-record mutations require requestId outside request: use a fresh UUID for each intended edit and reuse it only for an exact same-session retry. Supply expectedRevision from the latest read meta.revision for portfolio, cards, personal finance and settings edits. Research reads support response summaries, fields and pagination; preserve omission and coverage warnings. Cancellation does not roll back an executing edit. Read-only MCP is on by default; permissions can only be changed locally in Settings. Edits may require native local approval. Do not bypass a refusal with a new ID. Receipts are session-only: after an app restart or interrupted write, read the saved record first. Research shares the app provider rate gate; reuse cached results unless fresh data is needed. ' + newsResearchInstructions + ' ' + optionsResearchInstructions,
})
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...catalog.map((entry) => entry.tool), connectionTool] }))
server.setRequestHandler(CallToolRequestSchema, async ({ params }, extra) => {
  try {
    const args = params.arguments ?? {}
    if (params.name === connectionTool.name) {
      if (Object.keys(args).length) throw new Error('Connection status takes no arguments.')
    } else validateCall(params.name, args)
    const progressToken = params._meta?.progressToken
    let progress = 0
    const result = await invokeBridge(params.name, args, { signal: extra.signal, progress: progressToken === undefined ? undefined : (completed, total) => {
      progress = Math.max(progress, completed)
      void extra.sendNotification({ method: 'notifications/progress', params: { progressToken, progress, ...(total === undefined ? {} : { total }) } }).catch(() => {})
    } })
    return toolResult(params.name, result)
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
