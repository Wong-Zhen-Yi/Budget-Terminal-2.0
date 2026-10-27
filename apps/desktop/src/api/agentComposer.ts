import { useCallback } from 'react'
import type { AgentImage } from '@shared/agents'
import { useAgentDraft } from '@/stores/agentDraft'
import { useAgentCommand, useAgents } from './agentsQueries'

export function useAgentComposer() {
  const query = useAgents()
  const command = useAgentCommand()
  const state = useAgentDraft()
  const { update } = state
  const agent = query.data?.data

  const perform = async (action: Parameters<typeof command>[0]) => {
    const pending = useAgentDraft.getState().pendingCommands
    const interrupt = action.type === 'stop' || action.type === 'readNotifications'
      || ((action.type === 'autonomy' || action.type === 'trackerEnabled') && !action.enabled)
    if (pending && !interrupt) return false
    update({ pendingCommands: pending + 1, error: '', ...(action.type === 'send' ? { sending: true } : {}) })
    try {
      await command(action)
      if (action.type === 'newChat' || action.type === 'openChat') update({ draft: '', images: [] })
      return true
    } catch (error) {
      update({ error: error instanceof Error ? error.message : String(error) })
      return false
    } finally { update({ pendingCommands: useAgentDraft.getState().pendingCommands - 1, ...(action.type === 'send' ? { sending: false } : {}) }) }
  }

  const send = async () => {
    const current = useAgentDraft.getState()
    const text = current.draft.trim()
    if ((!text && !current.images.length) || current.pendingCommands > 0 || current.readingImages
      || agent?.busy || agent?.portfolioProposal || !agent?.connected) return
    if (await perform({ type: 'send', text, images: current.images })) {
      // Do not erase a new draft typed while the IPC command was in flight.
      const next = useAgentDraft.getState()
      update({ ...(next.draft === current.draft ? { draft: '' } : {}),
        ...(next.images === current.images ? { images: [] } : {}) })
    }
  }

  const addImages = async (files: File[]) => {
    const current = useAgentDraft.getState()
    if (current.readingImages || current.pendingCommands > 0 || agent?.busy) return
    update({ error: '', readingImages: true })
    try {
      if (current.images.length + files.length > 4) throw new Error('Attach up to four images per message.')
      if (files.some(file => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) throw new Error('Use PNG, JPEG or WebP images.')
      if (files.some(file => file.size > 8 * 1024 * 1024)) throw new Error('Each image must be at most 8 MB.')
      if (files.reduce((total, file) => total + file.size, current.images.reduce((total, image) => total + image.dataUrl.length * 3 / 4, 0)) > 20 * 1024 * 1024) throw new Error('Attachments must total at most 20 MB.')
      const added = await Promise.all(files.map(file => new Promise<AgentImage>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve({ name: file.name || 'Pasted image.png', dataUrl: String(reader.result) })
        reader.onerror = () => reject(new Error(`Could not read ${file.name || 'pasted image'}.`))
        reader.readAsDataURL(file)
      })))
      // A chat reset or attachment removal may have happened while FileReader ran.
      if (useAgentDraft.getState().images === current.images) update({ images: [...current.images, ...added] })
    } catch (error) { update({ error: error instanceof Error ? error.message : String(error) }) }
    finally { update({ readingImages: false }) }
  }

  const attachImage = useCallback((image: AgentImage) => {
    const current = useAgentDraft.getState()
    if (current.pendingCommands || current.readingImages || agent?.busy) return false
    if (current.images.length >= 4 || image.dataUrl.length * 3 / 4 > 8 * 1024 * 1024
      || current.images.reduce((total, value) => total + value.dataUrl.length * 3 / 4, image.dataUrl.length * 3 / 4) > 20 * 1024 * 1024) {
      update({ error: 'Attach up to four images, 8 MB each and 20 MB total.' })
      return false
    }
    update({ images: [...current.images, image], draft: current.draft || 'Edit this image: ', error: '' })
    return true
  }, [agent?.busy, update])

  return { ...state, pending: state.pendingCommands > 0, query, agent, perform, send, addImages, attachImage }
}
