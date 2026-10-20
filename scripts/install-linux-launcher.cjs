const { chmodSync, mkdirSync, writeFileSync } = require('node:fs')
const { homedir } = require('node:os')
const path = require('node:path')

if (process.platform !== 'linux') throw new Error('This launcher installer requires Linux.')
const root = path.resolve(__dirname, '..')
// Escape desktop-entry values, including paths containing spaces or percent signs.
const quote = value => '"' + value.replace(/[\\"`$]/g, '\\$&').replace(/%/g, '%%') + '"'
const destination = path.join(process.env.XDG_DATA_HOME || path.join(homedir(), '.local/share'), 'applications')
mkdirSync(destination, { recursive: true })
const launcher = path.join(root, 'Launch Budget Terminal.sh')
chmodSync(launcher, 0o755)
const file = path.join(destination, 'budget-terminal.desktop')
writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Budget Terminal\nComment=Market research workspace\nExec=${quote(launcher)}\nIcon=utilities-system-monitor\nTerminal=true\nCategories=Office;Finance;\n`)
chmodSync(file, 0o755)
console.log(`Installed application launcher: ${file}`)
