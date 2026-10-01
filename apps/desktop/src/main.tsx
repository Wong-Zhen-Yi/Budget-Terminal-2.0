import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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
} from './api/queryPersistence'
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

const stopMcpChanges = api.onSavedDataChanged((event) => {
  void refreshSavedData(queryClient, event)
})
if (import.meta.hot) import.meta.hot.dispose(stopMcpChanges)

createRoot(document.getElementById('root')!).render(
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
  </StrictMode>,
)
