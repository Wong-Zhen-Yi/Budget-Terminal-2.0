import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api.js'
import { makeFunctionReference } from 'convex/server'
import { DESKTOP_AUTH_ORIGINS, convexDeploymentUrl, googleSignInUrl } from '../electron/shared/cloudOAuth.js'
import { CLOUD_DEPLOYMENT_URL } from '../electron/shared/cloudDeployment.js'

// Default to the desktop endpoint. Operators may explicitly check another deployment.
const url = convexDeploymentUrl(process.argv[2] ?? CLOUD_DEPLOYMENT_URL)
const client = new ConvexHttpClient(url, { logger: false,
  fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) })
const config = await client.query(api.sync.authConfiguration, {})
assert.equal(config.authVersion, 2)
assert.equal(config.accountControlsVersion, 2)
assert(!('githubConfigured' in config), 'The deployment still advertises GitHub sign-in. Deploy the current Convex functions with npm run convex:setup.')
await assert.rejects(client.query(api.sync.identity, {}))
await assert.rejects(client.query(api.sync.account, {}))
await assert.rejects(client.mutation(api.auth.revokeOtherSessions, { authorization: 'a'.repeat(64) }))
await assert.rejects(client.query(api.sync.read, {}))
await assert.rejects(client.mutation(api.sync.write, { expectedRevision: 0, payload: '{}' }))
assert.deepEqual(await client.mutation(api.auth.refreshSession, { refreshToken: 'invalid-probe-token' }), { kind: 'noSession' })
await client.mutation(api.auth.signOut, { refreshToken: 'invalid-probe-token' })
assert.equal(await client.query(api.auth.isAuthenticated, {}), false)
const redirectTo = `${DESKTOP_AUTH_ORIGINS[0]}/convex-sync-callback/${randomBytes(32).toString('hex')}`

// GitHub sign-in was removed: neither the public mutations nor the raw SDK adapter may start a GitHub flow.
for (const name of ['auth:startSignInWithGithub', 'githubAdapter:start']) {
  await assert.rejects(client.mutation(makeFunctionReference<'mutation'>(name), { redirectTo }), `${name} must not be callable`)
}
await assert.rejects(client.mutation(makeFunctionReference<'mutation'>('auth:completeSignInWithGithub'), { code: 'invalid-probe-code', state: 'invalid-probe-state' }))

// Google validates client_id and redirect_uri before sign-in, so a 400 here means the client is misregistered.
assert.equal(config.googleConfigured, true, 'Google OAuth credentials are missing or invalid on the selected deployment. Set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET, then run npm run convex:setup.')
await assert.rejects(client.mutation(api.auth.startSignInWithGoogle, { redirectTo: 'https://example.invalid/callback' }))
await assert.rejects(client.mutation(api.auth.startSignInWithGoogle, { redirectTo: 'http://127.0.0.1:1/callback' }))
await assert.rejects(client.mutation(api.auth.startSignInWithGoogle, { redirectTo, purpose: 'revokeOthers' }))
await assert.rejects(client.mutation(makeFunctionReference<'mutation'>('googleAdapter:start'), { redirectTo }), 'The raw Google adapter must not be accessible to public clients')
assert.deepEqual(await client.mutation(api.auth.completeSignInWithGoogle, { code: 'invalid-probe-code', state: 'invalid-probe-state' }),
  { status: 'error', userError: { error: 'INVALID_CODE' } })
const googleStarted = await client.mutation(api.auth.startSignInWithGoogle, { redirectTo })
googleSignInUrl(url, googleStarted.redirect, googleStarted.state)
const googleAuthorization = await fetch(googleStarted.redirect, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
assert.notEqual(googleAuthorization.status, 400, 'Google rejected the client ID or redirect URI. Add the exact Google callback to the OAuth client Authorized redirect URIs.')
const googleCallback = new URL(googleStarted.redirect).searchParams.get('redirect_uri')!
const googleRejected = await fetch(`${googleCallback}?code=invalid&state=invalid`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
assert.equal(googleRejected.status, 400, 'The mounted Google component must reject an unknown callback state')
console.log('PASS: live v2 components, GitHub sign-in removed, Google authorization entry and callback routing, redirect allowlist, invalid-code/refresh rejection and unauthenticated data isolation.')
console.log('NOT VERIFIED: a completed Google sign-in. Complete a signed-in browser flow from Settings.')
