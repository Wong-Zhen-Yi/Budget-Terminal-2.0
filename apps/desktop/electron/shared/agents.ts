import type { AgentImageArtifact } from './agentImageArtifacts.js'
import type { AgentPortfolioProposal } from './agentPortfolio.js'
import type { AgentWorkspaceState } from './agentWorkspace.js'
import type { AgentRun } from './agentRuns.js'
import type { TelegramCommand, TelegramHistoryState, TelegramState } from './telegram.js'

export interface AgentImage { name: string; dataUrl: string }

/** The model runtime behind Agents chat, trackers, monitoring and Telegram research. */
export type AgentProvider = 'codex' | 'claude' | 'claude-code'
export const agentProviderLabels: Record<AgentProvider, string> = { codex: 'Codex', claude: 'Claude', 'claude-code': 'Claude Code' }
export const agentProviders = Object.keys(agentProviderLabels) as AgentProvider[]
export const isAgentProvider = (value: unknown): value is AgentProvider => agentProviders.includes(value as AgentProvider)
/** Claude API keys from the Claude Console. Only a saved/not-saved flag reaches the renderer. */
export const claudeApiKeyPattern = /^sk-ant-[A-Za-z0-9_-]{16,400}$/

export interface AgentMessage {
  run?: AgentRun
  images?: string[]
  imageArtifacts?: AgentImageArtifact[]
  imageStatus?: 'generating' | 'ready' | 'failed'
  id: string
  role: 'user' | 'assistant' | 'activity'
  text: string
  at: number
}

export interface AgentNavigation {
  id: string
  page: string
  symbol?: string
}

export type AgentActivity = 'idle' | 'connecting' | 'thinking' | 'researching' | 'working' | 'responding' | 'generating' | 'done' | 'stopped' | 'error'

export interface AgentsState extends AgentWorkspaceState {
  provider?: AgentProvider
  claude?: { keySaved: boolean }
  telegram?: TelegramState
  telegramHistory?: TelegramHistoryState
  runLimitMinutes?: number
  activity?: AgentActivity
  imageGeneration?: boolean | null
  portfolioProposal: AgentPortfolioProposal | null
  model: string | null
  thinking: string | null
  models: AgentModel[]
  connected: boolean
  busy: boolean
  autonomy: boolean
  objective: string
  intervalMinutes: number
  runsRemaining: number
  nextRunAt: number | null
  messages: AgentMessage[]
  error: string
  navigation: AgentNavigation | null
}

export interface AgentModel {
  supportsImages: boolean
  id: string
  name: string
  defaultThinking: string
  thinkingModes: { id: string; description: string }[]
}

export type AgentsCommand =
  | TelegramCommand
  | { type: 'agentProvider'; provider: AgentProvider }
  | { type: 'claudeKey'; apiKey: string }
  | { type: 'claudeKeyClear' }
  | { type: 'continueResearch'; runId: string }
  | { type: 'configureRun'; minutes: number }
  | { type: 'configure'; model: string; thinking: string | null }
  | { type: 'connect' }
  | { type: 'send'; text: string; images?: AgentImage[] }
  | { type: 'portfolioDecision'; id: string; approve: boolean }
  | { type: 'stop' }
  | { type: 'newChat' }
  | { type: 'openChat'; id: string }
  | { type: 'deleteChat'; id: string }
  | { type: 'readNotifications'; id?: string }
  | { type: 'deleteNotification'; id: string }
  | { type: 'trackerEnabled'; id: string; enabled: boolean }
  | { type: 'deleteTracker'; id: string }
  | { type: 'autonomy'; enabled: boolean; objective?: string; intervalMinutes?: number; runs?: number }
  | { type: 'navigationResult'; id: string; error?: string }
