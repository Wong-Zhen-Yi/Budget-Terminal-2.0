import { useEffect, type ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
}

/** A centred dialog over a dimmed backdrop. Escape and a backdrop click both close it. */
export function Modal({ title, onClose, children, footer, width = '520px' }: ModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
    >
      <div
        role="dialog"
        aria-label={title}
        aria-modal="true"
        // The backdrop closes on click, so a click inside must not bubble up to it.
        onClick={(event) => event.stopPropagation()}
        style={{ width }}
        className="flex max-h-full min-h-0 flex-col border border-border-strong bg-surface shadow-2xl"
      >
        <header className="flex h-9 shrink-0 items-center border-b border-border bg-surface-raised px-3">
          <h2 className="text-2xs font-semibold tracking-wide text-text uppercase">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="ml-auto px-2 text-text-muted hover:text-text"
          >
            ✕
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
        {footer ? (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-3 py-2">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}
