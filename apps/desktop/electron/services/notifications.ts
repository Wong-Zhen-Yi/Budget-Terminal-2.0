import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseNotificationStore, notificationCommandSchema, notificationInputSchema, notificationSchema, notificationStoreSchema } from '../shared/notifications.js'
import type { AppNotification, NotificationCommand, NotificationData, NotificationInput, NotificationsState } from '../shared/notifications.js'
import { nextMarketOpen } from '../shared/marketOpenReminder.js'

interface Options {
  path?: string
  deliver: (notification: AppNotification) => Promise<void>
  supported: () => boolean
  now?: () => number
}

/** Shared durable inbox and main-process scheduler, independent of Agent connections and page mounts. */
export class NotificationCenter {
  private data: NotificationData = { version: 2, notifications: [], marketOpen: { enabled: false, nextAt: null, lastAt: null } }
  private initialized: Promise<void> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private timer: NodeJS.Timeout | null = null
  private closed = false
  storageError = ''
  setupError = ''
  constructor(private options: Options) {}
  private now() { return this.options.now?.() ?? Date.now() }
  private path() { return this.options.path ?? join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'), 'BudgetTerminalElectron', 'notifications.json') }
  initialize() {
    return this.initialized ??= this.load().catch(error => { this.initialized = null; throw error })
  }
  private async load() {
    let migrated = false
    try {
      const raw = await readFile(this.path())
      if (raw.length > 16 * 1024 * 1024) throw new Error('Notification store exceeds 16 MB.')
      const input: unknown = JSON.parse(raw.toString('utf8'))
      this.data = parseNotificationStore(input)
      migrated = !!input && typeof input === 'object' && 'version' in input && input.version === 1
      if (new Set(this.data.notifications.map(item => item.id)).size !== this.data.notifications.length) throw new Error('Duplicate notification IDs.')
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
        this.storageError = `Notifications could not load; the original file was left untouched. ${String(error)}`
        throw new Error(this.storageError)
      }
    }
    if (this.data.marketOpen.enabled) this.data.marketOpen.nextAt = nextMarketOpen(this.now())
    if (migrated || this.data.marketOpen.enabled) await this.save()
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
      if (command.type === 'marketOpen') {
        const before = { ...this.data.marketOpen }
        this.data.marketOpen.enabled = command.enabled
        this.data.marketOpen.nextAt = command.enabled ? nextMarketOpen(this.now()) : null
        try { await this.save() } catch (error) { this.data.marketOpen = before; throw error }
        this.schedule()
      } else if (command.type === 'test') {
        await this.create({ title: 'Budget Terminal · Test notification', body: 'Desktop notifications are working. Agent alerts and market-open reminders use this same notification system.', eventKey: randomUUID() }, 'test')
      } else {
        const before = structuredClone(this.data.notifications)
        if (command.type === 'read') for (const item of this.data.notifications) { if (!command.id || item.id === command.id) item.read = true }
        else this.data.notifications = this.data.notifications.filter(item => item.id !== command.id)
        try { await this.save() } catch (error) { this.data.notifications = before; throw error }
      }
      return this.snapshot()
    })
  }
  /** Deliver timely market openings without catch-up bursts after sleep. */
  tick() {
    return this.enqueue(async () => {
      const market = this.data.marketOpen
      if (market.enabled && market.nextAt !== null && market.nextAt <= this.now()) {
        const opening = market.nextAt
        market.nextAt = nextMarketOpen(this.now())
        const timely = this.now() - opening <= 5 * 60_000
        if (timely) market.lastAt = opening
        await this.save()
        // Do not announce an old opening after a long sleep or closed-app period.
        if (timely) await this.create({ title: 'U.S. stock market is open', body: 'The regular U.S. stock market session is scheduled to open now — 9:30 AM New York time.', eventKey: `market-open-${opening}` }, 'market-open')
      }
    }).finally(() => this.schedule())
  }
  private schedule() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const due = [this.data.marketOpen].filter(reminder => reminder.enabled && reminder.nextAt !== null).map(reminder => reminder.nextAt!)
    if (this.closed || !due.length) return
    this.timer = setTimeout(() => { this.timer = null; void this.tick().catch(() => {}) }, Math.min(15_000, Math.max(0, Math.min(...due) - this.now())))
    this.timer.unref()
  }
  async close() {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await this.queue.catch(() => {})
  }
}
