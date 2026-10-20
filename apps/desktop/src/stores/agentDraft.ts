import { create } from 'zustand'
import type { AgentImage } from '@shared/agents'

interface AgentDraftState {
  draft: string
  objective: string
  interval: number
  runs: number
  images: AgentImage[]
  pendingCommands: number
  sending: boolean
  readingImages: boolean
  error: string
  chatAvailable: boolean
  chatOpenRequested: boolean
  update: (patch: Partial<Omit<AgentDraftState, 'update'>>) => void
}

// Memory only: the top bar, Agents page and Dashboard share one composer and lock.
// Never persist unsent text or image bytes in renderer storage.
export const useAgentDraft = create<AgentDraftState>(set => ({
  draft: '', objective: '', interval: 15, runs: 4, images: [],
  pendingCommands: 0, sending: false, readingImages: false, error: '',
  chatAvailable: false, chatOpenRequested: false,
  update: patch => set(patch),
}))
