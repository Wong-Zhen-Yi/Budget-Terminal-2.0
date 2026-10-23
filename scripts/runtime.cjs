// Keep bootstrap checks usable before npm has installed any dependencies.
function versionParts(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version || '')
  return match ? match.slice(1).map(Number) : null
}

function supportedNodeVersion(version) {
  const parts = versionParts(version)
  if (!parts) return false
  const [major, minor, patch] = parts
  // October 2026 security releases block compromised eMudhra intermediate keys.
  const minimum = { 22: [23, 4], 24: [22, 1], 26: [12, 1] }[major]
  return Boolean(minimum && (minor > minimum[0] || (minor === minimum[0] && patch >= minimum[1])))
}

function supportedNpmVersion(version) {
  const parts = versionParts(version)
  if (!parts) return false
  const [major, minor, patch] = parts
  return major > 10 || (major === 10 && (minor > 9 || (minor === 9 && patch >= 8)))
}

function runtimeEnvironment(environment = process.env) {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => key.toUpperCase() !== 'ELECTRON_RUN_AS_NODE'))
}

function assertCertificateEnvironment(environment = process.env) {
  for (const [key, value] of Object.entries(environment)) {
    if (key.toUpperCase() === 'NODE_TLS_REJECT_UNAUTHORIZED' && value === '0') {
      throw new Error('Certificate verification is disabled by NODE_TLS_REJECT_UNAUTHORIZED. Remove this setting before starting Budget Terminal.')
    }
  }
}

if (require.main === module) {
  try {
    if (!supportedNodeVersion(process.versions.node)) throw new Error('Install Node.js 22.23.4+, 24.22.1+, or 26.12.1+ before installing or launching Budget Terminal (eMudhra certificate security update).')
    assertCertificateEnvironment()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = { supportedNodeVersion, supportedNpmVersion, runtimeEnvironment, assertCertificateEnvironment }
