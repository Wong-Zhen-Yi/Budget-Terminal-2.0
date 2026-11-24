import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseCloudSnapshot } from '../electron/shared/cloudSnapshot.js'
import { TABS } from '../electron/shared/contract.js'
import { WORKSPACES } from '../electron/shared/navigation.js'

const root = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const directory = await mkdtemp(join(tmpdir(), 'budget-desktop-startup-'))
const normalDownloads = join(directory, 'downloads')
const mobilePreview = process.argv.includes('--mobile-preview')
const connectedMobile = process.argv.includes('--connected-mobile')
const warmMobile = process.argv.includes('--warm')
const labsMobile = connectedMobile && process.argv.includes('--labs')
const demoOnly = mobilePreview || process.argv.includes('--demo')
let demo: { env: NodeJS.ProcessEnv; close(): void } | undefined
try {
  if (connectedMobile) assert.equal(process.platform, 'win32', 'Connected mobile startup is Windows-only')
  await mkdir(normalDownloads)
  const backupName = 'budget-terminal-backup.json'
  const normalBackup = join(normalDownloads, backupName)
  if (demoOnly || connectedMobile) {
    const { createDemoSession } = require('../../../scripts/demo-session.cjs')
    demo = createDemoSession({ ...process.env, APPDATA: join(directory, 'roaming'), LOCALAPPDATA: join(directory, 'local') })
    parseCloudSnapshot(await readFile(join(root, '../../fixtures/demo-user-data.json'), 'utf8'))
    if (demoOnly) await writeFile(normalBackup, 'Existing personal backup fixture')
  }
  // Reproduce unavailable Windows shader caches without touching a real profile.
  // Files at these directory paths prevent Chromium from opening a disk cache.
  const profile = join(directory, 'data', 'electron-profile')
  const shaderCaches = ['GPUCache', 'GPUPersistentCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GrShaderCache', 'ShaderCache']
  if (process.platform === 'win32' && !demoOnly && !connectedMobile) {
    await mkdir(profile, { recursive: true })
    await Promise.all(shaderCaches.map(name => writeFile(join(profile, name), 'unavailable shader cache fixture')))
  }
  const entry = join(directory, 'startup.cjs')
  await writeFile(entry, `
    const assert = require('node:assert/strict')
    const { readFile } = require('node:fs/promises')
    const { join } = require('node:path')
    const { app, BrowserWindow, dialog, screen, session } = require('electron')
    const connectedMobile = ${connectedMobile}
    app.setAppPath(${JSON.stringify(root)})
    app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))})
    app.setPath('appData', ${JSON.stringify(join(directory, 'fixture-appData'))})
    app.setPath('downloads', ${JSON.stringify(normalDownloads)})
    const demoDirectory = process.env.BUDGET_TERMINAL_DEMO_DIR
    if (process.env.BUDGET_PROBE_AGENT_FAILURE === '1') {
      const fs = require('node:fs')
      const mkdirSync = fs.mkdirSync
      fs.mkdirSync = (path, ...args) => {
        if (path === ${JSON.stringify(join(directory, 'data', 'electron-profile', 'agents'))}) throw Error('Fixture Agent startup failure')
        return mkdirSync(path, ...args)
      }
      require('node:module').syncBuiltinESMExports()
    }
    dialog.showErrorBox = (title, message) => { console.error(title + ': ' + message); app.exit(1) }
    // Block browser network requests while exercising real startup and IPC.
    app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (_details, callback) => callback({ cancel: true }),
    ))
    app.on('browser-window-created', (_event, window) => {
      const verify = async () => {
        if (window.webContents.getURL() === 'about:blank') return
        window.webContents.off('did-finish-load', verify)
        try {
          const bounds = window.getBounds()
          const area = screen.getDisplayMatching(bounds).workArea
          assert(bounds.x >= area.x && bounds.y >= area.y, 'Window starts inside the display origin')
          assert(bounds.x + bounds.width <= area.x + area.width, 'Window right edge fits the display')
          assert(bounds.y + bounds.height <= area.y + area.height, 'Window bottom edge fits the work area')
          assert(window.getMinimumSize()[0] < area.width || area.width <= 960, 'Compact displays retain room to resize')
          if (connectedMobile) {
            if (window.getTitle() === 'Budget Terminal') {
              if (${labsMobile}) {
                const run = script => window.webContents.executeJavaScript(script)
                const waitFor = async (script, message) => {
                  const end = Date.now() + 10_000
                  while (!await run(script)) {
                    assert(Date.now() < end, message)
                    await new Promise(resolve => setTimeout(resolve, 25))
                  }
                }
                await waitFor('Boolean(document.querySelector("button[aria-label=Settings]"))', 'Desktop Settings must be available')
                await run('document.querySelector("button[aria-label=Settings]").click()')
                await waitFor('Boolean(document.querySelector("[data-settings-category=labs]"))', 'Settings must show Labs')
                await run('document.querySelector("[data-settings-category=labs]").click()')
                const mobileButton = 'Array.from(document.querySelectorAll("[data-settings-card=mobile-access] button")).find(button => button.textContent === "Open iPhone 17 viewport")'
                await waitFor('Boolean(' + mobileButton + ')', 'Labs must offer a one-click iPhone viewport')
                assert.match(await run('document.getElementById("mobile-viewport-hint").textContent'), /402 × 874 at 3×/)
                assert.equal(await run('window.api.launchMobileWindow("unknown-model").then(() => false, error => error.message.includes("supported mobile viewport"))'), true)
                await run(mobileButton + '.click()')
              } else if (${warmMobile}) {
                console.log('Requesting the mobile window from the running test desktop')
                const child = require('node:child_process').spawn(process.execPath, [__filename], {
                  env: { ...process.env, BUDGET_TERMINAL_OPEN_MOBILE: '1' }, stdio: 'ignore',
                })
                child.once('error', error => { console.error(error); app.exit(1) })
                child.unref()
              }
              return
            }
            assert.equal(window.getTitle(), 'Budget Terminal Mobile')
            console.log('The connected window loaded')
            const desktop = window.getParentWindow()
            assert.equal(desktop?.getTitle(), 'Budget Terminal')
            const run = script => window.webContents.executeJavaScript(script)
            const desktopRun = script => desktop.webContents.executeJavaScript(script)
            const delay = () => new Promise(resolve => setTimeout(resolve, 25))
            const end = Date.now() + 10_000
            while (!await run('document.querySelector(".mobile-page-button")?.textContent === "Portfolio"')) {
              assert(Date.now() < end, 'Connected mobile UI must open the shared start page')
              await delay()
            }
            assert.deepEqual(await run('[innerWidth, innerHeight, devicePixelRatio]'), [402, 874, 3])
            assert.equal((await fetch(window.webContents.getURL())).status, 403)
            assert.equal(await desktopRun('window.api.mobileAccessStatus().then(status => status.enabled)'), false)
            assert.equal(await run('window.api.launchMobileWindow("iphone-17").then(() => false, () => true)'), true,
              'The mobile client cannot launch a desktop window')
            await desktopRun('window.api.launchMobileWindow("iphone-17")')
            assert.deepEqual(BrowserWindow.getAllWindows().filter(candidate => candidate.getTitle() === 'Budget Terminal Mobile').map(candidate => candidate.id), [window.id],
              'Launching the same viewport reuses the existing window')
            const readCash = 'window.api.portfolio().then(result => result.data.portfolios[0].cashBalance)'
            const setCash = balance => 'window.api.mutatePortfolio({type:"setCash",portfolioId:"portfolio_1",cashBalance:' + balance + '})'
            const listen = 'window.receivedChange = false; window.api.onSavedDataChanged(event => { if (event.domains.includes("portfolio")) window.receivedChange = true }); true'
            await desktopRun(listen)
            await run(listen)
            assert.deepEqual((await run(setCash(765))).errors, [])
            assert.equal(await desktopRun(readCash), 765)
            await run('window.receivedChange = false')
            assert.deepEqual((await desktopRun(setCash(876))).errors, [])
            assert.equal(await run(readCash), 876)
            while (!await desktopRun('window.receivedChange') || !await run('window.receivedChange')) {
              assert(Date.now() < end, 'Both windows must receive portfolio update events')
              await delay()
            }
            console.log('PASS: connected mobile shares desktop data and update events with Tailscale off')
            app.quit()
            return
          }
          if (process.env.BUDGET_TERMINAL_MOBILE_PREVIEW === '1') {
            const run = script => window.webContents.executeJavaScript(script)
            const waitFor = async (script, message) => {
              const end = Date.now() + 10_000
              while (!await run(script)) {
                assert(Date.now() < end, message)
                await new Promise(resolve => setTimeout(resolve, 25))
              }
            }
            assert.equal(window.getTitle(), 'Budget Terminal iPhone 17 Preview')
            assert.deepEqual(await run('[innerWidth, innerHeight, screen.width, screen.height, devicePixelRatio]'), [402, 874, 402, 874, 3])
            assert.equal(await run('navigator.maxTouchPoints'), 5)
            assert.equal(await run('typeof require'), 'undefined', 'Preview has no Electron preload or Node access')
            assert.equal((await fetch(window.webContents.getURL())).status, 403, 'Only the native preview can open its local endpoint')
            await waitFor('document.querySelector(".mobile-page-button")?.textContent === "Portfolio"', 'Mobile UI must open the saved start page')
            assert.equal(await run('window.api.portfolio().then(result => result.data.portfolios[0].name)'), 'Demo Core Portfolio')
            const visible = selector => 'Boolean(document.querySelector(' + JSON.stringify(selector) + ')?.getClientRects().length)'
            const click = selector => run('document.querySelector(' + JSON.stringify(selector) + ').click()')
            const openNavigation = async () => {
              await click('.mobile-page-button')
              await waitFor(visible('#mobile-navigation'), 'Mobile Workspaces must open')
            }
            const selectPage = async id => {
              await openNavigation()
              await click('[data-navigation-page="' + id + '"]')
              await waitFor('!' + visible('#mobile-navigation'), 'Choosing a pill must close Workspaces')
            }
            const summary = '.portfolio-summary-details > button'
            const positionTools = '.portfolio-position-actions .mobile-disclosure-toggle'
            const cash = '[aria-label="Brokerage cash"]'
            const margin = '[aria-label="Margin debt"]'
            const atPhoneWidths = async check => {
              for (const [width, height] of [[402, 874], [320, 568]]) {
                await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
                  width, height, screenWidth: width, screenHeight: height, mobile: true, deviceScaleFactor: 3,
                })
                await waitFor('innerWidth === ' + width, 'Phone emulation must resize the page')
                await check(width)
              }
            }
            await waitFor(visible('.portfolio-summary'), 'Portfolio summary must load from sample data')
            await atPhoneWidths(async width => {
              assert.deepEqual(await run('[document.documentElement, document.body, document.querySelector(".workspace-pages"), document.querySelector("[data-terminal-content]")].map(el => getComputedStyle(el).overscrollBehaviorX)'),
                ['none', 'none', 'none', 'none'], 'Mobile viewport and workspace tabs suppress horizontal overscroll at ' + width + 'px')
              assert.deepEqual(await run('(() => { const style = getComputedStyle(document.querySelector("[data-terminal-content]")); return [style.overflowX, style.overflowY, style.overscrollBehaviorY] })()'),
                ['hidden', 'auto', 'contain'], 'Mobile viewport keeps vertical scrolling at ' + width + 'px')
              await openNavigation()
              assert.equal(await run('getComputedStyle(document.querySelector(".mobile-navigation-scroll")).overscrollBehaviorX'), 'none', 'Workspaces suppresses horizontal overscroll')
              assert.equal(await run(visible('[data-page-id=portfolio]')), false, 'Workspaces takes the place of the active page')
              assert.equal(await run('document.querySelector("#mobile-navigation [aria-current=page]").dataset.navigationPage'), 'portfolio')
              const settings = await run('window.api.settings().then(result => result.data)')
              const available = ${JSON.stringify(TABS)}.filter(tab => tab.implemented &&
                settings.tabOrder.includes(tab.id) && !settings.hiddenTabs.includes(tab.id) && (!tab.lab || settings.enabledLabs.includes(tab.lab)))
              const workspaces = ${JSON.stringify([...WORKSPACES, { id: 'settings', label: 'Preferences', pages: ['settings'] }])}
              const actual = await run('[...document.querySelectorAll(".mobile-navigation-group")].map(group => [group.querySelector("h3").textContent.trim(), [...group.querySelectorAll("[data-navigation-page]")].map(pill => pill.dataset.navigationPage).sort()])')
              assert.deepEqual(actual, workspaces.map(workspace => [
                workspace.label, available.filter(tab => workspace.pages.includes(tab.id)).map(tab => tab.id).sort(),
              ]).filter(([, ids]) => ids.length > 0))
              assert.equal(await run('(() => { const list = document.querySelector(".mobile-navigation-scroll"); return list.scrollWidth === list.clientWidth && list.scrollHeight > list.clientHeight && [...list.querySelectorAll("button")].every(pill => pill.offsetHeight >= 44 && parseInt(getComputedStyle(pill).borderTopLeftRadius) >= 22) })()'), true,
                'Pills must wrap and remain touch-sized at ' + width + 'px')
              await run('(() => { const search = document.querySelector("#mobile-navigation input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(search, "trading"); search.dispatchEvent(new Event("input", { bubbles: true })); return true })()')
              await waitFor('document.querySelectorAll(".mobile-navigation-group").length === 2', 'Search must match workspace and page names')
              assert.equal(await run('Boolean(document.querySelector("[data-navigation-page=charts]"))'), true)
              assert.equal(await run('Boolean(document.querySelector("[data-navigation-page=trading-volumes]"))'), true)
              await click('.mobile-page-button')
              await waitFor(visible('.portfolio-summary'), 'Back must return to the same page')
              await waitFor('document.activeElement === document.querySelector(".mobile-page-button")', 'Back must restore focus to the mobile header')
            })
            await atPhoneWidths(async width => {
              assert.equal(await run(visible('.portfolio-mobile-total')), true)
              assert.equal(await run(visible(cash)), false, 'Cash should start inside the collapsed summary')
              assert.equal(await run(visible(margin)), false)
              assert.equal(await run('document.querySelector(".portfolio-summary").offsetHeight <= 58'), true)
              assert.equal(await run('new Set([...document.querySelectorAll(".portfolio-toolbar > select, .portfolio-toolbar > button")].map(el => el.offsetTop)).size === 1'), true,
                'Portfolio selector, Manage and Save must share a row at ' + width + 'px')
              const tableTop = await run('document.querySelector("[data-page-id=portfolio] table").getBoundingClientRect().top')
              assert.equal(await run('(() => { const scroller = document.querySelector("[data-page-id=portfolio] table").closest(".overflow-auto"); const left = scroller.scrollLeft; scroller.scrollLeft = 50; const canScroll = scroller.scrollLeft > 0 && getComputedStyle(scroller).overflowX === "auto"; scroller.scrollLeft = left; return canScroll })()'), true,
                'Portfolio table stays horizontally scrollable at ' + width + 'px')
              await click(summary)
              await waitFor(visible(cash), 'Opening the summary must reveal the cash editor')
              assert.equal(await run(visible(margin)), true)
              assert(await run('document.querySelector("[data-page-id=portfolio] table").getBoundingClientRect().top') > tableTop)
              await click(summary)
              await waitFor('!' + visible(cash), 'Closing the summary must reclaim the extra rows')
              await click(positionTools)
              await waitFor(visible('.portfolio-position-actions .mobile-disclosure-content button'), 'Position tools must expose the secondary actions')
              await click(positionTools)
              await waitFor('!' + visible('.portfolio-position-actions .mobile-disclosure-content button'), 'Position tools must fold away again')
            })
            await run('[...document.querySelectorAll(".portfolio-toolbar button")].find(button => button.textContent === "Manage Portfolios").click()')
            await waitFor(visible('[role=dialog][aria-label="Manage Portfolios"]'), 'Manage Portfolios must open at 320px')
            await click('[role=dialog][aria-label="Manage Portfolios"] [aria-label=Close]')

            await selectPage('charts')
            await waitFor(visible('.charts-toolbar'), 'Charts must open from its pill')
            await atPhoneWidths(async width => {
              assert.equal(await run('document.querySelector(".charts-toolbar").offsetHeight <= 116'), true, 'Chart toolbar wraps too far at ' + width + 'px')
              assert.equal(await run(visible('[aria-label="Chart style"]')), false)
              await click('.charts-toolbar-tools > button')
              await waitFor(visible('[aria-label="Chart style"]'), 'Chart tools must reveal chart style and indicators')
              await click('.charts-toolbar-tools > button')
              await waitFor('!' + visible('[aria-label="Chart style"]'), 'Chart tools must collapse')
            })
            await selectPage('politics')
            await waitFor(visible('.politics-filters'), 'Politics filters must mount')
            assert.equal(await run('document.querySelector(".politics-filters").offsetHeight <= 60'), true)
            await click('.politics-filters .mobile-disclosure-toggle')
            await waitFor(visible('.politics-filters select'), 'Politics filters must be available on demand')
            await selectPage('options')
            await waitFor(visible('.options-views'), 'Options views must mount')
            assert.equal(await run('new Set([...document.querySelectorAll(".options-views button")].map(el => el.offsetTop)).size === 1'), true,
              'Options view buttons must stay in one row')
            await selectPage('browser')
            await waitFor('Boolean(document.querySelector("#mobile-browser-address"))', 'The Browser pill must open Browser')
            console.log('PASS: iPhone preview opens with isolated sample data, mobile navigation, and compact toolbars at 402px and 320px')
            app.quit()
            return
          }
          const result = await window.webContents.executeJavaScript(
            '(async () => { const cache = await window.api.cacheStatus(); return { sync: await window.api.cloudSyncStatus(), mcp: await window.api.testMcpConnection(), mobile: await window.api.mobileAccessStatus(), cache, configured: await window.api.configureCache(cache.data.settings), progress: await window.api.heatmapProgress("SPY") } })()',
          )
          assert.equal(await window.webContents.executeJavaScript('(async () => { await window.api.setEquityQuoteVisibility(["AAPL"]); try { await window.api.setEquityQuoteVisibility([42]); return false } catch { return true } })()'), true, 'Visible quote IPC must accept symbols and reject malformed hints')
          assert.equal(result.mcp.available, true, result.mcp.error)
          assert.equal(result.sync.data.signedIn, false)
          assert.equal(result.sync.data.state, 'disconnected', 'Local startup must work without Convex configuration')
          assert.equal(result.mcp.setup.valid, true)
          assert.equal(result.mobile.enabled, false, 'The desktop starts with Mobile Access off until the user enables it')
          assert.equal(result.mobile.url, '')
          assert.equal(result.cache.meta.freshness, 'fresh')
          assert.equal(result.configured.meta.freshness, 'fresh')
          assert.deepEqual(result.configured.data.settings, result.cache.data.settings)
          assert(result.progress === null || typeof result.progress === 'object', 'Progress IPC returns null before a heatmap starts')
          const deadline = Date.now() + 10_000
          while (!await window.webContents.executeJavaScript('Boolean(document.querySelector("#root")?.children.length)')) {
            assert(Date.now() < deadline, 'Desktop UI must mount')
            await new Promise(resolve => setTimeout(resolve, 25))
          }
          if (demoDirectory) {
            const mobile = await window.webContents.executeJavaScript('window.api.configureMobileAccess(true)')
            assert.equal(mobile.available, false, 'Demo profiles cannot share records through the computer’s Tailscale proxy')
            assert.equal(mobile.enabled, false)
            while (!await window.webContents.executeJavaScript('document.querySelector(".terminal-topbar")?.textContent.includes("Demo data")')) {
              assert(Date.now() < deadline, 'Demo marker must appear in the desktop UI')
              await new Promise(resolve => setTimeout(resolve, 25))
            }
            assert.equal(window.getTitle(), 'Budget Terminal Demo')
            assert.equal(await window.webContents.executeJavaScript('Boolean(document.querySelector(".auth-popup"))'), false)
            const demoData = await window.webContents.executeJavaScript('(async () => { const api = window.api; return { portfolio: (await api.portfolio()).data, finance: (await api.personalFinance()).data, cards: (await api.cards()).data, articles: (await api.articles()).data, settings: (await api.settings()).data, syncCommand: await api.cloudSyncCommand({ type: "signInGitHub" }) } })()')
            assert.equal(demoData.portfolio.portfolios[0].name, 'Demo Core Portfolio')
            assert.equal(demoData.portfolio.portfolios.length, 3, 'Include both saved portfolios and their combined view')
            assert.equal(demoData.portfolio.sourcePath, join(process.env.BUDGET_TERMINAL_DATA_DIR, 'portfolio.json'))
            assert.deepEqual(demoData.portfolio.chartsWatchlists.watchlist, ['SPY', 'AAPL', 'MSFT', 'NVDA'])
            assert.equal(demoData.finance.goal.targetAmount, 18000)
            assert.equal(demoData.cards.customCards.length, 2)
            assert.equal(demoData.articles.articles.length, 2)
            assert.equal(demoData.settings.mainPage, 'portfolio')
            assert.equal(result.sync.data.demo, true)
            assert.match(demoData.syncCommand.meta.failureReason, /Cloud sync is disabled/)
            assert.equal(app.getPath('sessionData'), join(process.env.BUDGET_TERMINAL_DATA_DIR, 'electron-profile'))
            assert.equal(JSON.parse(result.mcp.setup.configuration).mcpServers['budget-terminal'].env.BUDGET_TERMINAL_DATA_DIR, process.env.BUDGET_TERMINAL_DATA_DIR)
            const edit = await window.webContents.executeJavaScript('window.api.mutatePortfolio({ type: "setCash", portfolioId: "portfolio_1", cashBalance: 765 })')
            assert.deepEqual(edit.errors, [])
            const backup = JSON.parse(await readFile(join(demoDirectory, 'downloads', ${JSON.stringify(backupName)}), 'utf8'))
            assert.equal(backup.userData.portfolios.portfolio_1.cashBalance, 765)
            assert.equal(await readFile(${JSON.stringify(normalBackup)}, 'utf8'), 'Existing personal backup fixture')
            console.log('PASS: demo UI opens with synthetic data, isolated profile, MCP and backup, and cloud sign-in disabled')
            app.quit()
            return
          }
          if (process.platform === 'linux' && area.width > 960 && area.height > 600) {
            const waitFor = async (check, message) => {
              const until = Date.now() + 5000
              while (!check()) {
                assert(Date.now() < until, message)
                await new Promise(resolve => setTimeout(resolve, 25))
              }
            }
            await waitFor(() => window.isVisible(), 'Window must become visible')
            // KWin can remember maximized state between the two fixture launches.
            // Start control checks from a visibly smaller, restored window.
            window.unmaximize()
            window.setBounds({ x: area.x, y: area.y, width: Math.max(960, area.width - 80), height: Math.max(600, area.height - 80) })
            await waitFor(() => !window.isMaximized() && window.getBounds().width < area.width, 'Prepare a restored window for control checks')
            await window.webContents.executeJavaScript('window.api.windowControl("maximize")')
            await waitFor(() => window.isMaximized(), 'Title-bar maximize must work on Steam Deck')
            const maximized = window.getBounds()
            assert(maximized.x >= area.x && maximized.x + maximized.width <= area.x + area.width, 'Maximized window must not shift past the right edge')
            await window.webContents.executeJavaScript('window.api.windowControl("maximize")')
            await waitFor(() => !window.isMaximized(), 'Title-bar restore must work on Steam Deck')
            window.setFullScreen(true)
            await waitFor(() => window.isFullScreen(), 'Native fullscreen must work')
            await window.webContents.executeJavaScript('window.api.windowControl("maximize")')
            await waitFor(() => !window.isFullScreen(), 'Title-bar restore must exit native fullscreen')
            console.log('PASS: Steam Deck window placement, maximize, restore and fullscreen controls')
          }
          console.log('PASS: built desktop opens with a mounted UI, working MCP connection and all three desktop-only IPC services')
          app.quit()
        } catch (error) { console.error(error); app.exit(1) }
      }
      window.webContents.on('did-finish-load', verify)
    })
    import(${JSON.stringify(pathToFileURL(join(root, 'out/main/main.js')).href)})
      .catch(error => { console.error(error); app.exit(1) })
  `)
  const env: NodeJS.ProcessEnv = demo?.env ?? {
    ...process.env, APPDATA: join(directory, 'roaming'), LOCALAPPDATA: join(directory, 'local'),
    BUDGET_TERMINAL_DATA_DIR: join(directory, 'data'), CODEX_HOME: join(directory, 'codex'),
  }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.BUDGET_TERMINAL_OPEN_MOBILE
  if (mobilePreview) env.BUDGET_TERMINAL_MOBILE_PREVIEW = '1'
  if (connectedMobile) {
    delete env.BUDGET_TERMINAL_DEMO_DIR
    if (!warmMobile && !labsMobile) env.BUDGET_TERMINAL_OPEN_MOBILE = '1'
  }
  const electron = require('electron') as string
  for (const agentFailure of demoOnly || connectedMobile ? [false] : [false, true]) {
    const output = await new Promise<{ code: number | null; text: string }>((resolveRun, reject) => {
      const child = spawn(electron, [entry], { env: { ...env, BUDGET_PROBE_AGENT_FAILURE: agentFailure ? '1' : '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let text = ''
      child.stdout.on('data', chunk => { text += chunk })
      child.stderr.on('data', chunk => { text += chunk })
      const timer = setTimeout(() => { child.kill(); reject(Error('Desktop startup timed out: ' + text)) }, 30_000)
      child.on('error', error => { clearTimeout(timer); reject(error) })
      child.on('close', code => { clearTimeout(timer); resolveRun({ code, text }) })
    })
    assert.equal(output.code, 0, output.text)
    assert.match(output.text, connectedMobile ? /PASS: connected mobile shares desktop data/ : mobilePreview ? /PASS: iPhone preview opens/ : demoOnly ? /PASS: demo UI opens/ : /PASS: built desktop opens/)
    if (process.platform === 'win32' && !demoOnly && !connectedMobile) {
      assert.doesNotMatch(output.text, /Failed to open persistent cache|Unable to move the cache|Unable to create cache|Gpu Cache Creation failed/i,
        'Unavailable GPU shader caches must not cause startup errors')
      for (const name of shaderCaches) {
        assert.equal(await readFile(join(profile, name), 'utf8'), 'unavailable shader cache fixture', 'Startup must leave existing shader caches alone')
      }
    }
    if (agentFailure) {
      const logs = join(directory, 'local', 'BudgetTerminal', 'logs')
      const records = (await Promise.all((await readdir(logs)).filter(name => name.endsWith('.jsonl'))
        .map(name => readFile(join(logs, name), 'utf8')))).join('\n').split('\n').filter(Boolean).map(line => JSON.parse(line))
      assert(records.some(record => record.event === 'startup-stage-failed' && record.details.stage === 'agents'), 'Optional agent startup failure must record a fixed diagnostic stage')
      assert(!JSON.stringify(records).includes('Fixture Agent startup failure'), 'Startup diagnostics must exclude raw exception messages')
    }
    console.log(output.text.trim())
  }
} finally {
  demo?.close()
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
