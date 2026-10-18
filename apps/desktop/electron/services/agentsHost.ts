import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { createServiceRoutes } from '../mcp/routes.js'
import { captureTerminalScreenshot, getMcpStatus } from '../mcp/host.js'
import type { AgentsCommand } from '../shared/agents.js'
import { failed, ok } from '../shared/envelope.js'
import { AgentsService } from './agents.js'
import { applyAgentPortfolioUpdate, readPortfolios } from './portfolioStore.js'
import { publishSavedDataChanged } from './savedDataEvents.js'
import { withAutomaticBackup } from './automaticBackup.js'

let service: AgentsService | null = null

function executable() {
  const binary = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const candidates = [process.env.BUDGET_TERMINAL_CODEX_PATH,
    ...(process.env.PATH ?? '').split(delimiter).map(directory => join(directory, binary)),
    ...(process.platform === 'win32' ? [join(process.env.LOCALAPPDATA ?? '', 'Programs', 'OpenAI', 'Codex', 'bin', binary)] : ['/usr/local/bin/codex', '/opt/homebrew/bin/codex']),
  ]
  return candidates.find((path): path is string => Boolean(path && existsSync(path))) ?? binary
}
function agent() {
  if (!service) {
    const cwd = join(app.getPath('userData'), 'agents')
    mkdirSync(cwd, { recursive: true })
    service = new AgentsService({ executable: executable(), cwd, routes: createServiceRoutes(captureTerminalScreenshot), connectionStatus: getMcpStatus, portfolio: {
      read: readPortfolios,
      apply: async (before, after) => {
        const result = await withAutomaticBackup(async () => ok(await applyAgentPortfolioUpdate(before, after), 'portfolio store'))
        publishSavedDataChanged(['portfolio', 'settings'])
        return { ...result.data, warning: result.errors.length ? result.errors.map(error => error.reason).join(' · ') : undefined }
      },
    } })
  }
  return service
}
export function agentsStatus() { return ok(agent().snapshot(), 'Codex agent') }
export async function agentsCommand(command: AgentsCommand) {
  try { return ok(await agent().command(command), 'Codex agent') }
  catch (error) { return failed(agent().snapshot(), error instanceof Error ? error.message : String(error), 'Codex agent') }
}
export function closeAgents() { service?.close(); service = null }
