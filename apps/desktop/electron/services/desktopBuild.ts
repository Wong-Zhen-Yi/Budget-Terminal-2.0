import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Capture the loaded backend, including the dynamically imported service chunks. */
export function desktopBuildFingerprint(directory: string): string {
  const hash = createHash('sha256')
  for (const name of readdirSync(directory).filter(name => /\.[cm]?js$/.test(name)).sort()) {
    hash.update(name).update('\0').update(readFileSync(join(directory, name))).update('\0')
  }
  return hash.digest('hex')
}
