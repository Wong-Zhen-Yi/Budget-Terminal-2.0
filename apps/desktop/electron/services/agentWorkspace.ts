import { agentsChanged } from './liveStatusEvents.js'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AGENT_HISTORY_CHATS, AGENT_HISTORY_DAYS, AGENT_HISTORY_MESSAGES, AGENT_HISTORY_MIB, agentWorkspaceSchema, notificationInputSchema, trackerDefinitionSchema, trackerReportSchema } from '../shared/agentWorkspace.js'
import type { AgentConversation, AgentNotification, AgentNotificationInput, AgentTracker, AgentTrackerDefinition, AgentTrackerReport, AgentWorkspaceData, AgentWorkspaceState } from '../shared/agentWorkspace.js'
import type { AgentMessage } from '../shared/agents.js'
import type { AgentCheckpoint } from '../shared/agentRuns.js'
import type { NotificationCenter } from './notifications.js'

const MAX_BYTES = AGENT_HISTORY_MIB * 1024 * 1024
const HOUR_MS = 60 * 60_000
const RETENTION_MS = AGENT_HISTORY_DAYS * 24 * HOUR_MS
export function agentWorkspacePath() {
  return join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'), 'BudgetTerminalElectron', 'agents.json')
}
interface Options {
  notifications?: NotificationCenter
  path?: string
  deliver?: (notification: AgentNotification) => Promise<void> | void
  check?: (tracker: AgentTracker, signal: AbortSignal) => Promise<AgentTrackerReport>
  removeImage?: (id: string) => Promise<void>
}

type LiveConversation = { busy: () => boolean; expired: () => void; trimmed: (messages: AgentMessage[]) => void }

function lastConversationActivity(chat: AgentConversation) {
  return chat.messages.reduce((latest, message) => message.role === 'activity' && !message.run
    ? latest
    : Math.max(latest, message.at, message.run?.endedAt ?? 0), chat.createdAt)
}

/** One atomic, serialized local store. No credentials, image bytes, thread IDs or executable code. */
export class AgentWorkspace {
  private data: AgentWorkspaceData = { version: 1, currentChatId: null, conversations: [], notifications: [], trackers: [] }
  private initialized: Promise<void> | null = null
  private writable = false
  private dirty = false
  private queue: Promise<void> = Promise.resolve()
  private saveTimer: NodeJS.Timeout | null = null
  private retentionTimer: NodeJS.Timeout | null = null
  private liveConversation?: LiveConversation
  private removedImages = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private active: { id: string; controller: AbortController; done: Promise<void> } | null = null
  private closed = false
  storageError = ''
  constructor(private options: Options = {}) {}

  initialize() {
    this.initialized ??= this.load()
    return this.initialized
  }
  bindLiveConversation(conversation: LiveConversation) {
    this.liveConversation = conversation
  }

  private async load() {
    try {
      const raw = await readFile(this.options.path ?? agentWorkspacePath())
      if (raw.length > MAX_BYTES) throw new Error(`Agents history exceeds the ${AGENT_HISTORY_MIB} MiB limit.`)
      this.data = agentWorkspaceSchema.parse(JSON.parse(raw.toString('utf8')))
      if (new Set(this.data.conversations.map(chat => chat.id)).size !== this.data.conversations.length
        || new Set(this.data.trackers.map(tracker => tracker.id)).size !== this.data.trackers.length) throw new Error('Duplicate IDs in Agents data.')
      // Saved definitions survive, but background work always needs explicit consent after launch.
      for (const chat of this.data.conversations) {
        const messages = chat.messages.filter(message => message.role !== 'activity' || message.text !== 'Codex connected. Budget Terminal MCP tools are available for research, screenshots and requested saved-data edits.')
        if (messages.length !== chat.messages.length) { chat.messages = messages; this.dirty = true }
      }
      for (const tracker of this.data.trackers) {
        if (tracker.running) tracker.error = 'The app closed during this check. Review and start again.'
        tracker.enabled = false; tracker.running = false; tracker.nextRunAt = null
      }
      for (const chat of this.data.conversations) for (const message of chat.messages) if (message.run?.status === 'running') {
        this.dirty = true
        message.run.status = 'failed'; message.run.endedAt = Math.max(message.run.startedAt, Math.min(Date.now(), chat.updatedAt))
        message.run.error = 'The app closed during this run. Continue research to recover.'
        for (const tool of message.run.tools) if (tool.status === 'running') {
          tool.status = 'cancelled'; tool.durationMs = Math.max(0, message.run.endedAt - tool.startedAt)
        }
        message.text = 'Research was interrupted when the app closed.'
      }
      for (const chat of this.data.conversations) {
        const activityAt = lastConversationActivity(chat)
        if (chat.updatedAt !== activityAt) { chat.updatedAt = activityAt; this.dirty = true }
      }
      if (!this.data.conversations.some(chat => chat.id === this.data.currentChatId)) this.data.currentChatId = null
      this.writable = true
      if (this.dirty) this.changed()
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') this.writable = true
      else {
        this.storageError = `Agents data could not be loaded; the original file was left untouched. ${String(error)}`
        throw new Error(this.storageError)
      }
    }
    if (!this.closed) {
      if (this.pruneHistory()) await this.flush().catch(() => {})
      this.retentionTimer = setInterval(() => this.pruneHistory(), HOUR_MS)
      this.retentionTimer.unref()
    }
    if (this.options.notifications) {
      await this.options.notifications.initialize()
      if (this.data.notifications.length) {
        await this.options.notifications.importLegacy(this.data.notifications)
        this.data.notifications = []
        this.changed()
        await this.flush()
      }
    }
  }
  snapshot(): AgentWorkspaceState {
    return structuredClone({
      currentChatId: this.data.currentChatId,
      history: this.data.conversations.map(({ messages, checkpoint: _checkpoint, ...chat }) => ({ ...chat, messageCount: messages.filter(message => message.role !== 'activity').length })).sort((a, b) => b.updatedAt - a.updatedAt),
      notifications: this.options.notifications
        ? this.options.notifications.snapshot().notifications.filter((item): item is AgentNotification => ['chat', 'autonomy', 'tracker'].includes(item.source))
        : [...this.data.notifications].reverse(), trackers: this.data.trackers, storageError: this.storageError,
    })
  }
  get currentChatId() { return this.data.currentChatId }

  conversation(id = this.data.currentChatId) { return structuredClone(this.data.conversations.find(chat => chat.id === id) ?? null) }
  pruneHistory(now = Date.now()) {
    if (!this.writable || this.liveConversation?.busy()) return false
    const expired = this.data.conversations.filter(chat => chat.updatedAt <= now - RETENTION_MS)
    if (!expired.length) return false
    this.removeConversations(expired)
    this.changed()
    return true
  }

  private rememberRemovedImages(messages: AgentMessage[]) {
    if (!this.options.removeImage) return
    for (const message of messages) for (const image of message.imageArtifacts ?? []) this.removedImages.add(image.id)
  }

  private removeConversations(removed: AgentConversation[]) {
    const ids = new Set(removed.map(chat => chat.id))
    for (const chat of removed) this.rememberRemovedImages(chat.messages)
    this.data.conversations = this.data.conversations.filter(chat => !ids.has(chat.id))
    if (this.data.currentChatId && ids.has(this.data.currentChatId)) {
      this.data.currentChatId = null
      this.liveConversation?.expired()
    }
  }

  private oldestInactive() {
    return this.data.conversations.filter(chat => chat.id !== this.data.currentChatId).sort((a, b) => a.updatedAt - b.updatedAt)
  }

  private boundedPayload() {
    const payload = JSON.stringify(agentWorkspaceSchema.parse(this.data))
    let bytes = Buffer.byteLength(payload)
    if (bytes <= MAX_BYTES) return payload
    const evicted: AgentConversation[] = []
    for (const chat of this.oldestInactive()) {
      bytes -= Buffer.byteLength(JSON.stringify(chat)) + (this.data.conversations.length - evicted.length > 1 ? 1 : 0)
      evicted.push(chat)
      if (bytes <= MAX_BYTES) break
    }
    const current = this.data.conversations.find(chat => chat.id === this.data.currentChatId)
    let trim = 0
    if (current) {
      for (const message of current.messages) {
        if (bytes <= MAX_BYTES) break
        bytes -= Buffer.byteLength(JSON.stringify(message)) + (current.messages.length - trim > 1 ? 1 : 0)
        trim++
      }
    }
    if (bytes > MAX_BYTES) throw new Error(`Agents data exceeds ${AGENT_HISTORY_MIB} MiB after history cleanup.`)
    this.removeConversations(evicted)
    if (current && trim) {
      this.rememberRemovedImages(current.messages.splice(0, trim))
      this.liveConversation?.trimmed(current.messages)
    }
    agentsChanged()
    return JSON.stringify(agentWorkspaceSchema.parse(this.data))
  }

  private changed() {
    agentsChanged()
    if (!this.writable) throw new Error(this.storageError || 'Agents storage is not initialized.')
    this.dirty = true
    if (!this.saveTimer) this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.flush().catch(() => {}) }, 250)
  }
  createConversation() {
    const now = Date.now()
    const chat: AgentConversation = { id: randomUUID(), title: 'New chat', createdAt: now, updatedAt: now, messages: [], model: null, thinking: null }
    this.data.conversations.push(chat)
    this.data.currentChatId = chat.id
    this.pruneHistory(now)
    const overflow = this.data.conversations.length - AGENT_HISTORY_CHATS
    if (overflow > 0) this.removeConversations(this.oldestInactive().slice(0, overflow))
    this.changed()
    return structuredClone(chat)
  }
  selectConversation(id: string) {
    const chat = this.conversation(id)
    if (!chat) throw new Error('That saved chat no longer exists.')
    this.data.currentChatId = id
    this.changed()
    return chat
  }
  recordConversation(messages: AgentMessage[], model: string | null, thinking: string | null, runLimitMinutes = 10) {
    if (this.closed) return
    let chat = this.data.conversations.find(chat => chat.id === this.data.currentChatId)
    if (!chat) { this.createConversation(); chat = this.data.conversations.at(-1)! }
    const retained = messages.slice(-AGENT_HISTORY_MESSAGES)
    if (this.options.removeImage && chat.messages.length && chat.messages[0]?.id !== retained[0]?.id) {
      const retainedIds = new Set(retained.map(message => message.id))
      this.rememberRemovedImages(chat.messages.filter(message => !retainedIds.has(message.id)))
    }
    chat.messages = structuredClone(retained)
    chat.title = messages.find(message => message.role === 'user')?.text.replace(/\s+/g, ' ').slice(0, 100) || 'New chat'
    chat.updatedAt = lastConversationActivity(chat)
    chat.model = model; chat.thinking = thinking
    chat.runLimitMinutes = runLimitMinutes
    this.changed()
  }
  recordCheckpoint(checkpoint: AgentCheckpoint) {
    const chat = this.data.conversations.find(chat => chat.id === this.data.currentChatId)
    if (!chat || this.closed) return
    chat.checkpoint = structuredClone(checkpoint)
    this.changed()
  }
  deleteConversation(id: string) {
    if (id === this.data.currentChatId) throw new Error('Open a different chat or New chat before deleting the active chat.')
    this.data.conversations = this.data.conversations.filter(chat => chat.id !== id)
    this.changed()
  }
  async flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const run = this.queue.catch(() => {}).then(async () => {
      if (!this.dirty) return
      if (!this.writable) throw new Error(this.storageError)
      const payload = this.boundedPayload()
      const imagesToRemove = [...this.removedImages]
      const referenced = imagesToRemove.length
        ? new Set(this.data.conversations.flatMap(chat => chat.messages.flatMap(message => message.imageArtifacts?.map(image => image.id) ?? [])))
        : null
      this.dirty = false
      const target = this.options.path ?? agentWorkspacePath()
      const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
      try {
        await mkdir(dirname(target), { recursive: true })
        await writeFile(temporary, payload, { encoding: 'utf8', mode: 0o600 })
        await rename(temporary, target)
        this.storageError = ''
        if (referenced && this.options.removeImage) {
          for (const id of imagesToRemove) {
            if (!referenced.has(id)) await this.options.removeImage(id).catch(() => {})
            this.removedImages.delete(id)
          }
        }
      } catch (error) {
        this.dirty = true
        throw error
      } finally { await rm(temporary, { force: true }).catch(() => {}) }
    }).catch(error => { this.storageError = `Agents changes could not be saved: ${String(error)}`; throw error })
    this.queue = run
    return run
  }
  async notify(input: AgentNotificationInput, source: AgentNotification['source'], trackerId?: string) {
    if (this.options.notifications) return this.options.notifications.notify(input, source, trackerId)
    const value = notificationInputSchema.parse(input)
    const duplicate = this.data.notifications.find(notification => notification.eventKey === value.eventKey && notification.trackerId === trackerId && Date.now() - notification.at < 24 * 60 * 60_000)
    if (duplicate) return { created: false, duplicate: true, id: duplicate.id }
    const notification: AgentNotification = { ...value, id: randomUUID(), at: Date.now(), read: false, source, ...(trackerId ? { trackerId } : {}) }
    this.data.notifications.push(notification)
    if (this.data.notifications.length > 500) this.data.notifications.shift()
    this.changed()
    await this.flush() // The inbox must be durable before attempting an OS popup.
    try { await this.options.deliver?.(structuredClone(notification)) }
    catch (error) { notification.deliveryError = String(error).slice(0, 1000); this.changed(); await this.flush() }
    return { created: true, id: notification.id, desktopError: notification.deliveryError }
  }
  markNotifications(id?: string) {
    if (this.options.notifications) return this.options.notifications.command({ type: 'read', id })
    for (const notification of this.data.notifications) if (!id || notification.id === id) notification.read = true
    this.changed()
  }
  deleteNotification(id: string) {
    if (this.options.notifications) return this.options.notifications.command({ type: 'dismiss', id })
    this.data.notifications = this.data.notifications.filter(notification => notification.id !== id)
    this.changed()
  }
  saveTracker(input: AgentTrackerDefinition) {
    const definition = trackerDefinitionSchema.parse(input)
    let tracker = definition.id ? this.data.trackers.find(tracker => tracker.id === definition.id) : undefined
    if (definition.id && !tracker) throw new Error('Tracker not found. Read terminal_trackers before editing.')
    if (tracker?.running) throw new Error('Pause this tracker before editing it.')
    if (!tracker && this.data.trackers.length >= 50) throw new Error('Tracker limit reached (50). Remove an old tracker first.')
    const now = Date.now()
    if (!tracker) {
      tracker = { ...definition, id: randomUUID(), createdAt: now, updatedAt: now, enabled: false, running: false, nextRunAt: null, lastRunAt: null, runsRemaining: definition.runLimit, memory: '', lastSummary: '', lastOutcome: null, error: '', lastNotifiedAt: null }
      this.data.trackers.push(tracker)
    } else {
      Object.assign(tracker, definition, { enabled: false, nextRunAt: null, updatedAt: now, runsRemaining: definition.runLimit, memory: '', lastSummary: '', lastOutcome: null, error: '' })
    }
    this.changed(); this.schedule()
    return structuredClone(tracker)
  }
  async removeTracker(id: string) {
    await this.setTrackerEnabled(id, false)
    this.data.trackers = this.data.trackers.filter(tracker => tracker.id !== id)
    this.changed()
  }
  async setTrackerEnabled(id: string, enabled: boolean) {
    const tracker = this.data.trackers.find(tracker => tracker.id === id)
    if (!tracker) throw new Error('Tracker no longer exists.')
    if (enabled && !this.options.check) throw new Error('Tracker execution is unavailable.')
    if (enabled && this.closed) throw new Error('Tracker workspace is closed.')
    tracker.enabled = enabled; tracker.nextRunAt = enabled ? Date.now() : null
    if (enabled) { tracker.runsRemaining = tracker.runLimit; tracker.error = '' }
    else if (this.active?.id === id) {
      this.active.controller.abort()
      await this.active.done
    }
    this.changed(); await this.flush(); this.schedule()
  }
  pauseAll() {
    if (this.closed) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const tracker of this.data.trackers) { tracker.enabled = false; tracker.nextRunAt = null }
    this.active?.controller.abort()
    if (this.writable) this.changed()
  }
  private schedule() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.closed || this.active || !this.options.check) return
    const next = this.data.trackers.filter(tracker => tracker.enabled && tracker.runsRemaining > 0 && tracker.nextRunAt !== null).sort((a, b) => a.nextRunAt! - b.nextRunAt!)[0]
    if (!next) return
    this.timer = setTimeout(() => { this.timer = null; this.startCheck(next.id) }, Math.max(0, next.nextRunAt! - Date.now()))
  }
  private startCheck(id: string) {
    const tracker = this.data.trackers.find(tracker => tracker.id === id)
    if (!tracker?.enabled || this.active || this.closed) return
    const controller = new AbortController()
    const done = Promise.resolve().then(() => this.check(tracker, controller.signal)).finally(() => { this.active = null; this.schedule() })
    this.active = { id, controller, done }
  }
  private async check(tracker: AgentTracker, signal: AbortSignal) {
    tracker.running = true; tracker.nextRunAt = null; tracker.runsRemaining--; tracker.lastRunAt = Date.now()
    this.changed()
    try {
      await this.flush()
      const report = trackerReportSchema.parse(await this.options.check!(structuredClone(tracker), signal))
      if (signal.aborted || !tracker.enabled) return
      tracker.memory = report.memory; tracker.lastSummary = report.summary; tracker.lastOutcome = report.outcome; tracker.error = ''
      if (report.outcome === 'triggered' && report.notification && (tracker.lastNotifiedAt === null || Date.now() - tracker.lastNotifiedAt >= tracker.cooldownMinutes * 60_000)) {
        const sent = await this.notify(report.notification, 'tracker', tracker.id)
        if (sent.created) tracker.lastNotifiedAt = Date.now()
      }
    } catch (error) {
      if (!signal.aborted) { tracker.error = String(error).slice(0, 4000); tracker.enabled = false }
    } finally {
      tracker.running = false
      if (tracker.runsRemaining <= 0) tracker.enabled = false
      tracker.nextRunAt = tracker.enabled && !signal.aborted ? Date.now() + tracker.intervalMinutes * 60_000 : null
      this.changed()
      await this.flush().catch(() => {})
    }
  }
  async close() {
    if (!this.closed) {
      if (this.retentionTimer) clearInterval(this.retentionTimer)
      this.pauseAll()
      this.closed = true
    }
    await this.active?.done
    await this.flush()
  }
}
