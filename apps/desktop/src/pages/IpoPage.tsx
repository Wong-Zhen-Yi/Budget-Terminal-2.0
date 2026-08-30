import { useCallback, useEffect, useMemo, useState } from 'react'

import type { IpoCompletedPayload, IpoUpcomingPayload } from '@shared/contract'
import {
  cacheStatusText,
  completedIpoClipboard,
  completedIpoStatus,
  todayIso,
  upcomingIpoClipboard,
  upcomingIpoStatus,
  type IpoStatus,
  type IpoStatusTone,
} from '@shared/ipo'
import { api } from '@/api/client'
import { useCompletedIpos, useRefreshIpos, useUpcomingIpos } from '@/api/ipoQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { CompletedIpoTable } from '@/components/ipo/CompletedIpoTable'
import { UpcomingIpoTable } from '@/components/ipo/UpcomingIpoTable'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { useIpoPage } from '@/stores/ipo'

/**
 * The IPO page, ported from `IpoPageMixin.init_page21`.
 *
 * The reference's layout exactly: a toolbar carrying the title, the estimate disclaimer,
 * one status line and one Refresh button, over a splitter with Completed IPOs on the left
 * at stretch 2 and Upcoming IPOs on the right at stretch 3. No charts, no filters, no
 * sub-tabs and no timer — `init_page21` restores both caches and fires nothing, so the
 * only loads are Refresh and F5.
 *
 * Two documented departures from `mixins/ipo_page.py`. There is no render deferral: the
 * reference stashes a payload arriving while the page is hidden and replays it in
 * `_p21_on_show`, because its table paints fifty rows at a time through `run_batched`;
 * React unmounts the page and React Query holds the payload, so there is nothing to defer.
 * And the yfinance fallback behind both feeds is not ported — see `services/ipo.ts`.
 */

const TONE_CLASS: Record<IpoStatusTone, string> = {
  muted: 'text-text-muted',
  positive: 'text-up',
  warning: 'text-warn',
  negative: 'text-down',
}

/** `_p21_cache_status_text`, plus the two states the reference sets the label to by hand. */
function cacheLabel(
  payload: IpoUpcomingPayload | IpoCompletedPayload | undefined,
  failureReason: string,
): IpoStatus {
  if (failureReason) return { text: 'Refresh failed; stale cache shown', tone: 'warning' }
  if (!payload || (!payload.fetchedAt && !payload.rows.length)) {
    return { text: 'No cache loaded', tone: 'warning' }
  }
  return {
    text: cacheStatusText(payload.cacheAgeSeconds, payload.fetchedAt),
    tone: payload.stale ? 'warning' : 'muted',
  }
}

export function IpoPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const completedYear = useIpoPage((state) => state.completedYear)
  const setCompletedYear = useIpoPage((state) => state.setCompletedYear)

  // `_p21_completed_year` is set from `date.today().year` when the page is built, so a
  // year persisted before a rollover is corrected the first time the page mounts again.
  useEffect(() => {
    const year = new Date().getFullYear()
    if (completedYear !== year) setCompletedYear(year)
  }, [completedYear, setCompletedYear])

  const upcomingQuery = useUpcomingIpos()
  const completedQuery = useCompletedIpos(completedYear)
  const refresh = useRefreshIpos()
  const [refreshing, setRefreshing] = useState(false)

  const upcoming = upcomingQuery.data?.data
  const completed = completedQuery.data?.data
  const upcomingBusy = upcomingQuery.isFetching || refreshing
  const completedBusy = completedQuery.isFetching || refreshing

  useEffect(() => {
    onStatusChange(
      [
        { label: 'Upcoming IPOs', envelope: upcomingQuery.data, loading: upcomingBusy },
        { label: 'Completed IPOs', envelope: completedQuery.data, loading: completedBusy },
      ],
      // The two JSON caches are the main process's own; no user file sits behind the page.
      '',
    )
  }, [onStatusChange, upcomingQuery.data, upcomingBusy, completedQuery.data, completedBusy])

  const upcomingMeta = upcomingQuery.data?.meta
  const upcomingFailure =
    upcomingMeta?.freshness === 'failed' ? (upcomingMeta.failureReason ?? 'unknown error') : ''
  const completedMeta = completedQuery.data?.meta
  const completedFailure =
    completedMeta?.freshness === 'failed' ? (completedMeta.failureReason ?? 'unknown error') : ''

  /** `_p21_apply_ipo_payload`'s status line, and the states around it. */
  const status = useMemo<IpoStatus>(() => {
    if (upcomingBusy && !upcoming) return { text: 'Loading cached IPO data...', tone: 'muted' }
    if (refreshing) return { text: 'Refreshing IPO data...', tone: 'muted' }
    if (upcomingFailure) return { text: `IPO refresh failed: ${upcomingFailure}`, tone: 'negative' }
    if (!upcoming) {
      return {
        text: 'No cached IPO calendar yet. Use Refresh to fetch upcoming IPOs.',
        tone: 'warning',
      }
    }
    if (upcoming.stale) {
      return {
        text: `Refresh failed; showing stale cache. ${upcoming.warning}`.trim(),
        tone: 'warning',
      }
    }
    return upcomingIpoStatus(
      {
        rowCount: upcoming.rows.length,
        source: upcoming.source,
        fetchedAt: upcoming.fetchedAt,
        fromCache: upcoming.fromCache,
        stale: upcoming.stale,
      },
      todayIso(),
    )
  }, [upcomingBusy, refreshing, upcoming, upcomingFailure])

  /** The completed panel carries its own line, as the reference's second label does. */
  const completedStatus = useMemo<IpoStatus>(() => {
    if (completedBusy && !completed) return { text: 'Refreshing completed IPOs...', tone: 'muted' }
    if (completedFailure) return { text: 'Completed IPO refresh failed', tone: 'negative' }
    if (!completed) return { text: 'No cache loaded', tone: 'warning' }
    return completedIpoStatus(
      {
        rowCount: completed.rows.length,
        source: completed.source,
        fetchedAt: completed.fetchedAt,
        fromCache: completed.fromCache,
        stale: completed.stale,
      },
      completed.year,
    )
  }, [completedBusy, completed, completedFailure])

  const upcomingCache = cacheLabel(upcoming, upcomingFailure)
  const completedCache = cacheLabel(completed, completedFailure)

  /** `_p21_refresh_ipo_calendar(force=True)` — one button, both feeds. */
  const onRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await refresh(completedYear)
    } finally {
      setRefreshing(false)
    }
  }, [refresh, refreshing, completedYear])

  const busy = upcomingBusy || completedBusy

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-center gap-3 border border-border bg-surface px-3 py-2">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-text">IPO</h1>
          <p className="truncate text-2xs text-text-dim">
            Completed IPOs and upcoming US IPOs through year-end. Dates are estimates and may
            change.
          </p>
        </div>
        <span
          title={upcoming?.warning || status.text}
          className={`ml-auto truncate text-right text-2xs ${TONE_CLASS[status.tone]}`}
        >
          {status.text}
        </span>
        <Button
          variant="accent"
          onClick={() => void onRefresh()}
          disabled={busy}
          title="Re-scrape both StockAnalysis pages."
        >
          {busy ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {/* `setStretchFactor(0, 2)` / `setStretchFactor(1, 3)`: completed narrower. */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
        <Panel
          title="Completed IPOs"
          warning={completedFailure || completed?.warning || undefined}
          actions={
            <>
              <span className={`text-2xs ${TONE_CLASS[completedCache.tone]}`}>
                {completedCache.text}
              </span>
              {completed?.sourceUrl ? (
                <button
                  type="button"
                  title={completed.sourceUrl}
                  onClick={() => void api.openExternal(completed.sourceUrl)}
                  className="no-drag text-2xs text-accent underline"
                >
                  Source
                </button>
              ) : null}
              <Button
                onClick={() => void api.writeClipboard(completedIpoClipboard(completed?.rows ?? []))}
                disabled={!completed?.rows.length}
                title="Copy the completed IPO table."
              >
                Copy
              </Button>
            </>
          }
        >
          <div className="min-h-0 flex-1 overflow-auto">
            <CompletedIpoTable rows={completed?.rows ?? []} />
          </div>
          <div
            className={`shrink-0 border-t border-border px-2 py-1 text-2xs ${TONE_CLASS[completedStatus.tone]}`}
          >
            {completedStatus.text}
          </div>
        </Panel>

        <Panel
          title="Upcoming IPOs"
          warning={upcomingFailure || upcoming?.warning || undefined}
          actions={
            <>
              <span className={`text-2xs ${TONE_CLASS[upcomingCache.tone]}`}>
                {upcomingCache.text}
              </span>
              {upcoming?.sourceUrl ? (
                <button
                  type="button"
                  title={upcoming.sourceUrl}
                  onClick={() => void api.openExternal(upcoming.sourceUrl)}
                  className="no-drag text-2xs text-accent underline"
                >
                  Source
                </button>
              ) : null}
              <Button
                onClick={() => void api.writeClipboard(upcomingIpoClipboard(upcoming?.rows ?? []))}
                disabled={!upcoming?.rows.length}
                title="Copy the upcoming IPO table."
              >
                Copy
              </Button>
            </>
          }
        >
          <div className="min-h-0 flex-1 overflow-auto">
            <UpcomingIpoTable rows={upcoming?.rows ?? []} />
          </div>
        </Panel>
      </div>
    </div>
  )
}
