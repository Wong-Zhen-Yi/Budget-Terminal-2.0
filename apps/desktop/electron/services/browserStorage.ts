import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Resolve existing ancestors too, so junctions/symlinks cannot hide a source checkout. */
function physicalPath(value: string): string {
  const target = resolve(value)
  if (existsSync(target)) return realpathSync(target)
  const parent = dirname(target)
  return parent === target ? target : resolve(physicalPath(parent), relative(parent, target))
}

function repositoryRoot(value: string): string | null {
  let directory = resolve(value)
  while (true) {
    // .git may be a directory or a worktree pointer file.
    if (existsSync(join(directory, '.git'))) return directory
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

function inside(directory: string, parent: string): boolean {
  const path = relative(parent, directory)
  return !path || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

/** Fail closed instead of allowing Chromium cookies or tokens to be written to source. */
export function assertPrivateBrowserStorage(directory: string, applicationDirectory: string): void {
  const storage = physicalPath(directory)
  const application = physicalPath(applicationDirectory)
  const source = repositoryRoot(application) ?? application
  if (inside(storage, source) || inside(resolve(directory), resolve(applicationDirectory)) || repositoryRoot(directory) || repositoryRoot(storage)) {
    throw new Error('Browser login storage must be outside application source and Git repositories. Restore the operating-system application-data location and restart Budget Terminal.')
  }
}
