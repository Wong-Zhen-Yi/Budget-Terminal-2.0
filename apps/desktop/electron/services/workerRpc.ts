import { existsSync } from 'node:fs'
import { Worker } from 'node:worker_threads'

/** Bundled entries in Electron; the same typed sources in tsx probes. */
export function serviceWorker(name: 'quantWorker' | 'cacheWorker', workerData?: unknown): Worker {
  const execArgv = process.execArgv.filter(argument => !argument.startsWith('--input-type'))
  const bundled = new URL(`./${name}.js`, import.meta.url)
  if (existsSync(bundled)) return new Worker(bundled, { workerData, execArgv })
  const source = new URL(`../workers/${name}.ts`, import.meta.url).href
  return new Worker(`
    const { workerData } = require('node:worker_threads')
    import(workerData.loader).then(({ tsImport }) => tsImport(workerData.source, workerData.parent))
  `, { eval: true, execArgv, workerData: { ...(workerData as object), loader: import.meta.resolve('tsx/esm/api'), source, parent: import.meta.url } })
}

export interface WorkerReply {
  id: number
  value?: unknown
  error?: { name: string; message: string; stack?: string }
}

export function createWorkerRpc(start: () => Worker, timeoutMs = 90_000) {
  let worker: Worker | undefined
  let sequence = 0
  let closed = false
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const fail = (current: Worker, error: Error) => {
    if (worker !== current) return
    worker = undefined
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
    void current.terminate()
  }
  return {
    call<T>(request: object): Promise<T> {
      return new Promise((resolve, reject) => {
        if (closed) { reject(new Error('Worker is closed')); return }
        try {
          if (!worker) {
            const current = start()
            worker = current
            current.on('message', (reply: WorkerReply) => {
              if (worker !== current) return
              const job = pending.get(reply.id)
              if (!job) return
              pending.delete(reply.id)
              clearTimeout(job.timer)
              if (reply.error) job.reject(Object.assign(new Error(reply.error.message), reply.error))
              else job.resolve(reply.value)
              if (!pending.size) current.unref()
            })
            current.on('error', error => fail(current, error instanceof Error ? error : new Error(String(error))))
            current.on('exit', code => fail(current, new Error(`Worker exited (${code})`)))
          }
          const current = worker
          const id = ++sequence
          const timer = setTimeout(() => fail(current, new Error(`Worker request timed out after ${timeoutMs}ms`)), timeoutMs)
          pending.set(id, { resolve: value => resolve(value as T), reject, timer })
          current.ref()
          try { current.postMessage({ ...request, id }) } catch (error) {
            clearTimeout(timer)
            pending.delete(id)
            if (!pending.size) current.unref()
            reject(error)
          }
        } catch (error) { reject(error) }
      })
    },
    close() {
      closed = true
      if (worker) fail(worker, new Error('Worker is closed'))
    },
  }
}
