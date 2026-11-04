import assert from 'node:assert/strict'
import { createAppMetricsReader } from '../electron/services/appMetrics.js'

let now = 1000
let mode = 'available'
let failMemory = false
const read = createAppMetricsReader({
  now: () => now++,
  processes: () => {
    if (failMemory) throw Error('private process details')
    return [{ type: 'Browser', memory: { workingSetSize: 102400 } }, { type: 'Tab', memory: { workingSetSize: 204800 } }, { type: 'Tab', memory: { workingSetSize: 102400 } }, { type: 'GPU', memory: { workingSetSize: 51200 } }]
  },
  backup: () => ({ path: '/private/backup.json' }),
  stat: async path => {
    assert.equal(path, '/private/backup.json')
    if (mode !== 'available') throw Object.assign(Error('private storage details'), { code: mode })
    return { size: 524288, mtimeMs: 500 }
  },
})
const first = await read()
assert.deepEqual(first.data.memory, [{ at: 1000, mainMiB: 100, rendererMiB: 300, otherMiB: 50 }])
assert.deepEqual(first.data.backup, { state: 'available', bytes: 524288, savedAt: 500 })
assert.equal(first.meta.freshness, 'fresh')
first.data.memory[0].mainMiB = 999
assert.equal((await read()).data.memory[0].mainMiB, 100, 'Response mutation must not change retained history')
for (let i = 0; i < 130; i++) await read()
assert.equal((await read()).data.memory.length, 120, 'History must stay bounded')
failMemory = true
mode = 'EACCES'
const failure = await read()
assert.equal(failure.meta.freshness, 'partial')
assert.equal(failure.data.memory.length, 120, 'Keep successful history on failure')
assert.equal(failure.data.backup.state, 'unavailable')
assert(!JSON.stringify(failure).includes('private'), 'Never expose paths, file contents or raw process/storage errors')
mode = 'ENOENT'
assert.equal((await read()).data.backup.state, 'not-created')
assert.equal((await createAppMetricsReader({ processes: () => [], backup: () => undefined })()).data.backup.state, 'not-created')
console.log('PASS: memory units/process aggregation, actual backup size, bounded immutable history, missing files, failure recovery and privacy')
