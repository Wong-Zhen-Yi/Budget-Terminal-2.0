import { useMemo } from 'react'

import type { EconomicRow } from '@shared/contract'
import {
  changeTone,
  formatEconomicChange,
  formatEconomicValue,
  rowTooltip,
} from '@shared/economic'
import { DataTable, type Column } from '@/components/ui/DataTable'

/**
 * The Overview and per-group indicator tables, ported from `build_overview_rows` and
 * `build_group_rows`.
 *
 * The two differ only at the ends: Overview carries a Group column and prints the provider
 * as its last column, while a group tab trades both for the series' own note. Everything
 * between is the shared `_common_cells` block.
 */

const TONE_CLASS = {
  positive: 'text-up',
  negative: 'text-down',
  neutral: 'text-text',
} as const

function valueCell(row: EconomicRow, value: number | null): string {
  return formatEconomicValue(value, row.units, row.decimals)
}

/** Latest, As of, Prior, Change and YoY %, which both tables share. */
function commonColumns(): Array<Column<EconomicRow>> {
  return [
    {
      key: 'latest',
      header: 'Latest',
      align: 'right',
      numeric: true,
      width: '96px',
      cell: (row) => valueCell(row, row.latest),
      sortValue: (row) => row.latest,
    },
    {
      key: 'latestDate',
      header: 'As of',
      align: 'center',
      numeric: true,
      width: '96px',
      cell: (row) => row.latestDate ?? '—',
      sortValue: (row) => row.latestDate ?? '',
    },
    {
      key: 'prior',
      header: 'Prior',
      align: 'right',
      numeric: true,
      width: '96px',
      cell: (row) => <span className="text-text-muted">{valueCell(row, row.prior)}</span>,
      sortValue: (row) => row.prior,
    },
    {
      key: 'change',
      header: 'Change',
      align: 'right',
      numeric: true,
      width: '104px',
      cell: (row) => (
        <span className={TONE_CLASS[changeTone(row, row.change)]}>
          {formatEconomicChange(row.change, row.units, row.decimals)}
        </span>
      ),
      sortValue: (row) => row.change,
    },
    {
      key: 'yoy',
      header: 'YoY %',
      align: 'right',
      numeric: true,
      width: '90px',
      cell: (row) =>
        row.yoy === null
          ? '—'
          : `${row.yoy >= 0 ? '+' : '-'}${Math.abs(row.yoy).toFixed(1)}%`,
      sortValue: (row) => row.yoy,
    },
  ]
}

function labelColumn(): Column<EconomicRow> {
  return {
    key: 'label',
    header: 'Indicator',
    width: '210px',
    cell: (row) => (
      <span title={rowTooltip(row)} className={row.available ? 'text-text' : 'text-text-dim'}>
        {row.label}
      </span>
    ),
    sortValue: (row) => row.label,
  }
}

export function EconomicOverviewTable({
  rows,
  loading,
}: {
  rows: EconomicRow[]
  loading: boolean
}) {
  const columns = useMemo<Array<Column<EconomicRow>>>(
    () => [
      labelColumn(),
      {
        key: 'group',
        header: 'Group',
        align: 'center',
        width: '88px',
        cell: (row) => <span className="text-text-muted">{row.group}</span>,
        sortValue: (row) => row.group,
      },
      ...commonColumns(),
      {
        key: 'source',
        header: 'Source',
        cell: (row) => <span className="text-text-muted">{row.source}</span>,
        sortValue: (row) => row.source,
      },
    ],
    [],
  )
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.seriesId}
      layout="fixed"
      empty={loading ? 'Loading economic series...' : 'No indicators to display'}
    />
  )
}

export function EconomicGroupTable({
  rows,
  selectedId,
  onSelect,
  loading,
}: {
  rows: EconomicRow[]
  selectedId: string
  onSelect: (seriesId: string) => void
  loading: boolean
}) {
  const columns = useMemo<Array<Column<EconomicRow>>>(
    () => [
      labelColumn(),
      ...commonColumns(),
      {
        key: 'note',
        header: 'Notes',
        cell: (row) => <span className="text-text-muted">{row.note || row.source || row.seriesId}</span>,
        sortValue: (row) => row.note || row.source,
      },
    ],
    [],
  )
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.seriesId}
      layout="fixed"
      onRowClick={(row) => onSelect(row.seriesId)}
      rowClassName={(row) => (row.seriesId === selectedId ? 'bg-surface-hover' : '')}
      empty={loading ? 'Loading economic series...' : 'No indicators to display'}
    />
  )
}
