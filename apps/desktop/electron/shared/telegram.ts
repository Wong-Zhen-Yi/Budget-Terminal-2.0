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
  | { type: 'telegramConfigure'; token?: string; chatId: string; enabled: boolean; receive: boolean }
  | { type: 'telegramTest' }
  | { type: 'telegramDisconnect' }
