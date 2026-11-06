import assert from 'node:assert/strict'
import { request } from 'node:http'
import { beginGitHubSignIn, createOAuthCallback, GitHubSetupError, type OAuthArgs } from '../electron/services/cloudSyncOAuth.js'
import { convexDeploymentUrl, desktopOAuthRedirect, githubSignInUrl } from '../electron/shared/cloudOAuth.js'

const path = `/convex-sync-callback/${'a'.repeat(64)}`
assert.equal(desktopOAuthRedirect(`http://127.0.0.1:34567${path}`), `http://127.0.0.1:34567${path}`)
for (const invalid of [
  `https://example.invalid${path}`, `http://localhost:34567${path}`, `http://127.0.0.1${path}`,
  `http://127.0.0.1:34567/other`, `http://user@127.0.0.1:34567${path}`,
  `http://127.0.0.1:34567${path}?other=1`, `http://127.0.0.1:34567${path}#fragment`,
]) assert.throws(() => desktopOAuthRedirect(invalid))
const deployment = 'https://fixture.convex.cloud'
const entry = 'https://fixture.convex.site/api/auth/signin/github'
assert.equal(convexDeploymentUrl(' https://fixture.ap-southeast-2.convex.cloud/ '), 'https://fixture.ap-southeast-2.convex.cloud')
assert.equal(githubSignInUrl('https://fixture.ap-southeast-2.convex.cloud',
  'https://fixture.ap-southeast-2.convex.site/api/auth/signin/github'),
'https://fixture.ap-southeast-2.convex.site/api/auth/signin/github')
for (const invalid of ['http://fixture.convex.cloud', 'https://fixture.convex.cloud.evil.invalid',
  'https://user:secret@fixture.convex.cloud', 'https://fixture.convex.cloud:8443',
  'https://fixture.convex.cloud/other', 'https://fixture.convex.cloud?token=value']) assert.throws(() => convexDeploymentUrl(invalid))
assert.equal(githubSignInUrl(deployment, entry), entry)
for (const invalid of ['https://example.invalid/api/auth/signin/github', 'javascript:alert(1)',
  'https://fixture.convex.site/other', 'https://user@fixture.convex.site/api/auth/signin/github']) {
  assert.throws(() => githubSignInUrl(deployment, invalid))
}

const callback = await createOAuthCallback()
try {
  assert.equal((await fetch(`${callback.url}?code=test`, { method: 'POST' })).status, 400)
  assert.equal((await fetch(`${callback.url}?code=one&code=two`)).status, 400)
  assert.equal((await fetch(`${callback.url}?code=one&token=unexpected`)).status, 400)
  assert.equal((await fetch(callback.url.replace(/.$/, 'x') + '?code=one')).status, 400)
  const hostileHost = await new Promise<number | undefined>((resolve, reject) => {
    const outgoing = request(`${callback.url}?code=one`, { headers: { Host: 'example.invalid' } }, response => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    })
    outgoing.on('error', reject)
    outgoing.end()
  })
  assert.equal(hostileHost, 400)
  const accepted = await fetch(`${callback.url}?code=fixture-code`)
  assert.equal(accepted.status, 200)
  assert.equal(accepted.headers.get('cache-control'), 'no-store')
  assert.equal(accepted.headers.get('referrer-policy'), 'no-referrer')
  assert(!((await accepted.text()).includes('fixture-code')), 'Browser response must not echo the authorization code')
  assert.deepEqual(await callback.result, { code: 'fixture-code' })
  await assert.rejects(fetch(`${callback.url}?code=replay`), 'A completed callback must close its listener')
} finally { callback.cancel() }
const cancelled = await createOAuthCallback()
cancelled.cancel()
assert.deepEqual(await cancelled.result, { reason: 'cancelled' })
const expired = await createOAuthCallback(25)
assert.deepEqual(await expired.result, { reason: 'expired' })

const calls: OAuthArgs[] = []
let callbackUrl = ''
let opened = ''
const flow = await beginGitHubSignIn(deployment, {
  isConfigured: async () => true,
  signIn: async args => {
    calls.push(args)
    if (args.provider === 'github') {
      callbackUrl = args.params!.redirectTo
      return { redirect: `${entry}?code=fixture-verifier`, verifier: 'fixture-verifier' }
    }
    assert.equal(args.verifier, 'fixture-verifier', 'Exchange must use the initiating device verifier')
    assert.equal(args.params?.code, 'returned-code')
    assert.equal(args.provider, undefined, 'Exchange uses Convex Auth verification rather than starting another provider flow')
    return { tokens: { token: 'fixture-token', refreshToken: 'fixture-refresh' } }
  },
  openExternal: async url => {
    opened = url
    assert.equal((await fetch(`${callbackUrl}?code=returned-code`)).status, 200)
  },
})
assert.equal(opened, `${entry}?code=fixture-verifier`)
assert.deepEqual(await flow.result, { tokens: { token: 'fixture-token', refreshToken: 'fixture-refresh' } })
assert.equal(calls.length, 2)
assert(callbackUrl.startsWith('http://127.0.0.1:'))

let unsafeOpened = false
await assert.rejects(beginGitHubSignIn(deployment, {
  isConfigured: async () => true,
  signIn: async () => ({ redirect: 'https://example.invalid', verifier: 'fixture' }),
  openExternal: async () => { unsafeOpened = true },
}))
assert.equal(unsafeOpened, false, 'Untrusted redirects must never be opened by the OS')
const pending = await beginGitHubSignIn(deployment, {
  isConfigured: async () => true,
  signIn: async () => ({ redirect: entry, verifier: 'fixture' }), openExternal: async () => {},
})
pending.cancel()
assert.deepEqual(await pending.result, { reason: 'cancelled' })
let startedWithoutCredentials = false
await assert.rejects(beginGitHubSignIn(deployment, {
  isConfigured: async () => false,
  signIn: async () => { startedWithoutCredentials = true; return {} },
  openExternal: async () => { startedWithoutCredentials = true },
}), GitHubSetupError)
assert.equal(startedWithoutCredentials, false, 'Missing OAuth credentials must show setup guidance without starting sign-in or opening a broken GitHub URL')
console.log('PASS: GitHub browser handshake, bound verifier, loopback-only redirects, hostile callbacks, one-use listener, expiry, cancellation and no browser token exposure')
