import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-settings-ui-'))
try {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import { createRoot } from 'react-dom/client'
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
    import { SettingsPage } from './src/pages/SettingsPage'
    import { TABS } from './electron/shared/contract'
    import { DEFAULT_CACHE_SETTINGS } from './electron/shared/cachePolicy'
    import { DEFAULT_BACKTEST_PAGE_SETTINGS } from './electron/shared/backtest'
    import { DEFAULT_QUANT_PAGE_SETTINGS } from './electron/shared/quant'
    import { DEFAULT_YOUTUBE_PAGE_SETTINGS } from './electron/shared/youtube'
    import { useSettingsNavigation } from './src/stores/settingsNavigation'
    import { useDataHealth } from './src/stores/dataHealth'
    import { startControllerNavigation } from './src/input/controllerNavigation'
    const check = (value, message) => { if (!value) throw Error(message) }
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    const visible = node => !!node && node.getClientRects().length > 0
    const card = id => document.querySelector('[data-settings-card="' + id + '"]')
    const choose = id => [...document.querySelectorAll('[data-settings-category="' + id + '"]')].find(visible).click()
    const clickText = (scope, text) => { const button = [...scope.querySelectorAll('button')].find(button => button.textContent === text); check(button, 'Missing button: ' + text); button.click() }
    const setSearch = async value => {
      const input = document.querySelector('input[aria-label="Search settings"]')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true })); await wait(80)
    }
    window.fixtureSettings = { clockCountry: 'US', time12h: true, tabOrder: TABS.map(tab => tab.id), hiddenTabs: [], favoriteTabs: [], sidebarCollapsed: false,
      obscuredTabs: ['portfolio'], backtestPage: DEFAULT_BACKTEST_PAGE_SETTINGS, signalsPage: { filter: 'all', setup: 'all', search: '' },
      quantPage: DEFAULT_QUANT_PAGE_SETTINGS, youtubePage: DEFAULT_YOUTUBE_PAGE_SETTINGS, sourcePath: '/private/settings.json',
      automaticBackup: { path: '/private/backup.json', savedAt: Date.now() } }
    window.fixtureCache = { settings: DEFAULT_CACHE_SETTINGS, service: { hits: 9, misses: 1, errors: 0, market: { bytes: 2000000, entries: 15, expiredEntries: 0, evictions: 0 }, assets: { bytes: 1000000, entries: 4, expiredEntries: 0, evictions: 0 } } }
    useDataHealth.setState({ startup: { durationMs: 1200, planned: 3, timings: [], pageOrder: ['dashboard', 'stocks', 'calendar'], pages: {
      dashboard: { state: 'ready' }, stocks: { state: 'loading' }, calendar: { state: 'failed', reason: 'Provider request timed out' },
    } } })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
    const host = createRoot(document.getElementById('root'))
    const render = () => host.render(<QueryClientProvider client={client}><SettingsPage active={true} onStatusChange={() => {}} /></QueryClientProvider>)
    render()
    window.runProbe = async () => {
      await wait(250)
      check(visible(document.querySelector('.app-dashboard')) && document.querySelectorAll('.app-dash-card').length === 18, 'Settings must open on its dashboard')
      check(!document.querySelector('[data-settings-category="all"]') && !document.querySelector('.settings-heading'), 'Redundant overview or introductory header returned')
      const dashboardPadding = getComputedStyle(document.querySelector('.app-dashboard')).padding
      const toolbar = document.querySelector('.settings-toolbar').getBoundingClientRect()
      const tabs = [...document.querySelectorAll('[data-settings-category]')]
      check(tabs.length === 7 && tabs.every(tab => visible(tab) && tab.getBoundingClientRect().top === tabs[0].getBoundingClientRect().top), 'Preferences must form one horizontal row')
      check(document.querySelectorAll('[data-settings-card]').length === 13, 'Expected all thirteen settings panels mounted')
      useSettingsNavigation.getState().openDiagnostics(); await wait(80)
      check(visible(card('logs')), 'Diagnostics navigation must reveal the log panel')
      choose('dashboard'); await wait(80)
      check(!document.body.innerText.includes('/private/'), 'Local file paths must start hidden')
      check(!document.querySelector('[title="/private/settings.json"]'), 'Footer path strip returned')
      check(document.querySelector('table[aria-label="Startup status"]').textContent.includes('Failed'), 'Startup failures missing')
      const original = card('api')
      choose('workspace'); await wait(80)
      check(getComputedStyle(document.querySelector('.settings-content')).padding === dashboardPadding, 'Settings views use different content spacing')
      check(document.querySelector('.settings-toolbar').getBoundingClientRect().height === toolbar.height, 'Switching views resized Preferences')
      check(document.querySelector('.settings-scroll').scrollHeight <= document.querySelector('.settings-scroll').clientHeight + 1, 'Compact Workspace must fit the desktop viewport')
      check(visible(card('navigation')) && !visible(card('api')), 'Category filtering failed')
      check(card('api') === original, 'Filtering remounted diagnostics')
      const shortcutDetails = document.querySelector('.settings-shortcut-details')
      check(!shortcutDetails.open && document.querySelectorAll('.settings-shortcuts kbd').length === 7, 'Compact shortcut reference missing')
      shortcutDetails.querySelector('summary').click(); await wait(80)
      check(shortcutDetails.open && visible(shortcutDetails.querySelector('table')), 'Full shortcut explanations inaccessible')
      shortcutDetails.querySelector('summary').click(); await wait(80)
      const clock = card('clock').querySelector('input[type=checkbox]')
      clock.click(); await wait(80)
      check(window.fixtureSettings.time12h === false && !clock.checked, 'Clock mutation did not persist and update the control')
      check(document.querySelector('.settings-feedback').textContent.includes('Clock format updated'), 'Save feedback missing')
      window.refuseMutation = true
      clock.click(); await wait(80)
      check(document.querySelector('.settings-feedback [role=alert]') && !clock.checked, 'Mutation rejection hidden or changed the stored value')
      window.refuseMutation = false
      choose('data'); await wait(80)
      await setSearch('automatic backups')
      check(visible(card('backups')) && !visible(card('navigation')), 'Settings search failed')
      const backupGrid = card('backups').closest('.settings-grid').getBoundingClientRect()
      check(Math.abs(card('backups').getBoundingClientRect().width - backupGrid.width) < 2, 'Single search result leaves an empty column')
      await setSearch('no-such-setting')
      check(visible(document.querySelector('.settings-empty')), 'No-results recovery missing')
      clickText(document.querySelector('.settings-empty'), 'Clear search'); await wait(80)
      check(visible(card('backups')) && visible(card('cache')), 'Reset search failed')
      choose('data'); await wait(80)
      check(card('maintenance').getBoundingClientRect().top - card('backups').getBoundingClientRect().bottom <= 16, 'Maintenance leaves a large gap below backups')
      clickText(card('maintenance'), 'Clear All User Data and Cards'); await wait(80)
      check(document.querySelector('[role=dialog]') && window.maintenanceCalls.length === 0, 'Destructive action bypassed confirmation')
      clickText(document.querySelector('[role=dialog]'), 'Cancel'); await wait(80)
      check(!document.querySelector('[role=dialog]') && window.maintenanceCalls.length === 0, 'Cancel performed an action')
      const sync = card('cloud-sync')
      check(visible(sync) && sync.textContent.includes('works normally without a cloud connection'), 'Local-first sync controls missing')
      const setInput = async (label, value) => {
        const input = sync.querySelector('[aria-label="' + label + '"]')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true })); await wait(30)
      }
      await setInput('Convex deployment URL', 'https://fixture.convex.cloud')
      window.githubNotConfigured = true
      clickText(sync, 'Sign in with GitHub'); await wait(80)
      check(sync.textContent.includes('AUTH_GITHUB_ID') && !sync.textContent.includes('Cancel sign-in'), 'Missing GitHub credentials must show setup guidance before opening a browser')
      window.githubNotConfigured = false
      clickText(sync, 'Sign in with GitHub'); await wait(80)
      check(sync.textContent.includes('Complete GitHub sign-in') && !sync.querySelector('input'), 'Browser approval status missing')
      clickText(sync, 'Cancel sign-in'); await wait(80)
      check(sync.querySelector('[aria-label="Convex deployment URL"]'), 'Cancelled sign-in must restore the form')
      clickText(sync, 'Sign in with GitHub'); await wait(80)
      window.fixtureSync = { ...window.fixtureSync, state: 'synced', signedIn: true, signInPending: false, cloudUpdatedAt: Date.now(), localUpdatedAt: Date.now(), revision: 3 }
      await wait(2100)
      check(!sync.querySelector('input'), 'Browser sign-in must update Settings without reloading')
      check(sync.textContent.includes('Cloud data updated') && sync.textContent.includes('Revision 3') && sync.textContent.includes('Local data updated'), 'Data timestamps and server revision must be visible in Settings')
      clickText(sync, 'Sync now'); await wait(80)
      check(sync.textContent.includes('Choose a copy'), 'Sync conflict hidden')
      clickText(sync, 'Use cloud copy'); await wait(40)
      check(!window.syncCommands.some(command => command.type === 'resolve'), 'Conflict replacement bypassed confirmation')
      clickText(sync, 'Cancel'); await wait(40)
      clickText(sync, 'Use cloud copy'); await wait(40)
      clickText(sync, 'Confirm replacement'); await wait(80)
      check(window.syncCommands.some(command => command.type === 'resolve' && command.use === 'cloud'), 'Cloud choice did not reach the host')
      clickText(sync, 'Disconnect sync'); await wait(80)
      check(sync.querySelector('input[type=email]') && sync.textContent.includes('Not connected'), 'Disconnect must retain normal local operation and restore sign-in')
      await setInput('Convex deployment URL', 'https://fixture.convex.cloud')
      sync.querySelector('details').open = true
      await setInput('Sync account email', 'fixture@example.invalid')
      sync.querySelector('button[type=submit]').click(); await wait(80)
      check(sync.querySelector('[aria-label="Sync email code"]'), 'Optional email code entry missing')
      await setInput('Sync email code', 'TESTCODE')
      sync.querySelector('button[type=submit]').click(); await wait(80)
      check(!sync.querySelector('input[type=email]') && !sync.textContent.includes('fixture@example.invalid'), 'Sign-in drafts retained after connecting')
      clickText(sync, 'Disconnect sync'); await wait(80)
      clickText(card('maintenance'), 'Reset Cache'); await wait(80)
      clickText(document.querySelector('[role=dialog]'), 'Reset Cache'); await wait(80)
      check(window.maintenanceCalls.join() === 'resetCache', 'Confirmed maintenance did not run exactly once')
      const retained = document.querySelector('table[aria-label="Provider usage"]')
      choose('privacy'); await wait(80)
      check(!visible(card('mcp')) && visible(card('privacy')), 'Privacy category failed')
      choose('integrations'); await wait(80)
      check(visible(card('mcp')) && !visible(card('privacy')), 'Integrations category failed')
      const keys = card('market-api-keys')
      check(visible(keys) && keys.querySelectorAll('input[type=password]').length === 2, 'Masked API key controls missing')
      check(!keys.textContent.includes('AllTick') && !keys.querySelector('#market-key-alltick'), 'Retired AllTick controls remain visible')
      for (const provider of ['binance', 'coinbase', 'world-bank', 'imf']) {
        const entry = keys.querySelector('[data-api-provider="' + provider + '"]')
        check(visible(entry) && entry.textContent.includes('Public endpoints enabled'), 'Public provider missing: ' + provider)
        check(!entry.querySelector('input'), 'Unnecessary credentials requested: ' + provider)
      }
      await setSearch('world bank')
      check(visible(keys) && !visible(card('mcp')), 'New API settings are not searchable')
      await setSearch('')
      for (const label of ['Binance', 'Coinbase', 'World Bank', 'IMF']) {
        check([...card('api').querySelectorAll('.api-usage__dependency > summary')].some(entry => entry.textContent.includes(label) && !entry.textContent.includes('Inactive')), 'API directory entry missing: ' + label)
      }
      const keyInput = keys.querySelector('input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(keyInput, 'fixture-only-key')
      keyInput.dispatchEvent(new Event('input', { bubbles: true })); await wait(80)
      keys.querySelector('button[type=submit]').click(); await wait(80)
      check(window.fixtureKeys.finnhub && keyInput.value === '' && keys.textContent.includes('Provider remains inactive'), 'Key save failed or draft retained')
      check(!document.body.innerText.includes('fixture-only-key'), 'Key exposed as visible text')
      clickText(keys, 'Remove'); await wait(80)
      check(!window.fixtureKeys.finnhub && keys.textContent.includes('Key removed'), 'Key removal failed')
      const categories = card('mcp').querySelector('fieldset[aria-label="MCP access categories"]')
      check(categories.querySelectorAll('input').length === 7, 'MCP category controls missing')
      const portfolioAccess = [...categories.querySelectorAll('label')].find(label => label.textContent.includes('Saved portfolios')).querySelector('input')
      portfolioAccess.click(); await wait(100)
      check(window.fixtureMcpPolicy.permissions.portfolioRead === false && !portfolioAccess.checked, 'MCP category change did not persist')
      check(window.fixtureMcpPolicy.readOnly === true && window.fixtureMcpPolicy.requireApproval === true, 'Category change altered approval defaults')
      window.refuseMcpPolicy = true
      portfolioAccess.click(); await wait(100)
      check(!portfolioAccess.checked && card('mcp').textContent.includes('Could not save MCP permissions'), 'Failed MCP permission save changed access or hid the failure')
      window.refuseMcpPolicy = false

      check(document.querySelector('table[aria-label="Provider usage"]') === retained, 'Provider polling panel remounted')
      choose('diagnostics'); await wait(80)
      check(visible(card('api')) && visible(card('load-order')) && visible(card('health')) && !visible(card('backups')), 'Diagnostics category failed')
      document.querySelector('[aria-label="Dismiss settings message"]').click(); await wait(80)
      window.checkLayout()
      check(!window.renderErrors.length, 'Renderer errors: ' + window.renderErrors.join('; '))
      return 'PASS: category/search recovery, retained diagnostic panels, clock persistence/rejection, hidden paths, failure visibility, maintenance confirmation/cancellation and renderer health'
    }
    window.checkLayout = () => {
      check(document.documentElement.scrollWidth <= innerWidth, 'Window overflows horizontally')
      const scroll = document.querySelector('.settings-scroll')
      check(scroll.scrollWidth <= scroll.clientWidth + 1, 'Settings content overflows horizontally at ' + innerWidth)
      check(scroll.clientHeight > 100, 'Settings lost its own scrollport')
      check([...document.querySelectorAll('.settings-card')].filter(visible).every(node => node.getBoundingClientRect().right <= innerWidth + 1), 'Card clipped horizontally')
      for (const grid of [...document.querySelectorAll('.settings-grid')].filter(visible)) {
        const columns = [...grid.children].filter(visible)
        if (columns.length === 1) check(Math.abs(columns[0].getBoundingClientRect().width - grid.getBoundingClientRect().width) < 2, 'Single visible column must fill its group')
      }
      return 'PASS: responsive Settings at ' + innerWidth + 'px'
    }
    window.checkNavigationSizing = async () => {
      choose('dashboard'); await wait(80)
      const toolbarHeight = document.querySelector('.settings-toolbar').getBoundingClientRect().height
      const padding = getComputedStyle(document.querySelector('.app-dashboard')).padding
      for (const category of ['workspace', 'privacy', 'data', 'integrations', 'diagnostics']) {
        choose(category); await wait(80)
        check(document.querySelector('.settings-toolbar').getBoundingClientRect().height === toolbarHeight, 'Preferences resized in ' + category + ' at ' + innerWidth)
        check(getComputedStyle(document.querySelector('.settings-content')).padding === padding, 'Content spacing changed in ' + category)
        window.checkLayout()
      }
    }
    window.checkController = async () => {
      choose('controller'); await wait(100)
      const panel = document.querySelector('.controller-controls')
      const status = panel.querySelector('[role=status]')
      check(visible(panel) && !visible(document.querySelector('.settings-scroll')), 'Controller category not displayed')
      check(status.textContent.includes('Connect a controller'), 'Disconnected guidance missing')
      window.controllerPad = { index: 0, connected: true, mapping: 'standard', buttons: Array.from({ length: 17 }, () => ({ pressed: false })), axes: [0,0,0,0] }
      await wait(100)
      check(status.textContent.includes('Controller connected'), 'Connection status missing')
      let pageChanges = 0, pickerChanges = 0
      const stop = startControllerNavigation(() => ({ enabled: true, stepPage: () => pageChanges++, togglePicker: () => pickerChanges++ }))
      clickText(panel, 'Test inputs'); await wait(100)
      window.controllerPad.buttons[4].pressed = true
      window.controllerPad.buttons[9].pressed = true
      window.controllerPad.axes = [0.8, 0, 0, -0.8]
      await wait(100)
      check(panel.hasAttribute('data-controller-test'), 'Test mode did not start')
      check(panel.querySelectorAll('.is-pressed').length >= 7, 'Buttons and sticks must highlight')
      check(pageChanges === 0 && pickerChanges === 0, 'Test input escaped into page navigation')
      window.controllerPad.buttons[1].pressed = true; await wait(100)
      check(!panel.hasAttribute('data-controller-test'), 'B must finish test mode')
      await wait(100)
      check(pageChanges === 0 && pickerChanges === 0, 'Held inputs triggered when leaving test mode')
      window.controllerPad.buttons.forEach(button => button.pressed = false)
      window.controllerPad.axes = [0,0,0,0]; await wait(100)
      window.controllerPad.buttons[5].pressed = true; await wait(100)
      check(pageChanges === 1, 'Normal shoulder navigation did not resume')
      stop()
      clickText(panel, 'Test inputs'); await wait(50)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(50)
      check(!panel.hasAttribute('data-controller-test'), 'Esc must finish test mode')
      window.controllerPad = null; await wait(100)
      check(status.textContent.includes('Connect a controller') && !panel.querySelector('.is-pressed'), 'Disconnect retained stale input')
      window.controllerPad = { connected: true, mapping: '', buttons: [], axes: [] }; await wait(100)
      check(status.textContent.includes('Standard layout required'), 'Unsupported mapping not explained')
      window.controllerPad = null
      clickText(panel, 'Test inputs'); await wait(50)
      choose('workspace'); await wait(50)
      check(!panel.hasAttribute('data-controller-test'), 'Hidden tab retained test capture')
      choose('controller'); await wait(80)
      check(!panel.hasAttribute('data-controller-test'), 'Reopened tab kept test capture')
      return 'PASS: controller status, live buttons/sticks, test isolation, B/Escape exit, navigation recovery, disconnect, unsupported devices and hidden-tab cleanup'
    }
    window.checkControllerLayout = async () => {
      document.getElementById('root').style.cssText = 'display:flex;height:100%;box-sizing:border-box;padding-top:94px;padding-left:64px'
      choose('controller'); await wait(100)
      for (const selector of ['.controller-host', '.controller-controls', '.controller-layout', '.controller-stage', '.controller-map']) {
        const node = document.querySelector(selector)
        check(node.scrollWidth <= node.clientWidth + 1, 'Controller horizontal overflow: ' + selector + ' at ' + innerWidth)
        if (innerWidth >= 1000) check(node.scrollHeight <= node.clientHeight + 1, 'Controller vertical overflow: ' + selector + ' at ' + innerWidth)
      }
      check(document.querySelector('.controller-diagram').getBoundingClientRect().height > 200, 'Diagram collapsed')
      return 'PASS: controller layout at ' + innerWidth + 'x' + innerHeight
    }
    window.finish = () => { host.unmount(); client.clear() }
  ` }, bundle: true, jsx: 'automatic', write: false, format: 'iife', loader: { '.css': 'empty' }, alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') }, define: { 'process.env.NODE_ENV': '"production"' } })
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(file => file.endsWith('.css'))
  assert.ok(css, 'Run the build before this UI probe')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'fixture.js'), `
    window.controllerPad = null
    Object.defineProperty(navigator, 'getGamepads', { value: () => window.controllerPad ? [window.controllerPad] : [] })
    Object.defineProperty(document, 'hasFocus', { value: () => true })
    window.renderErrors = []
    addEventListener('error', event => window.renderErrors.push(event.message))
    addEventListener('unhandledrejection', event => window.renderErrors.push(String(event.reason)))
    window.fixtureMcpPolicy = { readOnly: true, requireApproval: true, browserRequireApproval: false }
    window.maintenanceCalls = []
    window.fixtureKeys = { finnhub: false, fmp: false }
    window.syncCommands = []
    window.fixtureSync = { url: 'https://fixture.convex.cloud', configured: true, signedIn: false, encryptionAvailable: true, state: 'disconnected', pending: false }
    const envelope = data => ({ data, meta: { source: 'UI fixture', fetchedAt: Date.now(), freshness: 'fresh' }, errors: [] })
    window.api = {
      cloudSyncStatus: async () => envelope(window.fixtureSync),
      cloudSyncCommand: async command => {
        window.syncCommands.push(command)
        if (command.type === 'signInGitHub' && window.githubNotConfigured) {
          const message = 'GitHub sign-in is not configured. Add AUTH_GITHUB_ID and AUTH_GITHUB_SECRET in Convex.'
          window.fixtureSync = { ...window.fixtureSync, state: 'error', message, signInPending: false }
          return { ...envelope(window.fixtureSync), meta: { freshness: 'failed', failureReason: message } }
        }
        const signedOut = ['disconnect', 'cancelSignIn', 'sendCode', 'signInGitHub'].includes(command.type)
        window.fixtureSync = { ...window.fixtureSync, state: signedOut ? 'disconnected' : command.type === 'sync' ? 'conflict' : 'synced', signedIn: !signedOut,
          signInPending: command.type === 'signInGitHub', message: command.type === 'signInGitHub' ? 'Complete GitHub sign-in in your browser.' : undefined }
        return envelope(window.fixtureSync)
      },
      platform: 'win32', settings: async () => envelope(window.fixtureSettings),
      marketApiKeys: async () => envelope({ configured: { ...window.fixtureKeys }, encryptionAvailable: true }),
      mutateMarketApiKeys: async request => {
        window.fixtureKeys[request.provider] = request.type === 'save'
        return window.api.marketApiKeys()
      },
      mutateSettings: async mutation => {
        if (window.refuseMutation) throw Error('Fixture save failure')
        if (mutation.type === 'setTime12h') window.fixtureSettings.time12h = mutation.value
        return envelope({ ...window.fixtureSettings })
      },
      maintenance: async action => { window.maintenanceCalls.push(action); return envelope({ performed: false, message: 'Fixture action completed' }) },
      onPortfolioChanged: () => () => {}, portfolio: async () => envelope({ portfolios: [], activeId: null, mainId: null, sourcePath: '/private/portfolio.json' }),
      apiUsage: async () => ({ sampledAt: Date.now(), providers: [{ id: 'yahoo', label: 'Yahoo Finance', requestCount: 4, percent: 2, windowSeconds: 60, inFlight: 1, queued: 2, softLimit: 240, throttled: false, cooldownMs: 0 }] }),
      cacheStatus: async () => envelope(window.fixtureCache),
      mcpStatus: async () => ({ available: true, tools: 100, diagnostics: { policy: window.fixtureMcpPolicy, activity: [] } }),
      configureMcp: async policy => {
        if (window.refuseMcpPolicy) throw Error('Fixture permission save failure')
        window.fixtureMcpPolicy = policy
        return window.api.mcpStatus()
      },
      appMetrics: async () => envelope({ memory: [], backup: { state: 'not-created' } }),
    }
  `)
  await writeFile(join(directory, 'index.html'), '<meta charset="utf-8"><link rel="stylesheet" href="theme.css"><style>#root{display:flex;height:100%}</style><div id="root"></div><script src="fixture.js"></script><script src="renderer.js"></script>')
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))})
    app.whenReady().then(async () => {
      const win = new BrowserWindow({ show: false, width: 1600, height: 1000, webPreferences: { backgroundThrottling: false, offscreen: true } })
      win.setContentSize(1600, 1000)
      try {
        await win.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        console.log(await win.webContents.executeJavaScript('window.runProbe()'))
        console.log(await win.webContents.executeJavaScript('window.checkController()'))
        await win.webContents.executeJavaScript('window.checkNavigationSizing()')
        await new Promise(resolve => setTimeout(resolve, 400))
        if (process.env.SETTINGS_SCREENSHOT) {
          for (const category of ['controller']) {
            await win.webContents.executeJavaScript('document.querySelector(' + JSON.stringify('[data-settings-category="' + category + '"]') + ').click()')
            await new Promise(resolve => setTimeout(resolve, 120))
            require('node:fs').writeFileSync(process.env.SETTINGS_SCREENSHOT.replace(/\\.png$/, '-' + category + '.png'), (await win.webContents.capturePage()).toPNG())
          }
        }
        for (const width of [1280, 1024, 768, 480]) {
          win.setSize(width, 900)
          await new Promise(resolve => setTimeout(resolve, 120))
          await win.webContents.executeJavaScript('window.checkNavigationSizing()')
          console.log(await win.webContents.executeJavaScript('window.checkLayout()'))
        }
        for (const [width, height] of [[1600,1000], [1366,768], [1280,800], [1024,768], [480,900]]) {
          win.setContentSize(width, height)
          console.log(await win.webContents.executeJavaScript('window.checkControllerLayout()'))
        }
        await win.webContents.executeJavaScript('window.finish()')
        app.exit(0)
      } catch (error) { console.error(error); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((done, reject) => {
    const child = spawn(createRequire(import.meta.url)('electron'), [...(process.platform === 'linux' && !process.env.DISPLAY ? ['--ozone-platform=headless', '--ozone-override-screen-size=1920,1080', '--disable-gpu'] : []), join(directory, 'main.cjs')], { env, windowsHide: true })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(Error('Settings UI probe timed out')) }, 30000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); done({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output)
} finally { await rm(directory, { recursive: true, force: true }) }
