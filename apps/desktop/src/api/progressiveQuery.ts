import { useCallback, useContext, useEffect, useSyncExternalStore } from 'react'
import { hashKey, useQuery as useBaseQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import { pagePreview, subscribePagePreview, trackPageQuery } from './pageProgress'
import { PageQueryScope, registerPageQuery } from './pageQueryScope'
import { retainUsableSnapshot } from './snapshotResult'

/** Paint transient data without writing success into the query or persisted cache. */
export const useQuery: typeof useBaseQuery = ((options: UseQueryOptions, client?: Parameters<typeof useBaseQuery>[1]) => {
  const key = hashKey(options.queryKey)
  const page = useContext(PageQueryScope)
  useEffect(() => page ? registerPageQuery(page, key, options.queryKey) : undefined, [page, key])
  const queryClient = useQueryClient(client)
  const subscribe = useCallback((listener: () => void) => subscribePagePreview(key, listener), [key])
  const preview = useSyncExternalStore(subscribe, () => pagePreview(key), () => undefined)
  const queryFn = options.queryFn
  const result = useBaseQuery({ ...options,
    ...(typeof queryFn === 'function' ? { queryFn: async context => retainUsableSnapshot(
      queryClient.getQueryData(options.queryKey), await trackPageQuery(options.queryKey, () => queryFn(context)),
    ) } : {}),
  }, client)
  if (!result.isFetching || !preview) return result
  // Retain a completed snapshot during refresh; cold loads fill in as blocks arrive.
  return result.data ? result : { ...result, data: preview, isLoading: false }
}) as typeof useBaseQuery
