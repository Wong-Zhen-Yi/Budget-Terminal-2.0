import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

const EXAMPLE = 'AAPL, MSFT, NVDA'

/**
 * Split an entry box into tickers. Commas are what the dialog advertises, but a pasted
 * column or a space-separated list parses the same way, and duplicates collapse.
 */
export function parseTickers(raw: string): string[] {
  const seen = new Set<string>()
  const tickers: string[] = []
  for (const part of raw.split(/[\s,;]+/)) {
    const ticker = part.trim().toUpperCase()
    if (!ticker || seen.has(ticker)) continue
    seen.add(ticker)
    tickers.push(ticker)
  }
  return tickers
}

interface AddPositionsDialogProps {
  /** Tickers already in the portfolio, so the preview can mark them as skipped. */
  existing: string[]
  onClose: () => void
  /** Adds the tickers and answers with one message per ticker that was refused. */
  onSubmit: (tickers: string[]) => Promise<string[]>
}

/** Adds a comma-separated list of tickers in one pass, previewing what will happen. */
export function AddPositionsDialog({ existing, onClose, onSubmit }: AddPositionsDialogProps) {
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [failures, setFailures] = useState<string[]>([])

  const held = useMemo(() => new Set(existing.map((ticker) => ticker.toUpperCase())), [existing])
  const parsed = useMemo(() => parseTickers(raw), [raw])
  const fresh = useMemo(() => parsed.filter((ticker) => !held.has(ticker)), [parsed, held])

  const submit = async () => {
    if (!fresh.length || busy) return
    setBusy(true)
    try {
      const refused = await onSubmit(fresh)
      setFailures(refused)
      if (!refused.length) onClose()
      else setRaw(refused.map((entry) => entry.split(':')[0]).join(', '))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Add Positions"
      width="560px"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-2xs text-text-dim">
            {parsed.length === 0
              ? 'Nothing to add yet'
              : `${fresh.length} to add${
                  parsed.length - fresh.length > 0
                    ? ` · ${parsed.length - fresh.length} already held`
                    : ''
                }`}
          </span>
          <Button variant="accent" onClick={() => void submit()} disabled={!fresh.length || busy}>
            {busy ? 'Adding...' : fresh.length > 1 ? `Add ${fresh.length} Positions` : 'Add Position'}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <label htmlFor="add-positions-input" className="text-2xs text-text-muted">
        Separate tickers with a comma. For example: <span className="text-text">{EXAMPLE}</span>
      </label>
      <textarea
        id="add-positions-input"
        // The dialog exists to be typed into, so it takes focus the moment it opens.
        autoFocus
        rows={3}
        spellCheck={false}
        placeholder={EXAMPLE}
        value={raw}
        onChange={(event) => setRaw(event.target.value)}
        onKeyDown={(event) => {
          // Enter submits; Shift+Enter keeps the newline for a pasted column.
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void submit()
          }
        }}
        className="mt-1 w-full resize-none border border-border-strong bg-surface px-2 py-1 text-2xs text-text uppercase outline-none focus:border-accent"
      />

      {parsed.length ? (
        <ul className="mt-2 flex flex-wrap gap-1">
          {parsed.map((ticker) => {
            const duplicate = held.has(ticker)
            return (
              <li
                key={ticker}
                title={duplicate ? 'Already in this portfolio — it will be skipped' : undefined}
                className={`num border px-1.5 py-0.5 text-2xs ${
                  duplicate
                    ? 'border-border bg-surface-raised text-text-dim line-through'
                    : 'border-accent bg-accent-dim text-text'
                }`}
              >
                {ticker}
              </li>
            )
          })}
        </ul>
      ) : null}

      {failures.length ? (
        <ul className="mt-2 flex flex-col gap-0.5">
          {failures.map((failure) => (
            <li key={failure} className="text-2xs text-down">
              {failure}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-2 text-2xs text-text-dim">
        Each ticker lands with zero shares. Fill in shares and average price in the table.
      </p>
    </Modal>
  )
}
