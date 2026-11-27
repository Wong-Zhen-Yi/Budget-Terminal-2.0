import { useState } from 'react'
import type { AgentsCommand, AgentsState, PiSignInFlow } from '@shared/agents'
import { piApiKeyPattern } from '@shared/agents'

const sourceLabels = { app: 'API key saved here', pi: 'Pi sign-in', environment: 'Environment variable', 'claude-code': 'Claude Code sign-in' } as const
type Perform = (command: AgentsCommand) => Promise<boolean>

/** Model provider connections for Pi. A key is sent once to the main process and never displayed again. */
export function PiSettings({ agent, locked, perform, idPrefix }: { agent?: AgentsState; locked: boolean; perform: Perform; idPrefix: string }) {
  const pi = agent?.pi
  const providers = pi?.keyProviders ?? []
  const [provider, setProvider] = useState('')
  const [apiKey, setApiKey] = useState('')
  const selected = provider || providers.find(entry => entry.id === 'anthropic')?.id || providers[0]?.id || ''
  const label = (id: string) => providers.find(entry => entry.id === id)?.label ?? pi?.connected.find(entry => entry.id === id)?.label ?? id
  const valid = !!selected && piApiKeyPattern.test(apiKey.trim())
  return <div className="agents-pi-settings">
    {pi?.error && <p role="alert">{pi.error}</p>}
    {pi?.notices?.map(notice => <p key={notice} className="agents-pi-note">{notice}</p>)}
    <h3>Connected model providers</h3>
    {pi?.connected.length ? <ul aria-label="Connected model providers">{pi.connected.map(entry => <li key={entry.id}>
      <span>{entry.label}</span><span>{sourceLabels[entry.source]}</span>
      {entry.source === 'app' && <button type="button" disabled={locked} onClick={() => void perform({ type: 'piKeyClear', provider: entry.id })}>Remove key</button>}
      {entry.source === 'pi' && <button type="button" disabled={locked} onClick={() => void perform({ type: 'piSignOut', provider: entry.id })}>Sign out of Pi</button>}
    </li>)}</ul> : <p role="status">No model provider is connected yet.</p>}
    {pi?.savedKeys.filter(id => !pi.connected.some(entry => entry.id === id)).map(id => <p key={id}>A saved {label(id)} key is not accepted by Pi. <button type="button" disabled={locked} onClick={() => void perform({ type: 'piKeyClear', provider: id })}>Remove key</button></p>)}

    <h3>Claude Code</h3>
    <ClaudeCodeStatus agent={agent} locked={locked} perform={perform} />

    <h3>Sign in with a subscription</h3>
    {pi?.signIn ? <SignInFlow flow={pi.signIn} perform={perform} idPrefix={idPrefix} />
      : <SignInStart agent={agent} locked={locked} perform={perform} idPrefix={idPrefix} />}

    <h3>API key</h3>
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

function ClaudeCodeStatus({ agent, locked, perform }: { agent?: AgentsState; locked: boolean; perform: Perform }) {
  const status = agent?.pi?.claudeCode
  const plan = status?.plan ? ` (${status.plan.replace(/^./, letter => letter.toUpperCase())})` : ''
  const text = !status ? 'Checking for Claude Code…'
    : status.error ? status.error
      : !status.installed ? 'Claude Code was not found. Install it, run claude in a terminal and sign in, then select Check again.'
        : !status.signedIn ? 'Claude Code is installed but not signed in. Run claude in a terminal, sign in with /login, then select Check again.'
          : `Signed in${plan}. Pi sends requests through your Claude Code installation, which uses its own sign-in and your plan's usage limits.`
  return <div className="agents-pi-flow">
    <p role="status">{text}</p>
    <p>Claude Code runs with its tools, plugins, hooks, MCP servers and CLAUDE.md files off. Budget Terminal never reads or stores your Claude sign-in.</p>
    <div className="agents-pi-actions"><button type="button" disabled={locked} onClick={() => void perform({ type: 'claudeCodeCheck' })}>Check again</button></div>
  </div>
}

function SignInStart({ agent, locked, perform, idPrefix }: { agent?: AgentsState; locked: boolean; perform: Perform; idPrefix: string }) {
  const options = agent?.pi?.signInProviders ?? []
  const [choice, setChoice] = useState('')
  const selected = choice || options[0]?.id || ''
  return <form aria-label="Subscription sign-in" onSubmit={event => { event.preventDefault(); if (selected) void perform({ type: 'piSignIn', provider: selected }) }}>
    <label htmlFor={`${idPrefix}-pi-sign-in`}>Account</label>
    <select id={`${idPrefix}-pi-sign-in`} value={selected} disabled={locked || !options.length} onChange={event => setChoice(event.target.value)}>
      {!options.length && <option value="">Loading sign-ins…</option>}
      {options.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
    </select>
    <p>Opens the provider&apos;s sign-in page in your browser. Pi keeps the sign-in in its own credential file, shared with the pi CLI. Claude Pro/Max is not listed: use Claude Code for it.</p>
    <div className="agents-pi-actions"><button type="submit" className="agents-primary" disabled={locked || !selected}>Sign in</button></div>
  </form>
}

function SignInFlow({ flow, perform, idPrefix }: { flow: PiSignInFlow; perform: Perform; idPrefix: string }) {
  const [answer, setAnswer] = useState('')
  const prompt = flow.prompt
  const page = flow.verificationUri ?? flow.url
  const choice = prompt?.kind === 'select' ? answer || prompt.options?.[0]?.id || '' : answer
  return <div className="agents-pi-flow" aria-label={`${flow.label} sign-in`}>
    <p role="status"><strong>{flow.label}</strong>{flow.message ? ` · ${flow.message}` : ''}</p>
    {flow.userCode && <p>Code: <code className="agents-pi-code">{flow.userCode}</code></p>}
    {page && <p><a href={page} target="_blank" rel="noreferrer">Open the sign-in page</a></p>}
    {prompt && <form onSubmit={event => { event.preventDefault(); const value = choice; setAnswer(''); void perform({ type: 'piSignInAnswer', value }) }}>
      <label htmlFor={`${idPrefix}-pi-answer`}>{prompt.message}</label>
      {prompt.kind === 'select'
        ? <select id={`${idPrefix}-pi-answer`} value={choice} onChange={event => setAnswer(event.target.value)}>{prompt.options?.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
        : <input id={`${idPrefix}-pi-answer`} type={prompt.kind === 'secret' ? 'password' : 'text'} autoComplete="off" spellCheck={false} maxLength={4096}
          value={answer} placeholder={prompt.placeholder} onChange={event => setAnswer(event.target.value)} />}
      {prompt.kind === 'manual_code' && <p>Only needed if the browser could not return to Budget Terminal.</p>}
      <div className="agents-pi-actions"><button type="submit" disabled={prompt.kind === 'manual_code' && !answer.trim()}>Continue</button></div>
    </form>}
    <div className="agents-pi-actions"><button type="button" onClick={() => void perform({ type: 'piSignInCancel' })}>Cancel sign-in</button></div>
  </div>
}
