import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { agentWorkspaceSchema, notificationInputSchema, trackerDefinitionSchema, trackerReportSchema } from '../shared/agentWorkspace.js'
import type { AgentConversation, AgentNotification, AgentNotificationInput, AgentTracker, AgentTrackerDefinition, AgentTrackerReport, AgentWorkspaceData, AgentWorkspaceState } from '../shared/agentWorkspace.js'
import type { AgentMessage } from '../shared/agents.js'

const MAX_BYTES = 50 * 1024 * 1024
export function agentWorkspacePath() {
  return join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'), 'BudgetTerminalElectron', 'agents.json')
}
interface Options {
  path?: string
  deliver?: (notification: AgentNotification) => Promise<void> | void
  check?: (tracker: AgentTracker, signal: AbortSignal) => Promise<AgentTrackerReport>
}

/** One atomic, serialized local store. No credentials, image bytes, thread IDs or executable code. */
export class AgentWorkspace {
  private data: AgentWorkspaceData = { version: 1, currentChatId: null, conversations: [], notifications: [], trackers: [] }
  private initialized: Promise<void> | null = null
  private writable = false
  private dirty = false
  private queue: Promise<void> = Promise.resolve()
  private saveTimer: NodeJS.Timeout | null = null
  private timer: NodeJS.Timeout | null = null
  private active: { id: string; controller: AbortController; done: Promise<void> } | null = null
  private closed = false
  storageError = ''
  constructor(private options: Options = {}) {}

  initialize() {
    this.initialized ??= this.load()
    return this.initialized
  }
  private async load() {
    try {
      const raw = await readFile(this.options.path ?? agentWorkspacePath())
      if (raw.length > MAX_BYTES) throw new Error('Agents history exceeds the 50 MB limit.')
      this.data = agentWorkspaceSchema.parse(JSON.parse(raw.toString('utf8')))
      if (new Set(this.data.conversations.map(chat => chat.id)).size !== this.data.conversations.length
        || new Set(this.data.trackers.map(tracker => tracker.id)).size !== this.data.trackers.length) throw new Error('Duplicate IDs in Agents data.')
      // Saved definitions survive, but background work always needs explicit consent after launch.
      for (const tracker of this.data.trackers) {
        if (tracker.running) tracker.error = 'The app closed during this check. Review and start again.'
        tracker.enabled = false; tracker.running = false; tracker.nextRunAt = null
      }
      if (!this.data.conversations.some(chat => chat.id === this.data.currentChatId)) this.data.currentChatId = null
      this.writable = true
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') this.writable = true
      else {
        this.storageError = `Agents data could not be loaded; the original file was left untouched. ${String(error)}`
        throw new Error(this.storageError)
      }
    }
  }
  snapshot(): AgentWorkspaceState {
    return structuredClone({
      currentChatId: this.data.currentChatId,
      history: this.data.conversations.map(({ messages, ...chat }) => ({ ...chat, messageCount: messages.filter(message => message.role !== 'activity').length })).sort((a, b) => b.updatedAt - a.updatedAt),
      notifications: [...this.data.notifications].reverse(), trackers: this.data.trackers, storageError: this.storageError,
    })
  }
  conversation(id = this.data.currentChatId) { return structuredClone(this.data.conversations.find(chat => chat.id === id) ?? null) }
  private changed() {
    if (!this.writable) throw new Error(this.storageError || 'Agents storage is not initialized.')
    this.dirty = true
    if (!this.saveTimer) this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.flush().catch(() => {}) }, 250)
  }
  createConversation() {
    if (this.data.conversations.length >= 100) throw new Error('History is full (100 chats). Delete an old chat before creating another.')
    const now = Date.now()
    const chat: AgentConversation = { id: randomUUID(), title: 'New chat', createdAt: now, updatedAt: now, messages: [], model: null, thinking: null }
    this.data.conversations.push(chat)
    this.data.currentChatId = chat.id
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
  recordConversation(messages: AgentMessage[], model: string | null, thinking: string | null) {
    if (this.closed) return
    let chat = this.data.conversations.find(chat => chat.id === this.data.currentChatId)
    if (!chat) { this.createConversation(); chat = this.data.conversations.at(-1)! }
    chat.messages = structuredClone(messages.slice(-300))
    chat.title = messages.find(message => message.role === 'user')?.text.replace(/\s+/g, ' ').slice(0, 100) || 'New chat'
    chat.updatedAt = Date.now(); chat.model = model; chat.thinking = thinking
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
      const payload = JSON.stringify(agentWorkspaceSchema.parse(this.data))
      if (Buffer.byteLength(payload) > MAX_BYTES) throw new Error('Agents data exceeds 50 MB. Delete older chats or notifications.')
      this.dirty = false
      const target = this.options.path ?? agentWorkspacePath()
      const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
      try {
        await mkdir(dirname(target), { recursive: true })
        await writeFile(temporary, payload, { encoding: 'utf8', mode: 0o600 })
        await rename(temporary, target)
        this.storageError = ''
      } catch (error) {
        this.dirty = true
        throw error
      } finally { await rm(temporary, { force: true }).catch(() => {}) }
    }).catch(error => { this.storageError = `Agents changes could not be saved: ${String(error)}`; throw error })
    this.queue = run
    return run
  }
  async notify(input: AgentNotificationInput, source: AgentNotification['source'], trackerId?: string) {
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
    for (const notification of this.data.notifications) if (!id || notification.id === id) notification.read = true
    this.changed()
  }
  deleteNotification(id: string) {
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
      this.pauseAll()
      this.closed = true
    }
    await this.active?.done
    await this.flush()
  }
}
