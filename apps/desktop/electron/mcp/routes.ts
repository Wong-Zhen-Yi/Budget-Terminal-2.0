import { registerServiceHandlers } from '../ipc/serviceHandlers.js'
import { CHANNELS } from '../shared/contract.js'
import { operations, type Operation } from '../../mcp/operations.js'

export function createServiceRoutes(): Map<Operation, (request: unknown) => unknown> {
  const registered = new Map<string, (request: unknown) => unknown>()
  registerServiceHandlers(<Request>(channel: string, run: (request: Request) => unknown) => {
    registered.set(channel, (request) => run(request as Request))
  })
  const routes = new Map<Operation, (request: unknown) => unknown>()
  for (const operation of Object.keys(operations) as Operation[]) {
    const key = operation === 'mutatePortfolio' ? 'portfolioMutate'
      : operation === 'mutateCards' ? 'cardsMutate'
      : operation === 'mutatePersonalFinance' ? 'personalFinanceMutate'
      : operation === 'mutateSettings' ? 'settingsMutate' : operation
    const run = registered.get(CHANNELS[key])
    if (!run) throw new Error(`Missing MCP service route: ${operation}`)
    routes.set(operation, run)
  }
  if (routes.size !== registered.size) throw new Error('Service registry and MCP allowlist differ. Update the MCP catalog.')
  return routes
}
