import type { AgentImageArtifact } from './agentImageArtifacts.js'
import type { AgentPortfolioProposal } from './agentPortfolio.js'
import type { AgentWorkspaceState } from './agentWorkspace.js'

export interface AgentImage { name: string; dataUrl: string }

export interface AgentMessage {
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
