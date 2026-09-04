import { useCallback, useEffect, useMemo, useState } from 'react'

import type { PoliticsParty, PoliticsTrade } from '@shared/contract'
import {
  buildPoliticsThemeFlow,
  filterPoliticsTrades,
  formatPoliticsFlow,
  politicsClipboard,
  politicsFlowSlices,
  politicsTopCounts,
  POLITICS_PAGE_SIZE,
  type PoliticsFilters,
} from '@shared/politics'
import { api } from '@/api/client'
import { usePoliticsPage } from '@/api/politicsQueries'
import { Donut } from '@/components/charts/Donut'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Panel } from '@/components/ui/Panel'

type Tone = 'muted' | 'positive' | 'warning' | 'negative'

const SELECT_CLASS = 'h-8 border border-border-strong bg-surface-raised px-2 text-2xs text-text'
const PARTY_COLOR: Record<PoliticsParty, string> = {
  Democrat: '#2196f3',
  Republican: '#f44336',
  Independent: '#9e9e9e',
  Unknown: '#666666',
}
const TRADE_COLOR: Record<string, string> = {
  Purchase: '#00c853',
  'Sale (Full)': '#ff1744',
  'Sale (Partial)': '#ff5252',
  Exchange: '#ffc107',
}
const TONE_CLASS: Record<Tone, string> = {
  muted: 'text-text-muted',
  positive: 'text-up',
  warning: 'text-warn',
  negative: 'text-down',
}
const EXPORT_ALL = 'All'
const DEFAULT_FILTERS: PoliticsFilters = {
  politician: 'All',
  ticker: '',
  chamber: 'All',
  party: 'All',
  tradeType: 'All',
  theme: 'All',
}

function SelectFilter({
  label,
  value,
  values,
  onChange,
  className = '',
}: {
  label: string
  value: string
  values: string[]
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <label className="flex items-center gap-1 text-2xs text-text-muted">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${SELECT_CLASS} ${className}`}
      >
        {values.map((option) => <option key={option}>{option}</option>)}
      </select>
    </label>
  )
}

export function PoliticsPage({
  onStatusChange,
  onNavigate,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate: (tabId: string, symbol?: string) => void
}) {
  const [page, setPage] = useState(1)
  const query = usePoliticsPage(page)
  const [draft, setDraft] = useState<PoliticsFilters>(DEFAULT_FILTERS)
  const [filters, setFilters] = useState<PoliticsFilters>(DEFAULT_FILTERS)
  const [exporting, setExporting] = useState(false)
  const [exportPages, setExportPages] = useState('5')
  const [notice, setNotice] = useState<{ text: string; tone: Tone } | null>(null)

  const envelope = query.data
  const payload = envelope?.data
  const trades = payload?.page === page ? payload.trades : []
  const totalPages = payload?.page === page ? payload.totalPages : 0
  const totalCount = payload?.page === page ? payload.totalCount : 0

  useEffect(() => {
    onStatusChange(
      [{ label: 'Politics', envelope, loading: query.isFetching }],
      '',
    )
  }, [onStatusChange, envelope, query.isFetching])

  const politicianOptions = useMemo(
    () => ['All', ...new Set(trades.map((trade) => trade.politician).filter(Boolean))].sort(),
    [trades],
  )
  const themeOptions = useMemo(() => {
    const themes = [...new Set(trades.map((trade) => trade.theme || 'Other'))]
      .sort((left, right) => Number(left === 'Other') - Number(right === 'Other') || left.localeCompare(right))
    return ['All', ...themes]
  }, [trades])

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      politician: politicianOptions.includes(current.politician) ? current.politician : 'All',
      theme: themeOptions.includes(current.theme) ? current.theme : 'All',
    }))
    setFilters((current) => ({
      ...current,
      politician: politicianOptions.includes(current.politician) ? current.politician : 'All',
      theme: themeOptions.includes(current.theme) ? current.theme : 'All',
    }))
  }, [politicianOptions, themeOptions])

  const filtered = useMemo(() => filterPoliticsTrades(trades, filters), [trades, filters])
  const topTickers = useMemo(() => politicsTopCounts(filtered, 'ticker'), [filtered])
  const topPoliticians = useMemo(() => politicsTopCounts(filtered, 'politician'), [filtered])
  const themeFlow = useMemo(() => buildPoliticsThemeFlow(filtered), [filtered])
  const flowSlices = useMemo(() => politicsFlowSlices(themeFlow), [themeFlow])
  const grossFlow = flowSlices.reduce((sum, slice) => sum + slice.value, 0)

  const applyFilters = useCallback((next = draft) => {
    setFilters({ ...next, ticker: next.ticker.trim().toUpperCase() })
  }, [draft])

  const selectAndApply = useCallback((key: 'politician' | 'theme', value: string) => {
    setDraft((current) => {
      const next = { ...current, [key]: value }
      setFilters({ ...next, ticker: next.ticker.trim().toUpperCase() })
      return next
    })
  }, [])

  const status = useMemo<{ text: string; tone: Tone }>(() => {
    if (notice) return notice
    if (query.isFetching) return { text: `Fetching page ${page}...`, tone: 'muted' }
    if (envelope?.meta.freshness === 'failed') {
      return { text: `Error: ${envelope.meta.failureReason ?? 'Politics data unavailable'}`, tone: 'negative' }
    }
    if (!payload || payload.page !== page) return { text: `Fetching page ${page}...`, tone: 'muted' }
    const scope = totalPages
      ? `Page ${page} of ${totalPages} - ${trades.length} of ${totalCount.toLocaleString('en-US')} trades`
      : `Page ${page} - ${trades.length} trades`
    if (payload.stale) return { text: `${scope}; stale cache shown`, tone: 'warning' }
    return { text: scope, tone: 'positive' }
  }, [notice, query.isFetching, page, envelope, payload, trades.length, totalPages, totalCount])

  const exportTrades = useCallback(async () => {
    if (exporting) return
    // 'All' becomes 0, which the service reads as "walk every page the source reports".
    const pages = exportPages === EXPORT_ALL ? 0 : Number(exportPages)
    setExporting(true)
    setNotice({
      text: pages > 0
        ? `Exporting pages 1-${pages}...`
        : `Exporting every page${totalPages ? ` (${totalPages})` : ''}; this takes a while...`,
      tone: 'muted',
    })
    try {
      const result = await api.politicsExport({ pages })
      if (!result.data.trades.length) {
        setNotice({
          text: result.meta.failureReason ? `Export error: ${result.meta.failureReason}` : 'No trades to export',
          tone: result.meta.failureReason ? 'negative' : 'warning',
        })
        return
      }
      await api.writeClipboard(politicsClipboard(result.data.trades))
      const covered = result.data.totalPages
        ? ` from ${result.data.pagesFetched} of ${result.data.totalPages} pages`
        : ` from ${result.data.pagesFetched} page(s)`
      setNotice({
        text: `Copied ${result.data.trades.length.toLocaleString('en-US')} trades${covered} to clipboard`,
        tone: result.errors.length ? 'warning' : 'positive',
      })
    } finally {
      setExporting(false)
    }
  }, [exporting, exportPages, totalPages])

  const tradeColumns = useMemo<Array<Column<PoliticsTrade>>>(() => [
    { key: 'politician', header: 'Politician', cell: (row) => row.politician, sortValue: (row) => row.politician },
    { key: 'chamber', header: 'Chamber', cell: (row) => row.chamber, sortValue: (row) => row.chamber, width: '82px' },
    {
      key: 'party',
      header: 'Party',
      cell: (row) => <span style={{ color: PARTY_COLOR[row.party] }}>{row.party}</span>,
      sortValue: (row) => row.party,
      width: '100px',
    },
    {
      // Municipal debt, treasuries, LLCs and private funds are disclosed without a ticker.
      key: 'ticker',
      header: 'Ticker',
      cell: (row) => row.ticker
        ? <span className="text-accent">{row.ticker}</span>
        : <span className="text-text-muted" title={row.assetDescription}>--</span>,
      sortValue: (row) => row.ticker,
      width: '76px',
    },
    {
      key: 'tradeType',
      header: 'Type',
      cell: (row) => <span style={{ color: TRADE_COLOR[row.tradeType] ?? '#888888' }}>{row.tradeType}</span>,
      sortValue: (row) => row.tradeType,
      width: '105px',
    },
    { key: 'amount', header: 'Amount', cell: (row) => row.amount, sortValue: (row) => row.amountValue, align: 'right', numeric: true, width: '82px' },
    { key: 'transactionDate', header: 'Tx Date', cell: (row) => row.transactionDate, sortValue: (row) => row.transactionDate, width: '92px' },
    { key: 'disclosureDate', header: 'Filed', cell: (row) => row.disclosureDate, sortValue: (row) => row.disclosureDate, width: '92px' },
  ], [])

  const countColumns = useMemo<Array<Column<[string, number]>>>(() => [
    { key: 'name', header: '', cell: (row) => row[0], sortValue: (row) => row[0] },
    { key: 'count', header: 'Trades', cell: (row) => row[1], sortValue: (row) => row[1], align: 'right', numeric: true, width: '62px' },
  ], [])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
      <div className="flex shrink-0 items-center gap-3">
        <h1 className="text-sm font-semibold text-text">Congressional Stock Trades</h1>
        <span className={`ml-auto text-2xs ${TONE_CLASS[status.tone]}`}>{status.text}</span>
        <SelectFilter
          label="Export"
          value={exportPages}
          values={['5', '25', '50', EXPORT_ALL]}
          onChange={setExportPages}
          className="w-16"
        />
        <Button onClick={() => void exportTrades()} disabled={exporting}>
          {exporting ? 'Exporting...' : 'Export for LLM'}
        </Button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border border-border bg-surface p-2">
        <SelectFilter label="Politician" value={draft.politician} values={politicianOptions} onChange={(value) => selectAndApply('politician', value)} className="w-52" />
        <input
          aria-label="Search ticker"
          value={draft.ticker}
          placeholder="Search ticker..."
          onChange={(event) => setDraft((current) => ({ ...current, ticker: event.target.value }))}
          onKeyDown={(event) => { if (event.key === 'Enter') applyFilters() }}
          className={`${SELECT_CLASS} w-28`}
        />
        <SelectFilter label="Chamber" value={draft.chamber} values={['All', 'House', 'Senate']} onChange={(value) => setDraft((current) => ({ ...current, chamber: value }))} />
        <SelectFilter label="Party" value={draft.party} values={['All', 'Democrat', 'Republican', 'Independent']} onChange={(value) => setDraft((current) => ({ ...current, party: value }))} />
        <SelectFilter label="Type" value={draft.tradeType} values={['All', 'Purchase', 'Sale (Full)', 'Sale (Partial)', 'Exchange']} onChange={(value) => setDraft((current) => ({ ...current, tradeType: value }))} />
        <SelectFilter label="Theme" value={draft.theme} values={themeOptions} onChange={(value) => selectAndApply('theme', value)} className="w-40" />
        <Button variant="accent" onClick={() => applyFilters()}>Apply</Button>
      </div>

      <div className="grid min-h-[560px] flex-1 grid-cols-[minmax(620px,7fr)_minmax(440px,3fr)] gap-2">
        <Panel title="Trades">
          <DataTable
            columns={tradeColumns}
            rows={filtered}
            rowKey={(row, index) => `${row.politician}-${row.ticker}-${row.transactionDate}-${row.disclosureDate}-${index}`}
            layout="fixed"
            defaultSort={{ key: 'transactionDate', direction: 'desc' }}
            onRowDoubleClick={(row) => { if (row.ticker) onNavigate('charts', row.ticker) }}
            empty={query.isFetching ? `Fetching page ${page}...` : 'No matching trades'}
          />
        </Panel>

        <div className="grid min-h-0 grid-cols-[minmax(150px,2fr)_minmax(240px,3fr)] gap-2">
          <div className="grid min-h-0 grid-rows-2 gap-2">
            <Panel title="Most Traded Tickers">
              <DataTable
                columns={countColumns}
                rows={topTickers}
                rowKey={(row) => row[0]}
                onRowDoubleClick={(row) => onNavigate('charts', row[0])}
              />
            </Panel>
            <Panel title="Most Active Politicians">
              <DataTable
                columns={countColumns}
                rows={topPoliticians}
                rowKey={(row) => row[0]}
                onRowDoubleClick={(row) => selectAndApply('politician', row[0])}
              />
            </Panel>
          </div>

          <div className="grid min-h-0 grid-rows-[3fr_2fr] gap-2">
            <Panel title="Market Flow by Theme">
              <DataTable
                columns={[
                  { key: 'theme', header: 'Theme', cell: (row) => row.theme, sortValue: (row) => row.theme },
                  { key: 'buy', header: 'Buy $', cell: (row) => formatPoliticsFlow(row.buy), sortValue: (row) => row.buy, align: 'right', numeric: true },
                  { key: 'sell', header: 'Sell $', cell: (row) => formatPoliticsFlow(row.sell), sortValue: (row) => row.sell, align: 'right', numeric: true },
                  { key: 'net', header: 'Net $', cell: (row) => <span className={row.net > 0 ? 'text-up' : row.net < 0 ? 'text-down' : ''}>{formatPoliticsFlow(row.net, true)}</span>, sortValue: (row) => row.net, align: 'right', numeric: true },
                ]}
                rows={themeFlow}
                rowKey={(row) => row.theme}
                onRowDoubleClick={(row) => selectAndApply('theme', row.theme)}
              />
            </Panel>
            <Panel title="Flow Breakdown">
              <Donut
                slices={flowSlices}
                empty="No flow for the current filters"
                centerText={grossFlow > 0 ? formatPoliticsFlow(grossFlow) : undefined}
                centerSubtext={grossFlow > 0 ? 'Gross Flow' : undefined}
              />
            </Panel>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-center gap-2">
        <Button onClick={() => { setNotice(null); setPage((current) => Math.max(1, current - 1)) }} disabled={page <= 1 || query.isFetching}>&lt; Prev</Button>
        <span className="w-24 text-center text-2xs text-text-muted">
          Page {page}{totalPages ? ` / ${totalPages}` : ''}
        </span>
        <Button
          onClick={() => { setNotice(null); setPage((current) => current + 1) }}
          disabled={
            query.isFetching ||
            !payload ||
            payload.page !== page ||
            (totalPages ? page >= totalPages : payload.rawCount < POLITICS_PAGE_SIZE)
          }
        >
          Next &gt;
        </Button>
      </div>
    </div>
  )
}
