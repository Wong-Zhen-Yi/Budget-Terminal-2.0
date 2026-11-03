import type { AgentsService } from './agents.js'
import type { TelegramResearchCommand } from './telegram.js'
import { z } from 'zod'
import type { AgentWorkspace } from './agentWorkspace.js'
import type { TelegramHistoryState } from '../shared/telegram.js'

const chatId = z.string().min(1).max(100)
const historyCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('telegramViewChat'), id: chatId.nullable() }).strict(),
  z.object({ type: z.literal('telegramDeleteChat'), id: chatId }).strict(),
])

export function telegramHistorySnapshot(workspace: AgentWorkspace, selectedId: string | null, busy: boolean): TelegramHistoryState {
  const state = workspace.snapshot()
  const selected = selectedId ? workspace.conversation(selectedId) : null
  return {
    history: state.history, currentChatId: state.currentChatId, busy,
    selected: selected ? { id: selected.id, title: selected.title, messages: selected.messages } : null,
    error: state.storageError ? 'Telegram chat history could not be loaded or saved. The original file has been preserved.' : '',
  }
}

/** Desktop history viewing never selects a Telegram conversation or starts inference. */
export async function telegramHistoryAction(workspace: AgentWorkspace, input: unknown, busy: boolean) {
  const command = historyCommandSchema.parse(input)
  await workspace.initialize()
  if (command.type === 'telegramViewChat') {
    if (command.id && !workspace.conversation(command.id)) throw new Error('That Telegram chat no longer exists.')
    return command.id
  }
  if (busy) throw new Error('Wait for the Telegram research request to finish before deleting history.')
  workspace.deleteConversation(command.id)
  await workspace.flush()
  return null
}

export async function resetTelegramConversation(worker: AgentsService) {
  const state = await worker.command({ type: 'newChat' })
  if (state.error || state.storageError) throw new Error('Telegram conversation could not be reset.')
}

export async function telegramResearchCommand(worker: AgentsService, command: TelegramResearchCommand, argument: string) {
  await worker.initialize()
  if (command === 'history') {
    const state = worker.snapshot()
    return 'Telegram chats (most recent first):\n' + state.history.map(chat => `${chat.id === state.currentChatId ? '* ' : ''}${chat.id}\n${chat.title} (${chat.messageCount} messages)`).join('\n\n') + '\n\nUse /resume <chat ID>. * marks the current chat.'
  }
  if (command === 'resume') {
    if (!argument) return 'Usage: /resume <chat ID>. Use /history to find an ID.'
    if (!worker.snapshot().history.some(chat => chat.id === argument)) return 'That Telegram chat does not exist. Use /history to find its full ID.'
    const state = await worker.command({ type: 'openChat', id: argument })
    if (state.error || state.storageError) throw new Error('Telegram chat could not be resumed.')
    return `Resumed Telegram chat ${argument}. Its saved conversation context will be included in future questions.`
  }
  if (command === 'models' || (command === 'model' && argument)) {
    if (!worker.snapshot().connected) await worker.command({ type: 'connect' })
    if (!worker.snapshot().connected) throw new Error('Codex is unavailable.')
    if (command === 'models') return 'Available models:\n' + worker.snapshot().models.map(model => `${model.id} — ${model.name}`).join('\n') + '\n\nUse /model <model ID>.'
    const model = worker.snapshot().models.find(model => model.id === argument)
    if (!model) return 'Unknown model. Use /models to see available IDs.'
    await worker.command({ type: 'configure', model: model.id, thinking: null })
    return `Telegram model: ${model.id}. Conversation context is retained.`
  }
  const state = worker.snapshot()
  const chat = state.history.find(chat => chat.id === state.currentChatId)
  return `Telegram chat: ${chat?.id ?? 'none'}\nTitle: ${chat?.title ?? 'New chat'}\nMessages: ${chat?.messageCount ?? 0}\nCodex: ${state.connected ? 'connected' : 'disconnected'}\nModel: ${state.model ?? 'account default'}\nContext is retained in this chat. /new starts without previous conversation context.`
}
