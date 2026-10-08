import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import type { DiscoverySnapshot, DiscoveryUniverse, Envelope } from '@shared/contract'
import { pickDiscoverySymbol } from '@shared/discovery'
import { api } from '@/api/client'

const HISTORY_LIMIT = 12

export interface DiscoveryEntry {
  snapshot: DiscoverySnapshot
  seenAt: number
}

export function useDiscoveryScan(active: boolean, intervalSeconds: number) {
  const queryClient = useQueryClient()
  const startupUniverse = queryClient.getQueryData<Envelope<DiscoveryUniverse>>(['discoveryUniverse'])?.data.symbols ?? []
  const startupEnvelope = queryClient.getQueryData<Envelope<DiscoverySnapshot | null>>(['discoveryStartup'])
  const startupSnapshot = startupEnvelope?.data ?? null
  const startupHistory: DiscoveryEntry[] = startupSnapshot ? [{ snapshot: startupSnapshot, seenAt: Date.now() }] : []
  const [universeCount, setUniverseCount] = useState(startupUniverse.length)
  const [snapshot, setSnapshot] = useState<DiscoverySnapshot | null>(startupSnapshot)
  const [envelope, setEnvelope] = useState(startupEnvelope)
  const [history, setHistory] = useState<DiscoveryEntry[]>(startupHistory)
  const [paused, setPaused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [remaining, setRemaining] = useState(intervalSeconds * 1000)
  const [error, setError] = useState('')
  const symbolsRef = useRef<string[]>(startupUniverse)
  const historyRef = useRef<DiscoveryEntry[]>(startupHistory)
  const failedRef = useRef<string[]>([])
  const failuresRef = useRef(0)
  const snapshotRef = useRef<DiscoverySnapshot | null>(startupSnapshot)
  const activeRef = useRef(false)
  const pausedRef = useRef(false)
  const loadingRef = useRef(false)
  const deadlineRef = useRef(0)
  const remainingRef = useRef(intervalSeconds * 1000)
  const intervalMsRef = useRef(intervalSeconds * 1000)
  const requestRef = useRef(0)
  const pendingRef = useRef<string | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetCountdown = useCallback(() => {
    const intervalMs = intervalMsRef.current
    remainingRef.current = intervalMs
    setRemaining(intervalMs)
    deadlineRef.current = pausedRef.current ? 0 : Date.now() + intervalMs
  }, [])

  useEffect(() => {
    intervalMsRef.current = intervalSeconds * 1000
    if (snapshotRef.current && !loadingRef.current) resetCountdown()
    else {
      remainingRef.current = intervalMsRef.current
      setRemaining(intervalMsRef.current)
    }
  }, [intervalSeconds, resetCountdown])

  const load = useCallback(async (requested?: string) => {
    const symbol = requested ?? pickDiscoverySymbol(symbolsRef.current, [
      ...historyRef.current.map((entry) => entry.snapshot.symbol), ...failedRef.current,
    ])
    if (!symbol || !activeRef.current) return
    if (loadingRef.current) {
      pendingRef.current = symbol
      return
    }
    if (retryRef.current) clearTimeout(retryRef.current)
    retryRef.current = null
    loadingRef.current = true
    setLoading(true)
    setError('')
    deadlineRef.current = 0
    const request = ++requestRef.current
    try {
      const response = await api.discovery({ symbol })
      if (request !== requestRef.current || !activeRef.current) return
      if (!response.data || response.meta.freshness === 'failed') {
        throw new Error(response.meta.failureReason || `No market data for ${symbol}.`)
      }
      snapshotRef.current = response.data
      setEnvelope(response)
      failuresRef.current = 0
      failedRef.current = failedRef.current.filter((entry) => entry !== symbol)
      setSnapshot(response.data)
      const next = [{ snapshot: response.data, seenAt: Date.now() }, ...historyRef.current].slice(0, HISTORY_LIMIT)
      historyRef.current = next
      setHistory(next)
      resetCountdown()
      if (response.data.stale) setError('Some fields are unavailable or cached; see the quote status.')
    } catch (cause) {
      if (request !== requestRef.current || !activeRef.current) return
      failedRef.current = [symbol, ...failedRef.current.filter((entry) => entry !== symbol)].slice(0, 20)
      failuresRef.current += 1
      setError(`${symbol} could not load: ${cause instanceof Error ? cause.message : String(cause)}`)
      // A bad or delisted directory entry must not stop the terminal.
      const retryDelay = Math.min(30_000, 1_500 * 2 ** Math.min(failuresRef.current - 1, 5))
      retryRef.current = setTimeout(() => {
        if (activeRef.current) void load()
      }, retryDelay)
    } finally {
      loadingRef.current = false
      setLoading(false)
      const pending = pendingRef.current
      pendingRef.current = null
      if (pending && activeRef.current) void load(pending)
    }
  }, [resetCountdown])

  useEffect(() => {
    activeRef.current = active
    if (!active) return
    let cancelled = false
    if (snapshotRef.current) resetCountdown()
    else if (symbolsRef.current.length) void load()
    else {
      void api.discoveryUniverse().then((response) => {
        if (cancelled || !activeRef.current) return
        if (!response.data.symbols.length) {
          setError(response.meta.failureReason || 'The U.S. stock directory is unavailable. Search a ticker to continue.')
          return
        }
        symbolsRef.current = response.data.symbols
        setUniverseCount(response.data.symbols.length)
        if (response.data.stale) setError('Using the cached U.S. stock directory.')
        void load()
      }).catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    }
    const clock = setInterval(() => {
      if (!activeRef.current || pausedRef.current || loadingRef.current || !deadlineRef.current) return
      const left = Math.max(0, deadlineRef.current - Date.now())
      remainingRef.current = left
      setRemaining(left)
      if (left === 0) {
        deadlineRef.current = 0
        void load()
      }
    }, 100)
    return () => {
      cancelled = true
      activeRef.current = false
      requestRef.current += 1
      pendingRef.current = null
      if (retryRef.current) clearTimeout(retryRef.current)
      clearInterval(clock)
    }
  }, [active, load, resetCountdown])

  const togglePause = useCallback(() => {
    pausedRef.current = !pausedRef.current
    setPaused(pausedRef.current)
    if (pausedRef.current) {
      remainingRef.current = deadlineRef.current ? Math.max(0, deadlineRef.current - Date.now()) : intervalMsRef.current
      deadlineRef.current = 0
      setRemaining(remainingRef.current)
      if (retryRef.current) clearTimeout(retryRef.current)
    } else {
      setError((message) => message.startsWith('Inspecting a previous discovery.') ? '' : message)
      deadlineRef.current = snapshotRef.current ? Date.now() + remainingRef.current : 0
      if (!snapshotRef.current && !loadingRef.current) void load()
    }
  }, [load])

  const inspect = useCallback((entry: DiscoveryEntry) => {
    if (loadingRef.current) return
    snapshotRef.current = entry.snapshot
    setSnapshot(entry.snapshot)
    pausedRef.current = true
    setPaused(true)
    deadlineRef.current = 0
    remainingRef.current = intervalMsRef.current
    setRemaining(intervalMsRef.current)
    setError('Inspecting a previous discovery. Resume to continue scanning.')
  }, [])

  const previous = useCallback(() => {
    const currentIndex = historyRef.current.findIndex((entry) => entry.snapshot === snapshotRef.current)
    const entry = historyRef.current[currentIndex + 1]
    if (entry) inspect(entry)
  }, [inspect])

  return {
    universeCount, snapshot, envelope, history, paused, loading, remaining, error,
    failure: failuresRef.current > 0 ? error : undefined,
    togglePause, resetCountdown, next: () => void load(), previous, inspect,
    search: (ticker: string) => void load(ticker.trim().toUpperCase()),
  }
}
