import { convexDeploymentUrl } from './cloudOAuth.js'

export interface CloudAuthConfiguration { protocol: number; githubConfigured: boolean; emailConfigured: boolean }
export class CloudBackendUpgradeError extends Error {
  constructor() { super('This sync server needs the matching Budget Terminal backend update before sign-in can finish. Your saved data is safe.') }
}
export function requireCloudBackend(configuration: CloudAuthConfiguration): CloudAuthConfiguration {
  if (configuration.protocol !== 2) throw new CloudBackendUpgradeError()
  return configuration
}

/** Local source installs use their operator's existing backend; public releases require production. */
export function cloudBuildUrl(command: string, env: Record<string, string | undefined>, config: { productionUrl: string; developmentUrl: string }): string {
  const release = env.BUDGET_TERMINAL_RELEASE === '1'
  const local = !release && (command === 'serve' || env.BUDGET_TERMINAL_LOCAL_BUILD === '1')
  const configured = local
    ? env.BUDGET_TERMINAL_SYNC_DEVELOPMENT_URL || config.developmentUrl || env.VITE_CONVEX_URL || ''
    : env.BUDGET_TERMINAL_SYNC_PRODUCTION_URL || config.productionUrl
  if (release && !configured) throw Error('Release requires a public production sync URL. See docs/convex-sync.md.')
  return configured ? convexDeploymentUrl(configured) : ''
}
