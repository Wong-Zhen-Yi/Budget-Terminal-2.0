// Keep bootstrap checks usable before npm has installed any dependencies.
function versionParts(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version || '')
  return match ? match.slice(1).map(Number) : null
}

function supportedNodeVersion(version) {
  const parts = versionParts(version)
  if (!parts) return false
  const [major, minor] = parts
  return (major === 22 && minor >= 20) || (major === 24 && minor >= 12) || major === 26
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

module.exports = { supportedNodeVersion, supportedNpmVersion, runtimeEnvironment }
