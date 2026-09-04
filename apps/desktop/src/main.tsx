import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { App } from './App'
import './styles/theme.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Services handle stale fallback and provider cooldowns. Retrying IPC failures
      // here makes each mounted panel repeat the same failed provider work.
      retry: false,
      refetchOnWindowFocus: false,
      // Every page unmounts on a tab switch — `App.tsx` renders one at a time — so its
      // queries lose their observer immediately and the 5-minute default evicts them.
      // That silently undoes the `staleTime: Infinity` nearly every hook sets, and the
      // startup warm-up with it. An hour, not `Infinity`: the heavy payloads (Trading
      // Volumes, the 500-holding Heatmap, 49 Economic series) should still be reclaimed
      // in a long session.
      gcTime: 60 * 60_000,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
