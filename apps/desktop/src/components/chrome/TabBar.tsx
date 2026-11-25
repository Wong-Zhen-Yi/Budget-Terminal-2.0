import { useEffect, useState } from 'react'

import { CLOCK_COUNTRIES, DEFAULT_CLOCK_COUNTRY } from '@shared/contract'
import { api } from '@/api/client'
import type { ReloadProgress } from '@/api/startupScheduler'
import { clockTime } from '@/lib/format'
import { McpActivity } from './McpActivity'
import { ReloadButton } from './ReloadButton'
import { TopBarAgent } from './TopBarAgent'

interface TabBarProps {
  onOpenPicker: () => void
  canGoBack?: boolean
  canGoForward?: boolean
  onStepHistory?: (direction: -1 | 1) => void
  onReload: () => void
  reloadProgress: ReloadProgress | null
  clockCountry: string
  time12h: boolean
  obscured: boolean
  obscurePageCount?: number
  onToggleObscure: () => void
  demo?: boolean
  agentChatAvailable?: boolean
}

/** Only the clock re-renders every second, not the whole top bar. */
function TopBarClock({ zone, time12h }: { zone: string; time12h: boolean }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  return (
    <span className="terminal-clock num no-drag shrink-0 whitespace-nowrap px-2 text-2xs text-text-muted">
      {now.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: zone })}
      {'  '}{clockTime(now, zone, time12h)}
    </span>
  )
}

export function TabBar({
  onOpenPicker,
  canGoBack = false,
  canGoForward = false,
  onStepHistory,
  onReload,
  reloadProgress,
  clockCountry,
  time12h,
  obscured,
  obscurePageCount,
  onToggleObscure,
  demo,
  agentChatAvailable = true,
}: TabBarProps) {
  const isMac = api.platform === 'darwin'
  const zone =
    CLOCK_COUNTRIES.find((entry) => entry.code === clockCountry)?.zone ??
    CLOCK_COUNTRIES.find((entry) => entry.code === DEFAULT_CLOCK_COUNTRY)!.zone
  return (
    <div className={`terminal-topbar drag-region flex shrink-0 items-center gap-2 border-b border-border bg-surface ${isMac ? 'h-[52px] rounded-t-xl pr-3 pl-[86px]' : 'h-12 pr-0 pl-2'}`}>
      <span className="terminal-brand shrink-0" title="Budget Terminal">
        <img src="./budget-terminal-fold.png" alt="Budget Terminal" width="2048" height="745" draggable={false} />
      </span>
      <img className="terminal-brand-icon" src="./budget-terminal-icon.png" alt="Budget Terminal" width="36" height="36" draggable={false} />
      {demo && <span className="shrink-0 whitespace-nowrap text-2xs text-warn">Demo data</span>}
      <McpActivity />
      <TopBarAgent available={agentChatAvailable} />
      {onStepHistory ? <HistoryButtons isMac={isMac} canGoBack={canGoBack} canGoForward={canGoForward} onStep={onStepHistory} /> : null}
      <button type="button" onClick={onOpenPicker}
        className={`terminal-page-picker no-drag flex shrink-0 items-center gap-4 border border-border-strong px-3 py-2 text-2xs text-text-muted hover:bg-surface-hover ${isMac ? 'rounded-lg bg-surface-raised' : 'rounded'}`}>
        Find a page <kbd className="terminal-picker-hint num">{isMac ? '⌘ K' : 'Ctrl K'}</kbd>
      </button>

      <TopBarClock zone={zone} time12h={time12h} />

      <button
        type="button"
        onClick={onToggleObscure}
        title={`Toggle Obscure mode (${isMac ? '⌘⇧H' : 'Ctrl+Shift+H'}). Choose pages in Settings → Privacy.`}
        aria-label="Obscure mode"
        aria-pressed={obscured}
        className={`no-drag flex h-9 shrink-0 items-center gap-1.5 rounded border px-2 text-2xs focus-visible:outline-2 focus-visible:outline-accent-hover ${
          obscured
            ? 'border-accent bg-accent-dim text-text'
            : 'border-border-strong bg-surface-raised text-text hover:bg-surface-hover'
        }`}
      >
        <span>Obscure:</span>
        <span aria-hidden="true" className={obscured ? 'text-text' : 'text-text-muted'}>
          {!obscured ? 'off' : obscurePageCount === 0 ? 'on · 0 pages' : 'on'}
        </span>
      </button>

      <ReloadButton onReload={onReload} progress={reloadProgress} shortcut={isMac ? '⌘ R' : 'F5'}
        className={`no-drag h-9 w-20 shrink-0 whitespace-nowrap border border-border-strong bg-surface-raised text-2xs text-text enabled:hover:bg-surface-hover ${isMac ? 'rounded-lg' : ''}`} />

      {!isMac ? <WindowControls /> : null}
    </div>
  )
}

function HistoryButtons({ isMac, canGoBack, canGoForward, onStep }: {
  isMac: boolean
  canGoBack: boolean
  canGoForward: boolean
  onStep: (direction: -1 | 1) => void
}) {
  const button = `no-drag flex h-9 w-8 items-center justify-center border border-border-strong bg-surface-raised text-xs text-text-muted enabled:hover:bg-surface-hover enabled:hover:text-text disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent-hover ${isMac ? 'rounded-lg' : 'rounded'}`
  return (
    <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Page history">
      <button type="button" className={button} disabled={!canGoBack} onClick={() => onStep(-1)}
        aria-label="Back" title={`Back (${isMac ? '⌘[' : 'Alt+←'})`}>←</button>
      <button type="button" className={button} disabled={!canGoForward} onClick={() => onStep(1)}
        aria-label="Forward" title={`Forward (${isMac ? '⌘]' : 'Alt+→'})`}>→</button>
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
