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
      // Hidden Activity trees suspend their query observers. Keep their data, together
      // with startup-warmed pages, available until the renderer session ends.
      gcTime: Infinity,
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
