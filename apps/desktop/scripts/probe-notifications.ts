import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotificationCenter } from '../electron/services/notifications.js'
import { AgentWorkspace } from '../electron/services/agentWorkspace.js'
import { movementDelay } from '../electron/shared/notifications.js'
import { startupPages } from '../electron/shared/navigation.js'

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
  assert.throws(() => blocked.command({ type: 'movement', enabled: 'yes' } as never))
  console.log('PASS: random bounds, startup inclusion, due timing, concurrent ticks, sleep recovery, pause/resume, test delivery, persistence/relaunch, shared Agent migration/deduplication, read/dismiss, OS failure fallback, corrupt-file preservation and input validation')
} finally {
  for (const resource of resources.reverse()) await resource.close()
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  await rm(directory, { recursive: true, force: true })
}
