import Ajv from 'ajv'
import { z } from 'zod'
import schemas from '../../mcp/schemas.json'
import { operations, type Operation } from '../../mcp/operations.js'
import { registerServiceHandlers } from '../ipc/serviceHandlers.js'
import { CHANNELS, type StoredDataVerification } from '../shared/contract.js'
import { ok } from '../shared/envelope.js'
import { verifyStoredData } from '../services/portfolioStore.js'

export function browserResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(browserResult)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
    [key, key === 'sourcePath' || key === 'path' ? '' : browserResult(entry)],
  ))
}

/** Web has an explicit service allowlist; shell, MCP and maintenance never enter it. */
export function createWebRoutes(execute?: (channel: string, request: unknown) => unknown) {
  const registered = new Map<string, (request: unknown) => unknown>()
  registerServiceHandlers(<Request>(channel: string, run: (request: Request) => unknown) => {
    registered.set(channel, (request) => run(request as Request))
  })
  const validator = new Ajv({ strict: false, allErrors: true })
  const routes = new Map<string, { run: (request: unknown) => unknown; validate: (request: unknown) => boolean }>()
  for (const operation of Object.keys(operations) as Operation[]) {
    if (operation === 'screenshot') continue
    const key = operation === 'mutatePortfolio' ? 'portfolioMutate'
      : operation === 'mutateArticles' ? 'articlesMutate'
      : operation === 'mutateCards' ? 'cardsMutate'
      : operation === 'mutatePersonalFinance' ? 'personalFinanceMutate'
      : operation === 'mutateSettings' ? 'settingsMutate' : operation
    const run = registered.get(CHANNELS[key])
    if (!run) throw new Error(`Missing browser service: ${operation}`)
    routes.set(CHANNELS[key], { run, validate: validator.compile(schemas[operation]) })
  }
  const verification = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('portfolio'), expected: z.object({ portfolios: z.array(z.object({}).passthrough()), activeId: z.string(), mainId: z.string() }).passthrough() }).strict(),
    z.object({ kind: z.literal('personalFinance'), expected: z.object({}).passthrough() }).strict(),
  ])
  routes.set(CHANNELS.verifyStoredData, {
    validate: (request) => verification.safeParse(request).success,
    run: async (request) => {
      try { return ok(await verifyStoredData(request as StoredDataVerification), 'portfolio store') }
      catch { throw new TypeError('Could not verify saved records. Reload them and try again.') }
    },
  })
  return async (channel: string, args: unknown[]): Promise<unknown> => {
    const route = routes.get(channel)
    if (!route) throw new TypeError('This operation is available only on the desktop.')
    if (args.length > 1) throw new TypeError('Invalid service arguments.')
    const request = args[0] ?? {}
    let cleaned = request
    if (request && typeof request === 'object' && !Array.isArray(request)) {
      const { background, backgroundOrder, ...rest } = request as Record<string, unknown>
      if ((background !== undefined && typeof background !== 'boolean') ||
        (backgroundOrder !== undefined && (typeof backgroundOrder !== 'number' || !Number.isFinite(backgroundOrder) || backgroundOrder < 0))) throw new TypeError('Invalid startup request priority.')
      cleaned = rest
    }
    if (!route.validate(cleaned)) throw new TypeError('Invalid service request.')
    return browserResult(await (execute ? execute(channel, request) : route.run(request)))
  }
}
