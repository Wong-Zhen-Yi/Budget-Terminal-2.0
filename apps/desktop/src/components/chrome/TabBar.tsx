import { useEffect, useState } from 'react'

import { CLOCK_COUNTRIES, DEFAULT_CLOCK_COUNTRY } from '@shared/contract'
import { api } from '@/api/client'
import { clockTime } from '@/lib/format'

interface TabBarProps {
  onOpenPicker: () => void
  onReload: () => void
  reloading: boolean
  clockCountry: string
  time12h: boolean
  obscured: boolean
  onToggleObscure: () => void
}

export function TabBar({
  onOpenPicker,
  onReload,
  reloading,
  clockCountry,
  time12h,
  obscured,
  onToggleObscure,
}: TabBarProps) {
  const zone =
    CLOCK_COUNTRIES.find((entry) => entry.code === clockCountry)?.zone ??
    CLOCK_COUNTRIES.find((entry) => entry.code === DEFAULT_CLOCK_COUNTRY)!.zone
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="drag-region flex h-12 shrink-0 items-center gap-1 border-b border-border bg-surface pr-0 pl-2">
      <span className="shrink-0 pr-1 text-2xs font-semibold tracking-widest text-accent-hover">
        BT
      </span>

      <span className="min-w-0 flex-1 truncate px-2 text-2xs tracking-wide text-text-muted">BUDGET TERMINAL</span>
      <button type="button" onClick={onOpenPicker}
        className="no-drag flex items-center gap-8 rounded border border-border-strong px-3 py-2 text-2xs text-text-muted hover:bg-surface-hover">
        Find a page <kbd className="num">Ctrl K</kbd>
      </button>

      <span className="num no-drag px-2 text-2xs text-text-muted">
        {clockTime(now, zone, time12h)}
      </span>

      <button
        type="button"
        onClick={onToggleObscure}
        title="Obscure the pages selected in Settings (Ctrl+Shift+H)"
        aria-pressed={obscured}
        className={`no-drag h-9 shrink-0 border px-3 text-2xs ${
          obscured
            ? 'border-accent bg-accent-dim text-text'
            : 'border-border-strong bg-surface-raised text-text hover:bg-surface-hover'
        }`}
      >
        {obscured ? 'Reveal' : 'Obscure'}
      </button>

      <button
        type="button"
        onClick={onReload}
        disabled={reloading}
        className="no-drag h-9 shrink-0 border border-border-strong bg-surface-raised px-3 text-2xs text-text hover:bg-surface-hover disabled:opacity-50"
      >
        {reloading ? 'Reloading...' : 'Reload (F5)'}
      </button>

      <WindowControls />
    </div>
  )
}

function WindowControls() {
  return (
    <div className="no-drag flex shrink-0 items-center">
      {(
        [
          ['minimize', '─'],
          ['maximize', '□'],
          ['close', '✕'],
        ] as const
      ).map(([action, glyph]) => (
        <button
          key={action}
          type="button"
          aria-label={action}
          onClick={() => void api.windowControl(action)}
          className={`h-12 w-12 text-xs text-text-muted transition-colors ${
            action === 'close' ? 'hover:bg-down hover:text-white' : 'hover:bg-surface-hover'
          }`}
        >
          {glyph}
        </button>
      ))}
    </div>
  )
}
