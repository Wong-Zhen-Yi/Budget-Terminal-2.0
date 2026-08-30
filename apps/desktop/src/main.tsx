import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { App } from './App'
import './styles/theme.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Yahoo is the only upstream and it is rate limited; retrying a failure straight
      // away just spends the budget. One retry, then show the panel's error state.
      retry: 1,
      retryDelay: 2000,
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
