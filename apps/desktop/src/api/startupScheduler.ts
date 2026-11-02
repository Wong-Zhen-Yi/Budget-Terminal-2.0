import { hashKey, type QueryKey } from '@tanstack/react-query'
import { retryTransientData } from '@shared/dataRetry'
import type { StartupTiming } from '@/stores/dataHealth'
import { StartupLoadError, type StartupSnapshotObserver } from './warmQueue'
import { startupRefreshDelay } from './startupHealth'
import { errorMessage } from './snapshotHealth'

export interface StartupTask {
  id: string
  tab: string
  label: string
  refresh?: boolean
  refreshIntervalMs?: number
  run: (observe: StartupSnapshotObserver, maintenance: boolean) => Promise<unknown>
}

interface TaskState {
  state: 'ready' | 'degraded' | 'failed'
  reason?: string
}

interface Entry {
  task: StartupTask
  startedAt: number
  timing?: StartupTiming
  status?: TaskState
  retryReason?: string
  snapshots: Array<{ key: QueryKey; result: unknown }>
  cachedAt?: number
  timer?: ReturnType<typeof setTimeout>
  refreshing?: boolean
  running?: Promise<unknown>
}

/** A session-long plan: edits replace affected tasks without abandoning other pages. */
export function createStartupScheduler(options: {
  onChange: (complete: boolean) => void
  onSnapshot: (page: string, key: QueryKey, result: unknown, error?: unknown) => void
  onPageSettled?: (page: string, timings: StartupTiming[]) => void
  onRetired?: (owner: object) => void
  now?: () => number
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
}) {
  const now = options.now ?? (() => performance.now())
  const setTimer = options.setTimer ?? setTimeout
  const clearTimer = options.clearTimer ?? clearTimeout
  const entries = new Map<string, Entry>()
  const startedAt = now()
  let completedAt = startedAt
  let stopped = false
  let pending = 0
  let reloaded: Set<string> | undefined
  const notify = () => options.onChange(pending === 0)
  const current = (entry: Entry) => !stopped && entries.get(entry.task.id) === entry
  const classify = (error: unknown): TaskState => ({
    state: error instanceof StartupLoadError && error.state === 'degraded' ? 'degraded' : 'failed',
    reason: errorMessage(error),
  })

  async function run(entry: Entry, maintenance = false, force = false) {
    // Keep only metadata for scheduling; old chart payloads must remain collectible.
    entry.snapshots = []
    entry.cachedAt = undefined
    const observe: StartupSnapshotObserver = (key, result, error, cached) => {
      if (!current(entry)) return
      const meta = (result as { meta?: unknown } | null)?.meta
      const hash = hashKey(key)
      entry.snapshots = entry.snapshots.filter(snapshot => hashKey(snapshot.key) !== hash)
      entry.snapshots.push({ key, result: meta ? { meta } : undefined })
      const fetchedAt = (result as { meta?: { fetchedAt?: number } } | undefined)?.meta?.fetchedAt
      if (fetchedAt) entry.cachedAt = Math.min(entry.cachedAt ?? Infinity, fetchedAt)
      options.onSnapshot(entry.task.tab, key, result, error)
      if (cached) notify()
    }
    observe.owner = entry
    observe.force = force
    observe.reloaded = reloaded
    return entry.task.run(observe, maintenance)
  }

  async function refresh(entry: Entry, force = false) {
    if (!current(entry) || entry.refreshing) return
    entry.refreshing = true
    notify()
    let status: TaskState = { state: 'ready' }
    try { await run(entry, true, force) } catch (error) { status = classify(error) }
    if (!current(entry)) return
    entry.refreshing = false
    entry.status = status
    maintain(entry)
    notify()
  }

  function maintain(entry: Entry) {
    if (!current(entry) || entry.task.refresh === false) return
    const delay = entry.task.refreshIntervalMs ?? startupRefreshDelay(entry.snapshots, entry.status?.state !== 'ready')
    if (!Number.isFinite(delay)) return
    entry.timer = setTimer(() => {
      entry.timer = undefined
      if (!current(entry)) return
      entry.running = refresh(entry)
    }, delay)
  }

  async function start(entry: Entry) {
    let status: TaskState = { state: 'ready' }
    try {
      await retryTransientData(() => run(entry), {
        maxAttempts: 2,
        // Outlast the main-process cache's 10s failure coalescing window.
        baseDelayMs: 12_000,
        isCancelled: () => !current(entry),
        onRetry: (error, attempt, delayMs) => {
          entry.retryReason = `Retry ${attempt}/2 in ${Math.ceil(delayMs / 1000)}s: ${errorMessage(error)}`
          notify()
        },
      })
    } catch (error) { status = classify(error) }
    if (!current(entry)) return
    entry.status = status
    entry.retryReason = undefined
    completedAt = now()
    entry.timing = { tab: entry.task.tab, label: entry.task.label,
      durationMs: completedAt - entry.startedAt, failed: status.state === 'failed', ...status }
    pending -= 1
    // Each completed task owns its maintenance immediately, even while another
    // page is pending. Refreshes never overwrite the historical initial attempt.
    maintain(entry)
    const pageEntries = [...entries.values()].filter(value => value.task.tab === entry.task.tab)
    if (pageEntries.every(value => value.timing)) {
      options.onPageSettled?.(entry.task.tab, pageEntries.map(value => value.timing!))
    }
    notify()
  }

  let reloadPromise: Promise<void> | undefined
  return {
    /** Finish the focused page before checking every other prepared page. */
    reload(page: string, reloadMounted?: () => Promise<Set<string>>) {
      if (reloadPromise) return reloadPromise
      const check = async (entry: Entry, force: boolean) => {
        await entry.running
        if (!current(entry)) return
        clearTimer(entry.timer)
        entry.timer = undefined
        entry.running = refresh(entry, force)
        await entry.running
      }
      reloadPromise = (async () => {
        reloaded = await reloadMounted?.() ?? new Set()
        const plan = [...entries.values()]
        await Promise.all(plan.filter(entry => entry.task.tab === page).map(entry => check(entry, true)))
        await Promise.all(plan.filter(entry => entry.task.tab !== page).map(entry => check(entry, false)))
      })().finally(() => { reloadPromise = undefined; reloaded = undefined })
      return reloadPromise
    },
    /** Retry only settled unhealthy tasks; leave healthy and in-flight pages alone. */
    retry(page?: string) {
      for (const entry of entries.values()) {
        if (!entry.timing || entry.refreshing || entry.status?.state === 'ready' || (page && entry.task.tab !== page)) continue
        clearTimer(entry.timer)
        entry.timer = undefined
        entry.running = refresh(entry)
      }
    },
    reconcile(tasks: readonly StartupTask[]) {
      if (stopped) return
      const ids = new Set(tasks.map(task => task.id))
      for (const [id, entry] of entries) {
        if (ids.has(id)) continue
        entries.delete(id)
        if (!entry.timing) pending -= 1
        clearTimer(entry.timer)
        options.onRetired?.(entry)
      }
      const added: Entry[] = []
      for (const task of tasks) {
        if (entries.has(task.id)) continue
        const entry: Entry = { task, startedAt: now(), snapshots: [] }
        entries.set(task.id, entry)
        pending += 1
        added.push(entry)
      }
      // Register the whole plan before starting any work, so no page can briefly
      // appear complete while its remaining tasks are still being registered.
      for (const entry of added) entry.running = start(entry)
      notify()
    },
    snapshot() {
      const values = [...entries.values()]
      const pending = values.filter(entry => !entry.timing)
      return {
        durationMs: (pending.length ? now() : completedAt) - startedAt,
        active: pending.length > 0,
        done: values.length - pending.length,
        total: values.length,
        label: pending[0]?.task.label ?? '',
        failed: values.filter(entry => entry.status?.state === 'failed').length,
        degraded: values.filter(entry => entry.status?.state === 'degraded').length,
        timings: values.flatMap(entry => entry.timing ? [entry.timing] : []),
        pages: Object.fromEntries([...new Set(values.map(entry => entry.task.tab))].map(page => {
          const tasks = values.filter(entry => entry.task.tab === page)
          const loading = tasks.some(entry => !entry.timing)
          const worst = tasks.find(entry => entry.status?.state === 'failed')?.status
            ?? tasks.find(entry => entry.status?.state === 'degraded')?.status
          const cachedTimes = tasks.flatMap(entry => entry.cachedAt ? [entry.cachedAt] : [])
          return [page, { ...(loading ? { state: 'loading' as const, reason: tasks.find(entry => entry.retryReason)?.retryReason }
            : worst ?? { state: 'ready' as const }), refreshing: tasks.some(entry => entry.refreshing),
            ...(cachedTimes.length ? { cachedAt: Math.min(...cachedTimes) } : {}) }]
        })),
      }
    },
    stop() {
      stopped = true
      for (const entry of entries.values()) {
        clearTimer(entry.timer)
        options.onRetired?.(entry)
      }
      entries.clear()
    },
  }
}
