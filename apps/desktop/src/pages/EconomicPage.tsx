import { useEffect, useMemo } from 'react'

import type { EconomicGroup, EconomicRow } from '@shared/contract'
import {
  describeFreshness,
  dropUnavailable,
  filterRows,
  missingSummary,
  rowsForGroup,
  searchRows,
} from '@shared/economic'
import { useEconomic, useRefreshEconomic } from '@/api/economicQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { EconomicGroupTable, EconomicOverviewTable } from '@/components/economic/EconomicTable'
import { HeadlineStrip } from '@/components/economic/HeadlineStrip'
import { SeriesChart } from '@/components/economic/SeriesChart'
import { YieldCurvePanel } from '@/components/economic/YieldCurvePanel'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { SearchInput } from '@/components/ui/SearchInput'
import { Select } from '@/components/ui/Select'
import {
  ECONOMIC_GROUP_FILTERS,
  ECONOMIC_LOOKBACKS,
  ECONOMIC_TAB_GROUPS,
  ECONOMIC_TABS,
  lookbackYears,
  useEconomicPage,
  type EconomicGroupFilter,
  type EconomicLookback,
  type EconomicTab,
} from '@/stores/economic'

/**
 * US macroeconomic indicators, ported from `mixins/economic_page.py` (page42).
 *
 * The page owns its own catalog and needs no ticker input, so every sub-tab populates from
 * one load. Decision support only.
 *
 * One documented departure from the reference: there is no progress bar. `_p42_launch_fetch`
 * drives a `QProgressBar` from the worker's per-provider `progress` signal, and an IPC
 * request/response carries no intermediate frames — the same wall the Crypto page hit. The
 * busy status line reports the load instead, and the disk cache means most visits never see
 * it.
 */

const TAB_LABELS: Record<EconomicTab, string> = {
  overview: 'Overview',
  inflation: 'Inflation',
  labor: 'Labor',
  growth: 'Growth',
  rates: 'Rates',
}

const LOOKBACK_OPTIONS = ECONOMIC_LOOKBACKS.map((entry) => ({
  value: entry.key,
  label: entry.label,
}))

const GROUP_FILTER_OPTIONS = ECONOMIC_GROUP_FILTERS.map((key) => ({
  value: key,
  label: key === 'all' ? 'All groups' : key.charAt(0).toUpperCase() + key.slice(1),
}))

/**
 * Default the chart to a series that actually has history.
 *
 * Falling back to the first catalog entry would draw an empty plot whenever that one
 * provider is unreachable, which is exactly when the page is least useful.
 */
function selectedRow(rows: EconomicRow[], wanted: string): EconomicRow | null {
  const populated = rows.filter((row) => row.history.length)
  const candidates = populated.length ? populated : rows
  if (!candidates.length) return null
  return candidates.find((row) => row.seriesId === wanted) ?? candidates[0]
}

export function EconomicPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const activeTab = useEconomicPage((state) => state.activeTab)
  const lookback = useEconomicPage((state) => state.lookback)
  const groupFilter = useEconomicPage((state) => state.groupFilter)
  const search = useEconomicPage((state) => state.search)
  const hideUnavailable = useEconomicPage((state) => state.hideUnavailable)
  const selectedSeries = useEconomicPage((state) => state.selectedSeries)
  const setActiveTab = useEconomicPage((state) => state.setActiveTab)
  const setLookback = useEconomicPage((state) => state.setLookback)
  const setGroupFilter = useEconomicPage((state) => state.setGroupFilter)
  const setSearch = useEconomicPage((state) => state.setSearch)
  const setHideUnavailable = useEconomicPage((state) => state.setHideUnavailable)
  const selectSeries = useEconomicPage((state) => state.selectSeries)

  const query = useEconomic(true)
  const { refresh, refreshing } = useRefreshEconomic()
  const payload = query.data?.data
  const busy = refreshing || query.isFetching

  useEffect(() => {
    onStatusChange([{ label: 'Economic', envelope: query.data, loading: query.isFetching }], '')
  }, [onStatusChange, query.data, query.isFetching])

  const allRows = useMemo(() => {
    const rows = payload?.rows ?? []
    return hideUnavailable ? dropUnavailable(rows) : [...rows]
  }, [hideUnavailable, payload])

  const overviewRows = useMemo(
    () => searchRows(filterRows(allRows, groupFilter), search),
    [allRows, groupFilter, search],
  )

  const group: EconomicGroup | null =
    activeTab === 'overview' ? null : (ECONOMIC_TAB_GROUPS[activeTab] as EconomicGroup)
  const groupRows = useMemo(
    () => (group ? rowsForGroup(allRows, group) : []),
    [allRows, group],
  )
  const charted = group ? selectedRow(groupRows, selectedSeries[group] ?? '') : null

  const status = useMemo(() => {
    if (busy && !payload?.rows.length) return 'Pulling series from US Treasury, BLS, NY Fed, UMich and FRED...'
    if (query.data?.meta.freshness === 'failed') {
      return `Economic refresh failed: ${query.data.meta.failureReason ?? 'unknown error'}`
    }
    return describeFreshness(payload).text
  }, [busy, payload, query.data])

  const footer = missingSummary(payload)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <h1 className="text-sm font-semibold text-text">Economic</h1>
        <p className="min-w-0 flex-1 truncate text-2xs text-text-muted">
          Headline US macro releases — inflation, labour, growth and the full treasury curve.
          Decision support only.
        </p>
        <Button variant="accent" onClick={() => void refresh(false)} disabled={busy}>
          {busy ? 'Fetching...' : 'Refresh'}
        </Button>
        <Button
          onClick={() => void refresh(true)}
          disabled={busy}
          title="Re-download every provider, ignoring the cached payload."
        >
          Force refresh
        </Button>
        <span className="text-2xs text-text-muted">Chart span</span>
        <Select
          aria-label="Chart span"
          value={lookback}
          options={LOOKBACK_OPTIONS}
          onChange={(value) => setLookback(value as EconomicLookback)}
          className="w-[70px]"
        />
      </div>

      <p className="shrink-0 truncate text-2xs text-text-muted" title={status}>
        {status}
      </p>

      <HeadlineStrip payload={payload} />

      <div className="flex shrink-0 border-b border-border">
        {ECONOMIC_TABS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`h-8 border border-b-0 px-3 text-2xs ${
              activeTab === key
                ? 'border-accent bg-surface-raised text-text'
                : 'border-border bg-surface text-text-muted hover:text-text'
            }`}
          >
            {TAB_LABELS[key]}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="text-2xs text-text-muted">Group</span>
            <Select
              aria-label="Group"
              value={groupFilter}
              options={GROUP_FILTER_OPTIONS}
              onChange={(value) => setGroupFilter(value as EconomicGroupFilter)}
              className="w-[110px]"
            />
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Indicator or FRED id"
              className="w-[190px]"
            />
            <Checkbox
              checked={hideUnavailable}
              onChange={setHideUnavailable}
              label="Hide unavailable"
              title="Hide indicators whose provider returned nothing on this network, so the tables show only series that actually loaded."
            />
          </div>
          <div className="flex min-h-0 flex-1 border border-border bg-surface">
            <EconomicOverviewTable rows={overviewRows} loading={busy} />
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {group === 'Rates' ? (
            <div className="flex h-[240px] shrink-0 flex-col">
              <YieldCurvePanel curve={payload?.yieldCurve} />
            </div>
          ) : null}
          <div className="flex min-h-0 flex-[3] border border-border bg-surface">
            <EconomicGroupTable
              rows={groupRows}
              selectedId={charted?.seriesId ?? ''}
              onSelect={(seriesId) => group && selectSeries(group, seriesId)}
              loading={busy}
            />
          </div>
          <div className="flex min-h-0 flex-[2] flex-col border border-border bg-surface p-2">
            <SeriesChart row={charted} years={lookbackYears(lookback)} />
          </div>
        </div>
      )}

      {footer ? <p className="shrink-0 text-2xs text-text-muted">{footer}</p> : null}
    </div>
  )
}
