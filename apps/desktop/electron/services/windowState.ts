import { app, type BrowserWindow } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSavedWindowState, type SavedWindowState } from '../shared/windowSize.js'

const FILE = 'window-state.json'
const SAVE_DELAY_MS = 1_000

function statePath(): string {
  return join(app.getPath('userData'), FILE)
}

/** The last main-window placement, or undefined on first launch or a damaged file. */
export function readWindowState(): SavedWindowState | undefined {
  try {
    return parseSavedWindowState(JSON.parse(readFileSync(statePath(), 'utf8')))
  } catch {
    return undefined
  }
}

function writeWindowState(state: SavedWindowState): void {
  const path = statePath()
  const temporary = `${path}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(state))
    renameSync(temporary, path)
  } catch (error) {
    // Placement is a convenience; a failed write must never block closing the window.
    console.warn('Could not save window placement:', error)
  }
}

/** Remember the window's normal bounds and maximized state as it moves, resizes and closes. */
export function trackWindowState(window: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const save = () => {
    clearTimeout(timer)
    timer = undefined
    if (window.isDestroyed() || window.isMinimized()) return
    writeWindowState({ bounds: window.getNormalBounds(), maximized: window.isMaximized() })
  }
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(save, SAVE_DELAY_MS)
  }
  window.on('resize', schedule)
  window.on('move', schedule)
  window.on('maximize', schedule)
  window.on('unmaximize', schedule)
  window.on('close', save)
  window.once('closed', () => clearTimeout(timer))
}
