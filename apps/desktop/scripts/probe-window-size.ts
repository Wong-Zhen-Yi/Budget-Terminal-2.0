import assert from 'node:assert/strict'
import { desktopWindowBounds, desktopWindowSize, useGamingFullscreen } from '../electron/shared/windowSize.js'

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
  width: 1600, height: 1000, minWidth: 960, minHeight: 600,
})
for (const workArea of [
  { x: 0, y: 0, width: 1280, height: 800 },
  { x: 0, y: 48, width: 1280, height: 752 },
  { x: 1920, y: 32, width: 1024, height: 608 },
  { x: -1920, y: -1080, width: 1920, height: 1080 },
  { x: 0, y: 0, width: 800, height: 1280 },
]) {
  for (const previous of [undefined,
    { x: 2560, y: 80, width: 1600, height: 1000 },
    { x: -3840, y: -2160, width: 1920, height: 1080 },
    { x: 9999, y: 9999, width: 400, height: 300 },
  ]) {
    const bounds = desktopWindowBounds(workArea, previous)
    assert(bounds.x >= workArea.x && bounds.y >= workArea.y)
    assert(bounds.x + bounds.width <= workArea.x + workArea.width)
    assert(bounds.y + bounds.height <= workArea.y + workArea.height)
    assert(bounds.width >= bounds.minWidth && bounds.height >= bounds.minHeight)
  }
}
assert.equal(desktopWindowBounds({ x: 1920, y: 0, width: 1920, height: 1080 }).x, 2080)
assert.equal(useGamingFullscreen('linux', { XDG_CURRENT_DESKTOP: 'gamescope' }), true)
assert.equal(useGamingFullscreen('linux', { SteamGamepadUI: '1' }), true)
assert.equal(useGamingFullscreen('linux', { DESKTOP_SESSION: 'gamescope' }), true)
assert.equal(useGamingFullscreen('linux', { XDG_CURRENT_DESKTOP: 'KDE', SteamDeck: '1' }), false)
assert.equal(useGamingFullscreen('win32', { SteamGamepadUI: '1' }), false)
console.log('Window sizes fit Steam Deck, scaled desktops, and external monitors.')
