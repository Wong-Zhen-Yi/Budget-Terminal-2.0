import { useState } from 'react'

import type { Portfolio } from '@shared/contract'
import { MAX_PORTFOLIOS } from '@shared/contract'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

interface ManagePortfoliosDialogProps {
  portfolios: Portfolio[]
  mainId: string | null
  error: string
  onClose: () => void
  onCreate: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onSetMain: (id: string) => void
  onReorder: (order: string[]) => void
}

/** Create, rename, reorder, delete, and choose which portfolio is "main". */
export function ManagePortfoliosDialog({
  portfolios,
  mainId,
  error,
  onClose,
  onCreate,
  onRename,
  onDelete,
  onSetMain,
  onReorder,
}: ManagePortfoliosDialogProps) {
  // The Combined view is derived, so it is not something you can manage.
  const editable = portfolios.filter((portfolio) => !portfolio.readOnly)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)

  const move = (index: number, delta: number) => {
    const next = [...editable]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onReorder(next.map((portfolio) => portfolio.id))
  }

  return (
    <Modal
      title="Manage Portfolios"
      width="680px"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-2xs text-text-dim">
            {editable.length} of {MAX_PORTFOLIOS} used
          </span>
          <Button
            variant="accent"
            onClick={onCreate}
            disabled={editable.length >= MAX_PORTFOLIOS}
            title={
              editable.length >= MAX_PORTFOLIOS
                ? `A maximum of ${MAX_PORTFOLIOS} portfolios is supported`
                : undefined
            }
          >
            + New Portfolio
          </Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      {error ? <p className="mb-2 text-2xs text-down">{error}</p> : null}

      <ul className="flex flex-col gap-1">
        {editable.map((portfolio, index) => {
          const isMain = portfolio.id === mainId
          const positions = portfolio.tickers.length
          return (
            <li
              key={portfolio.id}
              className="flex items-center gap-2 border border-border bg-surface-raised px-2 py-1"
            >
              <div className="flex flex-col">
                <button
                  type="button"
                  aria-label={`Move ${portfolio.name} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className="text-2xs text-text-muted hover:text-text disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  type="button"
                  aria-label={`Move ${portfolio.name} down`}
                  disabled={index === editable.length - 1}
                  onClick={() => move(index, 1)}
                  className="text-2xs text-text-muted hover:text-text disabled:opacity-30"
                >
                  ▼
                </button>
              </div>

              <input
                aria-label={`${portfolio.name} name`}
                defaultValue={portfolio.name}
                onBlur={(event) => {
                  const next = event.target.value.trim()
                  if (next && next !== portfolio.name) onRename(portfolio.id, next)
                  else event.target.value = portfolio.name
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
                className="h-7 min-w-0 flex-1 border border-border-strong bg-surface px-2 text-2xs text-text outline-none focus:border-accent"
              />

              <span className="num w-24 shrink-0 text-right text-2xs whitespace-nowrap text-text-dim">
                {positions} {positions === 1 ? 'position' : 'positions'}
              </span>

              <Button
                variant="toggle"
                active={isMain}
                onClick={() => onSetMain(portfolio.id)}
                title="The main portfolio is what the Dashboard opens on"
              >
                {isMain ? 'Main' : 'Set main'}
              </Button>

              {confirmingDelete === portfolio.id ? (
                <>
                  <Button
                    onClick={() => {
                      onDelete(portfolio.id)
                      setConfirmingDelete(null)
                    }}
                    className="border-down text-down"
                  >
                    Confirm
                  </Button>
                  <Button onClick={() => setConfirmingDelete(null)}>Cancel</Button>
                </>
              ) : (
                <Button
                  onClick={() => setConfirmingDelete(portfolio.id)}
                  disabled={editable.length <= 1}
                  title={
                    editable.length <= 1 ? 'The last portfolio cannot be deleted' : 'Delete'
                  }
                >
                  Delete
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
