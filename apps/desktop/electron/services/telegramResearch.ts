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

export async function telegramModelChoices(worker: AgentsService) {
  await worker.initialize()
  if (!worker.snapshot().connected) await worker.command({ type: 'connect' })
  const state = worker.snapshot()
  if (!state.connected) throw new Error('Codex is unavailable.')
  return state.models.map(model => {
    const thinking = model.thinkingModes.some(mode => mode.id === state.thinking) ? state.thinking : null
    return { id: model.id, name: model.name, current: model.id === state.model,
      reasoning: [
        { id: 'default', name: `Model default (${model.defaultThinking})`, current: thinking === null },
        ...model.thinkingModes.map(mode => ({ id: mode.id, name: mode.id, current: mode.id === thinking })),
      ],
    }
  })
}

export async function telegramResearchCommand(worker: AgentsService, command: TelegramResearchCommand, argument: string) {
  await worker.initialize()
  if (!worker.snapshot().connected) await worker.command({ type: 'connect' })
  const state = worker.snapshot()
  if (!state.connected) throw new Error('Codex is unavailable.')
  if (command === 'model') {
    if (!argument) return 'Send /model and tap a model to choose it.'
    const model = state.models.find(model => model.id === argument)
    if (!model) return 'Unknown model. Send /model to choose an available model.'
    const thinking = model.thinkingModes.some(mode => mode.id === state.thinking) ? state.thinking : null
    await worker.command({ type: 'configure', model: model.id, thinking })
    return `Model: ${model.id}\nReasoning: ${thinking ?? model.defaultThinking}\nConversation context is retained.`
  }
  const model = state.models.find(model => model.id === state.model)
  if (!model) throw new Error('The current model is unavailable.')
  if (!argument) return 'Send /model to choose a model and its reasoning level.'
  if (argument !== 'default' && !model.thinkingModes.some(mode => mode.id === argument)) return `Unsupported reasoning for ${model.id}. Send /model to choose its reasoning level.`
  await worker.command({ type: 'configure', model: model.id, thinking: argument === 'default' ? null : argument })
  return `Reasoning: ${argument === 'default' ? model.defaultThinking + ' (model default)' : argument}\nModel: ${model.id}\nConversation context is retained.`
}
