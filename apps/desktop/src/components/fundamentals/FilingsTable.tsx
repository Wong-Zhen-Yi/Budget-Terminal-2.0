import { useMemo, useState } from 'react'

import type { SecFiling } from '@shared/contract'
import { filterFundamentalsFilings } from '@shared/fundamentalsPage'
import { api } from '@/api/client'
import { Button } from '@/components/ui/Button'

type FilingFilter = 'All' | '10-K' | '10-Q' | '8-K'
type SortKey = 'filedDate' | 'reportPeriod' | 'form' | 'description'

export function FilingsTable({ filings }: { filings: SecFiling[] }) {
  const [query, setQuery] = useState('')
  const [form, setForm] = useState<FilingFilter>('All')
  const [selectedUrl, setSelectedUrl] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: 'filedDate',
    descending: true,
  })

  const rows = useMemo(() => {
    const filtered = filterFundamentalsFilings(filings, query, form)
    return filtered.sort((left, right) => {
      const comparison = String(left[sort.key]).localeCompare(String(right[sort.key]))
      return sort.descending ? -comparison : comparison
    })
  }, [filings, form, query, sort])

  const toggleSort = (key: SortKey) => {
    setSort((current) => ({
      key,
      descending: current.key === key ? !current.descending : key === 'filedDate',
    }))
  }

  const openSelected = () => {
    if (selectedUrl) void api.openExternal(selectedUrl)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search filings"
          aria-label="Search SEC filings"
          className="h-8 min-w-[220px] flex-1 border border-border-strong bg-surface-raised px-2 text-2xs text-text outline-none focus:border-accent"
        />
        {(['All', '10-K', '10-Q', '8-K'] as const).map((value) => (
          <Button key={value} variant="toggle" active={form === value} onClick={() => setForm(value)}>
            {value}
          </Button>
        ))}
        <Button variant="accent" disabled={!selectedUrl} onClick={openSelected}>Open Filing</Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto border border-border">
        <table className="w-full table-fixed border-collapse text-2xs">
          <thead className="sticky top-0 z-[1] bg-surface-raised text-text-muted">
            <tr>
              <FilingHeader label="Filed" width="13%" active={sort.key === 'filedDate'} descending={sort.descending} onClick={() => toggleSort('filedDate')} />
              <FilingHeader label="Period" width="13%" active={sort.key === 'reportPeriod'} descending={sort.descending} onClick={() => toggleSort('reportPeriod')} />
              <FilingHeader label="Form" width="10%" active={sort.key === 'form'} descending={sort.descending} onClick={() => toggleSort('form')} />
              <FilingHeader label="Description" width="42%" active={sort.key === 'description'} descending={sort.descending} onClick={() => toggleSort('description')} />
              <th className="border-b border-border px-2 py-1 text-left font-semibold" style={{ width: '22%' }}>Items</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${row.accessionNumber}:${row.documentUrl}`}
                tabIndex={0}
                aria-selected={selectedUrl === row.documentUrl}
                onClick={() => setSelectedUrl(row.documentUrl)}
                onDoubleClick={() => { if (row.documentUrl) void api.openExternal(row.documentUrl) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && row.documentUrl) void api.openExternal(row.documentUrl)
                }}
                className={`cursor-default border-b border-border/60 text-text hover:bg-surface-hover ${selectedUrl === row.documentUrl ? 'bg-accent-dim/50' : ''}`}
              >
                <td className="num truncate px-2 py-1">{row.filedDate || '--'}</td>
                <td className="num truncate px-2 py-1">{row.reportPeriod || '--'}</td>
                <td className="truncate px-2 py-1 font-semibold">{row.form || '--'}</td>
                <td className="truncate px-2 py-1" title={row.description}>{row.description || '--'}</td>
                <td className="truncate px-2 py-1 text-text-muted" title={row.items}>{row.items || '--'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? (
          <p className="p-6 text-center text-2xs text-text-dim">No filings match the current filter.</p>
        ) : null}
      </div>
      <p className="shrink-0 text-2xs text-text-dim">{rows.length} filing{rows.length === 1 ? '' : 's'} shown · double-click a row to open it</p>
    </div>
  )
}

function FilingHeader({
  label,
  width,
  active,
  descending,
  onClick,
}: {
  label: string
  width: string
  active: boolean
  descending: boolean
  onClick: () => void
}) {
  return (
    <th className="border-b border-border p-0 text-left font-semibold" style={{ width }}>
      <button type="button" onClick={onClick} className="w-full px-2 py-1 text-left hover:text-text">
        {label}{active ? (descending ? ' ▼' : ' ▲') : ''}
      </button>
    </th>
  )
}
