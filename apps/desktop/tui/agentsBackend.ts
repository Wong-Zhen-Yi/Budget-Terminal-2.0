import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { findCodex } from '../../../scripts/codex-runtime.cjs'
import { AgentWorkspace, agentWorkspacePath } from '../electron/services/agentWorkspace.js'
import { AgentsService } from '../electron/services/agents.js'
import { createServiceRoutes } from '../electron/mcp/routes.js'
import { McpDispatcher, mcpPolicySchema } from '../electron/mcp/dispatcher.js'
import type { McpPolicy } from '../electron/shared/mcpAccess.js'
import type { AgentsBackend } from './agents.js'

export async function createAgentsBackend(options: Pick<ConstructorParameters<typeof AgentsService>[0], 'clientFactory'> = {}): Promise<AgentsBackend> {
  const directory = dirname(agentWorkspacePath())
  await mkdir(directory, { recursive: true })
  // Desktop and TUI histories are independent; two TUIs must not overwrite each other.
  const lock = new DatabaseSync(join(directory, '.tui-agents-lock.sqlite'))
  try { lock.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE') }
  catch { lock.close(); throw new Error('Another TUI is using Agents. Close it and retry.') }
  const workspace = new AgentWorkspace({ path: join(directory, 'tui-agents.json') })
  let agent: AgentsService | undefined
  let dispatcher: McpDispatcher | undefined
  try {
    let policy: McpPolicy | undefined
    let policyError: string | undefined
    try { policy = mcpPolicySchema.parse(JSON.parse(await readFile(join(directory, '.mcp/access.json'), 'utf8'))) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') policyError = 'MCP permissions could not be loaded. Review permissions in desktop Settings.'
    }
    const routes = createServiceRoutes()
    dispatcher = new McpDispatcher({ routes, policy: { ...policy, readOnly: true, requireApproval: true }, policyError })
    const dispatch = dispatcher
    const cwd = join(directory, 'tui-agents')
    await mkdir(cwd, { recursive: true })
    agent = new AgentsService({
      workspace, cwd, executable: findCodex() ?? (process.platform === 'win32' ? 'codex.exe' : 'codex'),
      // This mode exposes research reads and web search, excluding desktop-only actions.
      remoteResearch: true, researchSurface: 'TUI', routes, ...options,
      dispatch: (name, args, signal) => dispatch.invoke(name, args, 'agent', signal),
    })
    await agent.initialize()
    const service = agent
    let closed = false
    return {
      snapshot: () => service.snapshot(),
      command: command => service.command(command),
      close: async () => {
        if (closed) return
        closed = true
        dispatch.close()
        service.close()
        try { await workspace.close() } finally { lock.close() }
      },
    }
  } catch (error) {
    dispatcher?.close()
    agent?.close()
    try { await workspace.close() } finally { lock.close() }
    throw error
  }
}
