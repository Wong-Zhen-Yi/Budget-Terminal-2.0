import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { MarketApiKeyStore } from '../electron/services/marketApiKeys.js'

const directory = await mkdtemp(join(tmpdir(), 'bt-market-keys-'))
const previous = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
try {
  const path = join(directory, 'keys.bin')
  const encryptionKey = randomBytes(32)
  let available = true
  const storage = {
    path: () => path,
    available: () => available,
    encrypt: (text: string) => {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
      const bytes = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), bytes])
    },
    decrypt: (bytes: Buffer) => {
      const cipher = createDecipheriv('aes-256-gcm', encryptionKey, bytes.subarray(0, 12))
      cipher.setAuthTag(bytes.subarray(12, 28))
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')
    },
  }
  const store = new MarketApiKeyStore(storage)
  assert.deepEqual((await store.read()).data.configured, { finnhub: false, fmp: false })
  await writeFile(path, storage.encrypt(JSON.stringify({ alltick: 'fixture-retired-key' })))
  assert.deepEqual((await store.read()).data.configured, { finnhub: false, fmp: false }, 'Retired provider exposed to renderer')
  assert.equal((await store.mutate({ type: 'save', provider: 'alltick', key: 'fixture-retired-key' })).meta.freshness, 'failed')
  const secrets = ['fixture-finnhub', 'fixture-fmp']
  const providers = ['finnhub', 'fmp'] as const
  const results = await Promise.all(providers.map((provider, index) => store.mutate({ type: 'save', provider, key: secrets[index] })))
  assert.ok(results.every(result => result.meta.freshness === 'fresh'))
  const bytes = await readFile(path)
  assert.ok(!storage.decrypt(bytes).includes('alltick'), 'Retired credential retained after saving supported keys')
  for (const secret of secrets) {
    assert.ok(!bytes.includes(secret), 'Plaintext key on disk')
    assert.ok(!JSON.stringify(results).includes(secret), 'Key returned to renderer')
  }
  const reloaded = new MarketApiKeyStore(storage)
  assert.deepEqual((await reloaded.read()).data.configured, { finnhub: true, fmp: true })
  assert.equal((await store.mutate({ type: 'save', provider: 'unknown', key: 'bad' })).meta.freshness, 'failed')
  assert.equal((await store.mutate({ type: 'save', provider: 'finnhub', key: ' ' })).meta.freshness, 'failed')
  assert.deepEqual(await readFile(path), bytes, 'Invalid requests changed storage')
  available = false
  assert.equal((await store.mutate({ type: 'save', provider: 'finnhub', key: 'replacement' })).meta.freshness, 'failed')
  assert.deepEqual(await readFile(path), bytes, 'Encryption failure changed storage')
  available = true
  await store.mutate({ type: 'remove', provider: 'finnhub' })
  assert.deepEqual((await reloaded.read()).data.configured, { finnhub: false, fmp: true })
  const goodBytes = await readFile(path)
  await writeFile(path, 'corrupt')
  assert.equal((await reloaded.read()).meta.freshness, 'failed')
  assert.equal((await store.mutate({ type: 'save', provider: 'fmp', key: 'replacement' })).meta.freshness, 'failed')
  assert.equal(await readFile(path, 'utf8'), 'corrupt', 'Corrupt storage silently overwritten')
  await writeFile(path, goodBytes)
  await store.mutate({ type: 'remove', provider: 'fmp' })
  await assert.rejects(readFile(path), { code: 'ENOENT' })
  console.log('PASS: encrypted persistence, serialized saves, redacted responses, validation, keyring failure, corruption protection and removal')
} finally {
  for (const name of ['APPDATA', 'LOCALAPPDATA'] as const) {
    if (previous[name] === undefined) delete process.env[name]
    else process.env[name] = previous[name]
  }
  await rm(directory, { recursive: true, force: true })
}
