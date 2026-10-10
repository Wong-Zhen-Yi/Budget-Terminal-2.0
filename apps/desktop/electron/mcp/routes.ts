import { registerServiceHandlers } from '../ipc/serviceHandlers.js'
import { CHANNELS } from '../shared/contract.js'
import { operations, type Operation } from '../../mcp/operations.js'
import { failed } from '../shared/envelope.js'
import type { ScreenshotPayload, ScreenshotRequest } from '../shared/screenshot.js'
import type { Envelope } from '../shared/contract.js'

export function createServiceRoutes(screenshot: (request: ScreenshotRequest) => Promise<Envelope<ScreenshotPayload>> = async () =>
  failed({ screenshots: [] }, 'Screenshot capture requires an Electron window.', 'Electron page capture'),
): Map<Operation, (request: unknown) => unknown> {
  const registered = new Map<string, (request: unknown) => unknown>()
  registerServiceHandlers(<Request>(channel: string, run: (request: Request) => unknown) => {
    registered.set(channel, (request) => run(request as Request))
  })
  const routes = new Map<Operation, (request: unknown) => unknown>()
  for (const operation of Object.keys(operations) as Operation[]) {
    if (operation === 'screenshot') {
      routes.set(operation, (request) => screenshot(request as ScreenshotRequest))
      continue
    }
    const key = operation === 'mutatePortfolio' ? 'portfolioMutate'
      : operation === 'mutateArticles' ? 'articlesMutate'
      : operation === 'mutateCards' ? 'cardsMutate'
      : operation === 'mutatePersonalFinance' ? 'personalFinanceMutate'
      : operation === 'mutateSettings' ? 'settingsMutate' : operation
    const run = registered.get(CHANNELS[key])
    if (!run) throw new Error(`Missing MCP service route: ${operation}`)
    routes.set(operation, run)
  }
  if (routes.size !== registered.size + 1) throw new Error('Service registry and MCP allowlist differ. Update the MCP catalog.')
  return routes
}
