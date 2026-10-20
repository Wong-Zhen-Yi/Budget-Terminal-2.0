import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { TABS } from '../electron/shared/contract.js'
import { startupPages, workspaceFor } from '../electron/shared/navigation.js'
import { browserRequestSchema } from '../electron/shared/browser.js'
import { browserInputRequest, browserSearchUrl } from '../electron/shared/browserSearch.js'
import { assertPrivateBrowserStorage } from '../electron/services/browserStorage.js'
import { catalog, validateCall } from '../mcp/catalog.js'
import { toolResult } from '../mcp/toolResult.js'

assert(TABS.some(tab => tab.id === 'browser' && tab.label === 'Browser' && tab.implemented))
assert.equal(workspaceFor('browser')?.id, 'research')
assert(startupPages('dashboard', [], []).includes('browser'))
assert.equal(catalog.find(entry => entry.operation === 'browserResearch')?.tool.annotations?.readOnlyHint, false)
validateCall('budget_terminal_browser_research', { request: { action: 'read' } })
validateCall('budget_terminal_browser_research', { request: { action: 'search', query: 'Apple investor relations' } })
for (const text of ['Apple investor relations', 'semiconductors', 'site:sec.gov AAPL', 'site:sec.gov', 'AAPL earnings & guidance / 2026 + café']) {
  assert.deepEqual(browserInputRequest(`  ${text}  `), { action: 'search', query: text })
  assert.equal(new URL(browserSearchUrl(text)).searchParams.get('q'), text)
}
for (const text of ['https://example.com/path?q=hello world', 'http://127.0.0.1', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,unsafe']) {
  assert.deepEqual(browserInputRequest(text), { action: 'navigate', url: text }, 'Explicit URLs must still go through the public URL validator')
}
assert.deepEqual(browserInputRequest('example.com/path'), { action: 'navigate', url: 'https://example.com/path' })
assert.deepEqual(browserInputRequest('example.com:8443/path'), { action: 'navigate', url: 'https://example.com:8443/path' })
assert.throws(() => browserSearchUrl('  '))
assert.throws(() => browserSearchUrl('x'.repeat(4097)))
assert.throws(() => browserRequestSchema.parse({ action: 'search', query: '' }))
assert.throws(() => validateCall('budget_terminal_browser_research', { request: { action: 'evaluate', script: 'process.exit()' } }))
assert.throws(() => browserRequestSchema.parse({ action: 'navigate', url: 'https://example.com', script: 'unsafe' }))
assert.throws(() => browserRequestSchema.parse({ action: 'fill', selector: 'input', text: 'secret' }))
const formatted = toolResult('budget_terminal_browser_research', { data: { state: {}, screenshot: { base64: 'pixels', mimeType: 'image/png', url: 'https://example.com' } }, meta: { freshness: 'fresh' }, errors: [] })
assert.equal(formatted.content[1].type, 'image')
assert(!JSON.stringify(formatted.structuredContent).includes('pixels'))

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-browser-'))
try {
  const checkout = join(directory, 'checkout-fixture')
  const localProfile = join(directory, 'local-profile')
  await mkdir(join(checkout, '.git'), { recursive: true })
  await mkdir(localProfile)
  assert.doesNotThrow(() => assertPrivateBrowserStorage(localProfile, root))
  assert.throws(() => assertPrivateBrowserStorage(join(checkout, 'profile'), join(checkout, 'apps/desktop')), /outside application source and Git/)
  assert.throws(() => assertPrivateBrowserStorage(join(checkout, 'profile'), root), /outside application source and Git/)
  assert.throws(() => assertPrivateBrowserStorage(join(directory, 'unpacked-app/profile'), join(directory, 'unpacked-app')), /outside application source and Git/)
  const worktree = join(directory, 'worktree-fixture')
  await mkdir(worktree)
  await writeFile(join(worktree, '.git'), 'gitdir: synthetic-worktree-pointer')
  assert.throws(() => assertPrivateBrowserStorage(join(worktree, 'profile'), root), /outside application source and Git/)
  const linked = join(directory, 'linked-checkout')
  const insideLink = join(checkout, 'linked-profile')
  await symlink(checkout, linked, process.platform === 'win32' ? 'junction' : 'dir')
  await symlink(localProfile, insideLink, process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => assertPrivateBrowserStorage(join(linked, 'profile'), root), /outside application source and Git/)
  assert.throws(() => assertPrivateBrowserStorage(insideLink, root), /outside application source and Git/)
  console.log('Browser storage policy: source folders, Git repositories/worktrees and linked paths are rejected; external local profiles are allowed.')
  const renderer = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import { createRoot } from 'react-dom/client'
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
    import { BrowserPage } from './src/pages/BrowserPage'
    import { buildTasks } from './src/api/prefetch'
    import { shouldPersistRemoteQuery } from './src/api/queryPersistence'
    const check = (value, message) => { if (!value) throw Error(message) }
    const settle = () => new Promise(resolve => setTimeout(resolve, 180))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    const root = createRoot(document.getElementById('root'))
    let active = true, status
    const render = () => root.render(<QueryClientProvider client={client}><BrowserPage active={active} onStatusChange={value => { status = value }} /></QueryClientProvider>)
    const click = async label => {
      const button = [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent === label)
      check(button && !button.disabled, 'Missing or disabled button: ' + label)
      button.click(); await settle()
    }
    const fillAddress = async value => {
      const input = document.querySelector('[aria-label="Website address or search"]')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true })); await settle()
    }
    window.hideBrowser = async hidden => { active = !hidden; render(); await settle() }
    window.openDialog = async () => {
      const dialog = document.createElement('div'); dialog.id = 'probe-dialog'; dialog.setAttribute('role', 'dialog'); dialog.style.cssText = 'position:fixed;inset:0;background:#111;z-index:100'
      document.body.append(dialog); await settle()
    }
    window.closeDialog = async () => { document.getElementById('probe-dialog')?.remove(); document.getElementById('topbar-agent-chat')?.remove(); await settle() }
    window.openAgentDialog = async () => {
      const dialog = document.createElement('div'); dialog.id = 'topbar-agent-chat'; dialog.setAttribute('role', 'dialog'); dialog.style.cssText = 'position:fixed;right:12px;top:45px;width:430px;height:700px;background:#111;z-index:100'
      document.body.append(dialog); await settle()
    }
    window.runUi = async () => {
      const tasks = buildTasks(undefined, { hiddenTabs: ['browser'] }, { stocks: '', fundamentals: '' }, { year: 2026, month: 9, earningsYear: 2026, ipoYear: 2026 }).filter(task => task.tab === 'browser')
      check(tasks.length === 1, 'Unvisited, hidden Browser must preload at startup')
      await tasks[0].run(client)
      check(client.getQueryData(['browser']).data.tabs.length === 1, 'Warmup must create a ready Chromium tab')
      check(!shouldPersistRemoteQuery(client.getQueryCache().find({ queryKey: ['browser'] })), 'Private browser URLs must not persist in renderer query cache')
      render(); await settle()
      check(document.querySelector('h1').textContent.includes('Browser'), 'Browser page heading')
      check(document.querySelector('[role=switch]').getAttribute('aria-checked') === 'true', 'Agent access starts on')
      check(status[0].loading === false, 'Warmed browser must mount ready')
      const ready = await window.api.browserResearch({ action: 'select' })
      check(ready.errors.length === 0, 'Agent tools work immediately without enabling access')
      await click('Agent browser access')
      check(document.querySelector('[role=switch]').getAttribute('aria-checked') === 'false', 'Disable revokes default-on access')
      const blocked = await window.api.browserResearch({ action: 'select' })
      check(blocked.meta.freshness === 'failed', 'Disabled access blocks agent tools')
      await click('New browser tab')
      check(document.querySelectorAll('[role=tab]').length === 2, 'New tab control')
      check((await window.api.browserStatus()).data.agentEnabled === false, 'Opening tabs and polling never re-enable disabled access')
      await click('Agent browser access')
      check(document.querySelector('[role=switch]').getAttribute('aria-checked') === 'true', 'Enable agent access')
      await click('Stop')
      check(document.querySelector('[role=switch]').getAttribute('aria-checked') === 'false', 'Stop revokes access')
      check(document.querySelector('input').placeholder.includes('Search DuckDuckGo'), 'Address bar advertises search')
      await fillAddress('Apple investor relations')
      document.querySelector('.browser-toolbar').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle()
      let current = await window.api.browserStatus()
      let url = current.data.tabs.find(tab => tab.id === current.data.activeTabId).url
      check(new URL(url).hostname === 'duckduckgo.com' && new URL(url).searchParams.get('q') === 'Apple investor relations', 'Enter submits a multi-word web search without agent access')
      await fillAddress('semiconductors')
      await click('Go')
      current = await window.api.browserStatus()
      url = current.data.tabs.find(tab => tab.id === current.data.activeTabId).url
      check(new URL(url).searchParams.get('q') === 'semiconductors', 'Go searches a single-word query')
      await fillAddress('file:///etc/passwd')
      await click('Go')
      check(document.querySelector('[role=alert]'), 'Unsafe URL errors are visible')
      return 'Browser UI: startup readiness, default-on agent access, disable/re-enable, tabs, manual address-bar searches via Enter/Go, stop, unsafe URL feedback and private cache checks passed.'
    }
    window.readUi = async () => {
      await client.invalidateQueries({ queryKey: ['browser'] }); await settle()
      await click('Read page')
      check(document.querySelector('.browser-reader').textContent.includes('Synthetic financial research'), 'Read page exposes bounded source text')
      await click('Close page reader')
      return 'Browser reader and native layout passed.'
    }
  ` }, bundle: true, write: false, outfile: join(directory, 'renderer.js'), jsx: 'automatic', format: 'iife', platform: 'browser' })
  await writeFile(join(directory, 'renderer.js'), renderer.outputFiles.find(file => file.path.endsWith('.js'))?.text ?? renderer.outputFiles[0].text)
  // CSS imports need an output path so esbuild emits the separate stylesheet.
  const styled = await build({ entryPoints: [join(root, 'src/styles/browser.css')], bundle: true, write: false })
  await writeFile(join(directory, 'browser.css'), styled.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="browser.css"><style>html,body,#root{height:100%;margin:0}#root{display:flex;font-family:Arial,sans-serif}*{box-sizing:border-box}</style></head><body><div id="root"></div><script src="renderer.js"></script></body></html>')
  await writeFile(join(directory, 'preload.cjs'), `const { contextBridge, ipcRenderer } = require('electron'); contextBridge.exposeInMainWorld('api', { platform: process.platform, browserStatus: () => ipcRenderer.invoke('probe:status'), browserResearch: request => ipcRenderer.invoke('probe:research', request), browserControl: request => ipcRenderer.invoke('probe:control', request), browserViewport: viewport => ipcRenderer.invoke('probe:viewport', viewport) })`)
  const main = await build({ stdin: { resolveDir: root, contents: `
    import { app, BrowserWindow, ipcMain, session } from 'electron'
    import assert from 'node:assert/strict'
    import { mkdirSync, writeFileSync } from 'node:fs'
    import { assertPrivateBrowserStorage } from './electron/services/browserStorage'
    import { browserStatus, browserResearch, browserControl, browserUrl, configureBrowserWindow, setBrowserViewport, compositeBrowserScreenshot } from './electron/services/browser'
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { preload: ${JSON.stringify(join(directory, 'preload.cjs'))}, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
      const profile = session.fromPartition('persist:budget-terminal-research')
      const resolveHost = profile.resolveHost.bind(profile)
      profile.resolveHost = async (host, ...args) => host === 'duckduckgo.com' ? { endpoints: [{ address: '8.8.8.8', family: 'ipv4' }] } : resolveHost(host, ...args)
      const searchQueries = []
      let privateRequests = 0
      await profile.protocol.handle('http', () => { privateRequests++; return new Response('Private network must not be reached') })
      // Synthetic HTTPS fixture served in-process: no live provider or local network access.
      await profile.protocol.handle('https', request => {
        if (new URL(request.url).hostname === 'duckduckgo.com') searchQueries.push(new URL(request.url).searchParams.get('q'))
        const next = request.url.includes('/second')
        return new Response('<!doctype html><html><head><title>' + (next ? 'Second source' : 'Research fixture') + '</title><style>body{background:#eef4f8;color:#15273b;font:20px Arial;padding:48px}a{display:block;margin:20px 0}article{max-width:800px}p{line-height:1.7}</style></head><body><article><h1>Synthetic financial research</h1><p>Fixture revenue: $123 million. As of 2026-10-18. Test data, not investment advice.</p><a href="https://8.8.8.8/second">Second source</a><a href="javascript:alert(1)">Unsafe scheme</a><img src="http://127.0.0.1/private" alt=""><div style="height:1800px">Long article body</div></article></body></html>', { headers: { 'content-type': 'text/html' } })
      })
      configureBrowserWindow(window)
      ipcMain.handle('probe:status', () => browserStatus())
      ipcMain.handle('probe:research', (_event, request) => browserResearch(request))
      ipcMain.handle('probe:control', (_event, request) => browserControl(request))
      ipcMain.handle('probe:viewport', (_event, viewport) => setBrowserViewport(viewport))
      const pause = () => new Promise(resolve => setTimeout(resolve, 250))
      try {
        for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'http://127.0.0.1', 'http://2130706433', 'http://[::1]', 'http://192.168.1.2', 'https://localhost', 'https://printer.local', 'https://user:pass@example.com']) assert.throws(() => browserUrl(url), url)
        assert.equal(browserUrl('example.com'), 'https://example.com/')
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        window.showInactive()
        console.log(await window.webContents.executeJavaScript('window.runUi()'))
        assert(searchQueries.includes('Apple investor relations') && searchQueries.includes('semiconductors'), 'Searches reached the synthetic engine')
        let result = await browserResearch({ action: 'search', query: 'Blocked agent search' })
        assert.equal(result.meta.freshness, 'failed', 'Stop keeps agent search disabled until the user re-enables it')
        assert(!searchQueries.includes('Blocked agent search'))
        await browserControl({ action: 'agentAccess', enabled: true })
        const agentQuery = 'AAPL earnings & guidance / 2026 + café'
        result = await browserResearch({ action: 'search', query: agentQuery })
        assert.equal(result.errors.length, 0, JSON.stringify(result.errors))
        const searchTab = result.data.state.tabs.find(tab => tab.id === result.data.state.activeTabId)
        assert.equal(new URL(searchTab.url).searchParams.get('q'), agentQuery, 'Agent search preserves encoded query text')
        assert(searchQueries.includes(agentQuery))
        result = await browserResearch({ action: 'navigate', url: 'https://8.8.8.8/research' })
        assert.equal(result.errors.length, 0, JSON.stringify(result.errors))
        result = await browserResearch({ action: 'read' })
        assert.equal(result.errors.length, 0, JSON.stringify(result.errors))
        assert.match(result.data.page.text, /Synthetic financial research/)
        assert.equal(result.data.page.links.length, 1, 'Unsafe link excluded')
        assert(result.data.page.readAt > 0)
        assert.equal(privateRequests, 0, 'Private subresources blocked before network/protocol access')
        const tabId = result.data.state.activeTabId
        const native = window.contentView.children.find(view => view.webContents && view.webContents.getURL().includes('/research'))
        assert(native, 'Research renders in a native WebContentsView')
        const isolation = await native.webContents.executeJavaScript('({ api: typeof window.api, require: typeof require, process: typeof process })')
        assert.deepEqual(isolation, { api: 'undefined', require: 'undefined', process: 'undefined' })
        assert.notEqual(native.webContents.session, window.webContents.session, 'Browser profile isolated from privileged shell')
        const storage = native.webContents.session.getStoragePath()
        assert(storage, 'Browser uses persistent local login storage')
        assertPrivateBrowserStorage(storage, ${JSON.stringify(root)})
        assert(storage.startsWith(${JSON.stringify(directory)}), 'Fixture profile must stay in the temporary user-data directory')
        await profile.cookies.set({ url: 'https://8.8.8.8', name: 'privacy-probe', value: 'synthetic-test-only', httpOnly: true, secure: true, expirationDate: Date.now() / 1000 + 3600 })
        await profile.cookies.flushStore()
        assert.equal((await profile.cookies.get({ name: 'privacy-probe' })).length, 1, 'Synthetic login cookie remains in the local Chromium profile')
        const exposed = JSON.stringify(await browserResearch({ action: 'read' }))
        assert(!exposed.includes('synthetic-test-only'), 'Browser tools do not expose the cookie store')
        console.log(await window.webContents.executeJavaScript('window.readUi()'))
        await pause()
        assert(native.getVisible(), 'Native website visible on Browser page: ' + JSON.stringify({ bounds: native.getBounds(), dom: await window.webContents.executeJavaScript('({viewport: document.querySelector(".browser-viewport").getBoundingClientRect().toJSON(), css: getComputedStyle(document.querySelector(".browser-page")).display, url: document.querySelector("input").value})'), tabs: (await browserStatus()).data }))
        const area = native.getBounds()
        assert(area.y > 100 && area.width > 600 && area.height > 300, JSON.stringify(area))
        result = await browserResearch({ action: 'screenshot', tabId })
        assert.equal(result.errors.length, 0, JSON.stringify(result.errors))
        assert(result.data.screenshot.base64.length > 100)
        const output = ${JSON.stringify(resolve(root, '../../output/playwright'))}
        mkdirSync(output, { recursive: true })
        writeFileSync(output + '/browser-website.png', Buffer.from(result.data.screenshot.base64, 'base64'))
        const shell = await window.webContents.capturePage()
        const composite = await compositeBrowserScreenshot(window, shell)
        assert(!composite.toPNG().equals(shell.toPNG()), 'App screenshots must include the native website layer')
        writeFileSync(output + '/browser-page.png', composite.toPNG())
        await window.webContents.executeJavaScript('window.openAgentDialog()')
        assert(native.getVisible() && native.getBounds().width < area.width - 300, 'Browser resizes beside the top-bar Agent dropdown')
        await window.webContents.executeJavaScript('window.closeDialog()')
        await window.webContents.executeJavaScript('window.openDialog()')
        assert.equal(native.getVisible(), false, 'Native view hides beneath dialogs')
        result = await browserResearch({ action: 'screenshot' })
        assert.equal(result.meta.freshness, 'failed', 'Hidden native content cannot be screenshotted')
        await window.webContents.executeJavaScript('window.closeDialog()')
        assert(native.getVisible())
        await window.webContents.executeJavaScript('window.hideBrowser(true)')
        assert.equal(native.getVisible(), false, 'Leaving/obscuring Browser hides native content')
        const hiddenShell = await window.webContents.capturePage()
        assert.equal(await compositeBrowserScreenshot(window, hiddenShell), hiddenShell, 'Privacy hiding must not composite hidden website pixels')
        await window.webContents.executeJavaScript('window.hideBrowser(false)')
        assert(native.getVisible(), 'Returning reuses the same ready session')
        result = await browserResearch({ action: 'follow', url: 'https://8.8.8.8/not-a-link' })
        assert.equal(result.meta.freshness, 'failed')
        result = await browserResearch({ action: 'follow', url: 'https://8.8.8.8/second' })
        assert.equal(result.errors.length, 0, JSON.stringify(result.errors))
        assert.equal(result.data.state.tabs.find(tab => tab.id === tabId).canGoBack, true)
        await browserResearch({ action: 'back' }); await pause()
        assert.match((await browserStatus()).data.tabs.find(tab => tab.id === tabId).url, /research/)
        await browserResearch({ action: 'scroll', direction: 'down' })
        assert(await native.webContents.executeJavaScript('scrollY > 0'))
        const queued = [browserResearch({ action: 'open', url: 'https://8.8.8.8/second' }), browserResearch({ action: 'open' })]
        await browserControl({ action: 'stop' })
        for (const stopped of await Promise.all(queued)) assert.equal(stopped.meta.freshness, 'failed', 'Stop cancels queued actions')
        result = await browserResearch({ action: 'read' })
        assert.equal(result.meta.freshness, 'failed', 'Stop revokes future agent actions')
        if (${JSON.stringify(process.argv.includes('--live'))}) {
          await profile.protocol.unhandle('https')
          profile.resolveHost = resolveHost
          const live = await browserControl({ action: 'search', query: 'SEC EDGAR company filings' })
          assert.equal(live.errors.length, 0, 'Live search navigation: ' + JSON.stringify(live.errors))
          const liveTab = live.data.state.tabs.find(tab => tab.id === live.data.state.activeTabId)
          assert(new URL(liveTab.url).hostname.endsWith('duckduckgo.com'), 'Live search stays on the search provider')
          const liveRead = await browserControl({ action: 'read' })
          assert.equal(liveRead.errors.length, 0, JSON.stringify(liveRead.errors))
          assert(liveRead.data.page.text.length > 0, 'Live search page has readable content')
          console.log('Live DuckDuckGo search loaded: ' + liveRead.data.page.title + ' · ' + liveRead.data.page.text.slice(0, 180).replaceAll('\\n', ' '))
        }
        await window.webContents.executeJavaScript('window.hideBrowser(true)')
        writeFileSync(output + '/browser-controls.png', (await window.webContents.capturePage()).toPNG())
        const reopened = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
        window.destroy()
        configureBrowserWindow(reopened)
        assert.equal((await browserStatus()).data.agentEnabled, true, 'A new window restores the default-on setting after a previous session was stopped')
        assert.equal((await browserResearch({ action: 'select' })).errors.length, 0, 'Agent tools are immediately available in the new window')
        await browserControl({ action: 'stop' })
        configureBrowserWindow(reopened)
        assert.equal((await browserStatus()).data.agentEnabled, false, 'Reconfiguring the same window cannot bypass Stop')
        console.log('Browser service: default-on access, disable/re-enable, new-window defaults, isolation, public URL policy, navigation, link following, history, scrolling, screenshot privacy, native layout and Stop cancellation passed.')
        app.exit(0)
      } catch (error) { console.error(error); app.exit(1) }
    })
  ` }, bundle: true, format: 'cjs', platform: 'node', external: ['electron'], write: false })
  await mkdir(join(directory, 'application'))
  await writeFile(join(directory, 'application/main.cjs'), main.outputFiles[0].text)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(directory, 'application/main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Browser probe timed out: ' + output)) }, 60_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log('Browser probe passed. Screenshots: output/playwright/browser-*.png')
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
