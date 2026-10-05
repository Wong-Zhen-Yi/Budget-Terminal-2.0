import Ajv from 'ajv'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import schemas from './schemas.json'
import { operations, mutationDomains, toolName, type Operation } from './operations.js'

const validator = new Ajv({ strict: false, allErrors: true })
export const catalog = Object.entries(operations).map(([operation, description]) => {
  const inputSchema = schemas[operation as Operation]
  const mutation = operation in mutationDomains
  const tool: Tool = {
    name: toolName(operation), description,
    // A wrapper keeps every MCP tool's root schema an object, including mutation unions.
    inputSchema: { type: 'object', properties: { request: { $ref: inputSchema.$ref } }, definitions: inputSchema.definitions, required: ['request'], additionalProperties: false },
    annotations: { readOnlyHint: !mutation, destructiveHint: mutation, idempotentHint: !mutation, openWorldHint: !['screenshot', 'portfolio', 'cards', 'personalFinance', 'settings', ...Object.keys(mutationDomains)].includes(operation) },
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
  return { operation: entry.operation, request: (args as { request: unknown }).request }
}

export function failed(result: unknown): boolean {
  return Boolean(result && typeof result === 'object' && 'meta' in result &&
    (result as { meta: { freshness?: string } }).meta?.freshness === 'failed')
}
