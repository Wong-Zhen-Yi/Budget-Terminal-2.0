import { useState, type ReactNode } from 'react'

import type { FinanceEntry } from '@shared/contract'
import { MAX_ENTRY_DESC } from '@shared/contract'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { NumberInput } from '@/components/ui/NumberInput'
import { Panel } from '@/components/ui/Panel'
import { TextInput } from '@/components/ui/TextInput'

interface EntriesPanelProps {
  /** Panel heading; the reference spells the currency into it, as `CASH (SGD)`. */
  title: string
  rows: FinanceEntry[]
  footer: ReactNode
  /** Green for the asset table, red for the liability one. */
  addVariant: 'positive' | 'danger'
  onAdd: () => void
  onRemove: (id: string) => void
  onSetDesc: (id: string, desc: string) => void
  onSetAmount: (id: string, amount: number) => void
  className?: string
}

/**
 * The Cash and Debt tables, which differ only in their heading, their Add colour and
 * what their footer totals up.
 *
 * Both are natively SGD and stay SGD however the Totals selector is set — the reference
 * hardcodes the column header and the footer prefix, and the aggregate views are the
 * only place the display currency applies.
 */
export function EntriesPanel({
  title,
  rows,
  footer,
  addVariant,
  onAdd,
  onRemove,
  onSetDesc,
  onSetAmount,
  className = '',
}: EntriesPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const columns: Array<Column<FinanceEntry>> = [
    {
      key: 'desc',
      header: 'Description',
      // A long name runs onto a second line rather than clipping, the way the
      // Dashboard's news headlines do.
      wrap: true,
      sortValue: (row) => row.desc.toLowerCase(),
      cell: (row) => (
        <TextInput
          aria-label={`${row.desc} description`}
          value={row.desc}
          maxLength={MAX_ENTRY_DESC}
          wrap
          onCommit={(value) => onSetDesc(row.id, value)}
        />
      ),
    },
    {
      key: 'amount',
      header: 'Amount (SGD)',
      align: 'right',
      numeric: true,
      width: '8.75rem',
      sortValue: (row) => row.amount,
      cell: (row) => (
        <NumberInput
          aria-label={`${row.desc} amount`}
          value={row.amount}
          decimals={2}
          onCommit={(value) => onSetAmount(row.id, value)}
        />
      ),
    },
  ]

  return (
    <Panel
      title={title}
      className={className}
      actions={
        <>
          <Button variant={addVariant} onClick={onAdd}>
            + Add
          </Button>
          <Button
            variant="danger"
            disabled={!selectedId}
            onClick={() => {
              if (!selectedId) return
              onRemove(selectedId)
              setSelectedId(null)
            }}
          >
            Remove
          </Button>
        </>
      }
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        showIndex
        layout="fixed"
        empty="No entries"
        defaultSort={{ key: 'amount', direction: 'desc' }}
        onRowClick={(row) => setSelectedId(row.id === selectedId ? null : row.id)}
        rowClassName={(row) => (row.id === selectedId ? 'bg-accent-dim' : '')}
      />
      <div className="flex h-8 shrink-0 items-center justify-end border-t border-border px-2 text-2xs font-semibold text-text">
        {footer}
      </div>
    </Panel>
  )
}
