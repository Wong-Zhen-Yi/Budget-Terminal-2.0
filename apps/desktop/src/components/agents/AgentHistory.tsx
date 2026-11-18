import { useEffect, useId, useRef, useState } from 'react'
import type { AgentsCommand, AgentsState } from '@shared/agents'
import type { AgentConversationSummary } from '@shared/agentWorkspace'
import { AGENT_HISTORY_CHATS, AGENT_HISTORY_DAYS, AGENT_HISTORY_MESSAGES, AGENT_HISTORY_MIB } from '@shared/agentWorkspace'
import { AgentMessages } from './AgentMessages'

type Channel = 'Desktop' | 'Telegram'
type Entry = { chat: AgentConversationSummary; channel: Channel; current: boolean }

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const ignoreImage = () => {}

export function AgentHistory({ agent, locked, pending, perform }: {
  agent?: AgentsState
  locked: boolean
  pending: boolean
  perform: (command: AgentsCommand) => Promise<boolean>
}) {
  const [channel, setChannel] = useState<Channel | 'All'>('All')
  const [search, setSearch] = useState('')
  const [confirm, setConfirm] = useState('')
  const historyId = useId()
  const searchInput = useRef<HTMLInputElement>(null)
  const readerTitle = useRef<HTMLHeadingElement>(null)
  const telegram = agent?.telegramHistory
  const selected = telegram?.selected
  const selectedId = selected?.id
  const lastSelected = useRef(selectedId)

  useEffect(() => {
    if (selectedId) readerTitle.current?.focus({ preventScroll: true })
    else if (lastSelected.current) searchInput.current?.focus({ preventScroll: true })
    lastSelected.current = selectedId
  }, [selectedId])

  const desktopChats = agent?.history ?? []
  const telegramChats = telegram?.history ?? []
  const history: Entry[] = [
    ...desktopChats.map(chat => ({ chat, channel: 'Desktop' as const, current: chat.id === agent?.currentChatId })),
    ...telegramChats.map(chat => ({ chat, channel: 'Telegram' as const, current: chat.id === telegram?.currentChatId })),
  ]
  const query = search.trim().toLocaleLowerCase()
  const days = new Map<string, Entry[]>()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  for (const entry of history.sort((a, b) => b.chat.updatedAt - a.chat.updatedAt)) {
    const { chat } = entry
    if ((channel !== 'All' && entry.channel !== channel) || !(chat.title || 'New chat').toLocaleLowerCase().includes(query)) continue
    const day = chat.updatedAt >= today.getTime() ? 'Today' : chat.updatedAt >= yesterday.getTime() ? 'Yesterday' : dateFormat.format(chat.updatedAt)
    const entries = days.get(day)
    if (entries) entries.push(entry)
    else days.set(day, [entry])
  }

  return <section className="agents-chat-history" aria-label="Chat history">
    <p className="agents-chat-history-retention" title={`Per channel: ${AGENT_HISTORY_MIB} MiB, ${AGENT_HISTORY_CHATS} chats, and ${AGENT_HISTORY_MESSAGES} messages per chat.`}>Saved for up to {AGENT_HISTORY_DAYS} days after activity, within storage limits.</p>
    {telegram?.error && <p className="agents-chat-history-error" role="alert">{telegram.error}</p>}
    <div className="agents-chat-history-panes" data-reading={!!selected}>
      <div className="agents-chat-history-browser">
        <div className="agents-chat-history-filters">
          <input ref={searchInput} type="search" aria-label="Search chat titles" placeholder="Search chat titles…" value={search} onChange={event => { setSearch(event.target.value); setConfirm('') }} />
          <select aria-label="Chat channel" value={channel} onChange={event => { setChannel(event.target.value as typeof channel); setConfirm('') }}>
            <option value="All">All chats ({history.length})</option>
            <option value="Desktop">Desktop ({desktopChats.length})</option>
            <option value="Telegram">Telegram ({telegramChats.length})</option>
          </select>
        </div>
        <div className="agents-chat-history-list">
          {!days.size && <p role="status">{query ? 'No chat titles match your search.' : channel === 'All' ? 'No saved chats yet.' : `No saved ${channel} chats yet.`}</p>}
          {[...days].map(([day, entries]) => <section key={day}>
            <h3>{day}</h3>
            {entries.map(({ chat, channel, current }) => {
              const isTelegram = channel === 'Telegram'
              const title = chat.title || 'New chat'
              const viewing = isTelegram && chat.id === selectedId
              const deleteType = isTelegram ? 'telegramDeleteChat' : 'deleteChat'
              const key = `${channel}:${chat.id}`
              const metadataId = `${historyId}-${key}`
              const deleting = confirm === key
              return <article key={key} className="agents-chat-history-row" data-viewing={viewing}>
                <button type="button" className="agents-chat-history-open"
                  aria-label={isTelegram ? `View Telegram chat: ${title}` : title}
                  aria-describedby={metadataId} title={title}
                  aria-current={viewing || (!selected && current && !isTelegram) ? 'true' : undefined}
                  disabled={isTelegram ? pending : locked || !!agent?.autonomy || current}
                  onClick={() => {
                    setConfirm('')
                    void perform({ type: isTelegram ? 'telegramViewChat' : 'openChat', id: chat.id })
                  }}>
                  <strong>{title}</strong>
                  <small id={metadataId}>{channel}{current ? ' · Active' : ''} · <time dateTime={new Date(chat.updatedAt).toISOString()}>{timeFormat.format(chat.updatedAt)}</time> · {chat.messageCount} {chat.messageCount === 1 ? 'message' : 'messages'}{chat.model ? ` · ${chat.model}` : ''}</small>
                </button>
                <div className="agents-chat-history-actions">
                  <button type="button" disabled={pending || (isTelegram ? !!telegram?.busy : locked) || current}
                    aria-label={deleting ? 'Confirm delete chat' : `Delete chat: ${title}`}
                    title={current ? isTelegram ? 'Send /new in Telegram before deleting the active chat' : 'Open a different desktop chat before deleting this one' : undefined}
                    onClick={async () => {
                      if (!deleting) setConfirm(key)
                      else if (await perform({ type: deleteType, id: chat.id })) setConfirm('')
                    }}>{deleting ? 'Confirm delete' : 'Delete'}</button>
                  {deleting && <button type="button" onClick={() => setConfirm('')}>Cancel</button>}
                </div>
              </article>
            })}
          </section>)}
        </div>
      </div>
      {selected && <section className="agents-chat-history-reader" aria-label="Telegram chat transcript">
        <header>
          <div><p>Telegram transcript</p><h3 ref={readerTitle} tabIndex={-1} title={selected.title}>{selected.title || 'New chat'}</h3></div>
          <button type="button" disabled={pending} onClick={() => void perform({ type: 'telegramViewChat', id: null })}>Close Telegram transcript</button>
        </header>
        <div key={selected.id} className="agents-chat-history-messages" tabIndex={0} role="region" aria-label="Saved Telegram messages">
          <AgentMessages messages={selected.messages} imagesLocked onUseImage={ignoreImage} />
          {!selected.messages.length && <p>No messages in this Telegram chat yet.</p>}
        </div>
      </section>}
    </div>
  </section>
}
