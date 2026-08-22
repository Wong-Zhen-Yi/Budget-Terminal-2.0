import { useState } from 'react'

import type { BillFrequency, FinanceCurrency, RecurringBill } from '@shared/contract'
import { MAX_ENTRY_DESC } from '@shared/contract'
import type { BillTotals } from '@shared/financeMath'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { NumberInput } from '@/components/ui/NumberInput'
import { Panel } from '@/components/ui/Panel'
import { Select } from '@/components/ui/Select'
import { TextInput } from '@/components/ui/TextInput'
import { EXPLICIT_CURRENCY_PREFIX, money } from '@/lib/format'

/** The reference offers exactly these two cycles — no weekly, quarterly or daily. */
const CYCLES: ReadonlyArray<{ value: BillFrequency; label: string }> = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

const CURRENCIES: ReadonlyArray<{ value: FinanceCurrency; label: string }> = [
  { value: 'SGD', label: 'SGD' },
  { value: 'USD', label: 'USD' },
]

interface BillsPanelProps {
  rows: RecurringBill[]
  totals: BillTotals
  /** The Totals selector's currency, which both footer figures are stated in. */
  display: FinanceCurrency
  onAdd: () => void
  onRemove: (id: string) => void
  onSetDesc: (id: string, desc: string) => void
  onSetAmount: (id: string, amount: number) => void
  onSetFrequency: (id: string, frequency: BillFrequency) => void
  onSetCurrency: (id: string, currency: FinanceCurrency) => void
  className?: string
}

export function BillsPanel({
  rows,
  totals,
  display,
  onAdd,
  onRemove,
  onSetDesc,
  onSetAmount,
  onSetFrequency,
  onSetCurrency,
  className = '',
}: BillsPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const columns: Array<Column<RecurringBill>> = [
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
      header: 'Amount',
      align: 'right',
      numeric: true,
      width: '5.5rem',
      sortValue: (row) => row.amount,
      cell: (row) => (
        <NumberInput
          aria-label={`${row.desc} amount`}
          value={row.amount}
          decimals={2}
          // The row states its own currency, unlike the reference's bare `$`.
          prefix={EXPLICIT_CURRENCY_PREFIX[row.currency]}
          onCommit={(value) => onSetAmount(row.id, value)}
        />
      ),
    },
    {
      key: 'frequency',
      header: 'Cycle',
      width: '6.25rem',
      cell: (row) => (
        <Select
          aria-label={`${row.desc} cycle`}
          value={row.frequency}
          options={CYCLES}
          onChange={(value) => onSetFrequency(row.id, value)}
        />
      ),
    },
    {
      key: 'currency',
      header: 'Currency',
      width: '5rem',
      cell: (row) => (
        <Select
          aria-label={`${row.desc} currency`}
          value={row.currency}
          options={CURRENCIES}
          onChange={(value) => onSetCurrency(row.id, value)}
        />
      ),
    },
  ]

  const monthly = totals.available ? money(totals.monthly, display) : 'FX required'
  const annual = totals.available ? money(totals.annual, display) : 'FX required'

  return (
    <Panel
      title="Recurring Bills"
      className={className}
      actions={
        <>
          <Button variant="accent" onClick={onAdd}>
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
        empty="No recurring bills"
        onRowClick={(row) => setSelectedId(row.id === selectedId ? null : row.id)}
        rowClassName={(row) => (row.id === selectedId ? 'bg-accent-dim' : '')}
      />
      <div className="flex h-8 shrink-0 items-center justify-end gap-4 border-t border-border px-2 text-2xs font-semibold text-text">
        <span>
          Monthly total ({display}): <span className="num">{monthly}</span>
        </span>
        <span>
          Annual total ({display}): <span className="num">{annual}</span>
        </span>
      </div>
    </Panel>
  )
}
