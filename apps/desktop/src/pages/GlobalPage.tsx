import { useCallback, useEffect, useMemo, useState } from 'react'

import { CLOCK_COUNTRIES, GLOBAL_INTERVALS } from '@shared/contract'
import { formatMarketTiming } from '@shared/globalMarkets'
import { api } from '@/api/client'
import { useGlobalMarkets } from '@/api/globalQueries'
import { useSettings } from '@/api/settingsQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { GlobalTable } from '@/components/global/GlobalTable'
import { buildGlobalLlmExport } from '@/components/global/llmExport'
import { MobileGlobalMarkets } from '@/components/global/MobileGlobalMarkets'
import { WorldMap, type MappedRow } from '@/components/global/WorldMap'
import { Button } from '@/components/ui/Button'
import { isMobileTerminal } from '@/mobile/client'
import { useGlobalPage } from '@/stores/global'

/** `_p26_refresh_market_status_display` re-reads once a minute; halve it so a market
 *  opening or closing shows up promptly. */
const STATUS_TICK_MS = 30_000

export function GlobalPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const query = useGlobalMarkets()
  const settingsQuery = useSettings()
  const interval = useGlobalPage((state) => state.interval)
  const mapFullscreen = useGlobalPage((state) => state.mapFullscreen)
  const setInterval = useGlobalPage((state) => state.setInterval)
  const toggleMapFullscreen = useGlobalPage((state) => state.toggleMapFullscreen)

  const [exportResult, setExportResult] = useState<{ state: 'idle' | 'saving' | 'saved' | 'failed'; message?: string }>({ state: 'idle' })
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
    onStatusChange([{ label: 'Global', envelope: query.data, error: query.error, enabled: query.isEnabled, loading: query.isFetching }], '')
  }, [onStatusChange, query.data, query.error, query.isEnabled, query.isFetching])

  const onExport = useCallback(async () => {
    if (!payload || !rows.length) return
    setExportResult({ state: 'saving' })
    try {
      const path = await api.saveText('global_markets.md', buildGlobalLlmExport(payload, rows))
      setExportResult(path ? { state: 'saved', message: `Global export written to ${path}` } : { state: 'idle' })
    } catch {
      setExportResult({ state: 'failed', message: 'Could not export global market data.' })
    }
  }, [payload, rows])

  if (isMobileTerminal()) {
    return <MobileGlobalMarkets rows={rows} interval={interval} setInterval={setInterval} loading={query.isLoading}
      onExport={() => void onExport()} exportState={exportResult.state} />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <h1 className="pr-2 text-sm font-semibold text-text">Global</h1>
        <div className="contents" role="group" aria-label="Global market controls">
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

          <Button variant="positive" disabled={!rows.length || exportResult.state === 'saving'} onClick={() => void onExport()}>
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
        </div>
        <span role="status" className={`ml-auto min-w-0 flex-1 truncate pl-2 text-right text-2xs ${exportResult.state === 'failed' ? 'text-down' : 'text-up'}`}
          title={exportResult.message}>{exportResult.message}</span>
      </div>

      {/* 2:1 against the table, as the reference stretches them. */}
      <div
        className={`relative flex min-h-0 flex-col overflow-hidden border border-border bg-surface ${
          mapFullscreen ? 'flex-1' : 'flex-[2]'
        }`}
      >
        <WorldMap rows={rows} interval={interval} />
        {mapFullscreen && !rows.length && <p className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-2xs text-text-muted">
          {query.isLoading ? 'Loading global market indexes…' : 'No global index data'}
        </p>}
      </div>

      {mapFullscreen ? null : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-border bg-surface">
          <GlobalTable rows={rows} interval={interval} loading={query.isLoading} />
        </div>
      )}
    </div>
  )
}
