import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

export interface CodexResult {
  model?: string
  reasoningEffort?: string | null
  data?: { model: string; displayName: string; hidden?: boolean; inputModalities?: string[]; defaultReasoningEffort: string; supportedReasoningEfforts: { reasoningEffort: string; description: string }[] }[]
  imageGeneration?: boolean
  nextCursor?: string | null
  account?: unknown
  config?: { mcp_servers?: Record<string, unknown> }
  thread?: { id: string }
  turn?: { id: string }
}
export interface CodexPacket {
  id?: number | string
  method?: string
  params?: {
    threadId?: string
    turnId?: string
    itemId?: string
    delta?: string
    tool?: string
    arguments?: unknown
    item?: { id: string; type: string; phase?: 'commentary' | 'final_answer'; text?: string; status?: string; result?: string; failure?: { type?: string; resetsAt?: number | null } | null }
    turn?: { id?: string; status: string; error?: { message?: string } }
    error?: { message?: string }
    willRetry?: boolean
  }
  result?: CodexResult
  error?: { message: string }
}
export interface CodexTransport {
  start(): Promise<void>
  request(method: string, params: unknown): Promise<CodexResult>
  write(packet: unknown): void
  close(): void
}

/** A private stdio connection. No shell interpolation or renderer access to credentials. */
export class CodexClient {
  private process: ChildProcessWithoutNullStreams | null = null
  private sequence = 0
  private pending = new Map<number, { resolve: (value: CodexResult) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()

  constructor(private executable: string, private cwd: string,
    private receive: (packet: CodexPacket) => void, private disconnected: (error: string) => void) {}

  async start() {
    const child = spawn(this.executable, ['app-server', '--listen', 'stdio://',
      '-c', 'features.shell_tool=false', '-c', 'features.unified_exec=false',
      '-c', 'features.plugins=false', '-c', 'agents.enabled=false', '-c', 'web_search="disabled"'],
    { cwd: this.cwd, windowsHide: true, stdio: 'pipe' })
    this.process = child
    // Always drain stderr; it may contain runtime diagnostics, never expose credentials.
    child.stderr.resume()
    const lines = createInterface({ input: child.stdout })
    lines.on('line', line => {
      try {
        const packet = JSON.parse(line) as CodexPacket
        if (!packet.method && typeof packet.id === 'number') {
          const call = this.pending.get(packet.id)
          if (!call) return
          clearTimeout(call.timer)
          this.pending.delete(packet.id)
          if (packet.error) call.reject(new Error(packet.error.message))
          else call.resolve(packet.result ?? {})
        } else this.receive(packet)
      } catch { /* Ignore non-protocol diagnostic lines. */ }
    })
    const ended = (message: string) => {
      if (this.process !== child) return
      this.close()
      this.disconnected(message)
    }
    child.on('error', error => ended((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'Codex executable was not found. Check the installation and reconnect.' : 'Codex could not start. Check the installation and reconnect.'))
    child.on('exit', (code, signal) => ended(`Codex process exited (code ${code ?? 'unknown'}, signal ${signal ?? 'none'}). Continue research to recover.`))
    child.stdin.on('error', () => ended('Codex connection was interrupted. Continue research to recover.'))
    await this.request('initialize', { clientInfo: { name: 'budget_terminal', title: 'Budget Terminal', version: '0.1.0' }, capabilities: { experimentalApi: true } })
    this.write({ method: 'initialized', params: {} })
  }

  request(method: string, params: unknown): Promise<CodexResult> {
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} timed out.`)) }, 30_000)
      this.pending.set(id, { resolve, reject, timer })
      try { this.write({ id, method, params }) } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  write(packet: unknown) {
    if (!this.process || this.process.stdin.destroyed) throw new Error('Codex is not connected.')
    this.process.stdin.write(`${JSON.stringify(packet)}\n`)
  }

  close() {
    const child = this.process
    this.process = null
    child?.kill()
    for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(new Error('Codex connection closed.')) }
    this.pending.clear()
  }
}
