import { useMemo, useState } from 'react'

import type { CardWeighting } from '@shared/contract'
import type { CardModel } from '@shared/cards'
import { normalizeCardSymbols, normalizeCardWeights } from '@shared/cards'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

interface EditorValues {
  name: string
  symbols: string[]
  weighting: CardWeighting
  weights: Record<string, number>
}

interface Row {
  key: string
  symbol: string
  weight: string
}

export function CardEditorDialog({
  card,
  onClose,
  onSave,
}: {
  card?: CardModel
  onClose: () => void
  onSave: (values: EditorValues) => void
}) {
  const [name, setName] = useState(card?.name ?? '')
  const [weighting, setWeighting] = useState<CardWeighting>(
    card?.weighting === 'custom' ? 'custom' : 'equal',
  )
  const [rows, setRows] = useState<Row[]>(() => {
    const initial = card?.symbols.map((symbol, index) => ({
      key: `${index}-${symbol}`,
      symbol,
      weight: String(card.weights[symbol] ?? 0),
    })) ?? []
    return initial.length ? initial : [{ key: 'new-0', symbol: '', weight: '0' }]
  })
  const [error, setError] = useState('')
  const activeRows = rows.filter((row) => row.symbol.trim())
  const equalWeight = activeRows.length ? 100 / activeRows.length : 0
  const total = useMemo(() => rows.reduce((sum, row) => {
    const value = Number(row.weight)
    return sum + (Number.isFinite(value) && value > 0 ? value : 0)
  }, 0), [rows])

  const updateRow = (key: string, patch: Partial<Row>) => {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row))
  }

  const save = () => {
    const symbols = normalizeCardSymbols(rows.map((row) => row.symbol))
    if (!symbols.length) {
      setError('Enter at least one ticker.')
      return
    }
    const rawWeights = Object.fromEntries(rows.map((row) => [row.symbol.trim().toUpperCase(), Number(row.weight)]))
    const weights = weighting === 'custom' ? normalizeCardWeights(symbols, rawWeights) : {}
    if (weighting === 'custom' && !Object.keys(weights).length) {
      setError('Enter at least one positive custom weight.')
      return
    }
    onSave({ name: name.trim() || 'Untitled Card', symbols, weighting, weights })
  }

  return (
    <Modal
      title={card ? 'Edit Card' : 'New Card'}
      width="540px"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="accent" onClick={save}>Save Card</Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-2xs text-text-muted">
          Card name
          <input
            autoFocus
            value={name}
            placeholder="Example: AI Infrastructure"
            onChange={(event) => setName(event.target.value)}
            className="h-8 border border-border-strong bg-bg px-2 text-2xs text-text outline-none focus:border-accent"
          />
        </label>
        <label className="flex items-center gap-2 text-2xs text-text-muted">
          Weighting
          <select
            value={weighting}
            onChange={(event) => setWeighting(event.target.value as CardWeighting)}
            className="ml-auto h-8 min-w-48 border border-border-strong bg-bg px-2 text-2xs text-text outline-none focus:border-accent"
          >
            <option value="equal">Equal Weight</option>
            <option value="custom">Custom Weights</option>
          </select>
        </label>

        <div className="max-h-72 overflow-auto border border-border">
          <div className="grid grid-cols-[1fr_120px_70px] border-b border-border bg-surface-raised px-2 py-1 text-2xs text-text-muted">
            <span>Ticker</span><span>Weight %</span><span />
          </div>
          {rows.map((row) => (
            <div key={row.key} className="grid grid-cols-[1fr_120px_70px] gap-1 border-b border-border px-2 py-1 last:border-b-0">
              <input
                value={row.symbol}
                onChange={(event) => updateRow(row.key, { symbol: event.target.value.toUpperCase() })}
                className="h-8 min-w-0 border border-border-strong bg-bg px-2 text-2xs text-text outline-none focus:border-accent"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={weighting === 'equal' ? (row.symbol.trim() ? equalWeight.toFixed(2) : '0.00') : row.weight}
                disabled={weighting === 'equal'}
                onChange={(event) => updateRow(row.key, { weight: event.target.value })}
                className="num h-8 min-w-0 border border-border-strong bg-bg px-2 text-2xs text-text outline-none focus:border-accent disabled:text-text-dim"
              />
              <Button
                onClick={() => setRows((current) => {
                  const next = current.filter((entry) => entry.key !== row.key)
                  return next.length ? next : [{ key: `new-${Date.now()}`, symbol: '', weight: '0' }]
                })}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setRows((current) => [
            ...current,
            { key: `new-${Date.now()}-${current.length}`, symbol: '', weight: '0' },
          ])}>
            Add Holding
          </Button>
          <span className="ml-auto text-2xs text-text-muted">
            Total: {weighting === 'equal' ? (activeRows.length ? '100.00' : '0.00') : total.toFixed(2)}%
            {weighting === 'custom' ? ' (normalized on save)' : ''}
          </span>
        </div>
        <p className="text-2xs text-text-muted">Custom positive weights are normalized to 100% when saved.</p>
        {error ? <p className="text-2xs text-down">{error}</p> : null}
      </div>
    </Modal>
  )
}
