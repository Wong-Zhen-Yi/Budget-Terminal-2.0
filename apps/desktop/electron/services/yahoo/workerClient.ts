import { Worker } from 'node:worker_threads'
import type YahooFinance from 'yahoo-finance2'

const METHODS = ['chart', 'quote', 'quoteSummary', 'options', 'fundamentalsTimeSeries', 'search', 'screener', '_fetch'] as const
type Method = typeof METHODS[number]
// Library overloads require its private ModuleThis context in their signatures.
// The actual context remains in the worker; callers only use METHODS below.
type YahooClient = InstanceType<typeof YahooFinance>

// An inline bootstrap works in both the bundled Electron main process and tsx
// probes. The library itself resolves from the application's installed dependency.
const BOOTSTRAP = `
const { parentPort, workerData } = require('node:worker_threads')
let client
parentPort.on('message', async ({ id, method, args }) => {
  try {
    if (!workerData.methods.includes(method)) throw new Error('Unsupported Yahoo method')
    client ??= import(workerData.moduleUrl).then(({ default: YahooFinance }) => new YahooFinance({
      suppressNotices: ['yahooSurvey'],
      validation: { logErrors: false, logOptionsErrors: false },
      queue: { concurrency: 4 },
    }))
    const yahoo = await client
    const value = await yahoo[method](...args)
    parentPort.postMessage({ id, value })
  } catch (error) {
    parentPort.postMessage({ id, error: {
      name: error?.name ?? 'Error', message: error?.message ?? String(error),
      stack: error?.stack, code: error?.code,
      status: error?.status ?? error?.response?.status,
    } })
  }
})
`

interface WorkerReply {
  id: number
  value?: unknown
  error?: { name: string; message: string; stack?: string; code?: string; status?: number }
}

/** One Yahoo session/cookie jar off the main event loop; admission stays in paced(). */
export function createYahooWorkerClient(moduleUrl = import.meta.resolve('yahoo-finance2')) {
  let worker: Worker | undefined
  let sequence = 0
  let closed = false
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  const fail = (current: Worker, error: Error) => {
    if (worker !== current) return
    worker = undefined
    for (const request of pending.values()) request.reject(error)
    pending.clear()
    void current.terminate()
  }
  const start = () => {
    if (worker) return worker
    const current = new Worker(BOOTSTRAP, {
      eval: true, workerData: { moduleUrl, methods: METHODS },
    })
    worker = current
    current.on('message', (reply: WorkerReply) => {
      if (worker !== current) return
      const request = pending.get(reply.id)
      if (!request) return
      pending.delete(reply.id)
      if (reply.error) {
        const error = Object.assign(new Error(reply.error.message), reply.error)
        request.reject(error)
      } else request.resolve(reply.value)
      // Idle workers must not keep CLI probes or application shutdown alive.
      if (!pending.size) current.unref()
    })
    current.on('error', error => fail(current, error instanceof Error ? error : new Error(String(error))))
    current.on('exit', code => fail(current, new Error(`Yahoo worker exited (${code})`)))
    return current
  }
  const call = (method: Method, args: unknown[]): Promise<unknown> => new Promise((resolve, reject) => {
    if (closed) { reject(new Error('Yahoo worker is closed')); return }
    const current = start()
    const id = ++sequence
    pending.set(id, { resolve, reject })
    current.ref()
    try { current.postMessage({ id, method, args }) } catch (error) {
      pending.delete(id)
      if (!pending.size) current.unref()
      reject(error)
    }
  })
  // Preserve the library's overloads and the replaceable methods used by offline probes.
  const yahoo = Object.fromEntries(METHODS.map(method => [method, (...args: unknown[]) => call(method, args)])) as unknown as YahooClient
  return {
    yahoo,
    close: () => {
      closed = true
      if (worker) fail(worker, new Error('Yahoo worker is closed'))
    },
  }
}
