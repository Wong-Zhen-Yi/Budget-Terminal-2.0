import { Worker } from 'node:worker_threads'
import type { AsyncBuffer } from 'hyparquet'
import type { DataRow } from './client.js'

// Decoding/transposing a Parquet row group is synchronous CPU work. Keep it off
// Electron's main event loop, including during a many-symbol Yahoo outage.
const BOOTSTRAP = `
const { parentPort, workerData } = require('node:worker_threads')
const modules = Promise.all([import(workerData.parquet), import(workerData.compressors)])
const metadata = new Map()
const ranges = new Map()
let sequence = 0
parentPort.on('message', async message => {
  if (message.kind === 'range') {
    const request = ranges.get(message.rangeId)
    if (!request) return
    ranges.delete(message.rangeId)
    if (message.error) request.reject(new Error(message.error))
    else request.resolve(message.buffer)
    return
  }
  const { id, key, size, symbol, symbols, startDate, columns } = message
  try {
    const [{ parquetMetadataAsync, parquetReadObjects }, { compressors }] = await modules
    const file = { byteLength: size, slice: (start, end) => new Promise((resolve, reject) => {
      const rangeId = ++sequence
      ranges.set(rangeId, { resolve, reject })
      parentPort.postMessage({ kind: 'range', id, rangeId, start, end })
    }) }
    if (!metadata.has(key)) {
      if (metadata.size >= 8) metadata.delete(metadata.keys().next().value)
      metadata.set(key, parquetMetadataAsync(file).catch(error => { metadata.delete(key); throw error }))
    }
    const fileMetadata = await metadata.get(key)
    const options = { file, metadata: fileMetadata, compressors, columns,
      filter: { symbol: symbols ? { $in: symbols } : { $eq: symbol },
        ...(startDate ? { report_date: { $gte: startDate } } : {}) } }
    const rows = []
    if (symbols) {
      // Do not retain decoded columns for the entire US history while HTTP ranges
      // wait in the gate. Only matching recent rows survive each bounded read.
      let rowStart = 0
      for (let index = 0; index < fileMetadata.row_groups.length; index += 4) {
        const rowEnd = rowStart + fileMetadata.row_groups.slice(index, index + 4)
          .reduce((count, group) => count + Number(group.num_rows), 0)
        const chunk = await parquetReadObjects({ ...options, rowStart, rowEnd })
        for (const row of chunk) rows.push(row)
        rowStart = rowEnd
      }
    } else {
      for (const row of await parquetReadObjects(options)) rows.push(row)
    }
    parentPort.postMessage({ kind: 'result', id, rows })
  } catch (error) {
    parentPort.postMessage({ kind: 'result', id, error: error?.message ?? String(error) })
  }
})
`

interface Request {
  file: AsyncBuffer
  resolve: (rows: DataRow[]) => void
  reject: (error: Error) => void
}

let worker: Worker | undefined
let sequence = 0
const pending = new Map<number, Request>()

function fail(current: Worker, error: Error): void {
  if (worker !== current) return
  worker = undefined
  for (const request of pending.values()) request.reject(error)
  pending.clear()
  void current.terminate()
}

function start(): Worker {
  if (worker) return worker
  const current = new Worker(BOOTSTRAP, {
    eval: true,
    execArgv: process.execArgv.filter(argument => !argument.startsWith('--input-type')),
    workerData: {
      parquet: import.meta.resolve('hyparquet'), compressors: import.meta.resolve('hyparquet-compressors'),
    },
  })
  worker = current
  current.on('message', async (message: { kind: string; id: number; rangeId?: number; start: number; end?: number; rows: DataRow[]; error?: string }) => {
    if (worker !== current) return
    const request = pending.get(message.id)
    if (!request) return
    if (message.kind === 'range') {
      try {
        const buffer = await request.file.slice(message.start, message.end)
        if (worker === current) current.postMessage({ kind: 'range', rangeId: message.rangeId, buffer }, [buffer])
      } catch (error) {
        if (worker === current) current.postMessage({ kind: 'range', rangeId: message.rangeId, error: String(error) })
      }
    } else {
      pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error))
      else request.resolve(message.rows)
      if (!pending.size) current.unref()
    }
  })
  current.on('error', error => fail(current, error instanceof Error ? error : new Error(String(error))))
  current.on('exit', code => fail(current, new Error(`DefeatBeta decoder exited (${code})`)))
  return current
}

export function readDefeatBetaParquet(file: AsyncBuffer, key: string, symbol: string,
  options: { columns?: string[]; symbols?: string[]; startDate?: string } = {}): Promise<DataRow[]> {
  return new Promise((resolve, reject) => {
    const current = start()
    const id = ++sequence
    pending.set(id, { file, resolve, reject })
    current.ref()
    try { current.postMessage({ id, key, size: file.byteLength, symbol, ...options }) } catch (error) {
      pending.delete(id)
      if (!pending.size) current.unref()
      reject(error)
    }
  })
}

export function closeDefeatBetaDecoder(): void {
  if (worker) fail(worker, new Error('DefeatBeta decoder is closed'))
}
