import { useCallback, useEffect, useMemo, useState } from 'react'

import { CLOCK_COUNTRIES, GLOBAL_INTERVALS } from '@shared/contract'
import { formatMarketTiming } from '@shared/globalMarkets'
import { api } from '@/api/client'
import { useGlobalMarkets, useRefreshGlobalMarkets } from '@/api/globalQueries'
import { useSettings } from '@/api/settingsQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { GlobalTable } from '@/components/global/GlobalTable'
import { buildGlobalLlmExport } from '@/components/global/llmExport'
import { WorldMap, type MappedRow } from '@/components/global/WorldMap'
import { Button } from '@/components/ui/Button'
import { useGlobalPage } from '@/stores/global'

/**
 * The Global page: seventeen world indexes pinned to a map, over the same numbers in a
 * table. Ported from `GlobalPageMixin`, with two changes — the map has a fullscreen
 * toggle and opens in it, and there is no 2x clipboard export.
 */

/** `_p26_refresh_market_status_display` re-reads once a minute; halve it so a market
 *  opening or closing shows up promptly. */
const STATUS_TICK_MS = 30_000

type Tone = 'muted' | 'positive' | 'warning' | 'negative'

const toneClass: Record<Tone, string> = {
  muted: 'text-text-muted',
  positive: 'text-up',
  warning: 'text-warn',
  negative: 'text-down',
}

export function GlobalPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const query = useGlobalMarkets()
  const refresh = useRefreshGlobalMarkets()
  const settingsQuery = useSettings()
  const interval = useGlobalPage((state) => state.interval)
  const mapFullscreen = useGlobalPage((state) => state.mapFullscreen)
  const setInterval = useGlobalPage((state) => state.setInterval)
  const toggleMapFullscreen = useGlobalPage((state) => state.toggleMapFullscreen)

  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: Tone } | null>(null)
  const [now, setNow] = useState(() => Date.now() / 1000)

  // The session line is clock-dependent, so it has to re-derive on its own.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() / 1000), STATUS_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  const settings = settingsQuery.data?.data
  const zone = useMemo(
    () =>
      CLOCK_COUNTRIES.find((entry) => entry.code === settings?.clockCountry)?.zone ??
      CLOCK_COUNTRIES[0].zone,
    [settings],
  )
  const time12h = settings?.time12h ?? true

  const payload = query.data?.data
  const rows = useMemo<MappedRow[]>(
    () =>
      (payload?.rows ?? []).map((row) => ({
        ...row,
        status: formatMarketTiming(row.marketTiming, zone, { now, use12h: time12h }),
      })),
    [payload, zone, now, time12h],
  )

  useEffect(() => {
    // No file behind this page, so the status bar's path slot stays empty.
    onStatusChange([{ label: 'Global', envelope: query.data, loading: query.isFetching }], '')
  }, [onStatusChange, query.data, query.isFetching])

  /** The header's own line, which is what `_p26_set_status` writes. */
  const status = useMemo<{ text: string; tone: Tone }>(() => {
    if (notice) return notice
    if (query.isFetching) return { text: 'Loading global market indexes...', tone: 'muted' }
    const meta = query.data?.meta
    if (meta?.freshness === 'failed') {
      return { text: `Global indexes failed: ${meta.failureReason ?? 'unknown error'}`, tone: 'negative' }
    }
    if (!payload) return { text: 'Ready', tone: 'muted' }
    if (payload.missing.length) {
      return {
        text: `Loaded ${payload.rows.length} global index row(s); ${payload.missing.length} symbol(s) unavailable.`,
        tone: 'warning',
      }
    }
    return { text: `Loaded ${payload.rows.length} global index row(s).`, tone: 'positive' }
  }, [notice, query.data, query.isFetching, payload])

  const onRefresh = useCallback(async () => {
    setNotice(null)
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }, [refresh])

  const onExport = useCallback(async () => {
    if (!payload || !rows.length) {
      setNotice({ text: 'Load global index data before exporting.', tone: 'warning' })
      return
    }
    const path = await api.saveText('global_markets.md', buildGlobalLlmExport(payload, rows))
    setNotice(path ? { text: `Global export written to ${path}`, tone: 'positive' } : null)
  }, [payload, rows])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <h1 className="pr-2 text-sm font-semibold text-text">Global</h1>
        <span className="px-1 text-2xs text-text-muted">Interval</span>
        {GLOBAL_INTERVALS.map((label) => (
          <Button
            key={label}
            variant="toggle"
            active={label === interval}
            onClick={() => setInterval(label)}
          >
            {label}
          </Button>
        ))}
        <Button
          className="ml-2"
          onClick={() => void onRefresh()}
          disabled={refreshing || query.isFetching}
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
        <Button variant="positive" onClick={() => void onExport()}>
          Export for LLM
        </Button>
        <Button
          variant="toggle"
          active={mapFullscreen}
          onClick={toggleMapFullscreen}
          title="Give the map the whole page, or bring the index table back below it."
        >
          {mapFullscreen ? 'Exit Fullscreen' : 'Fullscreen Map'}
        </Button>
        <span className={`ml-auto pl-2 text-2xs ${toneClass[status.tone]}`}>{status.text}</span>
      </div>

      {/* 2:1 against the table, as the reference stretches them. */}
      <div
        className={`flex min-h-0 flex-col overflow-hidden border border-border bg-surface ${
          mapFullscreen ? 'flex-1' : 'flex-[2]'
        }`}
      >
        <WorldMap rows={rows} interval={interval} />
      </div>

      {mapFullscreen ? null : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-border bg-surface">
          <GlobalTable rows={rows} interval={interval} loading={query.isLoading} />
        </div>
      )}
    </div>
  )
}
