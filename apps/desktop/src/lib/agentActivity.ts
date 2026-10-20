import type { AgentsState } from '@shared/agents'

const labels = {
  hidden: 'Hidden',
  connecting: 'Connecting',
  thinking: 'Thinking',
  researching: 'Researching',
  working: 'Working',
  responding: 'Writing',
  generating: 'Creating image',
  done: 'Done',
  stopped: 'Stopped',
  error: 'Error',
  review: 'Review needed',
  ready: 'Ready',
  disconnected: 'Disconnected',
} as const

type Phase = keyof typeof labels

/** Show actual runtime state, never infer completion from saved assistant text. */
export function topBarAgentActivity(agent: AgentsState | undefined, options: {
  available: boolean
  sending: boolean
  loading: boolean
  error: boolean
  queryError: boolean
}) {
  let phase: Phase
  if (!options.available) phase = 'hidden'
  else if (options.error) phase = 'error'
  else if (options.sending) phase = 'thinking'
  else if (options.queryError || agent?.error || agent?.activity === 'error') phase = 'error'
  else if (agent?.busy) {
    phase = !agent.connected ? 'connecting'
      : agent.activity && ['researching', 'working', 'responding', 'generating'].includes(agent.activity)
        ? agent.activity as 'researching' | 'working' | 'responding' | 'generating' : 'thinking'
  } else if (!agent || options.loading) phase = 'connecting'
  else if (agent.activity === 'stopped') phase = 'stopped'
  else if (!agent.connected) phase = 'disconnected'
  else if (agent.portfolioProposal) phase = 'review'
  else if (agent.activity === 'done') phase = 'done'
  else phase = 'ready'

  return { phase, label: labels[phase], active: ['connecting', 'thinking', 'researching', 'working', 'responding', 'generating'].includes(phase) }
}
