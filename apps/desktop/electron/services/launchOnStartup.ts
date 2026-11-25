import { app } from 'electron'

import type { LaunchOnStartupStatus } from '../shared/contract.js'

/** The Run registry value Windows lists in Task Manager → Startup apps. */
const ENTRY_NAME = 'Budget Terminal'

/**
 * Source builds run Electron with the app folder as its argument, the way the launcher
 * starts them, so sign-in opens the most recent build without a terminal or rebuild.
 * Electron quotes each argument itself, so the folder path is passed unquoted.
 */
function loginItem() {
  return { path: process.execPath, args: [app.getAppPath()] }
}

function unavailableReason(): string | undefined {
  if (process.env.BUDGET_TERMINAL_DEMO_DIR) return 'Demo profiles cannot open at sign-in.'
  if (process.platform !== 'win32') return 'Available on Windows.'
  return undefined
}

export function launchOnStartupStatus(): LaunchOnStartupStatus {
  const reason = unavailableReason()
  if (reason) return { supported: false, enabled: false, reason }
  const item = loginItem()
  // `openAtLogin` only inspects the entry named after the AppUserModelId, so match this
  // entry by name and command. One disabled in Task Manager stays listed but no longer opens.
  const enabled = app.getLoginItemSettings(item).launchItems.some(entry => entry.name === ENTRY_NAME &&
    entry.path.toLowerCase() === item.path.toLowerCase() &&
    entry.args.length === 1 && entry.args[0].toLowerCase() === item.args[0].toLowerCase() && entry.enabled)
  return { supported: true, enabled }
}

export function configureLaunchOnStartup(enabled: unknown): LaunchOnStartupStatus {
  if (typeof enabled !== 'boolean') throw new Error('Choose whether Budget Terminal opens when you sign in.')
  const reason = unavailableReason()
  if (reason) throw new Error(reason)
  app.setLoginItemSettings({ ...loginItem(), name: ENTRY_NAME, openAtLogin: enabled })
  return launchOnStartupStatus()
}
