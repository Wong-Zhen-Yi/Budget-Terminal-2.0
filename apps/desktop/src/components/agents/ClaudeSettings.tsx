import { useState } from 'react'
import type { AgentsCommand, AgentsState } from '@shared/agents'
import { claudeApiKeyPattern } from '@shared/agents'

/** Claude API key entry. The key is sent once to the main process and never displayed again. */
export function ClaudeSettings({ agent, locked, perform }: { agent?: AgentsState; locked: boolean; perform: (command: AgentsCommand) => Promise<boolean> }) {
  const [apiKey, setApiKey] = useState('')
  const saved = !!agent?.claude?.keySaved
  const valid = claudeApiKeyPattern.test(apiKey.trim())
  return <form aria-label="Claude API key" onSubmit={event => {
    event.preventDefault()
    const credential = apiKey.trim()
    setApiKey('')
    void perform({ type: 'claudeKey', apiKey: credential })
  }}>
    <p>Create an API key in the Claude Console under API keys, then paste it here. Usage is billed to that Console workspace.</p>
    <label htmlFor="agents-claude-key">Claude API key</label>
    <input id="agents-claude-key" type="password" autoComplete="new-password" spellCheck={false} value={apiKey} maxLength={420}
      placeholder={saved ? 'Saved · paste a new key to replace it' : 'sk-ant-…'} onChange={event => setApiKey(event.target.value)} />
    <p role="status">{saved ? 'A Claude API key is saved and encrypted with your operating system.' : 'No Claude API key saved.'}</p>
    <div className="agents-claude-actions">
      <button type="submit" className="agents-primary" disabled={locked || !valid}>{saved ? 'Replace key and connect' : 'Save key and connect'}</button>
      <button type="button" disabled={locked || !saved} onClick={() => void perform({ type: 'claudeKeyClear' })}>Remove saved key</button>
    </div>
  </form>
}
