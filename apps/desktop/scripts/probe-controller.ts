import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { ControllerReader } from '../src/input/controller'

const require = createRequire(import.meta.url)
const reader = new ControllerReader()
const pad = (buttons: number[] = [], axes = [0, 0, 0, 0], mapping = 'standard', index = 0) => ({
  index, connected: true, mapping, axes,
  buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: buttons.includes(index), value: buttons.includes(index) ? 1 : 0 })),
}) as unknown as Gamepad
assert.deepEqual(reader.read(pad([0]), 0).actions, [], 'Connection must baseline held confirm')
assert.deepEqual(reader.read(pad([0]), 10).actions, [], 'Held confirm cannot activate after connection')
reader.read(pad(), 20)
assert.deepEqual(reader.read(pad([0]), 30).actions, ['activate'])
assert.deepEqual(reader.read(pad([0]), 900).actions, [], 'Confirm must not repeat')
assert.deepEqual(reader.read(pad([13]), 1000).actions, ['down'])
assert.deepEqual(reader.read(pad([13]), 1349).actions, [])
assert.deepEqual(reader.read(pad([13]), 1350).actions, ['down'])
assert.deepEqual(reader.read(pad([13]), 1479).actions, [])
assert.deepEqual(reader.read(pad([13]), 1480).actions, ['down'])
reader.read(pad(), 1500)
assert.deepEqual(reader.read(pad([], [0.2, -0.3, 0.3, -0.2]), 1600), { actions: [], scroll: [0, 0] }, 'Stick drift must be ignored')
assert.deepEqual(reader.read(pad([], [0.9, 0.6, 1, -1]), 1700), { actions: ['right'], scroll: [1, -1] })
assert.deepEqual(reader.read(pad([0], [], ''), 1800).actions, [], 'Unknown mappings ignored')
assert.deepEqual(reader.read(pad([0]), 1900).actions, [], 'Reconnect held confirm ignored')
reader.read(undefined, 2000)
assert.deepEqual(reader.read(pad([5]), 2100).actions, [], 'Reconnect held shoulder ignored')
reader.read(pad(), 2200)
assert.deepEqual(reader.read(pad([4, 5, 9, 1]), 2300).actions, ['back', 'previousPage', 'nextPage', 'picker'])
assert.deepEqual(reader.read(pad([0], [], 'standard', 1), 2400).actions, [], 'Changing devices baselines inputs')
console.log('PASS: standard mapping, connection baseline, edge activation, repeat timing, dead zones and reconnects')

const directory = await mkdtemp(join(tmpdir(), 'budget-controller-'))
try {
  const bundle = await build({
    stdin: { resolveDir: resolve(import.meta.dirname, '..'), loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { flushSync } from 'react-dom'
      import { TabPicker } from './src/components/chrome/TabPicker'
      import { startControllerNavigation, performControllerAction, moveControllerFocus, scrollControllerPanel } from './src/input/controllerNavigation'
      import { useControllerNavigation } from './src/input/useControllerNavigation'
      const check = (value, message) => { if (!value) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 70))
      const byId = id => document.getElementById(id)
      let page = 0, pickerToggles = 0, clicks = 0, selected = '', focused = true, enabled = true, buttons = [], connected = true
      const options = { enabled: true, stepPage: direction => page += direction, togglePicker: () => pickerToggles++ }
      const action = value => performControllerAction(value, options)
      Object.defineProperty(navigator, 'getGamepads', { value: () => connected ? [{ index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({length:17}, (_, i) => ({ pressed: buttons.includes(i) })) }] : [] })
      Object.defineProperty(document, 'hasFocus', { value: () => focused })
      const root = createRoot(byId('react'))
      function HookFixture() { useControllerNavigation({ ...options, enabled }); return null }
      const renderHook = () => flushSync(() => root.render(<HookFixture />))
      window.runProbe = async () => {
        byId('first').onclick = () => clicks++
        byId('last').onclick = () => clicks++
        moveControllerFocus('down')
        check(document.activeElement.id === 'first', 'Initial focus should enter active page')
        check(byId('first').hasAttribute('data-controller-focus'), 'Controller focus marker missing')
        action('activate'); check(clicks === 1, 'Confirm did not click')
        action('right'); check(document.activeElement.id === 'second', 'Spatial right navigation failed')
        action('down'); check(document.activeElement.id === 'last', 'Spatial down navigation failed')
        action('activate'); check(clicks === 2, 'Hidden or disabled control intercepted activation')
        byId('choice').focus(); action('down')
        check(byId('choice').value === 'two', 'Native select did not change')
        action('right'); check(document.activeElement !== byId('choice'), 'Select traps spatial navigation')
        byId('text').focus(); action('back'); check(document.activeElement !== byId('text'), 'Back did not leave text field')
        byId('first').focus(); scrollControllerPanel(0, 100)
        check(byId('scroll').scrollTop > 0, 'Right stick did not scroll focused panel')
        action('nextPage'); action('previousPage'); check(page === 0, 'Shoulder navigation failed')
        action('picker'); check(pickerToggles === 1, 'Menu did not toggle picker')
        byId('dialog').hidden = false; byId('first').focus(); action('down')
        check(document.activeElement.id === 'dialogButton', 'Modal focus escaped')
        action('nextPage'); action('picker'); check(page === 0 && pickerToggles === 1, 'Page switch or picker escaped modal')
        byId('dialog').hidden = true
        flushSync(() => root.render(<TabPicker tabs={[{ id: 'stocks', label: 'Stocks', implemented: true }, { id: 'settings', label: 'Settings', implemented: true }]} onSelect={id => { selected = id }} onClose={() => { selected = 'closed' }} />))
        action('down'); action('activate'); check(selected === 'stocks', 'Controller cannot select real page picker result')
        action('back'); check(selected === 'closed', 'Back did not dismiss page picker')
        flushSync(() => root.render(null))
        byId('first').focus()
        renderHook(); await settle()
        buttons = [0]; await settle(); check(clicks === 3, 'Gamepad polling or React hook failed')
        await settle(); check(clicks === 3, 'Held confirm repeated in UI')
        focused = false; await settle(); buttons = []; await settle(); buttons = [0]; await settle()
        check(clicks === 3, 'Unfocused app accepted input')
        focused = true; await settle(); check(clicks === 3, 'Refocus activated held confirm')
        buttons = []; await settle(); buttons = [0]; await settle(); check(clicks === 4, 'Release/repress after refocus failed')
        connected = false; await settle(); connected = true; await settle(); check(clicks === 4, 'Reconnect activated held confirm')
        enabled = false; renderHook(); buttons = []; await settle(); buttons = [0]; await settle(); check(clicks === 4, 'Disabled screenshot mode accepted input')
        enabled = true; renderHook(); await settle(); buttons = []; await settle(); buttons = [0]; await settle(); check(clicks === 5, 'Re-enabling controller failed')
        window.dispatchEvent(new PointerEvent('pointerdown')); check(!document.querySelector('[data-controller-focus]'), 'Mouse did not clear controller decoration')
        flushSync(() => root.unmount()); buttons = []; await settle(); buttons = [0]; await settle(); check(clicks === 5, 'Unmount did not stop polling')
        check(innerWidth === 1280 && document.documentElement.scrollWidth <= innerWidth, 'Steam Deck viewport overflow: viewport=' + innerWidth + ', scroll=' + document.documentElement.scrollWidth)
        return 'PASS: Electron UI at 1280x800, focus and activation, hidden/disabled filtering, selects, scrolling, dialog isolation, real page picker, React polling, focus loss, reconnect, screenshot suppression and cleanup'
      }
    ` }, bundle: true, jsx: 'automatic', write: false, platform: 'browser', format: 'iife',
    tsconfig: resolve(import.meta.dirname, '../tsconfig.json'),
  })
  await writeFile(join(directory, 'fixture.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), `<!doctype html><html><style>
    body { margin:0; background:#080b12; color:#d5dee9 }
    #scroll { overflow:auto; width:500px; height:400px }
    #grid { display:grid; grid-template-columns:200px 200px; gap:10px }
    button, input, select { height:40px } #dialog { position:fixed; inset:100px; background:#0d1420 }
  </style><body><button id="chrome">Navigation</button><div data-page-id="stocks" id="scroll"><div id="grid">
    <button id="first">First</button><button id="second">Second</button>
    <button disabled>Disabled</button><button id="last">Last</button>
    <select id="choice"><option value="one">One</option><option value="two">Two</option></select><input id="text">
  </div><div hidden><button>Hidden page control</button></div><div aria-hidden="true"><button>Obscured control</button></div><div style="height:1000px"></div></div>
  <div id="dialog" role="dialog" hidden><button id="dialogButton">Dialog action</button></div><div id="react"></div><script src="fixture.js"></script></body></html>`)
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width:1280, height:800, useContentSize:true, webPreferences: { backgroundThrottling:false, offscreen:true } })
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        console.log(await window.webContents.executeJavaScript('window.runProbe()'))
        app.exit(0)
      } catch (error) { console.error(error); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [...(process.platform === 'linux' && !process.env.DISPLAY ? ['--ozone-platform=headless', '--ozone-override-screen-size=1280,800', '--disable-gpu'] : []), join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Controller UI probe timed out')) }, 60_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
