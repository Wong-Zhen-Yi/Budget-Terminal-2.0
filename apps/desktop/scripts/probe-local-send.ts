import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:https'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { LocalSendSync, isLocalSendAddress } from '../electron/services/localSendSync.js'
import { snapshotHash, validateSyncSnapshot, type SyncSnapshot } from '../electron/services/syncSnapshot.js'

const scratch = await mkdtemp(join(tmpdir(), 'budget-localsend-'))
process.env.APPDATA = join(scratch, 'roaming')
process.env.LOCALAPPDATA = join(scratch, 'local')
const { yahooProvider: provider } = await import('../electron/services/provider.js')
const { readSyncSnapshot, applySyncSnapshot } = await import('../electron/services/syncSnapshot.js')
const { onUserDataSaved, configureAutomaticBackup, initializeAutomaticBackup, flushAutomaticBackup } = await import('../electron/services/automaticBackup.js')
const { cache } = await import('../electron/services/cache.js')

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise<void>(resolve => server.close(() => resolve()))
  return address.port
}
function success<T extends { errors: unknown[] }>(result: T): T { assert.deepEqual(result.errors, [], JSON.stringify(result)); return result }
async function eventually(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 8000
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Automatic sync did not complete')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}
let a: LocalSendSync | undefined
let b: LocalSendSync | undefined
let attacker: LocalSendSync | undefined
let unsubscribe = () => {}
let bSnapshot: SyncSnapshot
let appliedA = 0
let appliedB = 0
const bAdapter = {
  read: async () => structuredClone(bSnapshot),
  apply: async (next: SyncSnapshot, expected?: string) => {
    if (expected && expected !== snapshotHash(bSnapshot)) throw new Error('Both devices have changed')
    validateSyncSnapshot(next)
    bSnapshot = structuredClone(next)
    await writeFile(join(scratch, 'b-data.json'), JSON.stringify(next))
    return { hash: snapshotHash(next), recoveryPath: 'fixture recovery' }
  },
  onApplied: () => { appliedB += 1 },
}

async function rawPost(port: number, identityDirectory: string, path: string, body: unknown) {
  const identity = JSON.parse(await readFile(join(identityDirectory, 'localsend.json'), 'utf8'))
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))
  return new Promise<{ code: number; body: any }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'POST', cert: identity.cert, key: identity.key,
      rejectUnauthorized: false, agent: false, headers: { 'content-length': bytes.length } }, res => {
      const parts: Buffer[] = []
      res.on('data', part => parts.push(part))
      res.on('end', () => resolve({ code: res.statusCode!, body: JSON.parse(Buffer.concat(parts).toString()) }))
    })
    req.on('error', reject)
    req.end(bytes)
  })
}

try {
  configureAutomaticBackup(join(scratch, 'Downloads'))
  await initializeAutomaticBackup()
  const portfolioId = (await provider.portfolio()).data.mainId!
  success(await provider.mutatePortfolio({ type: 'addPosition', portfolioId, ticker: 'SYNC' }))
  success(await provider.mutatePortfolio({ type: 'setPosition', portfolioId, ticker: 'SYNC', shares: 7, avgPrice: 42 }))
  success(await provider.mutatePersonalFinance({ type: 'addEntry', category: 'cash' }))
  success(await provider.mutateCards({ type: 'add', name: 'Synced strategy', symbols: ['SPY', 'GLD'], weighting: 'custom', weights: { SPY: 37, GLD: 63 } }))
  const initial = await readSyncSnapshot()
  bSnapshot = structuredClone(initial)
  bSnapshot.settings.time12h = !initial.settings.time12h
  const ports = [await freePort(), await freePort(), await freePort()]
  const aDirectory = join(scratch, 'a')
  const bDirectory = join(scratch, 'b')
  a = new LocalSendSync(aDirectory, {
    read: readSyncSnapshot,
    apply: (next, expected) => applySyncSnapshot(next, expected, join(scratch, 'recovery')),
    onApplied: () => { appliedA += 1 },
  }, false)
  b = new LocalSendSync(bDirectory, bAdapter, false)
  attacker = new LocalSendSync(join(scratch, 'attacker'), bAdapter, false)
  await a.initialize(); await b.initialize(); await attacker.initialize()
  assert.equal(a.status().data.enabled, false)
  success(await a.action({ type: 'enable', enabled: true, port: ports[0] }))
  success(await b.action({ type: 'enable', enabled: true, port: ports[1] }))
  success(await attacker.action({ type: 'enable', enabled: true, port: ports[2] }))
  assert.ok((await a.action({ type: 'connect', address: '8.8.8.8', port: ports[1] })).errors.length)
  success(await a.action({ type: 'connect', address: '127.0.0.1', port: ports[1] }))
  const target = a.status().data.devices.find(device => device.port === ports[1])!
  assert.ok(target?.budgetTerminal)
  success(await b.action({ type: 'openPairing' }))
  assert.ok((await a.action({ type: 'pair', fingerprint: target.fingerprint, code: '000000' })).errors.length)
  success(await a.action({ type: 'pair', fingerprint: target.fingerprint, code: b.status().data.pairingCode! }))
  assert.equal(snapshotHash(bSnapshot), snapshotHash(initial), 'Initial pairing must send the chosen source')
  assert.equal(appliedB, 1)
  assert.equal(a.status().data.devices.find(device => device.port === ports[1])?.paired, true)
  assert.equal(b.status().data.pairingCode, undefined, 'Pairing code must be single use')
  unsubscribe = onUserDataSaved(() => a?.scheduleSync())

  // A renderer/MCP saved edit propagates without manually asking to sync.
  success(await provider.mutatePortfolio({ type: 'setCash', portfolioId, cashBalance: 1234 }))
  await eventually(async () => snapshotHash(bSnapshot) === snapshotHash(await readSyncSnapshot()))
  assert.equal(appliedB, 2)

  // A remote edit updates the real stores, automatic backup, and renderer notification.
  bSnapshot.settings.clockCountry = 'SG'
  bSnapshot.cards.customCards[0].name = 'Remote card edit'
  success(await b.action({ type: 'sync' }))
  assert.equal((await provider.settings()).data.clockCountry, 'SG')
  assert.equal((await provider.cards()).data.customCards[0].name, 'Remote card edit')
  assert.equal(appliedA, 1)
  const beforeConflict = await readSyncSnapshot()
  const exportedLater = structuredClone(beforeConflict)
  exportedLater.exportedAt = new Date(Date.now() + 10000).toISOString()
  exportedLater.settings.lastBackupAt = Date.now()
  assert.equal(snapshotHash(exportedLater), snapshotHash(beforeConflict))
  assert.throws(() => validateSyncSnapshot({ ...initial, version: 99 }))
  assert.throws(() => validateSyncSnapshot({ ...initial, cards: { customCards: [] } }))
  assert.throws(() => validateSyncSnapshot({ ...initial, cards: { ...initial.cards, customCards: [...initial.cards.customCards, initial.cards.customCards[0]] } }))
  assert.throws(() => validateSyncSnapshot({ ...initial, userData: {} }))

  // Both sides changed: do not silently overwrite either copy. Persist the conflict across restart.
  success(await provider.mutatePortfolio({ type: 'setCash', portfolioId, cashBalance: 4321 }))
  bSnapshot.settings.time12h = !bSnapshot.settings.time12h
  const divergentB = snapshotHash(bSnapshot)
  success(await a.action({ type: 'sync' }))
  assert.ok(b.status().data.pending)
  assert.equal(snapshotHash(bSnapshot), divergentB)
  assert.match(a.status().data.devices.find(device => device.port === ports[1])!.error!, /Review/)
  await b.stop()
  b = new LocalSendSync(bDirectory, bAdapter, false)
  await b.initialize()
  assert.equal(b.status().data.running, true, 'Enabled pairing must survive restart')
  assert.ok(b.status().data.pending, 'A conflict must survive restart')
  success(await b.action({ type: 'resolve', id: b.status().data.pending!.id, accept: true }))
  success(await a.action({ type: 'sync' }))
  assert.equal(snapshotHash(bSnapshot), snapshotHash(await readSyncSnapshot()))
  assert.equal(a.status().data.devices.find(device => device.port === ports[1])!.error, undefined)

  // An unpaired TLS identity cannot impersonate a trusted fingerprint in JSON.
  const info = { alias: 'Spoofed', version: '2.0', fingerprint: target.fingerprint, port: ports[2], protocol: 'https', budgetTerminal: true }
  assert.equal((await rawPost(ports[1], join(scratch, 'attacker'), '/api/localsend/v2/prepare-upload', { info, files: {} })).code, 403)
  assert.equal((await rawPost(ports[1], join(scratch, 'attacker'), '/api/budget-terminal/state', info)).code, 403)

  // Actual LocalSend prepare/upload routes enforce IP, certificate, tokens and checksums.
  const bytes = Buffer.from(JSON.stringify(await readSyncSnapshot()))
  const transfer = await rawPost(ports[1], aDirectory, '/api/localsend/v2/prepare-upload', {
    info, syncBaseHash: snapshotHash(bSnapshot), files: { probe: { id: 'probe', fileName: 'budget-terminal-backup.json', size: bytes.length, sha256: '0'.repeat(64) } },
  })
  assert.equal(transfer.code, 200)
  const params = new URLSearchParams({ sessionId: transfer.body.sessionId, fileId: 'probe', token: transfer.body.files.probe })
  assert.equal((await rawPost(ports[1], join(scratch, 'attacker'), `/api/localsend/v2/upload?${params}`, bytes)).code, 403)
  assert.equal((await rawPost(ports[1], aDirectory, `/api/localsend/v2/upload?${params}`, bytes)).code, 422)
  assert.equal(b.status().data.pending, undefined)
  const saved = await readSyncSnapshot()
  await assert.rejects(applySyncSnapshot(initial, '0'.repeat(64), join(scratch, 'recovery')), /Both devices/)
  assert.equal(snapshotHash(await readSyncSnapshot()), snapshotHash(saved))
  // A mid-import disk failure must preserve the complete pre-sync snapshot for recovery.
  const { settingsPath } = await import('../electron/services/settingsStore.js')
  const blocked = `${settingsPath()}.${process.pid}.tmp`
  assert.ok(!relative(scratch, blocked).startsWith('..'))
  await mkdir(blocked)
  try {
    await assert.rejects(applySyncSnapshot(initial, snapshotHash(saved), join(scratch, 'recovery')), /rollback failed.*Restore/)
    assert.equal(snapshotHash(await readSyncSnapshot()), snapshotHash(saved), 'A failed sync must not leave partially replaced data')
    const files = await readdir(join(scratch, 'recovery'))
    assert.ok(files.length >= 2)
    for (const file of files) validateSyncSnapshot(JSON.parse(await readFile(join(scratch, 'recovery', file), 'utf8')))
  } finally { await rm(blocked, { recursive: true }) }
  const applied = await applySyncSnapshot(initial, snapshotHash(saved), join(scratch, 'recovery'))
  assert.equal(snapshotHash(validateSyncSnapshot(JSON.parse(await readFile(applied.recoveryPath, 'utf8')))), snapshotHash(saved), 'Recovery includes all three stores')
  const automatic = validateSyncSnapshot(JSON.parse(await readFile(join(scratch, 'Downloads/budget-terminal-backup.json'), 'utf8')))
  assert.equal(snapshotHash(automatic), snapshotHash(await readSyncSnapshot()))

  // A peer which was offline keeps its edits and can resume with its pinned identity.
  await b.stop()
  success(await provider.mutatePortfolio({ type: 'setCash', portfolioId, cashBalance: 777 }))
  success(await a.action({ type: 'sync' }))
  assert.ok(a.status().data.devices.find(device => device.port === ports[1])!.error)
  b = new LocalSendSync(bDirectory, bAdapter, false)
  await b.initialize()
  success(await a.action({ type: 'sync' }))
  // The earlier local snapshot replacement can make this a conflict, which still must not discard edits.
  if (b.status().data.pending) success(await b.action({ type: 'resolve', id: b.status().data.pending!.id, accept: true }))
  success(await a.action({ type: 'sync' }))
  assert.equal(snapshotHash(bSnapshot), snapshotHash(await readSyncSnapshot()))

  success(await a.action({ type: 'forget', fingerprint: target.fingerprint }))
  assert.equal((await rawPost(ports[0], bDirectory, '/api/budget-terminal/state', info)).code, 403)
  success(await a.action({ type: 'enable', enabled: false }))
  assert.equal(a.status().data.running, false)
  for (const address of ['10.1.2.3', '192.168.1.2', '172.16.0.1', '169.254.1.2', '127.0.0.1']) assert.equal(isLocalSendAddress(address), true)
  for (const address of ['8.8.8.8', '172.32.0.1', 'localhost', '192.168.999.1', '127.0.0.1/path']) assert.equal(isLocalSendAddress(address), false)
  console.log('PASS: encrypted pairing, automatic bidirectional sync, startup persistence, conflicts/restart/review, spoofed identities, upload tokens/checksums, strict snapshots, recovery backups, unpairing and LAN restrictions')
} finally {
  unsubscribe()
  await a?.stop(); await b?.stop(); await attacker?.stop()
  await flushAutomaticBackup()
  cache.close()
  assert.ok(!relative(tmpdir(), scratch).startsWith('..'))
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
