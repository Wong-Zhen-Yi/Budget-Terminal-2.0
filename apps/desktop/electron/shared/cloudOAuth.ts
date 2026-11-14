export interface OAuthTokens { accessToken: string; refreshToken: string; refreshTokenExpiresAt: number; userId: string }
export type OAuthCompletion = { status: 'complete'; tokens: OAuthTokens; authorization?: string }
  | { status: 'error'; userError: { error: 'INVALID_CODE' | 'ACCOUNT_MISMATCH' } }

/** Only the temporary desktop listener is an allowed OAuth return destination. */
export function desktopOAuthRedirect(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
    url.username || url.password || url.search || url.hash ||
    !/^\/convex-sync-callback\/[a-f0-9]{64}$/.test(url.pathname)) {
    throw new Error('Invalid desktop sign-in return URL')
  }
  return url.href
}

/** The OS browser opens only GitHub, bound to this deployment and the initiating state. */
export function githubSignInUrl(deploymentUrl: string, redirect: string, state: string): string {
  const deployment = new URL(convexDeploymentUrl(deploymentUrl))
  const url = new URL(redirect)
  const siteHost = deployment.hostname.replace(/\.convex\.cloud$/, '.convex.site')
  const callback = new URL(`https://${siteHost}/api/auth/callback/github/callback`)
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password ||
    url.hash || url.pathname !== '/login/oauth/authorize' ||
    url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state || !state ||
    url.searchParams.getAll('redirect_uri').length !== 1 || url.searchParams.get('redirect_uri') !== callback.href ||
    url.searchParams.getAll('client_id').length !== 1 || !url.searchParams.get('client_id') ||
    ['undefined', 'null'].includes(url.searchParams.get('client_id')!) ||
    url.searchParams.get('code_challenge_method') !== 'S256' || !url.searchParams.get('code_challenge')) {
    throw new Error('Invalid GitHub sign-in URL')
  }
  return url.href
}
/** Convex cloud endpoints may include a region between the deployment and convex.cloud. */
export function convexDeploymentUrl(value: string): string {
  const url = new URL(value.trim())
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)?\.convex\.cloud$/.test(url.hostname) ||
    url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use your HTTPS Convex cloud deployment URL.')
  }
  return url.origin
}

// V2 requires explicit origins. Try a small port range to allow concurrent checkouts.
export const DESKTOP_AUTH_PORTS = [43871, 43872, 43873, 43874, 43875]
export const DESKTOP_AUTH_ORIGINS = DESKTOP_AUTH_PORTS.map(port => `http://127.0.0.1:${port}`)

