import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { movementDelay, notificationCommandSchema, notificationInputSchema, notificationSchema, notificationStoreSchema } from '../shared/notifications.js'
import type { AppNotification, NotificationCommand, NotificationData, NotificationInput, NotificationsState } from '../shared/notifications.js'

interface Options {
  path?: string
  deliver: (notification: AppNotification) => Promise<void>
  supported: () => boolean
  now?: () => number
  random?: () => number
}

/** Shared durable inbox and main-process scheduler, independent of Agent connections and page mounts. */
export class NotificationCenter {
  private data: NotificationData = { version: 1, notifications: [], movement: { enabled: false, nextAt: null, lastAt: null } }
  private initialized: Promise<void> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private timer: NodeJS.Timeout | null = null
  private closed = false
  storageError = ''
  setupError = ''
  constructor(private options: Options) {}
  private now() { return this.options.now?.() ?? Date.now() }
  private nextAt() { return this.now() + movementDelay(this.options.random) }
  private path() { return this.options.path ?? join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'), 'BudgetTerminalElectron', 'notifications.json') }
  initialize() {
    return this.initialized ??= this.load().catch(error => { this.initialized = null; throw error })
  }
  private async load() {
    try {
      const raw = await readFile(this.path())
      if (raw.length > 16 * 1024 * 1024) throw new Error('Notification store exceeds 16 MB.')
      this.data = notificationStoreSchema.parse(JSON.parse(raw.toString('utf8')))
      if (new Set(this.data.notifications.map(item => item.id)).size !== this.data.notifications.length) throw new Error('Duplicate notification IDs.')
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
        this.storageError = `Notifications could not load; the original file was left untouched. ${String(error)}`
        throw new Error(this.storageError)
      }
    }
    // Start a fresh interval after relaunch; never replay missed reminders.
    if (this.data.movement.enabled) { this.data.movement.nextAt = this.nextAt(); await this.save() }
    this.schedule()
  }
  snapshot(): NotificationsState {
    return structuredClone({ ...this.data, notifications: [...this.data.notifications].reverse(), supported: this.options.supported(), storageError: this.storageError, setupError: this.setupError })
  }
  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.catch(() => {}).then(async () => {
      await this.initialize()
      if (this.closed) throw new Error('Notifications are shutting down.')
      return run()
    })
    this.queue = result
    return result
  }
  private async save() {
    const target = this.path()
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      await mkdir(dirname(target), { recursive: true })
      await writeFile(temporary, JSON.stringify(notificationStoreSchema.parse(this.data)), { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, target)
      this.storageError = ''
    } catch (error) {
      this.storageError = `Notification changes could not be saved: ${String(error)}`
      throw new Error(this.storageError)
    } finally { await rm(temporary, { force: true }).catch(() => {}) }
  }
  /** Import by stable ID before clearing the old inbox. Safe to retry after a crash. */
  importLegacy(items: AppNotification[]) {
    return this.enqueue(async () => {
      for (const item of items) if (!this.data.notifications.some(existing => existing.id === item.id)) this.data.notifications.push(notificationSchema.parse(item))
      this.data.notifications.sort((a, b) => a.at - b.at)
      this.data.notifications = this.data.notifications.slice(-500)
      await this.save()
    })
  }
  notify(input: NotificationInput, source: AppNotification['source'], trackerId?: string) {
    return this.enqueue(() => this.create(input, source, trackerId))
  }
  private async create(input: NotificationInput, source: AppNotification['source'], trackerId?: string) {
    const value = notificationInputSchema.parse(input)
    const duplicate = this.data.notifications.find(item => item.source === source && item.eventKey === value.eventKey && item.trackerId === trackerId && this.now() - item.at < 86_400_000)
    if (duplicate) return { created: false, duplicate: true, id: duplicate.id }
    const item: AppNotification = { ...value, source, id: randomUUID(), at: this.now(), read: false, desktopStatus: 'pending', ...(trackerId ? { trackerId } : {}) }
    this.data.notifications.push(item)
    const before = this.data.notifications.slice(0, -1)
    this.data.notifications = this.data.notifications.slice(-500)
    try { await this.save() } catch (error) { this.data.notifications = before; throw error }
    try { await this.options.deliver(structuredClone(item)); item.desktopStatus = 'shown' }
    catch (error) { item.desktopStatus = 'failed'; item.deliveryError = String(error).slice(0, 1000) }
    await this.save()
    return { created: true, id: item.id, desktopError: item.deliveryError }
  }
  command(input: NotificationCommand) {
    const command = notificationCommandSchema.parse(input)
    return this.enqueue(async () => {
      if (command.type === 'movement') {
        const before = { ...this.data.movement }
        this.data.movement.enabled = command.enabled
        this.data.movement.nextAt = command.enabled ? this.nextAt() : null
        try { await this.save() } catch (error) { this.data.movement = before; throw error }
        this.schedule()
      } else if (command.type === 'test') {
        await this.create({ title: 'Budget Terminal · Test notification', body: 'Desktop notifications are working. Movement reminders use this same notification system.', eventKey: randomUUID() }, 'test')
      } else {
        const before = structuredClone(this.data.notifications)
        if (command.type === 'read') for (const item of this.data.notifications) { if (!command.id || item.id === command.id) item.read = true }
        else this.data.notifications = this.data.notifications.filter(item => item.id !== command.id)
        try { await this.save() } catch (error) { this.data.notifications = before; throw error }
      }
      return this.snapshot()
    })
  }
  /** One overdue reminder after sleep, followed by a fresh interval, without catch-up bursts. */
  tick() {
    return this.enqueue(async () => {
      const movement = this.data.movement
      if (!movement.enabled || movement.nextAt === null || movement.nextAt > this.now()) return
      movement.lastAt = this.now()
      movement.nextAt = this.nextAt()
      await this.save()
      await this.create({ title: 'Time to move', body: 'Stand up, stretch, or take a short walk. Your next reminder will arrive in 30–45 minutes.', eventKey: randomUUID() }, 'movement')
    }).finally(() => this.schedule())
  }
  private schedule() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.closed || !this.data.movement.enabled || this.data.movement.nextAt === null) return
    this.timer = setTimeout(() => { this.timer = null; void this.tick().catch(() => {}) }, Math.min(15_000, Math.max(0, this.data.movement.nextAt - this.now())))
    this.timer.unref()
  }
  async close() {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await this.queue.catch(() => {})
  }
}
