import { parentPort } from 'node:worker_threads'
import { buildPairDetail, discoverPairs, type QuantBar } from '../shared/quant.js'

export type QuantWork =
  | { kind: 'discover'; histories: Record<string, QuantBar[]> }
  | { kind: 'detail'; left: string; right: string; leftBars: QuantBar[]; rightBars: QuantBar[] }

parentPort!.on('message', (request: QuantWork & { id: number }) => {
  try {
    const value = request.kind === 'discover' ? discoverPairs(request.histories)
      : buildPairDetail(request.left, request.right, request.leftBars, request.rightBars)
    parentPort!.postMessage({ id: request.id, value })
  } catch (error) {
    parentPort!.postMessage({ id: request.id, error: { name: error instanceof Error ? error.name : 'Error', message: String(error) } })
  }
})
