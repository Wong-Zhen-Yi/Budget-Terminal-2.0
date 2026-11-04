import { useEffect, useState } from 'react'
import { MARKET_API_PROVIDERS } from '@shared/marketApiKeys'
import type { MarketApiKeyMutation, MarketApiKeyStatus, MarketApiProvider } from '@shared/marketApiKeys'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'

export function MarketApiKeysPanel() {
  const [status, setStatus] = useState<MarketApiKeyStatus | null>(null)
  const [drafts, setDrafts] = useState({ alltick: '', finnhub: '', fmp: '' })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)

  const load = async () => {
    setBusy(true)
    try {
      const result = await window.api.marketApiKeys()
      setStatus(result.meta.failureReason ? null : result.data)
      setMessage(result.meta.failureReason ?? '')
      setError(Boolean(result.meta.failureReason))
    } catch { setError(true); setMessage('Unable to read API key settings. Try again.') }
    finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [])

  const update = async (request: MarketApiKeyMutation) => {
    setBusy(true)
    try {
      const result = await window.api.mutateMarketApiKeys(request)
      setError(Boolean(result.meta.failureReason))
      setMessage(result.meta.failureReason ?? (request.type === 'save' ? 'Key saved. Provider remains inactive.' : 'Key removed.'))
      if (!result.meta.failureReason) {
        setStatus(result.data)
        setDrafts(previous => ({ ...previous, [request.provider]: '' }))
      }
    } catch { setError(true); setMessage('Unable to update API key. Try again.') }
    finally { setBusy(false) }
  }

  return <Panel title="Market data API keys">
    <div className="flex flex-col gap-3 p-2">
      <p className="text-2xs text-text-muted">AllTick, Finnhub and Financial Modeling Prep are inactive. Keys are stored encrypted on this device for future use. Saving a key does not validate it or fetch data.</p>
      {status && !status.encryptionAvailable ? <p role="alert">OS credential encryption is unavailable. Enable your system keyring to save keys.</p> : null}
      {MARKET_API_PROVIDERS.map(provider => <form key={provider.id} className="market-api-key" onSubmit={event => {
        event.preventDefault()
        void update({ type: 'save', provider: provider.id, key: drafts[provider.id] })
      }}>
        <label htmlFor={`market-key-${provider.id}`} className="text-xs">{provider.label} <span className="text-text-muted">· Inactive · {status ? status.configured[provider.id] ? 'Key saved' : 'No key saved' : 'Status unavailable'}</span></label>
        <div className="flex flex-wrap gap-2">
          <input id={`market-key-${provider.id}`} type="password" autoComplete="off" spellCheck={false} maxLength={4096}
            className="min-w-0 flex-1 border border-border bg-bg px-2 text-xs" placeholder="Enter API key" aria-label={`${provider.label} API key`}
            disabled={busy || !status?.encryptionAvailable} value={drafts[provider.id]}
            onChange={event => setDrafts(previous => ({ ...previous, [provider.id as MarketApiProvider]: event.target.value }))} />
          <Button type="submit" disabled={busy || !status?.encryptionAvailable || !drafts[provider.id].trim()}>Save</Button>
          <Button disabled={busy || !status?.configured[provider.id] || !status.encryptionAvailable} onClick={() => void update({ type: 'remove', provider: provider.id })}>Remove</Button>
        </div>
      </form>)}
      {message ? <p className="text-2xs" role={error ? 'alert' : 'status'}>{message}</p> : null}
      {!status ? <Button disabled={busy} onClick={() => void load()}>Retry key settings</Button> : null}
    </div>
  </Panel>
}
