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
import { registerSnapshot } from './api/snapshotHealth'
import { connectBrowserEvents, isBrowser } from './api/browser'
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
      // Hidden Activity trees suspend their query observers. Keep their data, together
      // with startup-warmed pages, available until the renderer session ends.
      gcTime: Infinity,
    },
  },
})

queryClient.getQueryCache().subscribe(({ query }) => {
  registerSnapshot(query.state.data, queryFreshness(query.queryKey))
})

const stopMcpChanges = api.onSavedDataChanged((event) => {
  void refreshSavedData(queryClient, event)
})
if (import.meta.hot) import.meta.hot.dispose(stopMcpChanges)

if (isBrowser) {
  // Resume stale prepared pages too: hidden pages stay ready after reconnection.
  const resume = () => {
    void queryClient.invalidateQueries({
      predicate: (query) => query.isStaleByTime(queryFreshness(query.queryKey)),
      refetchType: 'all',
    })
  }
  window.addEventListener('budget-browser-resume', resume)
  const stopEvents = connectBrowserEvents()
  if (import.meta.hot) import.meta.hot.dispose(() => {
    stopEvents()
    window.removeEventListener('budget-browser-resume', resume)
  })
}

// Private browser snapshots stay in memory; logout removes the rendered session.
const browserPersister = {
  persistClient: async () => {},
  restoreClient: async () => undefined,
  removeClient: async () => {},
}

export default function TerminalRoot() {
  return (
    <StrictMode>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: isBrowser ? browserPersister : rendererQueryPersister,
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
