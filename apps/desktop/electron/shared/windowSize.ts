// Use logical display pixels so desktop scaling and Steam Deck work areas fit.
export function desktopWindowSize(workArea: { width: number; height: number }) {
  return {
    width: Math.min(1600, workArea.width),
    height: Math.min(1000, workArea.height),
    minWidth: Math.min(960, workArea.width),
    minHeight: Math.min(600, workArea.height),
  }
}

type Rectangle = { x: number; y: number; width: number; height: number }

// Electron screen coordinates are logical pixels, including display origins.
// Never multiply these by scaleFactor (or assume the primary display is at 0,0).
export function desktopWindowBounds(workArea: Rectangle, previous?: Rectangle) {
  const size = desktopWindowSize(workArea)
  const width = previous ? Math.max(size.minWidth, Math.min(previous.width, workArea.width)) : size.width
  const height = previous ? Math.max(size.minHeight, Math.min(previous.height, workArea.height)) : size.height
  return {
    ...size,
    width,
    height,
    x: Math.max(workArea.x, Math.min(previous?.x ?? workArea.x + Math.floor((workArea.width - width) / 2), workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(previous?.y ?? workArea.y + Math.floor((workArea.height - height) / 2), workArea.y + workArea.height - height)),
  }
}

export function useGamingFullscreen(platform: string, environment: Record<string, string | undefined>) {
  return platform === 'linux' && (
    environment.XDG_CURRENT_DESKTOP?.toLowerCase().split(':').includes('gamescope') === true ||
    environment.DESKTOP_SESSION?.toLowerCase() === 'gamescope' ||
    environment.SteamGamepadUI === '1'
  )
}

/** The main window's last normal (unmaximized) placement, saved between launches. */
export interface SavedWindowState {
  bounds: Rectangle
  maximized: boolean
}

function overlap(a: Rectangle, b: Rectangle): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? width * height : 0
}

export function parseSavedWindowState(value: unknown): SavedWindowState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { bounds, maximized } = value as Partial<SavedWindowState>
  if (!bounds || typeof bounds !== 'object') return undefined
  const numbers = [bounds.x, bounds.y, bounds.width, bounds.height]
  if (!numbers.every(number => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) < 100_000)) return undefined
  if (bounds.width < 100 || bounds.height < 100) return undefined
  return { bounds: { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) }, maximized: maximized === true }
}

/**
 * Where to open the main window. A saved placement returns to the display it mostly
 * covered, clamped to that display's current work area. A placement on a display that
 * is no longer connected (too little visible area to grab) opens centered on the
 * primary display instead.
 */
export function restoreWindowBounds(workAreas: readonly Rectangle[], primary: Rectangle, saved?: SavedWindowState) {
  if (!saved) return desktopWindowBounds(primary)
  let best: Rectangle | undefined
  let bestArea = 0
  for (const area of workAreas) {
    const covered = overlap(area, saved.bounds)
    if (covered > bestArea) { best = area; bestArea = covered }
  }
  // Require a usable strip of the title bar region to be on screen.
  if (!best || bestArea < 100 * 50) return desktopWindowBounds(primary)
  return desktopWindowBounds(best, saved.bounds)
}
