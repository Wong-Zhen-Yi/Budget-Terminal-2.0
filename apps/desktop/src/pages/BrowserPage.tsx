import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { BrowserControl, BrowserPageContent } from '@shared/browser'
import { browserInputRequest } from '@shared/browserSearch'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { api } from '@/api/client'
import { browserKey, useBrowser } from '@/api/browserQueries'
import '@/styles/browser.css'

const sources = [
  { title: 'SEC EDGAR', caption: 'Company filings & disclosures', url: 'https://www.sec.gov/edgar/search/' },
  { title: 'Yahoo Finance', caption: 'Markets, companies & headlines', url: 'https://finance.yahoo.com/' },
  { title: 'Federal Reserve', caption: 'Policy, releases & economic research', url: 'https://www.federalreserve.gov/' },
]

export function BrowserPage({ active, onStatusChange }: { active: boolean; onStatusChange: (panels: PanelStatus[], path: string) => void }) {
  const query = useBrowser(active)
  const client = useQueryClient()
  const state = query.data?.data
  const tab = state?.tabs.find(tab => tab.id === state.activeTabId)
  const [address, setAddress] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [reader, setReader] = useState<BrowserPageContent | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const blank = !tab?.url || tab.url === 'about:blank'

  useEffect(() => { setAddress(blank ? '' : tab?.url ?? ''); setReader(null) }, [tab?.id, tab?.url, blank])
  useEffect(() => {
    onStatusChange([{ label: 'Browser', envelope: query.data, loading: query.isPending, error: query.error ?? (error || tab?.error || undefined) }], 'Isolated Chromium profile · public websites only')
  }, [onStatusChange, query.data, query.isPending, query.error, error, tab?.error])

  // Native WebContentsViews sit above DOM content. Keep the bounds in sync and move
  // out of the way of privacy screens, page pickers and the top-bar Agent dropdown.
  useLayoutEffect(() => {
    if (!active) return
    let disposed = false
    let previous = ''
    const update = () => {
      if (disposed || !viewport.current) return
      const rect = viewport.current.getBoundingClientRect()
      let width = rect.width
      let visible = !blank && rect.width > 0 && rect.height > 0
      for (const dialog of document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"]')) {
        if (!dialog.getClientRects().length) continue
        const bounds = dialog.getBoundingClientRect()
        if (bounds.left < rect.right && bounds.right > rect.left && bounds.top < rect.bottom && bounds.bottom > rect.top) {
          if (dialog.id === 'topbar-agent-chat' && bounds.left - rect.left > 320) width = Math.min(width, bounds.left - rect.left - 12)
          else visible = false
        }
      }
      const next = { visible, x: rect.x, y: rect.y, width, height: rect.height }
      const signature = JSON.stringify(next)
      if (signature === previous) return
      previous = signature
      void api.browserViewport(next).catch(reason => setError(String(reason)))
    }
    const resize = new ResizeObserver(update)
    if (viewport.current) resize.observe(viewport.current)
    const overlays = new MutationObserver(update)
    overlays.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'style', 'aria-expanded'] })
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    update()
    return () => {
      disposed = true
      resize.disconnect()
      overlays.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      void api.browserViewport({ visible: false, x: 0, y: 0, width: 0, height: 0 }).catch(() => {})
    }
  }, [active, blank, tab?.id, reader])

  const control = async (request: BrowserControl) => {
    const interrupt = request.action === 'stop' || request.action === 'agentAccess'
    if (!interrupt) setPending(true)
    setError('')
    try {
      const result = await api.browserControl(request)
      await client.cancelQueries({ queryKey: browserKey })
      client.setQueryData(browserKey, { ...result, data: result.data.state })
      if (result.data.page) setReader(result.data.page)
      if (result.errors.length) setError(result.errors.map(error => error.reason).join(' · '))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (!interrupt) setPending(false) }
  }

  return <section className="browser-page" aria-label="Browser">
    <header className="browser-heading">
      <div><span className="browser-eyebrow">RESEARCH WORKSPACE</span><h1>Browser <span>Chromium</span></h1></div>
      <div className="browser-access">
        <span className={state?.agentEnabled ? 'browser-agent-on' : ''}>{state?.agentEnabled ? 'Agent access on' : 'Agent access off'}</span>
        <button type="button" role="switch" aria-label="Agent browser access" aria-checked={state?.agentEnabled ?? false} disabled={!state}
          onClick={() => void control({ action: 'agentAccess', enabled: !state?.agentEnabled })}>{state?.agentEnabled ? 'Disable' : 'Enable agent'}</button>
        <button type="button" className="browser-stop" onClick={() => void control({ action: 'stop' })}>Stop</button>
      </div>
    </header>
    <div className="browser-tabs" role="tablist" aria-label="Browser tabs">
      {state?.tabs.map(item => <div key={item.id} className={`browser-tab ${item.id === tab?.id ? 'is-active' : ''}`}>
        <button type="button" role="tab" aria-selected={item.id === tab?.id} title={item.url} disabled={pending} onClick={() => void control({ action: 'select', tabId: item.id })}>
          {item.loading ? '◌ ' : '◉ '}{item.title || 'New tab'}
        </button>
        <button type="button" aria-label={`Close ${item.title || 'New tab'}`} disabled={pending} onClick={() => void control({ action: 'close', tabId: item.id })}>×</button>
      </div>)}
      <button type="button" aria-label="New browser tab" disabled={pending || !state || state.tabs.length >= 8} onClick={() => void control({ action: 'open' })}>＋</button>
    </div>
    <form className="browser-toolbar" onSubmit={event => { event.preventDefault(); if (!pending && address.trim()) void control(browserInputRequest(address)) }}>
      <button type="button" aria-label="Back" disabled={pending || !tab?.canGoBack} onClick={() => void control({ action: 'back' })}>←</button>
      <button type="button" aria-label="Forward" disabled={pending || !tab?.canGoForward} onClick={() => void control({ action: 'forward' })}>→</button>
      <button type="button" aria-label="Reload page" disabled={pending || blank} onClick={() => void control({ action: 'reload' })}>↻</button>
      <label className="browser-address"><span aria-hidden="true">{tab?.url.startsWith('https:') ? '◇' : '◎'}</span><input aria-label="Website address or search" placeholder="Search DuckDuckGo or enter a website URL…" value={address} onChange={event => setAddress(event.target.value)} maxLength={4096} spellCheck={false} autoComplete="off" /></label>
      <button type="submit" disabled={pending || !address.trim() || !state}>Go</button>
      <button type="button" disabled={pending || blank || tab?.loading} onClick={() => reader ? setReader(null) : void control({ action: 'read' })}>{reader ? 'Close reader' : 'Read page'}</button>
    </form>
    <div className="browser-activity" role="status" aria-live="polite"><span className={tab?.loading || pending ? 'is-working' : ''}>●</span>{pending || tab?.loading ? 'Loading · ' : ''}{state?.activity ?? 'Starting Chromium…'}<span className="browser-activity-note">Shared with your agent · no downloads or device permissions</span></div>
    {(error || tab?.error || query.error || query.data?.meta.freshness === 'failed') && <div className="browser-error" role="alert">{error || tab?.error || String(query.error || query.data?.meta.failureReason)} <button type="button" onClick={() => void query.refetch()}>Retry status</button></div>}
    <div className="browser-content">
      <div ref={viewport} className="browser-viewport" aria-label="Website content">
        {blank ? <div className="browser-start">
          <div className="browser-globe" aria-hidden="true">◎</div>
          <span className="browser-eyebrow">YOUR RESEARCH, IN ONE PLACE</span>
          <h2>Explore the source.</h2>
          <p>Search for websites, filings and market news from the address bar, or enter a URL directly. You and your agent use the same tabs, so the evidence stays in view.</p>
          <div className="browser-sources">{sources.map(source => <button key={source.title} type="button" disabled={pending || !state} onClick={() => void control({ action: 'navigate', url: source.url })}><strong>{source.title} ↗</strong><span>{source.caption}</span></button>)}</div>
          <div className="browser-safety"><strong>You stay in control.</strong> Login data stays in a local browser profile outside the repository. Agent access starts on, so you can ask the agent to research a public website right away. Use Disable to turn access off. Stop cancels loading and revokes access. Handle logins and CAPTCHAs yourself; the agent cannot fill forms or execute transactions.</div>
        </div> : <div className="browser-placeholder">{active ? 'Website is displayed in the Chromium view. Close overlapping dialogs to reveal it.' : 'Browser session kept ready.'}</div>}
      </div>
      {reader && <aside className="browser-reader" aria-label="Page reader"><div><h2>{reader.title || 'Page text'}</h2><button onClick={() => setReader(null)} aria-label="Close page reader">×</button></div><p>{reader.url}</p><small>Read {new Date(reader.readAt).toLocaleTimeString()}{reader.truncated ? ' · text truncated' : ''} · untrusted source content</small><pre>{reader.text || 'No readable text. This may be a login, CAPTCHA or image-only page.'}</pre></aside>}
    </div>
  </section>
}
