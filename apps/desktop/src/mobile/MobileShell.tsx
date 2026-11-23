import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { browserInputRequest, browserSearchUrl } from '@shared/browserSearch'
import { isSafeExternalUrl } from '../../electron/services/urls'
import type { ReloadProgress } from '@/api/startupScheduler'
import { ReloadButton } from '@/components/chrome/ReloadButton'
import { mobileTelegramProfile } from './client'

export function MobileHeader({ label, navigationOpen, onToggleNavigation, onReload, reloadProgress, onToggleObscure, obscured, favorite, onToggleFavorite, savingFavorite }: {
  label: string
  navigationOpen: boolean
  onToggleNavigation: () => void
  onReload: () => void
  reloadProgress: ReloadProgress | null
  onToggleObscure: () => void
  obscured: boolean
  favorite: boolean
  onToggleFavorite?: () => void
  savingFavorite: boolean
}) {
  const pageButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!navigationOpen) return
    const button = pageButton.current
    return () => button?.focus({ preventScroll: true })
  }, [navigationOpen])

  return <header className="mobile-topbar">
    <h1>
      <button ref={pageButton} type="button" className="mobile-page-button" onClick={onToggleNavigation}
        aria-label={navigationOpen ? `Back to ${label}` : `${label}, browse workspaces`}
        aria-expanded={navigationOpen} aria-controls={navigationOpen ? 'mobile-navigation' : undefined}>
        {navigationOpen && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M20 12H5m7-7-7 7 7 7"/></svg>}
        <span>{label}</span>
        {!navigationOpen && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>}
      </button>
    </h1>
    {!navigationOpen && <div className="mobile-topbar-actions">
      {onToggleFavorite && <button type="button" onClick={onToggleFavorite} disabled={savingFavorite} aria-pressed={favorite} aria-label={favorite ? 'Remove page from favorites' : 'Add page to favorites'}>
        <svg viewBox="0 0 24 24" fill={favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9Z"/></svg>
      </button>}
      <button type="button" onClick={onToggleObscure} aria-pressed={obscured} aria-label={obscured ? 'Reveal obscured pages' : 'Obscure selected pages'}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.5"/>{obscured && <path d="M4 20 20 4"/>}</svg>
      </button>
      <ReloadButton onReload={onReload} progress={reloadProgress} />
    </div>}
  </header>
}

export function MobileBrowserPage() {
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')
  const open = (event: FormEvent) => {
    event.preventDefault()
    try {
      const request = browserInputRequest(address)
      const url = request.action === 'search' ? browserSearchUrl(request.query) : request.action === 'navigate' ? request.url : ''
      if (!isSafeExternalUrl(url)) throw new Error('Enter an HTTP or HTTPS address.')
      setError('')
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Enter an address or a search.') }
  }
  return <section className="mobile-handoff">
    <h2>Browse on this device</h2>
    <form onSubmit={open}>
      <label htmlFor="mobile-browser-address">Website or search</label>
      <div className="mobile-browser-field">
        <input id="mobile-browser-address" value={address} onChange={event => setAddress(event.target.value)} maxLength={4096} autoCapitalize="off" autoCorrect="off" />
        <button type="submit">Open</button>
      </div>
    </form>
    {error && <p role="alert">{error}</p>}
    <nav aria-label="Research sites">
      <a href="https://www.sec.gov/edgar/search/" target="_blank" rel="noreferrer">SEC EDGAR</a>
      <a href="https://finance.yahoo.com/" target="_blank" rel="noreferrer">Yahoo Finance</a>
      <a href="https://www.federalreserve.gov/" target="_blank" rel="noreferrer">Federal Reserve</a>
    </nav>
    <p>The desktop Chromium session and its signed-in tabs stay on the computer.</p>
  </section>
}

export const mobileTelegramKey = ['mobileTelegram'] as const
export function MobileAgentsPage() {
  const heading = useId()
  const telegram = useQuery({ queryKey: mobileTelegramKey, queryFn: mobileTelegramProfile, staleTime: 60_000 })
  return <section className="mobile-agent-chat" aria-labelledby={heading}>
    <header>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 4h16v12H9l-5 4V4Z"/><path d="M8 9h8m-8 3h5"/>
      </svg>
      <h2 id={heading}>Agent Chat</h2>
    </header>
    {telegram.data ? <>
      <p>Ask a research question or continue your private Telegram conversation.</p>
      <a href={`https://t.me/${telegram.data}`} target="_blank" rel="noreferrer">
        Open Telegram
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M7 17 17 7M7 7h10v10"/>
        </svg>
      </a>
    </> : telegram.isPending ? <p role="status">Checking Telegram availability…</p>
      : telegram.isError ? <>
        <p role="status">Couldn’t check Telegram. Keep Budget Terminal open on your computer and try again.</p>
        <button type="button" disabled={telegram.isFetching} onClick={() => void telegram.refetch()}>
          {telegram.isFetching ? 'Checking…' : 'Try again'}
        </button>
      </> : <p>On your computer, go to <strong>Agents → Telegram</strong> and enable <strong>Receive research questions from Telegram</strong>.</p>}
  </section>
}
