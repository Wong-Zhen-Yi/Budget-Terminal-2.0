/** Electron 44.9.3 includes electron/electron#55126 in both TLS stacks.
 * Its embedded Node reports 24.22.0, but has the security fix backported.
 */
export function assertDesktopCertificateSecurity(version: string | undefined, environment: NodeJS.ProcessEnv,
  hasSwitch: (name: string) => boolean) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '')
  const [major, minor, patch] = match ? match.slice(1).map(Number) : [0, 0, 0]
  if (!(major > 44 || (major === 44 && (minor > 9 || (minor === 9 && patch >= 3))))) {
    throw new Error('Electron 44.9.3 or newer is required for eMudhra certificate protection. Reinstall dependencies and rebuild with the launcher.')
  }
  if (Object.entries(environment).some(([key, value]) => key.toUpperCase() === 'NODE_TLS_REJECT_UNAUTHORIZED' && value === '0')) {
    throw new Error('Remove NODE_TLS_REJECT_UNAUTHORIZED=0 before starting Budget Terminal. Certificate verification must remain enabled.')
  }
  for (const name of ['ignore-certificate-errors', 'ignore-certificate-errors-spki-list', 'allow-insecure-localhost']) {
    if (hasSwitch(name)) throw new Error(`Remove --${name} before starting Budget Terminal. Certificate verification bypasses are not supported.`)
  }
}
