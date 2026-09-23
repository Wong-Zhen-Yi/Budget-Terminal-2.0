import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireDataSession } from '../electron/services/dataSession.js'

const scratch = await mkdtemp(join(tmpdir(), 'budget-session-'))
process.env.APPDATA = scratch
process.env.LOCALAPPDATA = scratch
let release: (() => void) | undefined
let child: ReturnType<typeof spawn> | undefined
try {
  release = acquireDataSession()
  assert.throws(acquireDataSession, /already using this data folder/)
  release()
  release()
  release = undefined
  child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import { acquireDataSession } from ${JSON.stringify(new URL('../electron/services/dataSession.ts', import.meta.url).href)}
    const release = acquireDataSession()
    process.once('exit', release)
    console.log('LOCKED')
    setInterval(() => {}, 1000)
  `], { env: { ...process.env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = once(child, 'exit')
  await new Promise<void>((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error(`Lock child timed out: ${output}`)), 10_000)
    child!.stdout!.on('data', (chunk) => {
      output += chunk
      if (output.includes('LOCKED')) { clearTimeout(timer); resolve() }
    })
    child!.stderr!.on('data', (chunk) => { output += chunk })
    child!.once('error', (error) => { clearTimeout(timer); reject(error) })
    child!.once('exit', () => { clearTimeout(timer); reject(new Error(output)) })
  })
  assert.throws(acquireDataSession, /already using this data folder/)
  // Simulate a crash: no application cleanup handler runs.
  child.kill('SIGKILL')
  await exited
  child = undefined
  release = acquireDataSession()
  console.log('PASS: same-process and cross-process exclusion, idempotent release, immediate recovery after crash')
} catch (error) {
  console.error('Session check failed:', error)
  throw error
} finally {
  if (child) {
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
  }
  release?.()
  await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
