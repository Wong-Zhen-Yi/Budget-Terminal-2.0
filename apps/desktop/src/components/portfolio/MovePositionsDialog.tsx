import { useState } from 'react'

import type { Portfolio } from '@shared/contract'
import type { PositionRow } from '@shared/portfolioMath'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { PrivateNumber } from '@/components/ui/NumberPrivacy'
import { currency, decimals } from '@/lib/format'

interface MovePositionsDialogProps {
  source: Portfolio
  portfolios: Portfolio[]
  rows: PositionRow[]
  onClose: () => void
  onSubmit: (destinationId: string, tickers: string[]) => Promise<string>
}

export function MovePositionsDialog({ source, portfolios, rows, onClose, onSubmit }: MovePositionsDialogProps) {
  const destinations = portfolios.filter((portfolio) => portfolio.id !== source.id && !portfolio.readOnly)
  const [destinationId, setDestinationId] = useState(destinations[0]?.id ?? '')
  const [picked, setPicked] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const destination = destinations.find((portfolio) => portfolio.id === destinationId)
  const eligible = rows.filter((row) => !destination?.tickers.includes(row.ticker))
  const valid = Boolean(destination && picked.length && picked.every((ticker) => eligible.some((row) => row.ticker === ticker)))
  const close = () => { if (!busy) onClose() }
  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    setError('')
    try {
      const failure = await onSubmit(destinationId, picked)
      if (failure) { setError(failure); setConfirming(false) }
      else onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not move positions. Please retry.')
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Move Positions" width="600px" onClose={close} footer={
      <>
        <Button variant="accent" disabled={!valid || busy} onClick={() => confirming ? void submit() : setConfirming(true)}>
          {busy ? 'Moving...' : confirming ? `Confirm moving ${picked.length}` : `Move ${picked.length || ''}`}
        </Button>
        <Button disabled={busy} onClick={close}>Cancel</Button>
      </>
    }>
      <p className="mb-3 text-2xs text-text-muted">Move entire stock positions from {source.name}, keeping shares, average prices and weight settings. Cash, margin and options stay in this portfolio.</p>
      {destinations.length ? <>
        <label className="mb-3 flex items-center gap-2 text-2xs text-text">
          Destination portfolio
          <select aria-label="Destination portfolio" disabled={busy} value={destinationId} onChange={(event) => {
            setDestinationId(event.target.value); setPicked([]); setConfirming(false); setError('')
          }} className="h-8 flex-1 border border-border-strong bg-surface-raised px-2">
            {destinations.map((portfolio) => <option key={portfolio.id} value={portfolio.id}>{portfolio.name}</option>)}
          </select>
        </label>
        <p className="mb-2 text-2xs text-text-dim">Tickers already in the destination are unavailable to prevent overwriting existing holdings.</p>
        <Button disabled={busy || !eligible.length} onClick={() => {
          setPicked(picked.length === eligible.length ? [] : eligible.map((row) => row.ticker)); setConfirming(false)
        }}>{picked.length && picked.length === eligible.length ? 'Clear all' : 'Select all available'}</Button>
        <ul className="mt-2 flex flex-col gap-1">
          {rows.map((row) => {
            const exists = destination?.tickers.includes(row.ticker)
            return <li key={row.ticker}>
              <label className="flex items-center gap-2 border border-border bg-surface-raised px-2 py-2 text-2xs">
                <input type="checkbox" aria-label={`Move ${row.ticker}`} disabled={busy || exists} checked={picked.includes(row.ticker)} onChange={() => {
                  setPicked((current) => current.includes(row.ticker) ? current.filter((ticker) => ticker !== row.ticker) : [...current, row.ticker]); setConfirming(false)
                }} className="accent-accent" />
                <span className="w-20 text-text">{row.ticker}</span>
                {exists ? <span className="text-text-dim">Already in destination</span> : <span className="ml-auto text-text-muted"><PrivateNumber>{decimals(row.shares, 4)}</PrivateNumber> shares at <PrivateNumber>{currency(row.avgPrice)}</PrivateNumber> average</span>}
              </label>
            </li>
          })}
        </ul>
        {confirming ? <p role="status" className="mt-3 text-2xs text-text">Move {picked.join(', ')} from {source.name} to {destination?.name}? These positions will leave {source.name}.</p> : null}
      </> : <p className="text-2xs text-text-muted">Create another portfolio using Manage Portfolios, then return here to move positions.</p>}
      {error ? <p role="alert" className="mt-3 text-2xs text-down">{error}</p> : null}
    </Modal>
  )
}
