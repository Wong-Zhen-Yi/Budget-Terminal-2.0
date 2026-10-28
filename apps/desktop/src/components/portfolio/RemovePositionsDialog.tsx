import { useMemo, useState } from 'react'

import type { PositionRow } from '@shared/portfolioMath'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { PrivateNumber } from '@/components/ui/NumberPrivacy'
import { currency, decimals } from '@/lib/format'

interface RemovePositionsDialogProps {
  rows: PositionRow[]
  onClose: () => void
  /** Removes the tickers and answers with one message per ticker that was refused. */
  onSubmit: (tickers: string[]) => Promise<string[]>
}

/** Removes one or many positions at once, with the shares held shown before you confirm. */
export function RemovePositionsDialog({ rows, onClose, onSubmit }: RemovePositionsDialogProps) {
  const [picked, setPicked] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failures, setFailures] = useState<string[]>([])

  const chosen = useMemo(() => new Set(picked), [picked])
  const allPicked = rows.length > 0 && picked.length === rows.length

  const toggle = (ticker: string) => {
    setConfirming(false)
    setPicked((current) =>
      current.includes(ticker)
        ? current.filter((value) => value !== ticker)
        : [...current, ticker],
    )
  }

  const submit = async () => {
    if (!picked.length || busy) return
    setBusy(true)
    try {
      const refused = await onSubmit(picked)
      setFailures(refused)
      if (!refused.length) onClose()
      else {
        setPicked(refused.map((entry) => entry.split(':')[0]))
        setConfirming(false)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Remove Positions"
      width="560px"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-2xs text-text-dim">
            {picked.length ? `${picked.length} selected` : 'Select the positions to remove'}
          </span>
          {confirming ? (
            <Button
              onClick={() => void submit()}
              disabled={busy}
              className="border-down text-down"
            >
              {busy ? 'Removing...' : `Confirm removing ${picked.length}`}
            </Button>
          ) : (
            <Button
              variant="danger"
              onClick={() => setConfirming(true)}
              disabled={!picked.length}
            >
              Remove {picked.length || ''}
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      {rows.length ? (
        <>
          <div className="mb-2 flex items-center gap-2">
            <Button
              variant="toggle"
              active={allPicked}
              onClick={() => {
                setConfirming(false)
                setPicked(allPicked ? [] : rows.map((row) => row.ticker))
              }}
            >
              {allPicked ? 'Clear all' : 'Select all'}
            </Button>
            <span className="text-2xs text-text-dim">
              Removing a position drops its shares and average price too.
            </span>
          </div>

          <ul className="flex flex-col gap-1">
            {rows.map((row) => (
              <li key={row.ticker}>
                <label className="flex cursor-pointer items-center gap-2 border border-border bg-surface-raised px-2 py-1 hover:border-accent-dim">
                  <input
                    type="checkbox"
                    checked={chosen.has(row.ticker)}
                    onChange={() => toggle(row.ticker)}
                    className="accent-accent"
                  />
                  <span className="num w-20 shrink-0 text-2xs text-text">{row.ticker}</span>
                  <span className="num flex-1 text-right text-2xs text-text-muted">
                    <PrivateNumber>{decimals(row.shares, row.shares % 1 === 0 ? 0 : 4)}</PrivateNumber> sh
                  </span>
                  <span className="num w-28 shrink-0 text-right text-2xs text-text-muted">
                    <PrivateNumber>{currency(row.marketValue)}</PrivateNumber>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-2xs text-text-dim">This portfolio has no positions to remove.</p>
      )}

      {failures.length ? (
        <ul className="mt-2 flex flex-col gap-0.5">
          {failures.map((failure) => (
            <li key={failure} className="text-2xs text-down">
              {failure}
            </li>
          ))}
        </ul>
      ) : null}
    </Modal>
  )
}
