import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api.js'
import { makeFunctionReference } from 'convex/server'
import { DESKTOP_AUTH_ORIGINS, convexDeploymentUrl, githubSignInUrl } from '../electron/shared/cloudOAuth.js'

// Read only the ignored local configuration. Never print provider URLs, profiles or tokens.
process.loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url)))
const url = convexDeploymentUrl(process.env.VITE_CONVEX_URL ?? '')
const client = new ConvexHttpClient(url, { logger: false,
  fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) })
const config = await client.query(api.sync.authConfiguration, {})
assert.equal(config.authVersion, 2)
assert.equal(config.accountControlsVersion, 2)
assert.equal(config.githubConfigured, true)
await assert.rejects(client.query(api.sync.identity, {}))
await assert.rejects(client.query(api.sync.account, {}))
await assert.rejects(client.mutation(api.auth.revokeOtherSessions, { authorization: 'a'.repeat(64) }))
await assert.rejects(client.query(api.sync.read, {}))
await assert.rejects(client.mutation(api.sync.write, { expectedRevision: 0, payload: '{}' }))
await assert.rejects(client.mutation(api.auth.startSignInWithGithub, { redirectTo: 'https://example.invalid/callback' }))
await assert.rejects(client.mutation(api.auth.startSignInWithGithub, { redirectTo: 'http://127.0.0.1:1/callback' }))
assert.deepEqual(await client.mutation(api.auth.completeSignInWithGithub, { code: 'invalid-probe-code', state: 'invalid-probe-state' }),
  { status: 'error', userError: { error: 'INVALID_CODE' } })
assert.deepEqual(await client.mutation(api.auth.refreshSession, { refreshToken: 'invalid-probe-token' }), { kind: 'noSession' })
await client.mutation(api.auth.signOut, { refreshToken: 'invalid-probe-token' })
assert.equal(await client.query(api.auth.isAuthenticated, {}), false)
const redirectTo = `${DESKTOP_AUTH_ORIGINS[0]}/convex-sync-callback/${randomBytes(32).toString('hex')}`
await assert.rejects(client.mutation(api.auth.startSignInWithGithub, { redirectTo, purpose: 'revokeOthers' }))
await assert.rejects(client.mutation(makeFunctionReference<'mutation'>('githubAdapter:start'), { redirectTo }), 'The raw SDK adapter must not be accessible to public clients')
const started = await client.mutation(api.auth.startSignInWithGithub, { redirectTo })
githubSignInUrl(url, started.redirect, started.state)
const authorization = await fetch(started.redirect, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
// Signed-out GitHub redirects even a misconfigured OAuth App to /login. This
// checks availability only; exact callback registration needs a signed-in browser.
assert.equal(authorization.status, 302, 'The signed-out GitHub login entry must be reachable')
const location = new URL(authorization.headers.get('location')!, 'https://github.com')
assert.equal(location.hostname, 'github.com')
assert.equal(location.pathname, '/login', 'Expected the signed-out GitHub login entry')
assert(!location.searchParams.has('error'))
const callback = new URL(started.redirect).searchParams.get('redirect_uri')!
const rejected = await fetch(`${callback}?code=invalid&state=invalid`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
assert.equal(rejected.status, 400, 'The mounted component must reject an unknown callback state')
console.log('PASS: live v2 components, signed-out GitHub login entry, callback routing, redirect allowlist, invalid-code/refresh rejection and unauthenticated data isolation.')
console.log('NOT VERIFIED: GitHub callback registration or completed sign-in. A signed-out /login redirect also occurs with an invalid redirect_uri; validate the exact callback in GitHub OAuth App settings and complete a signed-in browser flow.')
