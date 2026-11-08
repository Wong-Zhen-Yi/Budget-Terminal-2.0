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
