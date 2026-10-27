import { StrictMode } from 'react'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'

import { App } from './App'
import { api } from './api/client'
import { refreshSavedData } from './api/mcpChanges'
import { RENDERER_CACHE_MAX_AGE_MS } from '@shared/freshness'
import {
  RENDERER_CACHE_BUSTER,
  rendererQueryPersister,
  shouldPersistRemoteQuery,
  queryFreshness,
} from './api/queryPersistence'
import { manageQueryMemory, QUERY_IDLE_MS } from './api/queryMemory'
import { registerSnapshot } from './api/snapshotHealth'
import './styles/theme.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Services handle stale fallback and provider cooldowns. Retrying IPC failures
      // here makes each mounted panel repeat the same failed provider work.
      retry: false,
      refetchOnWindowFocus: false,
      // Startup refreshes stale page entries. A later first visit should paint that
      // prepared snapshot without immediately starting another request.
      refetchOnMount: false,
      // Startup helpers explicitly pin prepared page snapshots for this session.
      gcTime: QUERY_IDLE_MS,
    },
  },
})

const memory = manageQueryMemory(queryClient, { deferUntilStartup: true })
if (import.meta.hot) import.meta.hot.dispose(memory.stop)

queryClient.getQueryCache().subscribe(({ query }) => {
  registerSnapshot(query.state.data, queryFreshness(query.queryKey))
})

const stopCacheFlush = api.onCacheFlush(() => rendererQueryPersister.flush())
if (import.meta.hot) import.meta.hot.dispose(stopCacheFlush)

const stopMcpChanges = api.onSavedDataChanged((event) => {
  void refreshSavedData(queryClient, event)
})
if (import.meta.hot) import.meta.hot.dispose(stopMcpChanges)

export default function TerminalRoot() {
  return (
    <StrictMode>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: rendererQueryPersister,
          maxAge: RENDERER_CACHE_MAX_AGE_MS,
          buster: RENDERER_CACHE_BUSTER,
          dehydrateOptions: { shouldDehydrateQuery: shouldPersistRemoteQuery },
        }}
      >
        <App />
      </PersistQueryClientProvider>
    </StrictMode>
  )
}
