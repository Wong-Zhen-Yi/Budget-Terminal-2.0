import { z } from 'zod'

const field = z.string().min(1).max(120).regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/)
export const responseSchema = z.object({
  mode: z.enum(['full', 'summary']).optional(),
  collection: field.optional(),
  fields: z.array(z.string().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/)).min(1).max(40).optional(),
  offset: z.number().int().min(0).max(1_000_000).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  maxBytes: z.number().int().min(4096).max(1_048_576).optional(),
}).strict()
export type ResponseOptions = z.infer<typeof responseSchema>
export class ResponseSelectionError extends Error {}
export const responseJsonSchema = {
  type: 'object' as const, additionalProperties: false,
  description: 'Optional response controls. collection is a dot path to an array inside data; fields select top-level fields of each row (or data). Pagination requires an array. maxBytes bounds JSON data; sources, timestamps and warnings are preserved separately. Summary samples at most 3 rows per array and shortens long text. Omitted data is explicitly marked.',
  properties: {
    mode: { type: 'string', enum: ['full', 'summary'] }, collection: { type: 'string', maxLength: 120 },
    fields: { type: 'array', items: { type: 'string', maxLength: 120 }, minItems: 1, maxItems: 40 },
    offset: { type: 'integer', minimum: 0, maximum: 1_000_000 }, limit: { type: 'integer', minimum: 1, maximum: 1000 },
    maxBytes: { type: 'integer', minimum: 4096, maximum: 1_048_576 },
  },
}

function sample(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}… [shortened]` : value
  if (!value || typeof value !== 'object') return value
  if (depth > 12) return '[nested data omitted]'
  if (Array.isArray(value)) return value.slice(0, 3).map(item => sample(item, depth + 1))
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sample(entry, depth + 1)]))
}

/** Projection never discards envelope metadata/errors; all shaping is visible to clients. */
export function shapeResponse(result: unknown, options: ResponseOptions = {}): unknown {
  if (!result || typeof result !== 'object' || !('data' in result)) return result
  const envelope = result as Record<string, unknown>
  let data = structuredClone(envelope.data)
  const provenance: unknown[] = []
  let provenanceOmitted = false
  let provenanceBytes = 0
  function sources(value: unknown, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 20) return
    if (Array.isArray(value)) { for (const row of value) sources(row, depth + 1); return }
    const entries = Object.entries(value)
    const details = Object.fromEntries(entries.filter(([key]) => /^(sources?|priceSource|symbol|ticker|market|currency|priceBasis|changeBasis|fallbackReason|url|publishedAt|fetchedAt|sourcedAt|completedAt|reportedAt|period|asOf|readAt|expiresAt|freshness|warnings?|errors|coverage)$/i.test(key)))
    if (Object.keys(details).length) {
      const bytes = Buffer.byteLength(JSON.stringify(details))
      if (provenance.length < 100 && provenanceBytes + bytes <= 32_768) { provenance.push(details); provenanceBytes += bytes }
      else provenanceOmitted = true
    }
    for (const [key, entry] of entries) if (!(key in details)) sources(entry, depth + 1)
  }
  const shaped = Boolean(options.collection || options.fields || options.mode === 'summary' || options.offset !== undefined || options.limit !== undefined)
  if (shaped) sources(data)
  let holder: Record<string, unknown> = { data }
  let key = 'data'
  if (options.collection) {
    for (const part of options.collection.split('.')) {
      if (!holder[key] || typeof holder[key] !== 'object' || !Object.hasOwn(holder[key] as object, part)) throw new ResponseSelectionError('Response collection path does not exist in data.')
      holder = holder[key] as Record<string, unknown>
      key = part
    }
  }
  let selected = holder[key]
  let page: Record<string, unknown> | undefined
  if (options.collection || options.offset !== undefined || options.limit !== undefined) {
    if (!Array.isArray(selected)) throw new ResponseSelectionError('Response pagination requires an array; set collection to its path inside data.')
    const total = selected.length
    const offset = options.offset ?? 0
    const limit = options.limit ?? 100
    selected = selected.slice(offset, offset + limit)
    page = { total, offset, limit, nextOffset: offset + limit < total ? offset + limit : null }
  }
  if (options.fields) {
    const fields = options.fields
    const pick = (row: unknown) => row && typeof row === 'object' && !Array.isArray(row)
      ? Object.fromEntries(fields.filter(field => Object.hasOwn(row, field)).map(field => [field, (row as Record<string, unknown>)[field]])) : row
    selected = Array.isArray(selected) ? selected.map(pick) : pick(selected)
  }
  holder[key] = selected
  // The root holder may have been replaced while traversing a collection.
  if (!options.collection) data = holder.data
  if (options.mode === 'summary') data = sample(data)
  const maxBytes = options.maxBytes ?? 262_144
  const bytes = Buffer.byteLength(JSON.stringify(data) ?? 'null')
  const omitted = bytes > maxBytes
  if (omitted) {
    if (!shaped) sources(envelope.data)
    data = { omitted: true, reason: 'Response data exceeds maxBytes. Select a collection, fields and a smaller page.', originalBytes: bytes }
  }
  return { ...envelope, data, ...(shaped || omitted ? { response: {
    mode: options.mode ?? 'full', ...(page ? { page } : {}), fields: options.fields,
    maxBytes, omitted, sampled: options.mode === 'summary', provenance, provenanceOmitted,
  } } : {}) }
}
