// Use logical display pixels so desktop scaling and Steam Deck work areas fit.
export function desktopWindowSize(workArea: { width: number; height: number }) {
  return {
    width: Math.min(1600, workArea.width),
    height: Math.min(1000, workArea.height),
    minWidth: Math.min(1280, workArea.width),
    minHeight: Math.min(720, workArea.height),
  }
}
