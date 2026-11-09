import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { desktopOAuthRedirect, githubSignInUrl } from '../shared/cloudOAuth.js'

export interface OAuthTokens { token: string; refreshToken: string }
export interface OAuthArgs { provider?: string; params?: Record<string, string>; verifier?: string }
export interface OAuthResponse { redirect?: string; verifier?: string; tokens?: OAuthTokens | null }
export class GitHubSetupError extends Error {
  constructor() {
    super('GitHub sign-in is not available on this server yet. The service operator must finish account setup. Try email sign-in or continue using your local data.')
  }
}
type CallbackResult = { code: string } | { reason: 'cancelled' | 'expired' }

/** Listen on loopback only. The random path and Convex verifier bind the response to this device. */
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
    const codes = url.searchParams.getAll('code')
    if (url.origin !== origin || url.pathname !== path || codes.length !== 1 || !codes[0] || codes[0].length > 2048 ||
      [...url.searchParams.keys()].some(key => key !== 'code')) {
      response.writeHead(400).end('Invalid sign-in callback. Return to Budget Terminal and try again.')
      return
    }
    response.end('Sign-in response received. Return to Budget Terminal to finish connecting. You can close this browser tab.')
    settle({ code: codes[0] })
  })
  server.maxConnections = 8
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
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
  signIn: (args: OAuthArgs) => Promise<OAuthResponse>
  openExternal: (url: string) => Promise<void>
}): Promise<GitHubSignIn> {
  if (!await dependencies.isConfigured()) throw new GitHubSetupError()
  const callback = await createOAuthCallback()
  try {
    const started = await dependencies.signIn({ provider: 'github', params: { redirectTo: callback.url } })
    if (!started.redirect || !started.verifier) throw new Error('GitHub sign-in is not configured')
    const redirect = githubSignInUrl(deploymentUrl, started.redirect)
    await dependencies.openExternal(redirect)
    const result: GitHubSignIn['result'] = callback.result.then(async response => {
      if ('reason' in response) return response
      try {
        // The authorization verifier and returned code never cross into the renderer.
        const completed = await dependencies.signIn({ params: { code: response.code }, verifier: started.verifier! })
        if (!completed.tokens?.token || !completed.tokens.refreshToken) return { reason: 'failed' as const }
        return { tokens: completed.tokens }
      } catch { return { reason: 'failed' as const } }
    })
    return { result, cancel: callback.cancel }
  } catch (error) { callback.cancel(); throw error }
}
