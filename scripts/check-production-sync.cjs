const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { createPublicKey } = require('node:crypto')

function productionSyncUrl(value) {
  let url
  try { url = new URL(value) } catch { throw Error('Production cloud sync URL is missing or invalid.') }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)?\.convex\.cloud$/.test(url.hostname)
    || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') {
    throw Error('Production cloud sync must use its public HTTPS Convex deployment origin.')
  }
  return url.origin
}

/** Read public health/auth metadata only; never authenticate or retrieve user records. */
async function checkProductionSync(value, { fetch: request = fetch } = {}) {
  const url = productionSyncUrl(value)
  const site = url.replace(/\.convex\.cloud$/, '.convex.site')
  const read = async (target, options) => {
    let response
    try { response = await request(target, { ...options, redirect: 'error', signal: AbortSignal.timeout(15_000) }) }
    catch { throw Error('Production sync preflight could not reach the configured service.') }
    if (!response.ok) throw Error(`Production sync preflight returned HTTP ${response.status}.`)
    try { return await response.json() } catch { throw Error('Production sync preflight returned invalid JSON.') }
  }
  const [configuration, discovery, jwks] = await Promise.all([
    read(`${url}/api/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'sync:authConfiguration', args: {}, format: 'json' }) }),
    read(`${site}/.well-known/openid-configuration`),
    read(`${site}/.well-known/jwks.json`),
  ])
  if (!configuration || configuration.status !== 'success' || configuration.value?.protocol !== 2) {
    throw Error('Production sync backend must run Budget Terminal record protocol 2.')
  }
  if (!configuration.value.githubConfigured || configuration.value.emailConfigured !== false) {
    throw Error('Production GitHub-only authentication is not configured. Set the production OAuth Client ID and Client Secret before releasing.')
  }
  if (!discovery || discovery.issuer !== site || discovery.jwks_uri !== `${site}/.well-known/jwks.json`) {
    throw Error('Production authentication discovery does not match the configured deployment.')
  }
  if (!jwks || !Array.isArray(jwks.keys) || !jwks.keys.length || jwks.keys.some(key => !key || key.kty !== 'RSA'
    || !key.n || !key.e || (key.alg && key.alg !== 'RS256') || (key.use && key.use !== 'sig')
    || ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some(field => Object.hasOwn(key, field)))) {
    throw Error('Production authentication must publish valid public signing keys without private material.')
  }
  try {
    for (const key of jwks.keys) {
      const bits = createPublicKey({ key, format: 'jwk' }).asymmetricKeyDetails?.modulusLength
      if (!bits || bits < 2048) throw Error('Weak signing key')
    }
  } catch { throw Error('Production authentication must publish valid RSA signing keys of at least 2048 bits.') }
  return { url, site, protocol: 2, githubConfigured: true, publicSigningKeys: jwks.keys.length }
}

if (require.main === module) {
  const config = JSON.parse(readFileSync(resolve(__dirname, '../apps/desktop/config/cloud-sync.json'), 'utf8'))
  checkProductionSync(process.argv[2] || process.env.BUDGET_TERMINAL_SYNC_PRODUCTION_URL || config.productionUrl)
    .then(result => console.log(`Production sync preflight passed: protocol ${result.protocol}, GitHub configured, public signing keys valid (${result.url}).`))
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}

module.exports = { checkProductionSync, productionSyncUrl }
