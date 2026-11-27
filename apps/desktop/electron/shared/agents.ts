import type { AgentImageArtifact } from './agentImageArtifacts.js'
import type { AgentPortfolioProposal } from './agentPortfolio.js'
import type { AgentWorkspaceState } from './agentWorkspace.js'
import type { AgentRun } from './agentRuns.js'
import type { TelegramCommand, TelegramHistoryState, TelegramState } from './telegram.js'

export interface AgentImage { name: string; dataUrl: string }

/** Agents chat, trackers, monitoring and Telegram research all run on the embedded Pi agent runtime. */
export const agentRuntimeLabel = 'Pi'
/** A model provider Pi can reach, and where its credential comes from. Credentials never reach the renderer. */
export interface PiProviderConnection { id: string; label: string; source: 'app' | 'pi' | 'environment' | 'claude-code' }
/** A subscription sign-in in progress. Pi's own OAuth flow runs in the main process; only its public steps reach the renderer. */
export interface PiSignInFlow {
  provider: string
  label: string
  /** Sign-in page to open in the browser. */
  url?: string
  /** Device-code sign-in: the code to enter at the verification page. */
  userCode?: string
  verificationUri?: string
  message?: string
  /** A question the flow is waiting on, such as a pasted redirect URL. `manual_code` is optional while the browser callback is pending. */
  prompt?: { kind: 'text' | 'secret' | 'manual_code' | 'select'; message: string; placeholder?: string; options?: { id: string; label: string }[] }
}
export interface PiConnectionState {
  /** Providers with an API key saved (encrypted) in Budget Terminal. */
  savedKeys: string[]
  /** Providers Pi can use now: saved keys, Pi sign-ins, Claude Code and environment keys. */
  connected: PiProviderConnection[]
  /** Providers that accept an API key, for the key form. */
  keyProviders: { id: string; label: string }[]
  /** Subscription sign-ins Pi offers without an API key. Anthropic's is excluded: its terms forbid Claude.ai sign-in in third-party apps. */
  signInProviders?: { id: string; label: string }[]
  signIn?: PiSignInFlow
  /** The user's own Claude Code CLI, which Pi can use as a model provider with Claude Code's own sign-in. */
  claudeCode?: { installed: boolean; signedIn: boolean; plan?: string; error?: string }
  /** Explanations for credentials that were found but are not used. */
  notices?: string[]
  /** Set when the Pi credential or model files could not be read, or the last sign-in failed. */
  error?: string
}
export const piProviderPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/
/** Printable, without spaces. Provider-specific formats are left to the provider to reject. */
export const piApiKeyPattern = /^[\x21-\x7e]{8,1024}$/

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
  pi?: PiConnectionState
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
  | { type: 'piKey'; provider: string; apiKey: string }
  | { type: 'piKeyClear'; provider: string }
  | { type: 'piSignIn'; provider: string }
  | { type: 'piSignInAnswer'; value: string }
  | { type: 'piSignInCancel' }
  | { type: 'piSignOut'; provider: string }
  | { type: 'claudeCodeCheck' }
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
