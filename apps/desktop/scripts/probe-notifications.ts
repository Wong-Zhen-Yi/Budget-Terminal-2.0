import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotificationCenter } from '../electron/services/notifications.js'
import { AgentWorkspace } from '../electron/services/agentWorkspace.js'
import { movementDelay } from '../electron/shared/notifications.js'
import { startupPages } from '../electron/shared/navigation.js'
import { nextMarketOpen } from '../electron/shared/marketOpenReminder.js'

const directory = await mkdtemp(join(tmpdir(), 'budget-notifications-'))
const previous = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = directory; process.env.LOCALAPPDATA = directory
const resources: { close: () => Promise<unknown> }[] = []
const center = (options: ConstructorParameters<typeof NotificationCenter>[0]) => {
  const value = new NotificationCenter(options); resources.push(value); return value
}
try {
  assert.equal(movementDelay(() => 0), 30 * 60_000)
  assert.equal(movementDelay(() => 1), 45 * 60_000)
  assert.equal(movementDelay(() => .5), 37.5 * 60_000)
  assert(startupPages('dashboard', [], []).includes('movement'))
  assert(startupPages('dashboard', [], []).includes('notifications'))
  const nextOpen = (at: string) => new Date(nextMarketOpen(Date.parse(at))).toISOString()
  assert.equal(nextOpen('2026-03-06T14:30:00Z'), '2026-03-09T13:30:00.000Z', 'Spring DST transition')
  assert.equal(nextOpen('2026-10-30T13:30:00Z'), '2026-11-02T14:30:00.000Z', 'Autumn DST transition')
  assert.equal(nextOpen('2026-07-02T13:30:00Z'), '2026-07-06T13:30:00.000Z', 'Observed July 4 holiday and weekend')
  assert.equal(nextOpen('2026-11-25T14:30:00Z'), '2026-11-27T14:30:00.000Z', 'Thanksgiving closed; half-day still opens')
  assert.equal(nextOpen('2026-12-24T14:30:00Z'), '2026-12-28T14:30:00.000Z', 'Christmas weekend')
  assert.equal(nextOpen('2027-12-30T14:30:00Z'), '2027-12-31T14:30:00.000Z', 'Saturday New Year does not close Friday')
  assert.equal(nextOpen('2026-10-23T13:29:59.999Z'), '2026-10-23T13:30:00.000Z', 'Upcoming opening is included')
  let now = 1_000_000, deliveries = 0, draw = 0
  const path = join(directory, 'notifications.json')
  const store = center({ path, now: () => now, random: () => (draw++ % 2 ? 1 : 0), supported: () => true,
    deliver: async item => {
      const saved = JSON.parse(await readFile(path, 'utf8'))
      assert(saved.notifications.some((value: { id: string }) => value.id === item.id), 'Inbox must be durable before OS delivery')
      deliveries++
    },
  })
  await store.initialize()
  assert.equal(store.snapshot().movement.enabled, false)
  await store.command({ type: 'movement', enabled: true })
  assert.equal(store.snapshot().movement.nextAt, now + 30 * 60_000)
  now += 30 * 60_000 - 1
  await store.tick(); assert.equal(deliveries, 0, 'Never notify early')
  now++
  await Promise.all([store.tick(), store.tick(), store.tick()])
  assert.equal(deliveries, 1, 'Concurrent ticks cannot duplicate a reminder')
  assert.equal(store.snapshot().movement.nextAt, now + 45 * 60_000, 'Draw a new interval each time')
  now += 12 * 60 * 60_000
  await store.tick(); assert.equal(deliveries, 2, 'Only one reminder after sleep')
  assert.equal(store.snapshot().movement.nextAt, now + 30 * 60_000)
  await store.command({ type: 'movement', enabled: false })
  now += 60 * 60_000; await store.tick(); assert.equal(deliveries, 2)
  await store.command({ type: 'test' }); assert.equal(deliveries, 3)
  assert.equal(store.snapshot().movement.enabled, false, 'Test does not start reminders')
  await store.command({ type: 'movement', enabled: true })
  await store.close()
  now += 60 * 60_000
  const restored = center({ path, now: () => now, random: () => .5, supported: () => true, deliver: async () => { deliveries++ } })
  await restored.initialize()
  assert.equal(restored.snapshot().movement.nextAt, now + 37.5 * 60_000)
  assert.equal(deliveries, 3, 'Restart must not replay old notifications')
  await restored.command({ type: 'read' })
  assert(restored.snapshot().notifications.every(item => item.read))
  const dismissed = restored.snapshot().notifications[0].id
  await restored.command({ type: 'dismiss', id: dismissed })
  assert(!restored.snapshot().notifications.some(item => item.id === dismissed))

  const legacyPath = join(directory, 'agents.json')
  const legacy = new AgentWorkspace({ path: legacyPath }); resources.push(legacy)
  await legacy.initialize()
  await legacy.notify({ title: 'Legacy alert', body: 'Saved evidence', eventKey: 'legacy' }, 'chat')
  await legacy.close()
  const migrated = new AgentWorkspace({ path: legacyPath, notifications: restored }); resources.push(migrated)
  await migrated.initialize()
  assert.equal(migrated.snapshot().notifications.length, 1)
  assert.equal(JSON.parse(await readFile(legacyPath, 'utf8')).notifications.length, 0, 'Move legacy ownership to the shared store')
  assert.equal(deliveries, 3, 'Migration must not replay popups')
  await migrated.notify({ title: 'Agent alert', body: 'Independent of page', eventKey: 'agent' }, 'tracker', 'tracker-1')
  const duplicate = await migrated.notify({ title: 'Agent alert', body: 'Independent of page', eventKey: 'agent' }, 'tracker', 'tracker-1')
  assert(duplicate.duplicate)
  assert.equal(deliveries, 4)
  await migrated.markNotifications()
  assert(restored.snapshot().notifications.every(item => item.read))
  await migrated.deleteNotification(migrated.snapshot().notifications[0].id)
  assert.equal(migrated.snapshot().notifications.length, 1)

  const blocked = center({ path: join(directory, 'blocked.json'), supported: () => false, deliver: async () => { throw new Error('OS denied notifications') } })
  await blocked.command({ type: 'test' })
  assert.equal(blocked.snapshot().notifications[0].desktopStatus, 'failed')
  assert.match(blocked.snapshot().notifications[0].deliveryError!, /OS denied/)
  const corruptPath = join(directory, 'corrupt.json')
  await writeFile(corruptPath, 'broken-json')
  const corrupt = center({ path: corruptPath, supported: () => true, deliver: async () => assert.fail('Corrupt storage cannot deliver') })
  await assert.rejects(() => corrupt.command({ type: 'test' }), /original file was left untouched/)
  assert.equal(await readFile(corruptPath, 'utf8'), 'broken-json')
  let unsafeDeliveries = 0
  const unwritablePath = join(directory, 'unwritable.json')
  const unwritable = center({ path: unwritablePath, supported: () => true, deliver: async () => { unsafeDeliveries++ } })
  await unwritable.initialize()
  await mkdir(unwritablePath)
  await assert.rejects(() => unwritable.command({ type: 'test' }), /could not be saved/)
  assert.equal(unsafeDeliveries, 0, 'Never deliver an alert that could not be saved')
  assert.equal(unwritable.snapshot().notifications.length, 0, 'Failed inbox writes roll back the pending notification')
  let marketNow = Date.parse('2026-10-23T13:00:00Z')
  const marketPath = join(directory, 'market.json')
  const delivered: string[] = []
  // Pre-feature store migrates with the new reminder disabled.
  await writeFile(marketPath, JSON.stringify({ version: 1, notifications: [], movement: { enabled: false, nextAt: null, lastAt: null } }))
  const market = center({ path: marketPath, now: () => marketNow, random: () => 0, supported: () => true, deliver: async item => { delivered.push(item.source) } })
  await market.initialize()
  assert.equal(market.snapshot().marketOpen.enabled, false)
  await market.command({ type: 'marketOpen', enabled: true })
  await market.command({ type: 'movement', enabled: true })
  marketNow = Date.parse('2026-10-23T13:29:59.999Z')
  await market.tick(); assert.equal(delivered.length, 0)
  marketNow++
  await Promise.all([market.tick(), market.tick()])
  assert.deepEqual(delivered, ['market-open', 'movement'], 'Independent reminders both deliver once when due together')
  assert.equal(market.snapshot().marketOpen.nextAt, Date.parse('2026-10-26T13:30:00Z'))
  await market.command({ type: 'movement', enabled: false })
  marketNow = Date.parse('2026-10-26T15:00:00Z')
  await market.tick()
  assert.equal(delivered.length, 2, 'Long sleep must not announce a stale opening')
  assert.equal(market.snapshot().marketOpen.nextAt, Date.parse('2026-10-27T13:30:00Z'))
  marketNow = Date.parse('2026-10-27T13:32:00Z')
  await market.tick()
  assert.equal(delivered.length, 3, 'Short sleep may deliver within the five-minute opening window')
  await market.command({ type: 'marketOpen', enabled: false })
  marketNow = Date.parse('2026-10-28T13:30:00Z'); await market.tick()
  assert.equal(delivered.length, 3, 'Disabled market reminder stays quiet')
  await market.command({ type: 'marketOpen', enabled: true })
  await market.close()
  marketNow = Date.parse('2026-11-02T15:00:00Z')
  const resumed = center({ path: marketPath, now: () => marketNow, supported: () => true, deliver: async item => { delivered.push(item.source) } })
  await resumed.initialize()
  assert.equal(resumed.snapshot().marketOpen.enabled, true)
  assert.equal(resumed.snapshot().marketOpen.nextAt, Date.parse('2026-11-03T14:30:00Z'))
  assert.equal(delivered.length, 3, 'Relaunch resumes the next opening without replay')
  console.log('PASS: market-open DST, weekends, holidays, half-days, New Year exception, old-store migration, concurrent due reminders, stale-opening suppression, pause and relaunch')
  assert.throws(() => blocked.command({ type: 'movement', enabled: 'yes' } as never))
  console.log('PASS: random bounds, startup inclusion, due timing, concurrent ticks, sleep recovery, pause/resume, test delivery, persistence/relaunch, shared Agent migration/deduplication, read/dismiss, OS failure fallback, corrupt-file preservation and input validation')
} finally {
  for (const resource of resources.reverse()) await resource.close()
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  await rm(directory, { recursive: true, force: true })
}
