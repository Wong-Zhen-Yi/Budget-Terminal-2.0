import { useEffect, useState } from 'react'

import { CLOCK_COUNTRIES, DEFAULT_CLOCK_COUNTRY } from '@shared/contract'
import { api } from '@/api/client'
import { clockTime } from '@/lib/format'
import { McpActivity } from './McpActivity'
import { BrowserConnection } from './BrowserConnection'
import { RemoteConnection } from './RemoteConnection'
import { isBrowser } from '@/api/browser'

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
  const isMac = api.platform === 'darwin'
  const zone =
    CLOCK_COUNTRIES.find((entry) => entry.code === clockCountry)?.zone ??
    CLOCK_COUNTRIES.find((entry) => entry.code === DEFAULT_CLOCK_COUNTRY)!.zone
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className={`terminal-topbar drag-region flex shrink-0 items-center gap-2 border-b border-border bg-surface ${isMac ? 'h-[52px] rounded-t-xl pr-3 pl-[86px]' : 'h-12 pr-0 pl-2'}`}>
      <span className="shrink-0 pr-1 text-2xs font-semibold tracking-widest text-accent-hover">
        BT
      </span>

      <span className={`terminal-brand min-w-0 truncate text-2xs tracking-wide text-text-muted ${isMac ? 'px-1' : 'px-2'}`}>BUDGET TERMINAL</span>
      {isBrowser ? <BrowserConnection /> : <McpActivity />}
      {!isBrowser ? <RemoteConnection /> : null}
      <div className="min-w-0 flex-1" />
      <button type="button" onClick={onOpenPicker}
        className={`no-drag flex items-center gap-4 border border-border-strong px-3 py-2 text-2xs text-text-muted hover:bg-surface-hover ${isMac ? 'rounded-lg bg-surface-raised' : 'rounded'}`}>
        Find a page {!isBrowser ? <kbd className="num">{isMac ? '⌘ K' : 'Ctrl K'}</kbd> : null}
      </button>

      <span className="terminal-clock num no-drag shrink-0 whitespace-nowrap px-2 text-2xs text-text-muted">
        {now.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: zone })}
        {'  '}{clockTime(now, zone, time12h)}
      </span>

      <button
        type="button"
        onClick={onToggleObscure}
        title={`Obscure the pages selected in Settings (${isMac ? '⌘⇧H' : 'Ctrl+Shift+H'})`}
        aria-pressed={obscured}
        className={`no-drag h-9 shrink-0 border px-3 text-2xs ${isMac ? 'rounded-lg' : ''} ${
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
        className={`no-drag h-9 shrink-0 border border-border-strong bg-surface-raised px-3 text-2xs text-text hover:bg-surface-hover disabled:opacity-50 ${isMac ? 'rounded-lg' : ''}`}
      >
        {reloading ? 'Reloading...' : isBrowser ? 'Refresh' : `Reload (${isMac ? '⌘ R' : 'F5'})`}
      </button>

      {!isMac && !isBrowser ? <WindowControls /> : null}
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
