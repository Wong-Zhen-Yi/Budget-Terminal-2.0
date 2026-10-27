import type { QuantPairDetail, QuantPairRow } from '../shared/contract.js'
import type { QuantWork } from '../workers/quantWorker.js'
import { createWorkerRpc, serviceWorker } from './workerRpc.js'

const rpc = createWorkerRpc(() => serviceWorker('quantWorker'))
let tail = Promise.resolve()

/** Timeout starts on admission, rather than while waiting behind another scan. */
function calculate<T>(request: QuantWork): Promise<T> {
  const result = tail.then(() => rpc.call<T>(request))
  tail = result.then(() => undefined, () => undefined)
  return result
}

export const discoverPairsInWorker = (histories: Extract<QuantWork, { kind: 'discover' }>['histories']) => calculate<QuantPairRow[]>({ kind: 'discover', histories })
export const pairDetailInWorker = (request: Omit<Extract<QuantWork, { kind: 'detail' }>, 'kind'>) => calculate<QuantPairDetail>({ kind: 'detail', ...request })
export const closeQuantWorker = () => rpc.close()
