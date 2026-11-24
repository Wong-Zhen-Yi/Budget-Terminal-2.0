// Capture the production app with the same disposable profile as the demo launchers.
// Run npm run build first, then node scripts/capture-demo.cjs.
const { spawn } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { createDemoSession } = require('./demo-session.cjs')

const root = resolve(__dirname, '..')
const mobile = process.argv.includes('--mobile')
const demo = createDemoSession(process.env)
const entry = join(demo.directory, 'capture.cjs')
writeFileSync(entry, `
const { app, dialog } = require('electron')
const { writeFileSync } = require('node:fs')
app.setAppPath(${JSON.stringify(join(root, 'apps/desktop'))})
app.commandLine.appendSwitch('disable-gpu')
dialog.showErrorBox = (title, message) => { console.error(title, message); app.exit(1) }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    try {
      const run = async code => { try { return await window.webContents.executeJavaScript(code) } catch (error) { console.error(code); throw error } }
      const waitFor = async code => {
        const end = Date.now() + 30000
        while (!await run(code)) {
          if (Date.now() > end) throw Error('UI did not become ready: ' + code)
          await delay(250)
        }
      }
      const mobile = ${mobile}
      await waitFor('Boolean(document.querySelector("' + (mobile ? '.mobile-page-button' : '.terminal-page-picker') + '"))')
      await run('document.querySelector(".auth-popup-close")?.click()')
      if (!mobile) { window.unmaximize(); window.setContentSize(1600, 1000) }
      await delay(mobile ? 30000 : 60000)
      // Use the real Stop and New chat commands: demo capture needs no signed-in agent.
      if (!mobile) await run('window.api.agentsCommand({ type: "stop" }).then(() => window.api.agentsCommand({ type: "newChat" })).then(() => true)')
      await delay(1000)
      for (const [id, label] of ${JSON.stringify(mobile ? [['portfolio', 'Portfolio'], ['dashboard-2', 'Dashboard 2.0'], ['charts', 'Charts']] : [['portfolio', 'Portfolio'], ['dashboard-2', 'Dashboard 2.0'], ['personal-finance', 'Personal Finance'], ['charts', 'Charts'], ['dictionary', 'Dictionary'], ['focus-dashboard', 'Focus Dashboard']])}) {
        if (mobile) {
          await run('document.querySelector(".mobile-page-button").click()')
          await waitFor('Boolean(document.querySelector("#mobile-navigation"))')
          await run('document.querySelector("[data-navigation-page=' + id + ']").click()')
        } else {
        await run('document.querySelector(".terminal-page-picker").click()')
        await waitFor('Boolean(document.querySelector("[role=dialog] input"))')
        await run('(() => { const input = document.querySelector("[role=dialog] input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ' + JSON.stringify(label) + '); input.dispatchEvent(new Event("input", { bubbles: true })); })()')
        await delay(300)
        await run('document.querySelector("[data-result-index]").click()')
        }
        await waitFor('Boolean([...document.querySelectorAll("[data-page-id]")].find(page => page.dataset.pageId === ' + JSON.stringify(id) + ' && page.getBoundingClientRect().height > 0))')
        await delay(id === 'charts' ? 15000 : 5000)
        await run('document.fonts.ready.then(() => true)')
        const image = await window.webContents.capturePage()
        writeFileSync(${JSON.stringify(join(root, 'docs/assets/screenshots'))} + '/' + (mobile ? 'mobile-' : '') + id + '.png', image.toPNG())
        console.log('Captured ' + label)
      }
      if (mobile) {
        await run('document.querySelector(".mobile-page-button").click()')
        await delay(500)
        writeFileSync(${JSON.stringify(join(root, 'docs/assets/screenshots/mobile-workspaces.png'))}, (await window.webContents.capturePage()).toPNG())
      }
      app.exit(0)
    } catch (error) { console.error(error); app.exit(1) }
  })
})
import(${JSON.stringify(pathToFileURL(join(root, 'apps/desktop/out/main/main.js')).href)})
`)
const env = { ...demo.env }
if (mobile) env.BUDGET_TERMINAL_MOBILE_PREVIEW = '1'
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const child = spawn(require('electron'), [entry], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
child.stdout.pipe(process.stdout)
child.stderr.pipe(process.stderr)
const timer = setTimeout(() => child.kill(), 180000)
child.on('error', error => { console.error(error); process.exitCode = 1 })
child.on('close', code => {
  clearTimeout(timer)
  demo.close()
  process.exitCode = code ?? 1
})
