import assert from 'node:assert/strict'
import { request, createServer } from 'node:http'
import { beginOAuthSignIn, createOAuthCallback, OAuthSetupError } from '../electron/services/cloudSyncOAuth.js'
import { DESKTOP_AUTH_PORTS, convexDeploymentUrl, desktopOAuthRedirect, googleSignInUrl, OAUTH_PROVIDER_LABELS } from '../electron/shared/cloudOAuth.js'

const path = `/convex-sync-callback/${'a'.repeat(64)}`
assert.equal(desktopOAuthRedirect(`http://127.0.0.1:34567${path}`), `http://127.0.0.1:34567${path}`)
for (const invalid of [
  `https://example.invalid${path}`, `http://localhost:34567${path}`, `http://127.0.0.1${path}`,
  `http://127.0.0.1:34567/other`, `http://user@127.0.0.1:34567${path}`,
  `http://127.0.0.1:34567${path}?other=1`, `http://127.0.0.1:34567${path}#fragment`,
]) assert.throws(() => desktopOAuthRedirect(invalid))
const deployment = 'https://fixture.convex.cloud'
const state = 'fixture-state'
// GitHub sign-in was removed. Its authorization URL is never opened, even when correctly bound to this deployment.
const githubEntry = `https://github.com/login/oauth/authorize?client_id=fixture&state=${state}&redirect_uri=${encodeURIComponent('https://fixture.convex.site/api/auth/callback/github/callback')}&code_challenge=fixture-challenge&code_challenge_method=S256`
assert.deepEqual(Object.keys(OAUTH_PROVIDER_LABELS), ['google'], 'Google is the only sign-in provider')
assert.equal(convexDeploymentUrl(' https://fixture.ap-southeast-2.convex.cloud/ '), 'https://fixture.ap-southeast-2.convex.cloud')
for (const invalid of ['http://fixture.convex.cloud', 'https://fixture.convex.cloud.evil.invalid',
  'https://user:secret@fixture.convex.cloud', 'https://fixture.convex.cloud:8443',
  'https://fixture.convex.cloud/other', 'https://fixture.convex.cloud?token=value']) assert.throws(() => convexDeploymentUrl(invalid))
// Google authorization is bound to Google's host, this deployment's Google callback and the state/PKCE rules.
const entry = (site = 'fixture.convex.site') => `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=fixture.apps.googleusercontent.com&redirect_uri=${encodeURIComponent(`https://${site}/api/auth/callback/google/callback`)}&state=${state}&code_challenge=fixture-challenge&code_challenge_method=S256&scope=openid+email+profile`
assert.equal(googleSignInUrl(deployment, entry(), state), entry())
assert.equal(googleSignInUrl('https://fixture.ap-southeast-2.convex.cloud', entry('fixture.ap-southeast-2.convex.site'), state), entry('fixture.ap-southeast-2.convex.site'))
for (const invalid of [githubEntry, 'https://example.invalid/o/oauth2/v2/auth', 'javascript:alert(1)',
  entry().replace('accounts.google.com/', 'accounts.google.com.evil.invalid/'), entry().replace('accounts.google.com/', 'user@accounts.google.com/'),
  entry().replace('/o/oauth2/v2/auth', '/o/oauth2/auth'), entry().replace('fixture-state', 'other-state'),
  entry().replace('client_id=fixture.apps.googleusercontent.com', 'client_id=undefined'),
  entry().replace('callback%2Fgoogle%2F', 'callback%2Fgithub%2F'), entry('other.convex.site'),
  entry().replace('code_challenge_method=S256', 'code_challenge_method=plain'), `${entry()}&state=duplicate`,
  `${entry()}&redirect_uri=https://example.invalid`,
]) assert.throws(() => googleSignInUrl(deployment, invalid, state))

const callback = await createOAuthCallback()
try {
  assert(DESKTOP_AUTH_PORTS.includes(Number(new URL(callback.url).port)))
  assert.equal((await fetch(`${callback.url}?convexAuthCode=test`, { method: 'POST' })).status, 400)
  assert.equal((await fetch(`${callback.url}?convexAuthCode=one&convexAuthCode=two`)).status, 400)
  assert.equal((await fetch(`${callback.url}?convexAuthCode=one&token=unexpected`)).status, 400)
  assert.equal((await fetch(`${callback.url}?convexAuthCode=one&convexAuthError=expired`)).status, 400)
  assert.equal((await fetch(`${callback.url}?code=legacy`)).status, 400)
  assert.equal((await fetch(callback.url.replace(/.$/, 'x') + '?convexAuthCode=one')).status, 400)
  const hostileHost = await new Promise<number | undefined>((resolve, reject) => {
    const outgoing = request(`${callback.url}?convexAuthCode=one`, { headers: { Host: 'example.invalid' } }, response => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    })
    outgoing.on('error', reject)
    outgoing.end()
  })
  assert.equal(hostileHost, 400)
  const accepted = await fetch(`${callback.url}?convexAuthCode=fixture-code`)
  assert.equal(accepted.status, 200)
  assert.equal(accepted.headers.get('cache-control'), 'no-store')
  assert.equal(accepted.headers.get('referrer-policy'), 'no-referrer')
  assert(!((await accepted.text()).includes('fixture-code')), 'Browser response must not echo the one-time code')
  assert.deepEqual(await callback.result, { code: 'fixture-code' })
  await assert.rejects(fetch(`${callback.url}?convexAuthCode=replay`))
} finally { callback.cancel() }
for (const [error, reason] of [['access_denied', 'cancelled'], ['expired', 'expired'], ['oauth_error', 'failed']] as const) {
  const cb = await createOAuthCallback()
  await fetch(`${cb.url}?convexAuthError=${error}`)
  assert.deepEqual(await cb.result, { reason })
}
const cancelled = await createOAuthCallback()
cancelled.cancel()
assert.deepEqual(await cancelled.result, { reason: 'cancelled' })
const expired = await createOAuthCallback(25)
assert.deepEqual(await expired.result, { reason: 'expired' })
const occupied = createServer()
let occupiedPort: number | undefined
for (const port of DESKTOP_AUTH_PORTS) {
  try {
    await new Promise<void>((resolve, reject) => {
      occupied.once('error', reject)
      occupied.listen(port, '127.0.0.1', () => { occupied.removeListener('error', reject); resolve() })
    })
    occupiedPort = port
    break
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
  }
}
assert(occupiedPort, 'The fallback fixture needs an available loopback port')
try {
  const fallback = await createOAuthCallback()
  assert.notEqual(new URL(fallback.url).port, String(occupiedPort))
  fallback.cancel()
} finally { await new Promise<void>(resolve => occupied.close(() => resolve())) }

const tokens = { accessToken: 'fixture-token', refreshToken: 'fixture-refresh', userId: 'fixture-user', refreshTokenExpiresAt: Date.now() + 60_000 }
let callbackUrl = ''
let completed = 0
const flow = await beginOAuthSignIn('google', deployment, {
  isConfigured: async () => true,
  startSignIn: async args => { callbackUrl = args.redirectTo; return { redirect: entry(), state } },
  completeSignIn: async args => {
    completed++
    assert.deepEqual(args, { state, code: 'returned-code' }, 'Exchange must use the initiating device state')
    return { status: 'complete', tokens }
  },
  openExternal: async url => {
    assert.equal(url, entry())
    assert.equal((await fetch(`${callbackUrl}?convexAuthCode=returned-code`)).status, 200)
  },
})
assert.deepEqual(await flow.result, { tokens })
assert.equal(completed, 1)
let unsafeOpened = false
await assert.rejects(beginOAuthSignIn('google', deployment, {
  isConfigured: async () => true,
  startSignIn: async () => ({ redirect: 'https://example.invalid', state }),
  completeSignIn: async () => { throw Error('Must not redeem unsafe redirect') },
  openExternal: async () => { unsafeOpened = true },
}))
assert.equal(unsafeOpened, false)
const pending = await beginOAuthSignIn('google', deployment, {
  isConfigured: async () => true,
  startSignIn: async () => ({ redirect: entry(), state }),
  completeSignIn: async () => { throw Error('Cancelled flow must not redeem') }, openExternal: async () => {},
})
pending.cancel()
assert.deepEqual(await pending.result, { reason: 'cancelled' })
let startedWithoutCredentials = false
await assert.rejects(beginOAuthSignIn('google', deployment, {
  isConfigured: async () => false,
  startSignIn: async () => { startedWithoutCredentials = true; return { redirect: entry(), state } },
  completeSignIn: async () => { throw Error('Missing configuration') },
  openExternal: async () => { startedWithoutCredentials = true },
}), OAuthSetupError)
assert.equal(startedWithoutCredentials, false)
console.log('PASS: v2 Google state exchange and authorization URL binding, GitHub URL rejection, deployment-bound redirects, PKCE, loopback allowlist/port fallback, hostile callbacks, one-use listener, cancellation/expiry and no browser token exposure')
