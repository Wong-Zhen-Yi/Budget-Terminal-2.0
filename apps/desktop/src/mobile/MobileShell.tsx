import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { browserInputRequest, browserSearchUrl } from '@shared/browserSearch'
import { isSafeExternalUrl } from '../../electron/services/urls'
import { mobileTelegramProfile } from './client'

export function MobileHeader({ label, onOpenPicker, onReload, reloading, onToggleObscure, obscured }: {
  label: string
  onOpenPicker: () => void
  onReload: () => void
  reloading: boolean
  onToggleObscure: () => void
  obscured: boolean
}) {
  return <header className="mobile-topbar">
    <button type="button" className="mobile-page-button" onClick={onOpenPicker} aria-label="Find a page">
      <span aria-hidden="true">☰</span><span>{label}</span>
    </button>
    <div className="mobile-topbar-actions">
      <button type="button" onClick={onToggleObscure} aria-pressed={obscured} aria-label={obscured ? 'Reveal obscured pages' : 'Obscure selected pages'}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.5"/>{obscured && <path d="M4 20 20 4"/>}</svg>
      </button>
      <button type="button" disabled={reloading} onClick={onReload} aria-label="Refresh page">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14-5L3 9m0-5v5h5m-4 4a8 8 0 0 0 14 5l3-3m0 5v-5h-5"/></svg>
      </button>
    </div>
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
  const telegram = useQuery({ queryKey: mobileTelegramKey, queryFn: mobileTelegramProfile, staleTime: 60_000 })
  return <section className="mobile-handoff">
    <h2>Research with the agent</h2>
    {telegram.data ? <a href={`https://t.me/${telegram.data}`} target="_blank" rel="noreferrer">Open Telegram agent</a>
      : <p>{telegram.isPending ? 'Checking Telegram…' : 'To chat from this device, enable incoming Telegram messages under Agents on the computer.'}</p>}
    <p>Manage the desktop agent, trackers, and saved conversations on the computer.</p>
  </section>
}
