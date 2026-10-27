import { useQueries } from '@tanstack/react-query'
import type { UpDownRow, UpDownTargetsRequest } from '@shared/contract'
import { api } from './client'
import { queryFreshness } from './queryPersistence'

const BATCH_SIZE = 12
const MAX_ACTIVE = 8
let active = 0
const waiting: Array<() => void> = []

export function upDownTargetBatches(rows: readonly Pick<UpDownRow, 'ticker'>[]): string[][] {
  const tickers = [...new Set(rows.map(row => row.ticker))].sort()
  return Array.from({ length: Math.ceil(tickers.length / BATCH_SIZE) },
    (_, index) => tickers.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE))
}

export const upDownTargetsKey = (tickers: string[], revision = 0) =>
  ['upDownTargets', [...tickers].sort().join(','), revision] as const

/** Share bounded target work between startup preparation and interactive views. */
export async function loadUpDownTargets(request: UpDownTargetsRequest) {
  if (active >= MAX_ACTIVE) await new Promise<void>(resolve => waiting.push(resolve))
  else active += 1
  try { return await api.upDownTargets(request) }
  finally {
    const next = waiting.shift()
    if (next) next()
    else active -= 1
  }
}

export function useUpDownTargets(rows: UpDownRow[], force: boolean, revision: number) {
  const batches = upDownTargetBatches(rows)
  const queries = useQueries({ queries: batches.map(tickers => {
    const queryKey = upDownTargetsKey(tickers, force ? revision : 0)
    return { queryKey, queryFn: () => loadUpDownTargets({ tickers, force }),
      staleTime: queryFreshness(queryKey) }
  }) })
  const targets: Record<string, number | null> = {}
  let resolved = 0
  let available = 0
  let failures = 0
  let loading = false
  queries.forEach((query, index) => {
    loading ||= query.isPending || query.isFetching
    if (query.isError || query.data?.meta.freshness === 'failed') failures += 1
    if (query.data || query.isError) {
      resolved += batches[index].length
      for (const ticker of batches[index]) {
        const target = query.data?.data.targets[ticker] ?? null
        targets[ticker] = target
        if (target !== null) available += 1
      }
    }
  })
  return { targets, resolved, available, failures, loading }
}
