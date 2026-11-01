import { useState } from 'react'
import type { AgentsCommand } from '@shared/agents'
import type { TelegramState } from '@shared/telegram'

export function TelegramSettings({ state, perform, pending }: { state?: TelegramState; perform: (command: AgentsCommand) => Promise<boolean>; pending: boolean }) {
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [receive, setReceive] = useState(false)
  return <section className="agents-telegram" aria-label="Telegram connection">
    <button type="button" aria-expanded={open} onClick={() => {
      if (!open) { setChatId(state?.chatId ?? ''); setEnabled(state?.configured ? state.enabled : true); setReceive(state?.receive ?? false) }
      setToken(''); setOpen(!open)
    }}>Telegram · {state?.error ? 'Needs attention' : state?.enabled ? state.connected ? 'Connected' : 'Connecting' : 'Off'}</button>
    {open && <form onSubmit={event => {
      event.preventDefault()
      const credential = token
      setToken('')
      void perform({ type: 'telegramConfigure', token: credential || undefined, chatId: chatId.trim(), enabled, receive })
    }}>
      <p>Create a bot with @BotFather in Telegram using /newbot, then start a private chat with your bot. Enter your numeric Telegram user ID as the home chat ID. Only this user can chat with the research agent.</p>
      <label>Bot token<input type="password" autoComplete="new-password" value={token} placeholder={state?.configured ? 'Leave blank to keep saved token' : 'Paste BotFather token'} onChange={event => setToken(event.target.value)} /></label>
      <label>Private chat / user ID<input inputMode="numeric" value={chatId} onChange={event => setChatId(event.target.value)} required pattern="[1-9][0-9]{0,15}" /></label>
      <label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />Enable Telegram delivery</label>
      <label><input type="checkbox" checked={receive} onChange={event => setReceive(event.target.checked)} />Receive research questions from Telegram</label>
      <p>Keep Budget Terminal open. The token is encrypted with your operating system and never shown to the agent. Incoming text chats use separate history and research tools only. New connections discard queued messages; messages older than five minutes are skipped. Use /new to reset the Telegram conversation.</p>
      {state?.bot && <p>Bot: @{state.bot}</p>}
      {state?.error && <p role="alert">{state.error}</p>}
      <div className="agents-actions"><button disabled={pending}>Save connection</button><button type="button" disabled={pending || !state?.enabled} onClick={() => void perform({ type: 'telegramTest' })}>Send test message</button><button type="button" disabled={pending || !state?.configured} onClick={() => void perform({ type: 'telegramDisconnect' })}>Disconnect and forget token</button></div>
    </form>}
  </section>
}
