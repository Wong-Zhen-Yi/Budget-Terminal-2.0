/**
 * Linux launch on startup: the XDG autostart entry Settings writes, read back, and the
 * desktops' own off switches. Runs in a scratch XDG_CONFIG_HOME, never your real profile.
 *
 *   npm run probe:launch-on-startup --workspace budget-terminal-desktop
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { autostartEnabled, autostartFile, execLine, setAutostart } from '../electron/services/linuxAutostart.js'

const scratch = mkdtempSync(join(tmpdir(), 'bt-autostart-'))
try {
  const file = autostartFile({ XDG_CONFIG_HOME: scratch }, '/home/nobody')
  assert.equal(file, join(scratch, 'autostart', 'budget-terminal.desktop'))
  assert.equal(autostartFile({ XDG_CONFIG_HOME: 'relative' }, '/home/nobody'), '/home/nobody/.config/autostart/budget-terminal.desktop')

  const command = { path: '/opt/My Apps/electron', args: ['/home/me/100% "real" $dir\\app'], icon: '/home/me/icon.png' }
  assert.equal(execLine(command), String.raw`"/opt/My Apps/electron" "/home/me/100%% \\"real\\" \\$dir\\\\app"`)

  assert.equal(autostartEnabled(file, command), false, 'no entry must read as off')
  setAutostart(file, true, 'Budget Terminal', command)
  const text = readFileSync(file, 'utf8')
  assert.match(text, /^\[Desktop Entry\]\nType=Application\nName=Budget Terminal\n/)
  assert.match(text, /\nTerminal=false\n/)
  assert.equal(autostartEnabled(file, command), true, 'written entry must read as on')
  assert.equal(autostartEnabled(file, { ...command, args: ['/elsewhere'] }), false, 'another checkout must read as off')

  writeFileSync(file, text.replace('X-GNOME-Autostart-enabled=true', 'X-GNOME-Autostart-enabled=false'))
  assert.equal(autostartEnabled(file, command), false, 'GNOME Tweaks off switch must read as off')
  writeFileSync(file, text + 'Hidden=true\n')
  assert.equal(autostartEnabled(file, command), false, 'KDE Hidden entry must read as off')

  setAutostart(file, true, 'Budget Terminal', command)
  assert.equal(autostartEnabled(file, command), true, 're-enabling must clear desktop off switches')
  setAutostart(file, false, 'Budget Terminal', command)
  assert.equal(autostartEnabled(file, command), false, 'disabling must remove the entry')
  setAutostart(file, false, 'Budget Terminal', command)
  console.log('launch on startup probe passed')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
