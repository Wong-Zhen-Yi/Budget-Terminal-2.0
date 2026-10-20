import assert from 'node:assert/strict'
import { desktopWindowSize } from '../electron/shared/windowSize.js'

for (const workArea of [
  { width: 1280, height: 800 },
  { width: 1280, height: 752 },
  { width: 1024, height: 640 },
  { width: 1920, height: 1080 },
]) {
  const size = desktopWindowSize(workArea)
  assert(size.width <= workArea.width && size.height <= workArea.height)
  assert(size.minWidth <= size.width && size.minHeight <= size.height)
}
assert.deepEqual(desktopWindowSize({ width: 1920, height: 1080 }), {
  width: 1600, height: 1000, minWidth: 1280, minHeight: 720,
})
console.log('Window sizes fit Steam Deck, scaled desktops, and external monitors.')
