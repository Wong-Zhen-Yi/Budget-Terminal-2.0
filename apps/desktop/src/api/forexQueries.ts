import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ForexPair, ForexRange } from '@shared/forex'
import { FOREX_MARKET_MS, FOREX_NEWS_MS } from '@shared/forex'
import { api, queryKeys } from './client'
import { forcing } from './queries'

export function useForex(pair: ForexPair, range: ForexRange) {
  const [visible, setVisible] = useState(() => !document.hidden)
  useEffect(() => {
    const update = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  const common = { enabled: visible, refetchIntervalInBackground: false, retry: false } as const
  const quotes = useQuery({ ...common, queryKey: queryKeys.forexQuotes, queryFn: () => api.forexQuotes({ force: forcing() }), staleTime: FOREX_MARKET_MS, refetchInterval: visible ? FOREX_MARKET_MS : false })
  const history = useQuery({ ...common, queryKey: queryKeys.forexHistory(pair, range), queryFn: () => api.forexHistory({ pair, range, force: forcing() }), staleTime: FOREX_MARKET_MS, refetchInterval: visible ? FOREX_MARKET_MS : false })
  const news = useQuery({ ...common, queryKey: queryKeys.forexNews(pair), queryFn: () => api.forexNews({ pair, force: forcing() }), staleTime: FOREX_NEWS_MS, refetchInterval: visible ? FOREX_NEWS_MS : false })
  const client = useQueryClient()
  const refresh = async () => {
    // Fetch through QueryClient so an older in-flight request cannot overwrite Refresh.
    const keys = [queryKeys.forexQuotes, queryKeys.forexHistory(pair, range), queryKeys.forexNews(pair)]
    await Promise.all(keys.map((queryKey) => client.cancelQueries({ queryKey, exact: true })))
    await Promise.all([
      client.fetchQuery({ queryKey: keys[0], queryFn: () => api.forexQuotes({ force: true }), staleTime: 0 }),
      client.fetchQuery({ queryKey: keys[1], queryFn: () => api.forexHistory({ pair, range, force: true }), staleTime: 0 }),
      client.fetchQuery({ queryKey: keys[2], queryFn: () => api.forexNews({ pair, force: true }), staleTime: 0 }),
    ])
  }
  return { quotes, history, news, refresh }
}
