import type { ReloadProgress } from '@/api/startupScheduler'

export function ReloadButton({ onReload, progress, shortcut, className }: {
  onReload: () => void
  progress: ReloadProgress | null
  shortcut?: string
  className?: string
}) {
  const checkingOtherPages = progress?.phase === 'others'
  const status = checkingOtherPages ? 'Checking other pages' : 'Reloading the current page'
  const action = shortcut ? `Reload (${shortcut})` : 'Refresh page'
  const label = progress ? (checkingOtherPages ? 'Checking…' : 'Reloading…') : action
  const icon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14-5L3 9m0-5v5h5m-4 4a8 8 0 0 0 14 5l3-3m0 5v-5h-5"/></svg>
  const checks = progress && progress.phase !== 'mounted' ? progress : null
  const fraction = checks ? checks.done / checks.total : 0
  const title = checks ? `${status} · ${checks.done} of ${checks.total} checks finished`
    : progress ? status : `${action}: reload the current page first, then check all other pages`

  return <>
    <button type="button" className={`reload-button ${className ?? ''}`} onClick={onReload}
      disabled={Boolean(progress)} aria-busy={Boolean(progress)} title={title}
      aria-label={shortcut && progress ? undefined : action}>
      {/* Desktop: icon plus shortcut while idle, so the top bar stays compact; text only while busy. */}
      {shortcut ? (progress ? <span>{label}</span>
        : <span className="inline-flex items-center justify-center gap-1.5 [&>svg]:size-3.5">{icon}<kbd className="num text-text-muted">{shortcut}</kbd></span>)
        : icon}
      {progress && <span className="reload-button__track" aria-hidden="true">
        <span className="reload-button__fill" data-waiting={fraction === 0 || undefined}
          style={fraction > 0 ? { width: `${fraction * 100}%` } : undefined} />
      </span>}
    </button>
    <span className="sr-only" role="status">{progress ? status : ''}</span>
  </>
}
