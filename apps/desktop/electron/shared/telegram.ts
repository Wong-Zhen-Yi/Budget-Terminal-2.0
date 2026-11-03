import type { AgentConversation, AgentConversationSummary } from './agentWorkspace.js'

/** Keep Telegram prose readable without changing URL fragments or numeric facts. */
export function formatTelegramText(text: string) {
  return text.split(/(https?:\/\/[^\s<>*]+)/g).map((part, index) => index % 2 ? part : part
    .replace(/[*#]/g, '')
    .replace(/[ \t]*—[ \t]*/g, ', '))
    .join('').split('\n').map(line => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export interface TelegramState {
  configured: boolean
  enabled: boolean
  receive: boolean
  connected: boolean
  bot: string
  chatId: string
  error: string
}

export type TelegramCommand =
  | { type: 'telegramViewChat'; id: string | null }
  | { type: 'telegramDeleteChat'; id: string }
  | { type: 'telegramCheck' }
  | { type: 'telegramConfigure'; token?: string; chatId: string; enabled: boolean; receive: boolean }
  | { type: 'telegramTest' }
  | { type: 'telegramDisconnect' }

// Only locally authored, credential-free messages may escape Telegram's transport.
export class TelegramError extends Error {}

export interface TelegramHistoryState {
  history: AgentConversationSummary[]
  currentChatId: string | null
  busy: boolean
  selected: Pick<AgentConversation, 'id' | 'title' | 'messages'> | null
  error: string
}
