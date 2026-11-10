const { chmodSync, mkdirSync, writeFileSync } = require('node:fs')
// Installed source launchers retain the existing local backend; production release builds use docs/production-release.md.
// Efficiency updates preserve all-page startup readiness; verification is recorded in docs/efficiency-results.md.
const { homedir } = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

if (process.platform !== 'linux') throw new Error('This launcher installer requires Linux.')

const root = path.resolve(__dirname, '..')
const home = homedir()
const launcher = path.join(root, 'Launch Budget Terminal.sh')
const icon = path.join(root, 'apps/desktop/resources/budget-terminal-icon.png')
const quote = value => '"' + value.replace(/[\\"`$]/g, '\\$&').replace(/%/g, '%%') + '"'
const entry = `[Desktop Entry]\nType=Application\nName=Budget Terminal 2.0\nComment=Market research workspace with Steam Deck display support\nExec=/bin/sh ${quote(launcher)}\nIcon=${icon.replace(/\\/g, '\\\\')}\nTerminal=true\nCategories=Office;Finance;\n`
const desktop = spawnSync('xdg-user-dir', ['DESKTOP'], { encoding: 'utf8' })
const desktopDirectory = desktop.status === 0 && path.isAbsolute(desktop.stdout.trim())
  ? desktop.stdout.trim()
  : path.join(home, 'Desktop')
const destinations = [
  path.join(process.env.XDG_DATA_HOME || path.join(home, '.local/share'), 'applications/budget-terminal.desktop'),
  path.join(desktopDirectory, 'Budget Terminal 2.0.desktop'),
]

chmodSync(launcher, 0o755)
for (const destination of destinations) {
  mkdirSync(path.dirname(destination), { recursive: true })
  writeFileSync(destination, entry, { mode: 0o755 })
  chmodSync(destination, 0o755)
  console.log(`Installed launcher: ${destination}`)
}
console.log('Double-click Budget Terminal 2.0 in Desktop Mode. Keep its terminal open while using the app.')
