import assert from 'node:assert/strict'
import { desktopWindowBounds, desktopWindowSize, parseSavedWindowState, restoreWindowBounds, useGamingFullscreen } from '../electron/shared/windowSize.js'
import { normalizeChartSymbol, chartWindowHash } from '../electron/shared/chartWindow.js'

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

// Saved placement: reopen on the monitor the window was left on, clamped to its current work area.
const primary = { x: 0, y: 0, width: 1920, height: 1040 }
const right = { x: 1920, y: 0, width: 2560, height: 1400 }
assert.deepEqual(restoreWindowBounds([primary, right], primary), desktopWindowBounds(primary), 'First launch centers on the primary display')
const onRight = restoreWindowBounds([primary, right], primary, { bounds: { x: 2200, y: 120, width: 1400, height: 900 }, maximized: false })
assert.deepEqual([onRight.x, onRight.y, onRight.width, onRight.height], [2200, 120, 1400, 900], 'A saved placement on the second monitor must be kept')
const unplugged = restoreWindowBounds([primary], primary, { bounds: { x: 2200, y: 120, width: 1400, height: 900 }, maximized: true })
assert.deepEqual(unplugged, desktopWindowBounds(primary), 'A window left on a disconnected monitor must reopen on the primary display')
const oversized = restoreWindowBounds([primary, right], primary, { bounds: { x: -50, y: -20, width: 2400, height: 1300 }, maximized: false })
assert(oversized.x >= primary.x && oversized.x + oversized.width <= primary.x + primary.width, 'Restored bounds must fit the chosen display')
assert(oversized.y >= primary.y && oversized.y + oversized.height <= primary.y + primary.height)
const sliver = restoreWindowBounds([primary], primary, { bounds: { x: 1900, y: 1000, width: 1200, height: 800 }, maximized: false })
assert.deepEqual(sliver, desktopWindowBounds(primary), 'A window with only a sliver on screen must recenter')
assert.deepEqual(parseSavedWindowState({ bounds: { x: 10.4, y: 20, width: 1200, height: 800 }, maximized: true }),
  { bounds: { x: 10, y: 20, width: 1200, height: 800 }, maximized: true })
for (const damaged of [null, 'x', {}, { bounds: { x: 0, y: 0, width: 'wide', height: 800 } }, { bounds: { x: 0, y: 0, width: 50, height: 800 } },
  { bounds: { x: Infinity, y: 0, width: 1200, height: 800 } }]) {
  assert.equal(parseSavedWindowState(damaged), undefined, 'A damaged placement file must be ignored')
}

// Pop-out chart windows accept only ticker-shaped symbols.
for (const symbol of ['nvda', 'BRK-B', '^GSPC', 'ES=F', 'BTC-USD', 'BRK.B']) assert(normalizeChartSymbol(symbol), symbol)
for (const symbol of ['', ' ', 'A B', '../x', '<script>', 'A'.repeat(33), 42, null]) assert.equal(normalizeChartSymbol(symbol), null)
assert.equal(chartWindowHash('^GSPC'), 'chart=%5EGSPC')
console.log('Window sizes fit Steam Deck, scaled desktops, and external monitors; saved placement and chart pop-outs validated.')
