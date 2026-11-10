import assert from 'node:assert/strict'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'
import { convexDeploymentUrl } from '../electron/shared/cloudOAuth.js'
import { requireCloudBackend, type CloudAuthConfiguration } from '../electron/shared/cloudSyncConfiguration.js'
import { beginGitHubSignIn, type OAuthResponse } from '../electron/services/cloudSyncOAuth.js'

// This checks a real backend and starts/cancels one OAuth request. It never impersonates a user,
// opens a browser, reads saved records or prints codes, verifiers or provider credentials.
const env = loadEnv('development', fileURLToPath(new URL('..', import.meta.url)), 'VITE_')
const url = convexDeploymentUrl(process.argv[2] || env.VITE_CONVEX_URL || '')
const api = new ConvexHttpClient(url, { logger: false })
const configRef = makeFunctionReference<'query', Record<string, never>, CloudAuthConfiguration>('sync:authConfiguration')
const signInRef = makeFunctionReference<'action', { provider?: string; params?: Record<string, string>; verifier?: string }, OAuthResponse>('auth:signIn')
const configuration = requireCloudBackend(await api.query(configRef, {}))
assert(configuration.githubConfigured, 'GitHub is not configured on the selected backend')
let authorizationReached = false
const flow = await beginGitHubSignIn(url, {
  isConfigured: async () => configuration.githubConfigured,
  signIn: args => api.action(signInRef, args),
  openExternal: async destination => {
    const response = await fetch(destination, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    assert([302, 303, 307].includes(response.status), 'The backend did not redirect to GitHub authorization')
    const target = new URL(response.headers.get('location') || '')
    assert.equal(target.origin, 'https://github.com')
    assert.equal(target.pathname, '/login/oauth/authorize')
    assert(target.searchParams.get('client_id') && target.searchParams.get('client_id') !== 'undefined')
    authorizationReached = true
  },
})
flow.cancel()
assert.deepEqual(await flow.result, { reason: 'cancelled' })
assert(authorizationReached)
console.log(`PASS: live protocol compatibility, configured GitHub authorization redirect and safe callback cancellation. Email configured: ${configuration.emailConfigured}. Final browser approval still requires the account holder.`)
