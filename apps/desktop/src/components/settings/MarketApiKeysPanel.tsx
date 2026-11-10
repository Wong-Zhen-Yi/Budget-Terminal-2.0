import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Envelope } from '@shared/contract'
import { MARKET_API_PROVIDERS, MARKET_DATA_PROVIDERS } from '@shared/marketApiKeys'
import type { MarketApiKeyMutation, MarketApiKeyStatus, MarketApiProvider } from '@shared/marketApiKeys'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'

export function MarketApiKeysPanel() {
  const client = useQueryClient()
  const [status, setStatus] = useState<MarketApiKeyStatus | null>(() => client.getQueryData<Envelope<MarketApiKeyStatus>>(['marketApiKeys'])?.data ?? null)
  const [drafts, setDrafts] = useState({ finnhub: '', fmp: '' })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)

  const load = async (refresh = true) => {
    setBusy(true)
    try {
      const result = await client.fetchQuery({ queryKey: ['marketApiKeys'], queryFn: () => window.api.marketApiKeys(), staleTime: refresh ? 0 : Infinity })
      setStatus(result.meta.failureReason ? null : result.data)
      setMessage(result.meta.failureReason ?? '')
      setError(Boolean(result.meta.failureReason))
    } catch { setError(true); setMessage('Unable to read API key settings. Try again.') }
    finally { setBusy(false) }
  }
  useEffect(() => { void load(false) }, [client])

  const update = async (request: MarketApiKeyMutation) => {
    setBusy(true)
    try {
      const result = await window.api.mutateMarketApiKeys(request)
      client.setQueryData(['marketApiKeys'], result)
      setError(Boolean(result.meta.failureReason))
      setMessage(result.meta.failureReason ?? (request.type === 'save' ? 'Key saved. Provider remains inactive.' : 'Key removed.'))
      if (!result.meta.failureReason) {
        setStatus(result.data)
        setDrafts(previous => ({ ...previous, [request.provider]: '' }))
      }
    } catch { setError(true); setMessage('Unable to update API key. Try again.') }
    finally { setBusy(false) }
  }

  return <Panel title="Market data APIs">
    <div className="flex flex-col gap-3 p-2">
      <p className="text-2xs text-text-muted">Public APIs diversify spot quotes and annual economic data with separate budgets, caching and cooldowns. Finnhub and Financial Modeling Prep remain inactive, including when a key is saved. Keys stay encrypted on this device.</p>
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
      {MARKET_DATA_PROVIDERS.filter(provider => provider.access !== 'key').map(provider => <section key={provider.id} data-api-provider={provider.id} className="border-t border-border pt-2">
        <h3 className="text-xs">{provider.label} <span className="text-text-muted">· Public endpoints enabled</span></h3>
        <p className="text-2xs text-text-muted">{'description' in provider ? provider.description : ''}</p>
      </section>)}
      <p className="text-2xs text-text-muted">Budgets are conservative app limits, not account quotas. Daily budgets apply to this app session. A provider cooldown is never bypassed by Refresh. Live request counts and failures appear in Diagnostics → API usage.</p>
      {message ? <p className="text-2xs" role={error ? 'alert' : 'status'}>{message}</p> : null}
      {!status ? <Button disabled={busy} onClick={() => void load()}>Retry key settings</Button> : null}
    </div>
  </Panel>
}
