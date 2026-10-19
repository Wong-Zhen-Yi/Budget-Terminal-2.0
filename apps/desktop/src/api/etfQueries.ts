import { useCallback } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type { Envelope, EtfArbitragePayload, EtfAumPayload, EtfHoldingsPayload } from '@shared/contract'
import { api, queryKeys } from './client'
import { queryFreshness } from './queryPersistence'
import { forcing } from './queries'

/** A failed refresh must not replace a useful last-good renderer snapshot. */
function usable<T>(result: Envelope<T>): Envelope<T> {
  if (result.meta.freshness === 'failed') throw new Error(result.meta.failureReason || 'ETF data is unavailable. Try again later.')
  return result
}

const policy = { refetchInterval: false, refetchOnWindowFocus: false, retry: false } as const

export function useEtfHoldings(ticker: string): UseQueryResult<Envelope<EtfHoldingsPayload>> {
  const symbol = ticker.trim().toUpperCase()
  return useQuery({
    ...policy,
    queryKey: queryKeys.etfHoldings(symbol),
    queryFn: async () => usable(await api.etfHoldings({ ticker: symbol, force: forcing() })),
    enabled: Boolean(symbol),
    staleTime: queryFreshness(queryKeys.etfHoldings(symbol)),
  })
}

/** Basket analysis is an explicit action, never an automatic quote fan-out on tab selection. */
export function useEtfArbitrage(ticker: string): UseQueryResult<Envelope<EtfArbitragePayload>> {
  const symbol = ticker.trim().toUpperCase()
  return useQuery({
    ...policy,
    queryKey: queryKeys.etfArbitrage(symbol),
    queryFn: async () => usable(await api.etfArbitrage({ ticker: symbol })),
    enabled: false,
    staleTime: queryFreshness(queryKeys.etfArbitrage(symbol)),
  })
}

export function useEtfAum(): UseQueryResult<Envelope<EtfAumPayload>> {
  return useQuery({
    ...policy,
    queryKey: queryKeys.etfAum,
    queryFn: async () => usable(await api.etfAum({ force: forcing() })),
    staleTime: queryFreshness(queryKeys.etfAum),
  })
}

export function useRefreshEtfHoldings(): (ticker: string) => Promise<void> {
  const client = useQueryClient()
  return useCallback(async (ticker: string) => {
    const symbol = ticker.trim().toUpperCase()
    if (!symbol) return
    await client.fetchQuery({
      queryKey: queryKeys.etfHoldings(symbol),
      queryFn: async () => usable(await api.etfHoldings({ ticker: symbol, force: true })),
      staleTime: 0, retry: false,
    })
    // Do not remove the basket snapshot: it has its own timestamp and refresh action.
  }, [client])
}

export function useRefreshEtfArbitrage(): (ticker: string) => Promise<void> {
  const client = useQueryClient()
  return useCallback(async (ticker: string) => {
    const symbol = ticker.trim().toUpperCase()
    if (!symbol) return
    await client.fetchQuery({
      queryKey: queryKeys.etfArbitrage(symbol),
      queryFn: async () => usable(await api.etfArbitrage({ ticker: symbol, force: true })),
      staleTime: 0, retry: false,
    })
  }, [client])
}

export function useRefreshEtfAum(): () => Promise<void> {
  const client = useQueryClient()
  return useCallback(async () => {
    await client.fetchQuery({
      queryKey: queryKeys.etfAum,
      queryFn: async () => usable(await api.etfAum({ force: true })),
      staleTime: 0, retry: false,
    })
  }, [client])
}
