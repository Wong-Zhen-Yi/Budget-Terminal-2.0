import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const directory = mkdtempSync(join(tmpdir(), 'budget-diagnostics-'))
const saved = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = join(directory, 'roaming')
process.env.LOCALAPPDATA = join(directory, 'local')
try {
  const { DiagnosticLog, readDiagnosticLogs, faultCode, diagnosticRequest, diagnosticDirectory, diagnosticRequestContext } = await import('../electron/services/diagnosticLog.js')
  const { CHANNELS } = await import('../electron/shared/contract.js')
  const logDirectory = join(directory, 'rotation')
  const log = new DiagnosticLog(logDirectory, 600, 2400)
  for (let index = 0; index < 30; index++) log.write('info', 'test', 'rotation', { index })
  const files = readdirSync(logDirectory)
  assert(files.length > 1 && files.length <= 4, 'Rotation must retain a bounded number of files')
  assert(files.reduce((size, file) => size + statSync(join(logDirectory, file)).size, 0) <= 2400)
  assert(readDiagnosticLogs(logDirectory).entries.length > 0)
  const newest = join(logDirectory, files.at(-1)!)
  appendFileSync(newest, '{broken}\n{"partial":')
  assert(readDiagnosticLogs(logDirectory).entries.length > 0, 'Damaged and partial records must not hide good records')
  writeFileSync(join(logDirectory, 'settings.json'), '{"private":"fixture"}')
  assert(!JSON.stringify(readDiagnosticLogs(logDirectory)).includes('fixture'))
  const old = join(logDirectory, 'session-2000T01-00000000-0000-0000-0000-000000000000-0.jsonl')
  writeFileSync(old, '{}\n')
  utimesSync(old, new Date(0), new Date(0))
  const recent = join(logDirectory, 'session-2001T01-00000000-0000-0000-0000-000000000000-0.jsonl')
  const expired = join(logDirectory, 'session-2002T01-00000000-0000-0000-0000-000000000000-0.jsonl')
  for (const [path, ageDays] of [[recent, 14.5], [expired, 15.5]] as const) {
    writeFileSync(path, '{}\n')
    const modified = new Date(Date.now() - ageDays * 86400_000)
    utimesSync(path, modified, modified)
  }
  new DiagnosticLog(logDirectory).write('info', 'test', 'retention')
  assert(!readdirSync(logDirectory).includes(basename(old)), 'Expired files must be removed')
  assert(readdirSync(logDirectory).includes(basename(recent)), 'Logs newer than 15 days must remain within the storage budget')
  assert(!readdirSync(logDirectory).includes(basename(expired)), 'Logs older than 15 days must be removed')

  const blocked = join(directory, 'not-a-directory')
  writeFileSync(blocked, 'fixture')
  const unavailable = new DiagnosticLog(blocked)
  assert.doesNotThrow(() => unavailable.write('error', 'test', 'disk-failure'))
  assert(unavailable.status().failure.includes('unavailable'))
  const flooded = new DiagnosticLog(join(directory, 'flood'))
  for (let index = 0; index < 3000; index++) flooded.write('debug', 'test', 'flood')
  assert(flooded.status().dropped > 0, 'A log storm must be bounded')
  flooded.write('error', 'app', 'startup-failed', { stage: 'services' })
  flooded.write('info', 'startup', 'page-state', { page: 'news', state: 'ready' })
  flooded.write('info', 'service', 'request-complete', { id: 1 })
  const protectedEvents = readDiagnosticLogs(join(directory, 'flood')).entries
  for (const event of ['startup-failed', 'page-state', 'request-complete']) {
    assert(protectedEvents.some(entry => entry.event === event), `${event} must survive a debug flood`)
  }
  assert(flooded.status().droppedDebug > 0 && flooded.status().droppedImportant === 0)
  for (let index = 0; index < 3000; index++) flooded.write('warn', 'test', 'important-flood')
  assert(flooded.status().droppedImportant > 0, 'Important events still need a bounded rate')
  assert.equal(faultCode(new Error('Cannot find package fixture')), 'module-unavailable')
  assert.equal(faultCode(new Error('Application data is already in use')), 'data-locked')
  assert.equal(faultCode('HTTP 429 Authorization: Bearer fake-private-token'), 'rate-limited')
  assert.equal(faultCode(new Error('fetch failed https://private.invalid/?key=fixture')), 'network')
  assert.equal(faultCode('personal-fixture@example.invalid'), 'unknown')
  const secret = 'sensitive-fixture-do-not-persist'
  const result = { data: { secret }, meta: { freshness: 'partial' }, errors: [{ reason: `429 ${secret}` }] }
  assert.equal(await diagnosticRequest(CHANNELS.quotes, () => result), result)
  const failure = new Error(`timeout ${secret}`)
  await assert.rejects(diagnosticRequest(CHANNELS.stocks, () => { throw failure }), error => error === failure)
  await diagnosticRequest(secret, () => null)
  const { trackApiRequest } = await import('../electron/services/apiUsage.js')
  await Promise.all([CHANNELS.quotes, CHANNELS.stocks].map(channel => diagnosticRequest(channel, async () => {
    const id = diagnosticRequestContext.getStore()
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(diagnosticRequestContext.getStore(), id, 'Concurrent requests must retain their own correlation ID')
    return trackApiRequest('yahoo', async () => 'fixture')
  })))
  const snapshot = readDiagnosticLogs(diagnosticDirectory())
  const providers = snapshot.entries.filter(entry => entry.area === 'provider')
  assert.equal(providers.length, 2)
  assert.notEqual(providers[0].details.requestId, providers[1].details.requestId)
  assert(snapshot.entries.some(entry => entry.event === 'request-failed' && entry.details.code === 'timeout'))
  assert(snapshot.entries.some(entry => entry.details.freshness === 'partial' && entry.level === 'warn'))
  for (const file of readdirSync(diagnosticDirectory())) assert(!readFileSync(join(diagnosticDirectory(), file), 'utf8').includes(secret), 'Payloads and error text must not enter logs')
  mkdirSync(join(directory, 'empty'))
  assert.deepEqual(readDiagnosticLogs(join(directory, 'empty')).entries, [])
  console.log('PASS: rotation, retention, damaged records, storage failure, flood limits, classified failures, request identity and privacy')
} finally {
  for (const key of ['APPDATA', 'LOCALAPPDATA'] as const) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  rmSync(directory, { recursive: true, force: true })
}
