const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } = require('node:crypto')
const { checkProductionSync, productionSyncUrl } = require('./check-production-sync.cjs')

async function main() {
  const url = 'https://fixture-production.ap-southeast-2.convex.cloud'
  const site = url.replace('.convex.cloud', '.convex.site')
  const publicFixture = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'jwk' })
  assert.equal(productionSyncUrl(url), url)
  for (const invalid of ['', undefined, 'http://fixture.convex.cloud', 'https://example.com',
    'https://credential@fixture.convex.cloud', `${url}/path`, `${url}?key=value`, `${url}#fragment`]) {
    assert.throws(() => productionSyncUrl(invalid))
  }
  const fixture = (changes = {}) => async target => {
    if (target === `${url}/api/query`) return Response.json({ status: 'success', value: {
      protocol: 2, githubConfigured: true, emailConfigured: false, ...changes.configuration,
    } })
    if (target === `${site}/.well-known/openid-configuration`) return Response.json({
      issuer: site, jwks_uri: `${site}/.well-known/jwks.json`, ...changes.discovery,
    })
    if (target === `${site}/.well-known/jwks.json`) return Response.json({ keys: [publicFixture], ...changes.jwks })
    assert.fail('Preflight requested a non-public or unexpected endpoint')
  }
  assert.equal((await checkProductionSync(url, { fetch: fixture() })).githubConfigured, true)
  for (const changes of [
    { configuration: { protocol: 1 } }, { configuration: { githubConfigured: false } },
    { configuration: { emailConfigured: true } }, { discovery: { issuer: 'https://wrong.convex.site' } },
    { jwks: { keys: [] } }, { jwks: { keys: [{ kty: 'RSA', n: 'fixture', e: 'AQAB', d: 'private' }] } },
    { jwks: { keys: [null] } },
    { jwks: { keys: [{ ...publicFixture, alg: 'RSA-OAEP' }] } },
    { jwks: { keys: [generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ format: 'jwk' })] } },
  ]) await assert.rejects(checkProductionSync(url, { fetch: fixture(changes) }))
  await assert.rejects(checkProductionSync(url, { fetch: async () => new Response('provider failure', { status: 500 }) }), /HTTP 500/)
  await assert.rejects(checkProductionSync(url, { fetch: async () => Response.json('invalid') }), /protocol 2/)
  await assert.rejects(checkProductionSync(url, { fetch: async () => Response.json(null) }), /protocol 2/)
  await assert.rejects(checkProductionSync(url, { fetch: async () => { throw Error('private provider diagnostics') } }), error =>
    !error.message.includes('private provider diagnostics'))

  const scratch = mkdtempSync(join(tmpdir(), 'budget-release-signing-'))
  try {
    const generator = resolve(__dirname, '../apps/desktop/scripts/create-convex-auth-keys.mjs')
    const generated = spawnSync(process.execPath, [generator], { cwd: scratch, encoding: 'utf8', windowsHide: true })
    assert.equal(generated.status, 0, generated.stderr)
    const file = join(scratch, '.env.convex-auth.local')
    const contents = readFileSync(file, 'utf8')
    const { loadEnv } = await import('vite')
    const values = loadEnv('convex-auth', scratch, ['JWT_PRIVATE_KEY', 'JWKS'])
    assert.deepEqual(Object.keys(values).sort(), ['JWKS', 'JWT_PRIVATE_KEY'])
    const jwks = JSON.parse(values.JWKS)
    assert.equal(jwks.keys.length, 1)
    assert.equal(jwks.keys[0].alg, 'RS256')
    assert.equal(jwks.keys[0].d, undefined)
    const encoded = values.JWT_PRIVATE_KEY.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '')
    const privateKey = createPrivateKey({ key: Buffer.from(encoded, 'base64'), type: 'pkcs8', format: 'der' })
    const publicKey = createPublicKey({ key: jwks.keys[0], format: 'jwk' })
    const message = Buffer.from('Synthetic release signing check')
    const signature = sign('RSA-SHA256', message, privateKey)
    assert(verify('RSA-SHA256', message, publicKey, signature))
    assert(!generated.stdout.includes(values.JWT_PRIVATE_KEY) && !generated.stdout.includes(jwks.keys[0].n))
    const refused = spawnSync(process.execPath, [generator], { cwd: scratch, encoding: 'utf8', windowsHide: true })
    assert.notEqual(refused.status, 0, 'Signing keys must not be overwritten on rerun')
    assert.equal(readFileSync(file, 'utf8'), contents)
  } finally { rmSync(scratch, { recursive: true, force: true }) }
  console.log('PASS: production release preflight, endpoint/auth/key validation, safe provider failures, dotenv signing keys, RS256 verification and overwrite refusal')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
