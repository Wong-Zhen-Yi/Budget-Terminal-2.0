import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  InstitutionActivityPayload,
  InstitutionActivityRow,
  InstitutionManagerRow,
  InstitutionTickerActivityPayload,
} from '@shared/contract'
import {
  institutionActivityClipboard,
  institutionManagersClipboard,
} from '@shared/institutions'
import { api } from '@/api/client'
import {
  useInstitutionActivity,
  useInstitutionTickerActivity,
  useRefreshInstitutionActivity,
} from '@/api/institutionQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'

type Tone = 'muted' | 'positive' | 'warning' | 'negative'

const toneClass: Record<Tone, string> = {
  muted: 'text-text-muted',
  positive: 'text-up',
  warning: 'text-warn',
  negative: 'text-down',
}

const activityColumns = (flowLabel: string): Array<Column<InstitutionActivityRow>> => [
  { key: 'period', header: 'Period', cell: (row) => row.period, sortValue: (row) => row.period, width: '90px' },
  { key: 'symbol', header: 'Symbol', cell: (row) => row.symbol, sortValue: (row) => row.symbol, width: '72px' },
  {
    key: 'company',
    header: 'Company',
    cell: (row) => <span title={row.company}>{row.company}</span>,
    sortValue: (row) => row.company,
    wrap: true,
  },
  {
    key: 'manager',
    header: 'Manager',
    cell: (row) => <span title={row.manager}>{row.manager}</span>,
    sortValue: (row) => row.manager,
    wrap: true,
  },
  {
    key: 'activity',
    header: 'Activity',
    cell: (row) => <span title={row.activity}>{row.activity}</span>,
    sortValue: (row) => row.activity,
    width: '120px',
    wrap: true,
  },
  {
    key: 'approxFlow',
    header: flowLabel,
    cell: (row) => row.approxFlow,
    sortValue: (row) => row.approxFlowValue,
    align: 'right',
    numeric: true,
    width: '118px',
  },
  {
    key: 'changeToPortfolio',
    header: 'Change to Portfolio',
    cell: (row) => row.changeToPortfolio,
    sortValue: (row) => row.changeToPortfolioPct,
    align: 'right',
    numeric: true,
    width: '138px',
  },
]

const managerColumns: Array<Column<InstitutionManagerRow>> = [
  {
    key: 'manager',
    header: 'Manager',
    cell: (row) => <span title={row.manager}>{row.manager}</span>,
    sortValue: (row) => row.manager,
    wrap: true,
  },
  { key: 'managerId', header: 'ID', cell: (row) => row.managerId, sortValue: (row) => row.managerId, width: '72px' },
  { key: 'period', header: 'Period', cell: (row) => row.period, sortValue: (row) => row.period, width: '90px' },
  { key: 'buyCount', header: 'Buys', cell: (row) => row.buyCount, sortValue: (row) => row.buyCount, align: 'right', numeric: true, width: '58px' },
  { key: 'sellCount', header: 'Sells', cell: (row) => row.sellCount, sortValue: (row) => row.sellCount, align: 'right', numeric: true, width: '58px' },
  {
    key: 'topActivity',
    header: 'Top Activity',
    cell: (row) => {
      const activity = row.topActivity.join(', ')
      return <span title={activity}>{activity}</span>
    },
    sortValue: (row) => row.topActivity.join(', '),
    wrap: true,
  },
]

const tickerColumns: Array<Column<InstitutionActivityRow>> = [
  { key: 'period', header: 'Period', cell: (row) => row.period, sortValue: (row) => row.period, width: '90px' },
  {
    key: 'manager',
    header: 'Manager',
    cell: (row) => <span title={row.manager}>{row.manager}</span>,
    sortValue: (row) => row.manager,
    wrap: true,
  },
  {
    key: 'activity',
    header: 'Activity',
    cell: (row) => <span title={row.activity}>{row.activity}</span>,
    sortValue: (row) => row.activity,
    width: '120px',
    wrap: true,
  },
  { key: 'shareChange', header: 'Share Change', cell: (row) => row.shareChange, sortValue: (row) => row.shareChangeValue, align: 'right', numeric: true, width: '108px' },
  { key: 'changeToPortfolio', header: 'Change to Portfolio', cell: (row) => row.changeToPortfolio, sortValue: (row) => row.changeToPortfolioPct, align: 'right', numeric: true, width: '138px' },
]

function rowCount(payload: InstitutionActivityPayload): number {
  return payload.buyRows.length + payload.sellRows.length + payload.managerRows.length
}

function activityStatus(
  payload: InstitutionActivityPayload | undefined,
  freshness: string | undefined,
  failureReason: string | undefined,
  loading: boolean,
): { text: string; tone: Tone } {
  if (loading && !payload) return { text: 'Loading DATAROMA institution activity...', tone: 'muted' }
  if (freshness === 'failed') {
    return { text: `Institutions refresh failed: ${failureReason ?? 'DATAROMA is unavailable.'}`, tone: 'negative' }
  }
  if (!payload) return { text: 'Open the page to load institution activity.', tone: 'muted' }
  let text = `Institutions institution activity loaded: ${rowCount(payload)} row(s).`
  if (payload.activePeriod) text += ` Period: ${payload.activePeriod}.`
  text += ' Approx $ uses share change x DATAROMA hold price.'
  if (freshness === 'cached') text += ' Cache used.'
  if (freshness === 'stale') text += ' Stale cache shown.'
  if (payload.warnings.length) text += ` ${payload.warnings.at(-1)}`
  return {
    text,
    tone: freshness === 'stale' || payload.warnings.length ? 'warning' : 'positive',
  }
}

function tickerStatus(
  payload: InstitutionTickerActivityPayload | undefined,
  freshness: string | undefined,
  failureReason: string | undefined,
  loading: boolean,
): { text: string; tone: Tone } {
  if (loading) return { text: 'Loading institution activity for ticker...', tone: 'muted' }
  if (freshness === 'failed') {
    return { text: `Institutions refresh failed: ${failureReason ?? 'DATAROMA is unavailable.'}`, tone: 'negative' }
  }
  if (!payload) return { text: 'Search a ticker to load its institution activity.', tone: 'muted' }
  let text = `Institutions ticker activity loaded: ${payload.activityRows.length} row(s).`
  if (payload.activePeriod) text += ` Period: ${payload.activePeriod}.`
  if (freshness === 'cached') text += ' Cache used.'
  if (freshness === 'stale') text += ' Stale cache shown.'
  return { text, tone: freshness === 'stale' ? 'warning' : 'positive' }
}

function TablePanel<T>({
  title,
  rows,
  columns,
  rowKey,
  empty,
  openSource,
}: {
  title: string
  rows: T[]
  columns: Array<Column<T>>
  rowKey: (row: T, index: number) => string
  empty: string
  openSource: (row: T) => void
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col border border-border bg-surface p-2">
      <h2 className="shrink-0 pb-1 text-xs font-semibold text-text">{title}</h2>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={rowKey}
        layout="auto"
        onRowDoubleClick={openSource}
        empty={empty}
      />
    </section>
  )
}

export function InstitutionsPage({
  onStatusChange,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
}) {
  const [loadedQuarter, setLoadedQuarter] = useState('')
  const [selectedQuarter, setSelectedQuarter] = useState('')
  const [tickerDraft, setTickerDraft] = useState('MSFT')
  const [lastFacet, setLastFacet] = useState<'activity' | 'ticker'>('activity')
  const [refreshingActivity, setRefreshingActivity] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: Tone } | null>(null)

  const activityQuery = useInstitutionActivity(loadedQuarter)
  const refreshActivity = useRefreshInstitutionActivity()
  const tickerMutation = useInstitutionTickerActivity()
  const payload = activityQuery.data?.data
  const tickerPayload = tickerMutation.data?.data
  const busy = activityQuery.isFetching || refreshingActivity || tickerMutation.isPending

  useEffect(() => {
    if (!payload?.activePeriod) return
    setSelectedQuarter((current) => current || payload.activePeriod)
  }, [payload])

  useEffect(() => {
    onStatusChange(
      [
        { label: 'Institutions', envelope: activityQuery.data, error: activityQuery.error, enabled: activityQuery.isEnabled, loading: activityQuery.isFetching || refreshingActivity },
        { label: 'Ticker Activity', envelope: tickerMutation.data, error: tickerMutation.error, enabled: !tickerMutation.isIdle, loading: tickerMutation.isPending },
      ],
      '',
    )
  }, [
    onStatusChange,
    activityQuery.data,
    activityQuery.isFetching,
    refreshingActivity,
    tickerMutation.data,
    tickerMutation.isPending,
  ])

  const status = useMemo(() => {
    if (notice) return notice
    if (lastFacet === 'ticker') {
      return tickerStatus(
        tickerPayload,
        tickerMutation.data?.meta.freshness,
        tickerMutation.data?.meta.failureReason,
        tickerMutation.isPending,
      )
    }
    return activityStatus(
      payload,
      activityQuery.data?.meta.freshness,
      activityQuery.data?.meta.failureReason,
      activityQuery.isFetching || refreshingActivity,
    )
  }, [
    notice,
    lastFacet,
    tickerPayload,
    tickerMutation.data,
    tickerMutation.isPending,
    payload,
    activityQuery.data,
    activityQuery.isFetching,
    refreshingActivity,
  ])

  const loadQuarter = useCallback(async () => {
    setNotice(null)
    setLastFacet('activity')
    setRefreshingActivity(true)
    try {
      const result = await refreshActivity(selectedQuarter)
      if (result.meta.freshness !== 'failed') setLoadedQuarter(selectedQuarter)
    } finally {
      setRefreshingActivity(false)
    }
  }, [refreshActivity, selectedQuarter])

  const searchTicker = useCallback(async () => {
    const symbol = tickerDraft.toUpperCase().trim()
    setTickerDraft(symbol)
    setNotice(null)
    setLastFacet('ticker')
    await tickerMutation.mutateAsync({ symbol, force: true })
  }, [tickerDraft, tickerMutation])

  const openSource = useCallback((row: { sourceUrl: string; historyUrl?: string }) => {
    const url = row.sourceUrl || row.historyUrl || ''
    if (url) {
      void api.openExternal(url)
      return
    }
    setNotice({ text: 'No source URL is attached to that row.', tone: 'warning' })
  }, [])

  const copyActivity = useCallback(async () => {
    if (!payload) return
    await api.writeClipboard(institutionActivityClipboard(payload))
    const count = payload.buyRows.length + payload.sellRows.length
    setNotice({ text: `Copied Institutions buys/sells export to clipboard: ${count} row(s).`, tone: 'positive' })
  }, [payload])

  const copyManagers = useCallback(async () => {
    if (!payload) return
    await api.writeClipboard(institutionManagersClipboard(payload))
    setNotice({ text: `Copied Institutions superinvestors export to clipboard: ${payload.managerRows.length} row(s).`, tone: 'positive' })
  }, [payload])

  const periods = payload?.periods ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <section className="flex shrink-0 flex-wrap items-center gap-2 border border-border bg-surface px-3 py-2">
        <div className="mr-auto">
          <h1 className="text-sm font-semibold text-text">Institutions</h1>
          <p className="text-2xs text-text-muted">Latest DATAROMA superinvestor activity by quarter.</p>
        </div>
        <label className="text-2xs text-text-muted" htmlFor="institutions-quarter">Quarter</label>
        <select
          id="institutions-quarter"
          value={selectedQuarter}
          onChange={(event) => setSelectedQuarter(event.target.value)}
          disabled={busy || !periods.length}
          className="h-8 min-w-28 border border-border-strong bg-surface-raised px-2 text-2xs text-text"
        >
          {!periods.length ? <option value="">Latest</option> : null}
          {periods.map((period) => <option key={period} value={period}>{period}</option>)}
        </select>
        <Button onClick={() => void loadQuarter()} disabled={busy}>Load Quarter</Button>
        <Button onClick={() => void loadQuarter()} disabled={busy}>Refresh</Button>
        <Button variant="accent" onClick={() => void copyActivity()} disabled={busy || !payload}>
          Export Buys/Sells
        </Button>
        <Button variant="accent" onClick={() => void copyManagers()} disabled={busy || !payload}>
          Export Superinvestors
        </Button>
        <p className={`max-w-xl text-right text-2xs ${toneClass[status.tone]}`}>{status.text}</p>
      </section>

      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2">
        <TablePanel
          title="Top Institutional Buying"
          rows={payload?.buyRows ?? []}
          columns={activityColumns('Approx Inflow $')}
          rowKey={(row, index) => `${row.period}-${row.managerId}-${row.symbol}-${row.activity}-${index}`}
          empty={activityQuery.isFetching ? 'Loading institutional buying...' : 'No institutional buying loaded.'}
          openSource={openSource}
        />
        <TablePanel
          title="Top Institutional Selling"
          rows={payload?.sellRows ?? []}
          columns={activityColumns('Approx Outflow $')}
          rowKey={(row, index) => `${row.period}-${row.managerId}-${row.symbol}-${row.activity}-${index}`}
          empty={activityQuery.isFetching ? 'Loading institutional selling...' : 'No institutional selling loaded.'}
          openSource={openSource}
        />
        <TablePanel
          title="Superinvestors"
          rows={payload?.managerRows ?? []}
          columns={managerColumns}
          rowKey={(row, index) => `${row.managerId || row.manager}-${row.period}-${index}`}
          empty={activityQuery.isFetching ? 'Loading superinvestors...' : 'No superinvestors loaded.'}
          openSource={openSource}
        />
        <section className="flex min-h-0 min-w-0 flex-col border border-border bg-surface p-2">
          <div className="flex shrink-0 items-center gap-2 pb-1">
            <h2 className="mr-auto text-xs font-semibold text-text">Ticker Activity</h2>
            <input
              type="text"
              value={tickerDraft}
              onChange={(event) => setTickerDraft(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !busy) void searchTicker()
              }}
              placeholder="Ticker"
              aria-label="Institution ticker"
              disabled={busy}
              className="h-8 w-28 border border-border-strong bg-surface-raised px-2 text-2xs text-text outline-none focus:border-accent"
            />
            <Button onClick={() => void searchTicker()} disabled={busy}>Search Ticker</Button>
          </div>
          <DataTable
            columns={tickerColumns}
            rows={tickerPayload?.activityRows ?? []}
            rowKey={(row, index) => `${row.period}-${row.managerId}-${row.activity}-${index}`}
            layout="auto"
            onRowDoubleClick={openSource}
            empty={tickerMutation.isPending ? 'Loading ticker activity...' : 'Search a ticker to load institution activity.'}
          />
        </section>
      </div>
    </div>
  )
}
