import type { AgentConversation, AgentConversationSummary } from './agentWorkspace.js'

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
