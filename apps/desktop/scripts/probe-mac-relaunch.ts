import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const directory = await mkdtemp(join(tmpdir(), 'budget-relaunch-'))
const electron = createRequire(import.meta.url)('electron') as string
const entry = join(import.meta.dirname, 'fixtures', 'mac-relaunch.mjs')
const environment: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
delete environment.ELECTRON_RUN_AS_NODE

function launch(primary: boolean, mode: string) {
  const child = spawn(electron, [entry], {
    env: { ...environment, BUDGET_PROBE_PRIMARY: primary ? '1' : '0', BUDGET_PROBE_MODE: mode },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  return { child, output: () => output }
}

async function waitFor(check: () => boolean, label: string, diagnostics = () => ''): Promise<void> {
  const deadline = Date.now() + 30_000
  while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25))
  assert.ok(check(), `Timed out waiting for ${label}\n${diagnostics()}`)
}

try {
  const modes = process.platform === 'darwin' ? ['closed', 'hidden', 'minimized'] : ['hidden', 'minimized']
  for (const mode of modes) {
    const first = launch(true, mode)
    let second: ReturnType<typeof launch> | undefined
    try {
      await waitFor(() => first.output().includes(mode.toUpperCase()) || first.child.exitCode !== null,
        `first window to become ${mode}`, first.output)
      assert.equal(first.child.exitCode, null, first.output())
      assert.ok(first.output().includes(mode.toUpperCase()), first.output())
      second = launch(false, mode)
      await waitFor(() => first.output().includes('REOPENED') || first.child.exitCode !== null,
        'second launch to reopen the first process')
      assert(first.output().includes('REOPENED'), `${first.output()}\nSecond launch:\n${second.output()}`)
      await waitFor(() => second!.child.exitCode !== null && first.child.exitCode !== null, 'both probe processes to exit')
      assert.equal(first.child.exitCode, 0, first.output())
      assert.equal(second.child.exitCode, 0, second.output())
      assert.doesNotMatch(second.output(), /already using this data folder/)
      console.log(`PASS: second launch restored the ${mode} window in the existing process and rendered its content`)
    } finally {
      first.child.kill()
      second?.child.kill()
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
