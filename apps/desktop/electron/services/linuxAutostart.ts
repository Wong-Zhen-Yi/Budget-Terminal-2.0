import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/**
 * Electron's login item API is Windows and macOS only. Linux desktops (GNOME, KDE, XFCE and
 * others) follow the XDG Autostart spec instead: a desktop entry in ~/.config/autostart runs at
 * sign-in. Kept free of Electron imports so the probe can exercise it in a temporary profile.
 */
export const AUTOSTART_FILE_NAME = 'budget-terminal.desktop'

export interface AutostartCommand { path: string; args: string[]; icon?: string }

export function autostartFile(environment: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const config = environment.XDG_CONFIG_HOME && path.isAbsolute(environment.XDG_CONFIG_HOME)
    ? environment.XDG_CONFIG_HOME
    : path.join(home, '.config')
  return path.join(config, 'autostart', AUTOSTART_FILE_NAME)
}

// Desktop Entry Exec quoting: each argument in double quotes with " ` $ \ backslash-escaped and
// % doubled, then the value's own string escaping doubles every backslash.
function execArgument(value: string): string {
  if (/[\0\n\r]/.test(value)) throw new Error('The Budget Terminal path cannot be used in a Linux autostart entry.')
  return '"' + value.replace(/[\\"`$]/g, '\\$&').replace(/%/g, '%%') + '"'
}

export function execLine(command: AutostartCommand): string {
  return [command.path, ...command.args].map(execArgument).join(' ').replace(/\\/g, '\\\\')
}

export function autostartEntry(name: string, command: AutostartCommand): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${name}`,
    'Comment=Open Budget Terminal when you sign in',
    `Exec=${execLine(command)}`,
    ...(command.icon ? [`Icon=${command.icon.replace(/\\/g, '\\\\')}`] : []),
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n')
}

function entryValues(text: string): Map<string, string> {
  const values = new Map<string, string>()
  let section = ''
  for (const line of text.split(/\r?\n/)) {
    const header = /^\[(.+)\]\s*$/.exec(line)
    if (header) { section = header[1]; continue }
    if (section !== 'Desktop Entry') continue
    const pair = /^([A-Za-z0-9-]+)\s*=\s*(.*)$/.exec(line)
    if (pair && !values.has(pair[1])) values.set(pair[1], pair[2])
  }
  return values
}

/** Enabled when the entry runs this build and no desktop has switched it off (KDE sets Hidden, GNOME Tweaks clears X-GNOME-Autostart-enabled). */
export function autostartEnabled(file: string, command: AutostartCommand): boolean {
  let text: string
  try { text = readFileSync(file, 'utf8') } catch { return false }
  const values = entryValues(text)
  if (values.get('Hidden')?.toLowerCase() === 'true') return false
  if (values.get('X-GNOME-Autostart-enabled')?.toLowerCase() === 'false') return false
  return values.get('Exec') === execLine(command)
}

export function setAutostart(file: string, enabled: boolean, name: string, command: AutostartCommand): void {
  if (!enabled) {
    if (existsSync(file)) rmSync(file, { force: true })
    return
  }
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, autostartEntry(name, command), { mode: 0o644 })
}
