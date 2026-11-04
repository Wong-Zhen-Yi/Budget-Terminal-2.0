import { randomBytes } from 'node:crypto'
import { McpError } from '../../mcp/errors.js'

/** Bounded, private session snapshots. Never persisted or exported. */
export class ResearchSnapshots {
  private entries = new Map<string, { key: string; result: unknown; bytes: number; expiresAt: number }>()
  private prune() { for (const [id, entry] of this.entries) if (entry.expiresAt <= Date.now()) this.entries.delete(id) }
  create(key: string, result: unknown) {
    this.prune()
    const bytes = Buffer.byteLength(JSON.stringify(result))
    if (bytes > 4 * 1024 * 1024) throw new McpError('Snapshot exceeds 4 MiB. Narrow the research request.', 'INVALID_ARGUMENTS')
    while (this.entries.size >= 8 || [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, bytes) > 16 * 1024 * 1024) this.entries.delete(this.entries.keys().next().value!)
    const id = randomBytes(16).toString('hex')
    const expiresAt = Date.now() + 300_000
    this.entries.set(id, { key, result: { ...(structuredClone(result) as object), snapshotId: id, snapshotExpiresAt: expiresAt }, bytes, expiresAt })
    return id
  }
  read(id: string, key: string) {
    this.prune()
    const entry = this.entries.get(id)
    if (!entry || entry.key !== key) throw new McpError('Research snapshot expired or does not match this tool and request. Request a new snapshot.', 'INVALID_ARGUMENTS')
    return structuredClone(entry.result)
  }
  clear() { this.entries.clear() }
}
