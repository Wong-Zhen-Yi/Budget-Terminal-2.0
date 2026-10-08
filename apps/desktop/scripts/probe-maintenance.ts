/** One-time verification runner. Every child receives an isolated profile before imports. */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const output = join(root, 'out', 'maintenance')
const scratch = await mkdtemp(join(tmpdir(), 'budget-maintenance-'))
const ui = process.argv.includes('--ui')
const only = process.argv.find(value => value.startsWith('--only='))?.slice(7).split(',')
const report = join(output, only ? `offline-recheck-${new Date().toISOString().replace(/[:.]/g, '-')}.json` : 'offline-results.json')
interface Check { name: string; status: 'passed' | 'failed' | 'skipped'; durationMs: number; reason?: string; output?: string }
const checks: Check[] = []
await mkdir(output, { recursive: true })
try {
  const files = (await readdir(import.meta.dirname)).filter(file => /^probe-.+\.ts$/.test(file)
    && !file.startsWith('probe-maintenance')).sort()
  for (const file of files) {
    const name = file.slice(6, -3)
    if (only && !only.includes(name)) continue
    const isUi = name.endsWith('-ui') || ['navigation', 'security', 'mac-relaunch', 'mcp'].includes(name)
    if (isUi && !ui) continue
    const source = await readFile(join(import.meta.dirname, file), 'utf8')
    // Do not accidentally run a live-by-default report as an offline regression.
    if (['finance', 'analytics'].includes(name) && !source.includes('--offline')) {
      checks.push({ name, status: 'skipped', durationMs: 0, reason: 'No offline mode; run isolated live validation separately.' })
      continue
    }
    const directory = join(scratch, name)
    await mkdir(directory, { recursive: true })
    const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: join(directory, 'roaming'), LOCALAPPDATA: join(directory, 'local'),
      BUDGET_TERMINAL_DATA_DIR: join(directory, 'roaming', 'BudgetTerminalElectron') }
    delete env.ELECTRON_RUN_AS_NODE
    const started = Date.now()
    const result = await new Promise<{ code: number | null; output: string; timedOut: boolean }>(resolveRun => {
      const child = spawn(process.execPath, ['--import', 'tsx', join(import.meta.dirname, file), '--offline'], {
        cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      })
      let text = ''
      let timedOut = false
      child.stdout.on('data', data => { text += data })
      child.stderr.on('data', data => { text += data })
      const timer = setTimeout(() => { timedOut = true; child.kill() }, isUi ? 300_000 : 90_000)
      child.once('error', error => { clearTimeout(timer); resolveRun({ code: 1, output: String(error), timedOut }) })
      child.once('exit', code => { clearTimeout(timer); resolveRun({ code, output: text, timedOut }) })
    })
    const check: Check = { name, status: result.code === 0 && !result.timedOut ? 'passed' : 'failed',
      durationMs: Date.now() - started, output: result.output,
      ...(result.timedOut ? { reason: 'Probe timed out' } : {}) }
    checks.push(check)
    console.log(`${check.status.toUpperCase()}: ${name} (${check.durationMs}ms)`)
    if (check.status === 'failed') console.log(result.output.slice(-5000))
    await writeFile(report, JSON.stringify({ generatedAt: new Date().toISOString(),
      node: process.version, platform: process.platform, isolated: true, checks }, null, 2) + '\n')
  }
  const failures = checks.filter(check => check.status === 'failed')
  console.log(`${checks.filter(check => check.status === 'passed').length} passed, ${failures.length} failed, ${checks.filter(check => check.status === 'skipped').length} skipped. Report: ${report}`)
  if (failures.length) process.exitCode = 1
} finally {
  const location = relative(tmpdir(), scratch)
  if (!location || location.startsWith('..') || resolve(tmpdir(), location) !== scratch) throw new Error('Unsafe maintenance scratch path')
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
