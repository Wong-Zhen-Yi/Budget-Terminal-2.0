import { responseJsonSchema, responseSchema } from './response.js'
import Ajv from 'ajv'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import schemas from './schemas.json'
import { operations, mutationDomains, newsRefreshOperations, optionsRefreshOperations, toolName, type Operation } from './operations.js'

const validator = new Ajv({ strict: false, allErrors: true })
export const catalog = Object.entries(operations).map(([operation, description]) => {
  const inputSchema = schemas[operation as Operation]
  const mutation = operation in mutationDomains
  const freshness = newsRefreshOperations.has(operation as Operation)
    ? 'Always refreshes underlying news sources before returning, even if request.force is omitted or false. Check publishedAt, cite publication dates and links, and disclose refresh failures or stale/partial fallback data; a fresh fetch does not make an older article new.'
    : optionsRefreshOperations.has(operation as Operation)
      ? 'Always refreshes underlying options data before returning, even if request.force is omitted or false. Preserve source timestamps, delayed/stale quote warnings and failed-expiration coverage. Refreshed volume is provider-reported trading volume, distinct from open interest.'
      : 'Prefer cached data and narrow symbols/dates before forcing a refresh.'
  const tool: Tool = {
    name: toolName(operation), description: mutation ? `${description} Supply a unique requestId for each intended edit; reuse it only when retrying exactly the same edit in the same app session. Read saved records before retrying after an app restart. For portfolios, cards, personal finance and settings, supply expectedRevision from the latest read meta.revision.` : !mutation && !['screenshot', 'browserResearch'].includes(operation) ? `${description} Returns structured data with source/freshness metadata and partial-data warnings; coverage depends on the provider. Use response.mode summary for an overview, or response.collection with offset/limit and fields for large collections. Default JSON data budget: 256 KiB; omitted data is marked explicitly. ${freshness}` : description,
    // A wrapper keeps every MCP tool's root schema an object, including mutation unions.
    inputSchema: {
      type: 'object',
      properties: {
        request: { $ref: inputSchema.$ref },
        ...(!mutation && !['screenshot', 'browserResearch'].includes(operation) ? { response: responseJsonSchema } : {}),
        ...(mutation && operation !== 'mutateArticles' ? { expectedRevision: {
          type: 'string' as const, pattern: '^[a-f0-9]{64}$',
          description: 'meta.revision from the latest read of this domain; checked atomically before editing.',
        } } : {}),
        ...(mutation ? { requestId: {
          type: 'string' as const, minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$',
          description: 'Unique ID for this intended edit. Reuse for exact retries within this app session, never for a different edit.',
        } } : {}),
      },
      definitions: inputSchema.definitions, required: mutation ? ['request', 'requestId', ...(operation === 'mutateArticles' ? [] : ['expectedRevision'])] : ['request'], additionalProperties: false,
    },
    annotations: { readOnlyHint: !mutation && operation !== 'browserResearch', destructiveHint: mutation, idempotentHint: !mutation && operation !== 'browserResearch', openWorldHint: !['screenshot', 'articles', 'portfolio', 'cards', 'personalFinance', 'settings', ...Object.keys(mutationDomains)].includes(operation) },
  }
  return { operation: operation as Operation, tool, validate: validator.compile(tool.inputSchema) }
})

export const connectionTool: Tool = {
  name: 'budget_terminal_connection_status',
  description: 'Check whether the running Budget Terminal app can accept MCP calls.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}

export function validateCall(name: string, args: unknown) {
  const entry = catalog.find((item) => item.tool.name === name)
  if (!entry) throw new Error('Unknown Budget Terminal tool')
  if (!entry.validate(args)) throw new Error(`Invalid tool arguments: ${validator.errorsText(entry.validate.errors)}`)
  const { request, requestId, expectedRevision, response } = args as { request: unknown; requestId?: string; expectedRevision?: string; response?: unknown }
  // Enforce this once for external MCP clients and embedded manual/autonomous agents.
  // Copy the validated request so caller-owned arguments remain unchanged.
  const researchRequest = newsRefreshOperations.has(entry.operation) || optionsRefreshOperations.has(entry.operation) ? { ...(request as object), force: true } : request
  return { operation: entry.operation, request: researchRequest, requestId, expectedRevision, response: response === undefined ? undefined : responseSchema.parse(response) }
}

export function failed(result: unknown): boolean {
  return Boolean(result && typeof result === 'object' && 'meta' in result &&
    (result as { meta: { freshness?: string } }).meta?.freshness === 'failed')
}
