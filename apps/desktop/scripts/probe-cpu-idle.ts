/**
 * Measures steady-state CPU of the built desktop app in a temporary demo profile.
 *
 *   npm run build
 *   npm run probe:cpu-idle --workspace budget-terminal-desktop -- --warmup=150 --sample=60
 *
 * The app is launched exactly as the demo launcher does (fixture data, isolated
 * APPDATA/LOCALAPPDATA), so public providers are contacted. After startup loading,
 * each state is held idle and the CPU time of every app process is sampled from the
 * operating system. `--max-renderer=<percent>` / `--max-total=<percent>` turn the
 * report into a check; without them the probe only reports. `--profile=<directory>`
 * also records a renderer CPU profile per state and prints its hottest functions.
 */
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const require = createRequire(import.meta.url)
const appDirectory = resolve(import.meta.dirname, '..')
const option = (name: string, fallback: string) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
const warmupSeconds = Number(option('warmup', '150'))
const sampleSeconds = Number(option('sample', '60'))
const states = option('states', 'dashboard,charts,minimized').split(',').filter(Boolean)
const maxRenderer = process.argv.some(arg => arg.startsWith('--max-renderer=')) ? Number(option('max-renderer', '0')) : undefined
const maxTotal = process.argv.some(arg => arg.startsWith('--max-total=')) ? Number(option('max-total', '0')) : undefined
const port = Number(option('port', String(9400 + Math.floor(Math.random() * 400))))
const wait = (ms: number) => new Promise(resolveWait => setTimeout(resolveWait, ms))
const profileDirectory = option('profile', '')

interface CpuProfile {
  nodes: Array<{ id: number; callFrame: { functionName: string; url: string; lineNumber: number } }>
  samples: number[]
  timeDeltas: number[]
}

/** Top renderer functions by self time; idle and GC frames are reported as such. */
function hotSpots(profile: CpuProfile, limit = 15): string {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]))
  const self = new Map<string, number>()
  let total = 0
  profile.samples.forEach((id, index) => {
    const frame = nodes.get(id)?.callFrame
    const delta = profile.timeDeltas[index] ?? 0
    total += delta
    if (!frame) return
    const name = `${frame.functionName || '(anonymous)'} ${frame.url.split('/').at(-1) ?? ''}:${frame.lineNumber + 1}`
    self.set(name, (self.get(name) ?? 0) + delta)
  })
  return [...self].sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([name, micros]) => `  ${(micros / 1_000).toFixed(0).padStart(7)} ms  ${(micros / total * 100).toFixed(1).padStart(5)}%  ${name}`).join('\n')
}

interface ProcessSample { pid: number; ppid: number; cpuMs: number; label: string }

function label(command: string): string {
  const type = /--type=([\w-]+)/.exec(command)?.[1]
  if (!type) return /electron(\.exe)?["\s]/i.test(command) || /electron(\.exe)?$/i.test(command) ? 'main' : /node(\.exe)?["\s]/i.test(command) ? 'node' : 'other'
  if (type === 'utility') return `utility:${/--utility-sub-type=([\w.-]+)/.exec(command)?.[1]?.split('.').at(-2) ?? 'other'}`
  return type
}

async function processes(): Promise<ProcessSample[]> {
  if (process.platform === 'win32') {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,KernelModeTime,UserModeTime,CommandLine | ConvertTo-Json -Compress'],
    { maxBuffer: 64 * 1024 * 1024, windowsHide: true })
    return (JSON.parse(stdout) as Array<{ ProcessId: number; ParentProcessId: number; KernelModeTime: number; UserModeTime: number; CommandLine: string | null }>)
      .map(row => ({ pid: row.ProcessId, ppid: row.ParentProcessId, cpuMs: (Number(row.KernelModeTime) + Number(row.UserModeTime)) / 10_000, label: label(row.CommandLine ?? '') }))
  }
  const { stdout } = await run('ps', ['-A', '-o', 'pid=,ppid=,time=,args='], { maxBuffer: 64 * 1024 * 1024 })
  return stdout.split('\n').filter(Boolean).map(line => {
    const [, pid, ppid, time, args] = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line) ?? []
    const [days, clock] = time?.includes('-') ? time.split('-') : ['0', time ?? '0']
    const seconds = clock.split(':').reduce((total, part) => total * 60 + Number(part), 0) + Number(days) * 86_400
    return { pid: Number(pid), ppid: Number(ppid), cpuMs: seconds * 1_000, label: label(args ?? '') }
  })
}

async function tree(root: number): Promise<Map<number, ProcessSample>> {
  const all = await processes()
  const result = new Map<number, ProcessSample>()
  const queue = [root]
  while (queue.length) {
    const pid = queue.shift()!
    const row = all.find(entry => entry.pid === pid)
    if (row) result.set(pid, pid === root ? { ...row, label: 'main' } : row)
    for (const child of all) if (child.ppid === pid && !result.has(child.pid)) queue.push(child.pid)
  }
  return result
}

class Cdp {
  private id = 0
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  private constructor(private socket: WebSocket) {
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      const entry = message.id ? this.pending.get(message.id) : undefined
      if (!entry) return
      this.pending.delete(message.id)
      if (message.error) entry.reject(new Error(message.error.message))
      else entry.resolve(message.result)
    })
  }
  static async connect(url: string): Promise<Cdp> {
    const socket = new WebSocket(url)
    await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen); socket.addEventListener('error', reject) })
    return new Cdp(socket)
  }
  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++this.id
    this.socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolveSend, reject) => this.pending.set(id, { resolve: resolveSend, reject }))
  }
  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value as T
  }
  close() { this.socket.close() }
}

async function rendererTarget(): Promise<{ id: string; webSocketDebuggerUrl: string }> {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{ id: string; type: string; url: string; webSocketDebuggerUrl: string }>
      const page = targets.find(target => target.type === 'page' && /renderer\/index\.html|localhost:\d+\/?$/.test(target.url))
      if (page) return page
    } catch { /* The debugger endpoint opens shortly after launch. */ }
    await wait(500)
  }
  throw new Error('The app window did not expose a debuggable renderer')
}

const openPage = (cdp: Cdp, id: string, label: string) => cdp.evaluate<boolean>(`(async () => {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const visible = () => { const page = document.querySelector('[data-page-id="${id}"]'); return Boolean(page && page.getClientRects().length) }
  if (visible()) return true
  document.querySelector('.terminal-page-picker')?.click()
  await pause(300)
  const input = document.querySelector('input[aria-label="Search pages"]')
  if (!input) return false
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(label)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await pause(300)
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  for (let attempt = 0; attempt < 50 && !visible(); attempt++) await pause(100)
  return visible()
})()`)

const { createDemoSession } = require('../../../scripts/demo-session.cjs') as { createDemoSession: (env: NodeJS.ProcessEnv) => { env: NodeJS.ProcessEnv; close: () => void } }
const session = createDemoSession(process.env)
const env = { ...session.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(require('electron') as string, [appDirectory, `--remote-debugging-port=${port}`], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false })
let output = ''
child.stdout.on('data', data => { output += data })
child.stderr.on('data', data => { output += data })
let exited: number | null | undefined
const exit = new Promise<void>(resolveExit => child.once('exit', (code, signal) => {
  exited = code
  if (!finished) console.error(`The app exited early (code ${code}, signal ${signal}). Last output:
${output.slice(-3_000)}`)
  resolveExit()
}).once('error', () => resolveExit()))
let finished = false
const report: Record<string, { seconds: number; byProcess: Record<string, number>; total: number }> = {}
let cdp: Cdp | undefined
try {
  cdp = await Cdp.connect((await rendererTarget()).webSocketDebuggerUrl)
  console.log(`Startup loading: waiting ${warmupSeconds}s before sampling...`)
  await wait(warmupSeconds * 1_000)
  // Minimizing is one-way here, so it must be the last state measured.
  assert(!states.includes('minimized') || states.at(-1) === 'minimized', 'List minimized last in --states')
  for (const state of states) {
    if (state === 'minimized') await cdp.evaluate('window.api.windowControl("minimize")')
    else assert(await openPage(cdp, state, state === 'charts' ? 'Charts' : state === 'dashboard' ? 'Dashboard' : state), `Could not open ${state}`)
    await wait(10_000)
    // Profiling adds overhead, so use --profile runs to find hot functions, not for totals.
    if (profileDirectory) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start') }
    const before = await tree(child.pid!)
    const started = performance.now()
    await wait(sampleSeconds * 1_000)
    const after = await tree(child.pid!)
    if (profileDirectory) {
      const { profile } = await cdp.send('Profiler.stop') as { profile: CpuProfile }
      await mkdir(profileDirectory, { recursive: true })
      await writeFile(join(profileDirectory, `${state}.cpuprofile`), JSON.stringify(profile))
      console.log(`${state} renderer hot spots (self time):\n${hotSpots(profile)}`)
    }
    assert.equal(exited, undefined, `The app exited with code ${exited} while measuring ${state}`)
    const seconds = (performance.now() - started) / 1_000
    const byProcess: Record<string, number> = {}
    for (const [pid, sample] of after) {
      const delta = sample.cpuMs - (before.get(pid)?.cpuMs ?? 0)
      byProcess[sample.label] = (byProcess[sample.label] ?? 0) + delta / 10 / seconds
    }
    for (const key of Object.keys(byProcess)) byProcess[key] = Math.round(byProcess[key] * 100) / 100
    const total = Math.round(Object.values(byProcess).reduce((sum, value) => sum + value, 0) * 100) / 100
    report[state] = { seconds: Math.round(seconds), byProcess, total }
    console.log(`${state.padEnd(10)} total ${total.toFixed(2)}% of one core  ${Object.entries(byProcess).sort((a, b) => b[1] - a[1]).map(([name, value]) => `${name} ${value.toFixed(2)}%`).join(' · ')}`)
  }
  const json = option('json', '')
  if (json) await writeFile(json, JSON.stringify(report, null, 2))
  for (const [state, sample] of Object.entries(report)) {
    if (maxRenderer !== undefined) assert((sample.byProcess.renderer ?? 0) <= maxRenderer, `${state}: renderer CPU ${sample.byProcess.renderer}% exceeds ${maxRenderer}%`)
    if (maxTotal !== undefined) assert(sample.total <= maxTotal, `${state}: total CPU ${sample.total}% exceeds ${maxTotal}%`)
  }
  console.log('PASS: measured idle CPU in an isolated demo profile')
} catch (error) {
  console.error(output.slice(-4_000))
  throw error
} finally {
  finished = true
  cdp?.close()
  if (exited === undefined) child.kill()
  await exit
  await wait(1_000)
  try { session.close() } catch { console.warn('The temporary demo profile could not be removed.') }
}
