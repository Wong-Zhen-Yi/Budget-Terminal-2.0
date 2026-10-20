import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'

const lockCodes = new Set(['EBUSY', 'EACCES', 'EPERM', 'ETXTBSY'])

interface RetryOptions {
  attempts?: number
  delayMs?: number
}

export async function retryFileLock<T>(operation: () => Promise<T>, output: string, { attempts = 40, delayMs = 250 }: RetryOptions = {}): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (!lockCodes.has((error as NodeJS.ErrnoException).code ?? '')) throw error
      if (attempt >= attempts) {
        throw new Error(`Cannot update MCP bundle "${output}" because another process is keeping it locked. Close Budget Terminal and disconnect Budget Terminal MCP in Codex or other MCP clients, then run Launch Budget Terminal.cmd again. If the lock persists, check antivirus scanning or folder permissions.`, { cause: error })
      }
      await pause(delayMs)
    }
  }
}

// Never truncate a bundle that an MCP client may be starting or already using.
export async function publishBundle(output: string, contents: Uint8Array, options: RetryOptions = {}): Promise<void> {
  await mkdir(dirname(output), { recursive: true })
  const existing = await retryFileLock(async () => {
    try {
      return await readFile(output)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }, output, options)
  if (existing?.equals(contents)) return

  // A unique sibling keeps concurrent builds isolated and rename on one volume.
  const temporary = `${output}.${randomUUID()}.tmp`
  try {
    await retryFileLock(() => writeFile(temporary, contents), output, options)
    await retryFileLock(() => rename(temporary, output), output, options)
  } finally {
    await retryFileLock(() => rm(temporary, { force: true }), temporary, options)
  }
}
