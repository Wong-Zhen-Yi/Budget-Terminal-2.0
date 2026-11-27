import { useState } from 'react'
import type { AgentsCommand, AgentsState } from '@shared/agents'
import { piApiKeyPattern } from '@shared/agents'

const sourceLabels = { app: 'API key saved here', pi: 'Pi sign-in', environment: 'Environment variable' } as const

/** Model provider connections for Pi. A key is sent once to the main process and never displayed again. */
export function PiSettings({ agent, locked, perform, idPrefix }: { agent?: AgentsState; locked: boolean; perform: (command: AgentsCommand) => Promise<boolean>; idPrefix: string }) {
  const pi = agent?.pi
  const providers = pi?.keyProviders ?? []
  const [provider, setProvider] = useState('')
  const [apiKey, setApiKey] = useState('')
  const selected = provider || providers.find(entry => entry.id === 'anthropic')?.id || providers[0]?.id || ''
  const label = (id: string) => providers.find(entry => entry.id === id)?.label ?? pi?.connected.find(entry => entry.id === id)?.label ?? id
  const valid = !!selected && piApiKeyPattern.test(apiKey.trim())
  return <div className="agents-pi-settings">
    {pi?.error && <p role="alert">{pi.error}</p>}
    <h3>Connected model providers</h3>
    {pi?.connected.length ? <ul aria-label="Connected model providers">{pi.connected.map(entry => <li key={entry.id}>
      <span>{entry.label}</span><span>{sourceLabels[entry.source]}</span>
      {entry.source === 'app' && <button type="button" disabled={locked} onClick={() => void perform({ type: 'piKeyClear', provider: entry.id })}>Remove key</button>}
    </li>)}</ul> : <p role="status">No model provider is connected yet.</p>}
    {pi?.savedKeys.filter(id => !pi.connected.some(entry => entry.id === id)).map(id => <p key={id}>A saved {label(id)} key is not accepted by Pi. <button type="button" disabled={locked} onClick={() => void perform({ type: 'piKeyClear', provider: id })}>Remove key</button></p>)}
    <form aria-label="Model provider API key" onSubmit={event => {
      event.preventDefault()
      const credential = apiKey.trim()
      setApiKey('')
      void perform({ type: 'piKey', provider: selected, apiKey: credential })
    }}>
      <label htmlFor={`${idPrefix}-pi-provider`}>Provider</label>
      <select id={`${idPrefix}-pi-provider`} value={selected} disabled={locked || !providers.length} onChange={event => setProvider(event.target.value)}>
        {!providers.length && <option value="">Loading providers…</option>}
        {providers.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
      </select>
      <label htmlFor={`${idPrefix}-pi-key`}>API key</label>
      <input id={`${idPrefix}-pi-key`} type="password" autoComplete="new-password" spellCheck={false} value={apiKey} maxLength={1024}
        placeholder={pi?.savedKeys.includes(selected) ? 'Saved · paste a new key to replace it' : 'Paste the provider API key'} onChange={event => setApiKey(event.target.value)} />
      <p>Keys are encrypted with your operating system and never shown again. Usage is billed by the provider.</p>
      <div className="agents-pi-actions">
        <button type="submit" className="agents-primary" disabled={locked || !valid}>{pi?.savedKeys.includes(selected) ? 'Replace key and connect' : 'Save key and connect'}</button>
      </div>
    </form>
  </div>
}
