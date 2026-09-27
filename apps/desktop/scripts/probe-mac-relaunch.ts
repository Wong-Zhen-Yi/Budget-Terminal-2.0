import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

if (process.platform !== 'darwin') {
  console.log('macOS relaunch probe skipped on this platform')
  process.exit(0)
}

const directory = await mkdtemp(join(tmpdir(), 'budget-mac-relaunch-'))
const electron = createRequire(import.meta.url)('electron') as string
const entry = join(import.meta.dirname, 'fixtures', 'mac-relaunch.mjs')
const environment: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
delete environment.ELECTRON_RUN_AS_NODE

function launch(primary: boolean) {
  const child = spawn(electron, [entry], {
    env: { ...environment, BUDGET_PROBE_PRIMARY: primary ? '1' : '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  return { child, output: () => output }
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25))
  assert.ok(check(), `Timed out waiting for ${label}`)
}

const first = launch(true)
let second: ReturnType<typeof launch> | undefined
try {
  await waitFor(() => first.output().includes('CLOSED'), 'first window to close')
  assert.equal(first.child.exitCode, null, first.output())
  second = launch(false)
  await waitFor(() => first.output().includes('REOPENED'), 'second launch to reopen the first process')
  await waitFor(() => second!.child.exitCode !== null, 'second process to exit')
  assert.equal(second.child.exitCode, 0, second.output())
  assert.doesNotMatch(second.output(), /already using this data folder/)
  console.log('PASS: macOS second launch reopened the existing process and rendered its window')
} finally {
  first.child.kill()
  second?.child.kill()
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
