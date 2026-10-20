import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publishBundle, retryFileLock } from '../mcp/publishBundle.js'

const directory = await mkdtemp(join(tmpdir(), 'budget-mcp-build-'))
const output = join(directory, 'folder with spaces', 'server.mjs')
const original = Buffer.from('export const version = 1\n')
const updated = Buffer.from('export const version = 2\n')
const fastRetry = { attempts: 3, delayMs: 1 }

async function withWindowsLock(action: (release: () => void) => Promise<void>) {
  // Allow reads but deny writes/deletes, like an MCP client or scanner holding
  // the bundle. Keep the handle open until the test explicitly releases it.
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$ErrorActionPreference = "Stop"; $file = [System.IO.File]::Open($env:BUDGET_MCP_LOCK_PATH, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read); try { [Console]::Out.WriteLine("LOCKED"); [Console]::In.ReadLine() | Out-Null } finally { $file.Dispose() }',
  ], { env: { ...process.env, BUDGET_MCP_LOCK_PATH: output }, windowsHide: true, stdio: 'pipe' })
  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  const exited = new Promise<number | null>(resolve => child.once('close', resolve))
  const release = () => { if (!child.stdin.writableEnded) child.stdin.end('\n') }
  child.stdin.on('error', () => {}) // Startup failures are reported below.
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out opening Windows lock')), 10_000)
      const ready = (error?: Error) => { clearTimeout(timer); error ? reject(error) : resolve() }
      child.once('error', ready)
      child.once('exit', code => ready(new Error(`Lock fixture exited (${code}): ${stderr}`)))
      child.stdout.once('data', chunk => {
        if (chunk.toString().includes('LOCKED')) ready()
        else ready(new Error(`Unexpected lock fixture output: ${chunk}`))
      })
    })
    await action(release)
  } finally {
    release()
    assert.equal(await exited, 0, stderr)
  }
}

try {
  await publishBundle(output, original)
  assert.deepEqual(await readFile(output), original)
  const before = await stat(output)
  await publishBundle(output, original)
  assert.equal((await stat(output)).mtimeMs, before.mtimeMs, 'Identical builds must not rewrite the bundle')
  await publishBundle(output, updated)
  assert.deepEqual(await readFile(output), updated)
  assert.deepEqual(await readdir(join(directory, 'folder with spaces')), ['server.mjs'])

  // Both the standalone and plugin publisher use the same safe operation.
  const plugin = join(directory, 'plugin', 'server.mjs')
  await publishBundle(plugin, updated)
  assert.deepEqual(await readFile(plugin), await readFile(output))

  for (const code of ['EBUSY', 'EPERM', 'EACCES', 'ETXTBSY']) {
    let calls = 0
    const result = await retryFileLock(async () => {
      if (++calls < 3) throw Object.assign(new Error('Locked'), { code })
      return 'published'
    }, output, fastRetry)
    assert.equal(result, 'published')
    assert.equal(calls, 3)
  }
  let calls = 0
  const fullDisk = Object.assign(new Error('Disk full'), { code: 'ENOSPC' })
  await assert.rejects(retryFileLock(async () => { calls++; throw fullDisk }, output, fastRetry), error => error === fullDisk)
  assert.equal(calls, 1, 'Unrelated failures must not be retried or described as locks')
  calls = 0
  const locked = Object.assign(new Error('Locked'), { code: 'EBUSY' })
  await assert.rejects(retryFileLock(async () => { calls++; throw locked }, output, fastRetry), error => {
    assert(error instanceof Error)
    assert.equal(error.cause, locked)
    assert(error.message.includes(output))
    assert.match(error.message, /disconnect.*MCP.*Launch Budget Terminal.cmd/)
    return true
  })
  assert.equal(calls, 3, 'Persistent locks must stop after a bounded number of attempts')

  if (process.platform === 'win32') {
    await withWindowsLock(async () => {
      const before = await stat(output)
      await publishBundle(output, updated, fastRetry)
      assert.equal((await stat(output)).mtimeMs, before.mtimeMs, 'Identical builds must work while the bundle is locked')
      await assert.rejects(publishBundle(output, original, fastRetry), /keeping it locked/)
      assert.deepEqual(await readFile(output), updated, 'Failed replacement must preserve the previous complete bundle')
      assert.deepEqual(await readdir(join(directory, 'folder with spaces')), ['server.mjs'], 'Failed replacement must remove its temporary file')
    })
    await withWindowsLock(async release => {
      const timer = setTimeout(release, 300)
      try {
        await publishBundle(output, original, { attempts: 40, delayMs: 50 })
      } finally {
        clearTimeout(timer)
      }
      assert.deepEqual(await readFile(output), original, 'A transient real Windows lock must recover')
    })
  }
  console.log('MCP build checks passed: new/unchanged/changed bundles, plugin parity, transient retries, bounded lock errors, and preservation/cleanup under real Windows locks (Windows only).')
} finally {
  await rm(directory, { recursive: true, force: true })
}
