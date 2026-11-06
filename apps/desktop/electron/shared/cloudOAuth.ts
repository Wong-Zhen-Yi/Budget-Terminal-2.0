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

/** The OS browser opens only this deployment's Convex Auth GitHub entry point. */
export function githubSignInUrl(deploymentUrl: string, redirect: string): string {
  const deployment = new URL(convexDeploymentUrl(deploymentUrl))
  const url = new URL(redirect)
  const siteHost = deployment.hostname.replace(/\.convex\.cloud$/, '.convex.site')
  if (url.protocol !== 'https:' || url.hostname !== siteHost || url.port || url.username || url.password ||
    url.hash || url.pathname !== '/api/auth/signin/github') throw new Error('Invalid GitHub sign-in URL')
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

