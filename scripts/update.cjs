const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const path = require('node:path')

const exec = promisify(execFile)
const source = 'https://github.com/Wong-Zhen-Yi/Budget-Terminal-2.0.git'
const branch = 'refs/heads/main'
const commitPattern = /^[a-f0-9]{40}$/
const reopenMessage = 'Close Budget Terminal if it is open, then reopen it with the launcher to build and run the update.'

class UpdateError extends Error {}

function createUpdater(cwd = path.resolve(__dirname, '..'), run = exec) {
  // Work against this checkout even when the terminal is inside another Git operation.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')))
  env.GIT_TERMINAL_PROMPT = '0'
  const git = async (...args) => {
    try {
      const { stdout } = await run('git', [
        '-c', 'http.sslVerify=true', '-c', 'credential.helper=',
        '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always',
        ...args,
      ], { cwd, env, windowsHide: true, encoding: 'utf8', timeout: 60_000 })
      return stdout.trim()
    } catch (error) {
      if (error.code === 'ENOENT') throw new UpdateError('Git is required to update Budget Terminal. Install Git and make sure it is on PATH.')
      throw error
    }
  }

  const currentRevision = async () => {
    const prefix = await git('rev-parse', '--show-prefix').catch(error => {
      if (error.code === 128) throw new UpdateError('Updates require a Git clone of Budget Terminal.')
      throw error
    })
    if (prefix) throw new UpdateError('Updates require a Git clone of Budget Terminal.')
    if (await git('branch', '--show-current') !== 'main') {
      throw new UpdateError('Switch this checkout to the main branch before updating.')
    }
    return git('rev-parse', '--verify', 'HEAD')
  }

  const assertClean = async () => {
    if (await git('status', '--porcelain', '--untracked-files=normal')) {
      throw new UpdateError('This checkout has local changes. Commit, stash, or move them before updating.')
    }
  }

  const check = async () => {
    const current = await currentRevision()
    const remote = await git('ls-remote', '--exit-code', source, branch).catch(() => {
      throw new UpdateError('Could not reach the Budget Terminal update source. Check your internet connection and try again.')
    })
    const [revision, ref] = remote.split(/\s+/)
    if (!commitPattern.test(revision) || ref !== branch) {
      throw new UpdateError('The update source did not return a valid main branch revision.')
    }
    if (revision === current) return { status: 'current', revision }
    await git('fetch', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', source, revision).catch(() => {
      throw new UpdateError('Could not download the Budget Terminal update. Try again.')
    })
    await git('merge-base', '--is-ancestor', current, revision).catch(error => {
      if (error.code === 1) throw new UpdateError('Local main has commits outside the published main branch. Budget Terminal requires a fast-forward update.')
      throw error
    })
    return { status: 'available', revision, current }
  }

  return {
    check,
    async install(update) {
      if (update.status === 'current') return update
      const current = await currentRevision()
      if (current === update.revision) return { status: 'updated', revision: update.revision }
      if (current !== update.current) throw new UpdateError('The checkout changed during the update. Check for updates again.')
      await assertClean()
      // Dependency changes are installed by the launcher after the running app closes.
      await git('-c', 'core.hooksPath=/dev/null', '-c', 'merge.autoStash=false', 'merge', '--ff-only', '--no-overwrite-ignore', update.revision).catch(() => {
        throw new UpdateError('Git could not apply the update. Check for conflicting files or another Git operation and try again.')
      })
      return { status: 'updated', revision: update.revision }
    },
  }
}

async function runUpdate() {
  const updater = createUpdater()
  console.log('Checking for Budget Terminal updates…')
  try {
    const result = await updater.install(await updater.check())
    if (result.status === 'current') console.log('Budget Terminal source is up to date.')
    else console.log(`Budget Terminal source updated to ${result.revision.slice(0, 12)}. ${reopenMessage}`)
  } catch (error) {
    // Git stderr can include local paths and configuration. Display only our messages.
    console.error(`Budget Terminal update failed. ${updateErrorMessage(error)}`)
    process.exitCode = 1
  }
}

function updateErrorMessage(error) {
  return error instanceof UpdateError ? error.message : 'Git could not check this checkout. Verify Git is working and try again.'
}

module.exports = { createUpdater, reopenMessage, runUpdate, updateErrorMessage }
