const { existsSync } = require('node:fs')
const path = require('node:path')

/** Resolve a native executable; never execute a Windows npm shell shim. */
function findCodex({ platform = process.platform, architecture = process.arch, environment = process.env, exists = existsSync } = {}) {
  const windows = platform === 'win32'
  const paths = windows ? path.win32 : path.posix
  const value = name => Object.entries(environment).find(([key]) => windows ? key.toUpperCase() === name.toUpperCase() : key === name)?.[1]
  const binary = windows ? 'codex.exe' : 'codex'
  const candidates = [value('BUDGET_TERMINAL_CODEX_PATH')]
  const directories = (value('PATH') || '').split(windows ? ';' : ':').filter(Boolean).map(directory => directory.replace(/^"|"$/g, ''))
  for (const directory of directories) {
    candidates.push(paths.join(directory, binary))
    if (windows) {
      const target = architecture === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
      const packageName = `codex-win32-${architecture === 'arm64' ? 'arm64' : 'x64'}`
      const npmPackage = paths.join(directory, 'node_modules', '@openai', 'codex')
      candidates.push(paths.join(npmPackage, 'vendor', target, 'codex', binary),
        paths.join(npmPackage, 'node_modules', '@openai', packageName, 'vendor', target, 'codex', binary),
        paths.join(directory, 'node_modules', '@openai', packageName, 'vendor', target, 'codex', binary))
    }
  }
  if (windows && value('LOCALAPPDATA')) candidates.push(paths.join(value('LOCALAPPDATA'), 'Programs', 'OpenAI', 'Codex', 'bin', binary))
  if (!windows) {
    if (value('HOME')) candidates.push(paths.join(value('HOME'), '.local', 'bin', binary))
    candidates.push('/opt/homebrew/bin/codex', '/usr/local/bin/codex', '/usr/bin/codex')
  }
  return candidates.find(candidate => candidate && exists(candidate)) || null
}

module.exports = { findCodex }
