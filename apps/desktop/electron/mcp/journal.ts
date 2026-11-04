import { open, readFile, rename, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { McpError } from '../../mcp/errors.js'

const receiptSchema = z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/), state: z.enum(['uncertain', 'completed', 'failed', 'refused']), updatedAt: z.number() }).strict()
type Receipt = z.infer<typeof receiptSchema>
const journalSchema = z.object({ version: z.literal(1), entries: z.record(z.string().regex(/^[a-f0-9]{64}$/), receiptSchema).refine(value => Object.keys(value).length <= 500) }).strict()
export function receiptKey(tool: string, id: string) { return createHash('sha256').update(JSON.stringify([tool, id])).digest('hex') }

/** No arguments, record contents, raw request IDs or provider errors reach disk. */
export class WriteJournal {
  private entries: Record<string, Receipt> = Object.create(null)
  private loaded?: Promise<void>
  private queue: Promise<unknown> = Promise.resolve()
  error?: string
  constructor(private path?: string) {}
  load() {
    return this.loaded ??= (async () => {
      if (!this.path) return
      try { this.entries = journalSchema.parse(JSON.parse(await readFile(this.path, 'utf8'))).entries }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.error = 'Write journal could not be loaded. Writes are blocked; inspect saved records and restore the private journal locally.' }
    })()
  }
  get size() { return Object.keys(this.entries).length }
  get(key: string) { return this.entries[key] }
  async put(key: string, value: Receipt) {
    await this.load()
    const run = this.queue.catch(() => {}).then(async () => {
      if (this.error) throw new McpError(this.error, 'JOURNAL_UNAVAILABLE')
      if (!this.entries[key] && this.size >= 500) throw new McpError('The durable write receipt limit was reached. Inspect records and archive the journal locally before making more edits.', 'JOURNAL_UNAVAILABLE')
      const next = { ...this.entries, [key]: value }
      if (this.path) {
        const temporary = `${this.path}.${process.pid}.tmp`
        try {
          const file = await open(temporary, 'w', 0o600)
          try { await file.writeFile(JSON.stringify({ version: 1, entries: next })); await file.sync() } finally { await file.close() }
          await rename(temporary, this.path)
        } catch {
          this.error = 'Write journal could not be saved. Writes are blocked; an executing edit may have completed. Inspect saved records.'
          throw new McpError(this.error, 'JOURNAL_UNAVAILABLE')
        } finally { await rm(temporary, { force: true }).catch(() => {}) }
      }
      this.entries = next
    })
    this.queue = run
    await run
  }
}
