import outputs from './output-schemas.json'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

export const envelopeProperties = {
  data: {},
  meta: { type: 'object', required: ['source', 'freshness', 'fetchedAt'], properties: {
    source: { type: 'string' }, freshness: { enum: ['fresh', 'cached', 'partial', 'stale', 'failed'] }, fetchedAt: { type: 'number' }, revision: { type: 'string' },
  } },
  errors: { type: 'array', items: { type: 'object' } },
}
export const envelopeSchema = { type: 'object' as const, required: ['data', 'meta', 'errors'], properties: envelopeProperties }
export const failureSchema = { type: 'object' as const, required: ['error'], properties: { error: { type: 'object', required: ['code', 'message', 'retryable', 'nextStep'], properties: {
  code: { type: 'string' }, message: { type: 'string' }, retryable: { type: 'boolean' }, nextStep: { type: 'string' },
} } } }
const failedEnvelopeSchema = { ...envelopeSchema, properties: { ...envelopeProperties, meta: { ...envelopeProperties.meta, properties: { ...envelopeProperties.meta.properties, freshness: { const: 'failed' } } } } }
export function outputSchema(operation: string): NonNullable<Tool['outputSchema']> {
  const raw = structuredClone((outputs as Record<string, Record<string, unknown>>)[operation])
  if (!raw) {
    const data = operation === 'operationStatus'
      ? { type: 'object', required: ['state', 'durable', 'nextStep'], properties: { state: { enum: ['unknown', 'uncertain', 'completed', 'failed', 'refused'] }, durable: { type: 'boolean' }, nextStep: { type: 'string' } } }
      : { type: 'object', required: ['tickers', 'evidence'], properties: { tickers: { type: 'array', items: { type: 'string' } }, evidence: { type: 'object', additionalProperties: { type: 'object', anyOf: [envelopeSchema, failureSchema] } } } }
    return { type: 'object', anyOf: [failureSchema, failedEnvelopeSchema, { ...envelopeSchema, properties: { ...envelopeProperties, data } },
      { ...envelopeSchema, required: ['data', 'meta', 'errors', 'response'], properties: { ...envelopeProperties, response: { type: 'object' } } },
    ] }
  }
  const definitions = raw.definitions as Record<string, Record<string, unknown>>
  // Pixels travel in MCP image blocks, not in structuredContent.
  for (const definition of Object.values(definitions)) {
    if (Array.isArray(definition.required) && (definition.properties as Record<string, unknown> | undefined)?.base64) {
      definition.required = definition.required.filter(field => field !== 'base64')
    }
  }
  return {
    type: 'object', definitions,
    anyOf: [
      failureSchema,
      failedEnvelopeSchema,
      { $ref: raw.$ref },
      { ...envelopeSchema, required: ['data', 'meta', 'errors', 'response'], properties: { ...envelopeProperties, response: {
        type: 'object', required: ['mode', 'maxBytes', 'omitted', 'sampled'], properties: {
          mode: { enum: ['full', 'summary'] }, maxBytes: { type: 'number' }, omitted: { type: 'boolean' }, sampled: { type: 'boolean' },
          page: { type: 'object', required: ['total', 'offset', 'limit', 'nextOffset'], properties: {
            total: { type: 'integer' }, offset: { type: 'integer' }, limit: { type: 'integer' }, nextOffset: { type: ['integer', 'null'] },
          } },
        },
      } } },
      { ...envelopeSchema, properties: { ...envelopeProperties, data: { type: 'object', required: ['writeAlreadyAttempted', 'nextStep'], properties: { writeAlreadyAttempted: { const: true }, nextStep: { type: 'string' } } } } },
    ],
  }
}

/** Valid optional fields may be absent in the current provider response. */
export function selectionFields(operation: string, collection?: string): Set<string> {
  const root = (outputs as Record<string, Record<string, unknown>>)[operation]
  const fields = new Set<string>()
  if (!root) return fields
  const visit = (schema: unknown, path: string[], depth = 0) => {
    if (!schema || typeof schema !== 'object' || depth > 40) return
    const node = schema as Record<string, unknown>
    if (typeof node.$ref === 'string') {
      const target = node.$ref.slice(2).split('/').reduce<unknown>((value, key) => (value as Record<string, unknown>)?.[decodeURIComponent(key.replace(/~1/g, '/').replace(/~0/g, '~'))], root)
      visit(target, path, depth + 1)
    }
    for (const variant of (node.anyOf ?? node.oneOf ?? []) as unknown[]) visit(variant, path, depth + 1)
    if (node.items && path.length === 0) visit(node.items, path, depth + 1)
    const properties = node.properties as Record<string, unknown> | undefined
    if (properties) {
      if (path.length) visit(properties[path[0]], path.slice(1), depth + 1)
      else for (const name of Object.keys(properties)) fields.add(name)
    }
  }
  visit(root, ['data', ...(collection?.split('.') ?? [])])
  return fields
}
