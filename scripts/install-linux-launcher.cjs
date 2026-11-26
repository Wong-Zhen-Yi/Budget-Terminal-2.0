const { chmodSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
// Convex snapshot writes are restored; record-era cloud tables are retained as an archive.
// Launchers open the desktop workspace directly, including Portfolio, charts and Agents.
// Database sync restored to 3208321: optional Convex snapshots, GitHub sign-in and complete-copy conflict choices.
// Efficiency updates preserve all-page startup readiness; verification is recorded in docs/efficiency-results.md.
// Crypto prices use Hyperliquid and CoinGecko only; Finnhub remains a stock provider.
const { createHash } = require('node:crypto')
const { homedir } = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const home = homedir()
// The desktop entry runs the Linux double-click launcher, which wraps the shared launch script.
// Terminal=false: the launcher opens its own terminal. Terminal=true made XFCE also open the default
// terminal (ptyxis on Ubuntu), which ran no command and left a stray empty window beside the build.
const launcher = path.join(root, 'launchers', 'linux', 'Launch Budget Terminal.sh')
const icon = path.join(root, 'apps/desktop/resources/budget-terminal-icon.png')
const quote = value => '"' + value.replace(/[\\"`$]/g, '\\$&').replace(/%/g, '%%') + '"'
const entry = `[Desktop Entry]\nType=Application\nName=Budget Terminal 2.0\nComment=Market research workspace with Steam Deck display support\nExec=/bin/sh ${quote(launcher)}\nIcon=${icon.replace(/\\/g, '\\\\')}\nTerminal=false\nCategories=Office;Finance;\n`
// Terminal command: btd runs the same shared launch path from any directory, with the Windows btd commands.
function installBtdCommand() {
  const command = path.join(home, '.local/bin/btd')
  const content = `#!/bin/sh\nexec /bin/sh ${quote(path.join(root, 'scripts/launch-posix.sh')).replace(/%%/g, '%')} "$@"\n`
  try { if (readFileSync(command, 'utf8') === content) return command } catch { /* install below */ }
  mkdirSync(path.dirname(command), { recursive: true })
  writeFileSync(command, content, { mode: 0o755 })
  chmodSync(command, 0o755)
  return command
}

function installLinuxLauncher() {
  if (process.platform !== 'linux') throw new Error('This launcher installer requires Linux.')
  const desktop = spawnSync('xdg-user-dir', ['DESKTOP'], { encoding: 'utf8' })
  const desktopDirectory = desktop.status === 0 && path.isAbsolute(desktop.stdout.trim())
    ? desktop.stdout.trim()
    : path.join(home, 'Desktop')
  const destinations = [
    path.join(process.env.XDG_DATA_HOME || path.join(home, '.local/share'), 'applications/budget-terminal.desktop'),
    path.join(desktopDirectory, 'Budget Terminal 2.0.desktop'),
  ]

  for (const destination of destinations) {
    mkdirSync(path.dirname(destination), { recursive: true })
    writeFileSync(destination, entry, { mode: 0o755 })
    chmodSync(destination, 0o755)
    // GNOME (Ubuntu's desktop icons) and XFCE refuse untrusted desktop entries until marked trusted.
    const checksum = createHash('sha256').update(entry).digest('hex')
    spawnSync('gio', ['set', destination, 'metadata::trusted', 'true'], { stdio: 'ignore' })
    spawnSync('gio', ['set', '-t', 'string', destination, 'metadata::xfce-exe-checksum', checksum], { stdio: 'ignore' })
    console.log(`Installed launcher: ${destination}`)
  }
  console.log(`Installed command: ${installBtdCommand()}`)
  console.log('Double-click Budget Terminal 2.0 on the desktop or open it from the app menu, or type btd in a terminal (btd --help for commands).')
}

if (require.main === module) installLinuxLauncher()

module.exports = { installBtdCommand, installLinuxLauncher }
