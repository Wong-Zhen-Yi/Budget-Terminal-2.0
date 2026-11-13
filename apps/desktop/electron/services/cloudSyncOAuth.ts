import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { DESKTOP_AUTH_PORTS, desktopOAuthRedirect, githubSignInUrl } from '../shared/cloudOAuth.js'

export interface OAuthTokens { accessToken: string; refreshToken: string; refreshTokenExpiresAt: number; userId: string }
export type OAuthCompletion = { status: 'complete'; tokens: OAuthTokens } | { status: 'error'; userError: { error: 'INVALID_CODE' } }
export class GitHubSetupError extends Error {
  constructor(message = 'GitHub sign-in is not configured on this Convex deployment. Add AUTH_GITHUB_ID and AUTH_GITHUB_SECRET in the Convex dashboard, then retry. Local data is still available.') {
    super(message)
  }
}
type CallbackResult = { code: string } | { reason: 'cancelled' | 'expired' | 'failed' }

/** Listen on loopback only. The random path and v2 state bind the response to this device. */
export async function createOAuthCallback(timeoutMs = 5 * 60_000) {
  const path = `/convex-sync-callback/${randomBytes(32).toString('hex')}`
  let finish: (result: CallbackResult) => void = () => {}
  const result = new Promise<CallbackResult>(resolve => { finish = resolve })
  let settled = false
  let origin = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  const settle = (value: CallbackResult) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    server.close()
    server.closeIdleConnections()
    finish(value)
  }
  const server = createServer({ maxHeaderSize: 4096, requestTimeout: 5000, headersTimeout: 5000 }, (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    response.setHeader('Content-Type', 'text/plain; charset=utf-8')
    response.setHeader('Connection', 'close')
    if (settled || request.headers.host !== new URL(origin).host || request.method !== 'GET') {
      response.writeHead(400).end('Invalid sign-in callback.')
      return
    }
    const url = new URL(request.url ?? '/', origin)
    const codes = url.searchParams.getAll('convexAuthCode')
    const errors = url.searchParams.getAll('convexAuthError')
    const validCode = codes.length === 1 && Boolean(codes[0]) && codes[0].length <= 2048 && errors.length === 0
    const validError = errors.length === 1 && ['access_denied', 'expired', 'oauth_error'].includes(errors[0]) && codes.length === 0
    if (url.origin !== origin || url.pathname !== path || (!validCode && !validError) ||
      [...url.searchParams.keys()].some(key => key !== 'convexAuthCode' && key !== 'convexAuthError')) {
      response.writeHead(400).end('Invalid sign-in callback. Return to Budget Terminal and try again.')
      return
    }
    response.end('Sign-in response received. Return to Budget Terminal to finish connecting. You can close this browser tab.')
    settle(validCode ? { code: codes[0] } : { reason: errors[0] === 'access_denied' ? 'cancelled' : errors[0] === 'expired' ? 'expired' : 'failed' })
  })
  server.maxConnections = 8
  for (const port of DESKTOP_AUTH_PORTS) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
      })
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || port === DESKTOP_AUTH_PORTS.at(-1)) throw error
    }
  }
  server.on('error', () => settle({ reason: 'cancelled' }))
  const address = server.address()
  if (!address || typeof address === 'string') { server.close(); throw new Error('Sign-in callback unavailable') }
  origin = `http://127.0.0.1:${address.port}`
  timer = setTimeout(() => settle({ reason: 'expired' }), timeoutMs)
  timer.unref()
  return { url: desktopOAuthRedirect(`${origin}${path}`), result, cancel: () => settle({ reason: 'cancelled' }) }
}

export interface GitHubSignIn {
  result: Promise<{ tokens: OAuthTokens } | { reason: 'cancelled' | 'expired' | 'failed' }>
  cancel: () => void
}

export async function beginGitHubSignIn(deploymentUrl: string, dependencies: {
  isConfigured: () => Promise<boolean>
  startSignIn: (args: { redirectTo: string }) => Promise<{ redirect: string; state: string }>
  completeSignIn: (args: { code: string; state: string }) => Promise<OAuthCompletion>
  openExternal: (url: string) => Promise<void>
}): Promise<GitHubSignIn> {
  if (!await dependencies.isConfigured()) throw new GitHubSetupError()
  const callback = await createOAuthCallback()
  try {
    const started = await dependencies.startSignIn({ redirectTo: callback.url })
    const redirect = githubSignInUrl(deploymentUrl, started.redirect, started.state)
    await dependencies.openExternal(redirect)
    const result: GitHubSignIn['result'] = callback.result.then(async response => {
      if ('reason' in response) return response
      try {
        // State, the one-time code and session tokens never cross into the renderer.
        const completed = await dependencies.completeSignIn({ code: response.code, state: started.state })
        if (completed.status !== 'complete' || !completed.tokens.accessToken || !completed.tokens.refreshToken) return { reason: 'failed' as const }
        return { tokens: completed.tokens }
      } catch { return { reason: 'failed' as const } }
    })
    return { result, cancel: callback.cancel }
  } catch (error) { callback.cancel(); throw error }
}
