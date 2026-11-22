import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { adjacentPage, DEFAULT_TAB_ID, pagesInVisualOrder, startupPages, workspaceFor } from '../electron/shared/navigation.js'
import { FOCUS_DASHBOARD_TAB_ID, TABS } from '../electron/shared/contract.js'

assert.equal(workspaceFor('dashboard-2')?.id, 'overview')
assert.equal(DEFAULT_TAB_ID, 'dashboard-2', 'Dashboard 2.0 must be the default opening page')
assert(TABS.some(tab => tab.id === DEFAULT_TAB_ID && tab.label === 'Dashboard 2.0' && tab.implemented))
assert(startupPages('dashboard', [], []).includes('dashboard-2'), 'Unvisited Dashboard 2.0 must load at startup')
const defaultStartup = startupPages(DEFAULT_TAB_ID, [], [])
assert.equal(defaultStartup[0], DEFAULT_TAB_ID)
assert.equal(workspaceFor(FOCUS_DASHBOARD_TAB_ID)?.pages[0], FOCUS_DASHBOARD_TAB_ID)
assert(defaultStartup.includes(FOCUS_DASHBOARD_TAB_ID), 'The Focus Dashboard must be ready at startup')
assert(TABS.filter(tab => tab.implemented).every(tab => defaultStartup.includes(tab.id)),
  'Opening Dashboard 2.0 must still warm every implemented page')
assert.equal(workspaceFor('hims')?.id, 'focus')
assert.equal(workspaceFor('scorecard')?.id, 'research')
assert(TABS.some(tab => tab.id === 'scorecard' && tab.label === 'Scorecard' && tab.implemented))
assert(startupPages('dashboard', [], []).includes('scorecard'), 'Unvisited Scorecard must load at startup')
assert.equal(workspaceFor('pltr')?.id, 'focus')
assert(TABS.some(tab => tab.id === 'pltr' && tab.label === 'PLTR' && tab.implemented))
assert.equal(workspaceFor('semiconductors')?.id, 'focus')
assert(startupPages('dashboard', [], []).includes('semiconductors'))
assert(TABS.some(tab => tab.id === 'hims' && tab.label === 'HIMS' && tab.implemented))
assert.equal(workspaceFor('sofi')?.id, 'focus')
assert(TABS.some(tab => tab.id === 'sofi' && tab.label === 'SOFI' && tab.implemented))
assert(!TABS.some(tab => tab.id === 'signals'), 'Day Trading must be absent from navigation and settings')
assert.equal(workspaceFor('signals'), undefined)
assert(!startupPages('signals', ['signals'], ['signals']).includes('signals'), 'Saved history must not restore Day Trading')

// Saved global order interleaves workspaces; controller/arrow traversal must follow the UI instead.
const interleaved = ['charts', 'news', 'stocks', 'dashboard-2', 'heatmap', 'portfolio', 'pre-market', 'settings']
  .map(id => TABS.find(tab => tab.id === id)!)
const visualOrder = pagesInVisualOrder(interleaved)
assert.deepEqual(visualOrder.map(tab => tab.id), ['news', 'dashboard-2', 'pre-market', 'heatmap', 'stocks', 'charts', 'portfolio', 'settings'])
assert.equal(adjacentPage(visualOrder, 'news', 1), 'dashboard-2', 'Right must follow the next visible header button')
assert.equal(adjacentPage(visualOrder, 'pre-market', 1), 'heatmap', 'Workspace boundaries must follow sidebar order')
assert.equal(adjacentPage(visualOrder, 'news', -1), 'settings', 'Left must wrap to the last visible page')
assert.equal(adjacentPage(visualOrder, 'settings', 1), 'news', 'Right must wrap to the first visible page')
assert.equal(adjacentPage([], 'news', 1), undefined)
assert.equal(adjacentPage(visualOrder, 'hidden', 1), 'news')
assert(!pagesInVisualOrder(interleaved.map(tab => ({ ...tab, implemented: tab.id !== 'charts' }))).some(tab => tab.id === 'charts'))
assert(!pagesInVisualOrder(interleaved.filter(tab => tab.id !== 'heatmap')).some(tab => tab.id === 'heatmap'))

// Exercise the actual page host in Chromium with synthetic data and isolated storage.
const require = createRequire(import.meta.url)
const directory = await mkdtemp(join(tmpdir(), 'budget-navigation-'))
try {
  const bundle = await build({
    stdin: {
      resolveDir: resolve(import.meta.dirname, '..'),
      loader: 'tsx',
      contents: `
        import { useEffect, useState } from 'react'
        import { createRoot } from 'react-dom/client'
        import { flushSync } from 'react-dom'
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
        import { queryKeys } from './src/api/client'
        import { PageCache } from './src/components/chrome/PageCache'
        import { WorkspaceHeader, WorkspaceSidebar } from './src/components/chrome/WorkspaceNavigation'
        import { pageIconPaths } from './src/components/chrome/NavigationIcon'
        import { FocusDashboardPage } from './src/pages/FocusDashboardPage'
        import { FOCUS_DASHBOARD_TAB_ID, TABS } from './electron/shared/contract'
        import { adjacentPage, FOCUS_WORKSPACE, pagesInVisualOrder, WORKSPACES } from './electron/shared/navigation'
        const renders = {}, effects = {}, ticks = {}
        const ids = ['a', 'b', 'c', 'd', 'e', 'dictionary', 'settings', 'articles', 'notifications']
        let select, updateShell, hide
        function Page({ id }) {
          renders[id] = (renders[id] || 0) + 1
          const [value, setValue] = useState(0)
          useEffect(() => {
            effects[id] = (effects[id] || 0) + 1
            const timer = setInterval(() => ticks[id] = (ticks[id] || 0) + 1, 10)
            return () => { effects[id]--; clearInterval(timer) }
          }, [])
          return <main><button onClick={() => setValue(v => v + 1)}>{value}</button>
            <div data-scroll style={{height: 100, overflow: 'auto'}}>{Array.from({length: 1000}, (_, i) => <div key={i}>Row {i}</div>)}</div>
          </main>
        }
        const renderPage = id => <Page id={id} />
        function Shell() {
          const [tab, setTab] = useState('a')
          const [count, setCount] = useState(0)
          const [visible, setVisible] = useState(ids)
          select = setTab; updateShell = setCount; hide = id => setVisible(v => v.filter(x => x !== id))
          return <><span>{count}</span><PageCache activeTab={tab} visibleIds={visible} renderPage={renderPage} /></>
        }
        const check = (value, message) => { if (!value) throw Error(message) }
        const settle = () => new Promise(resolve => setTimeout(resolve, 80))
        const go = async id => { flushSync(() => select(id)); await settle() }
        window.runProbe = async () => {
          const railHost = document.createElement('div')
          document.body.append(railHost)
          const railRoot = createRoot(railHost)
          let selected, toggled = false
          const focusCache = new QueryClient()
          const renderFocus = (tabs, obscuredPages) => flushSync(() => railRoot.render(
            <QueryClientProvider client={focusCache}>
              <FocusDashboardPage tabs={tabs} obscuredPages={obscuredPages} onSelectTab={id => selected = id} />
            </QueryClientProvider>,
          ))
          const railProps = {
            tabs: TABS, activeTab: 'articles', favorites: TABS.map(tab => tab.id), recent: [],
            onSelectTab: id => selected = id, onToggleCollapsed: () => toggled = true,
            saving: false, isMac: false,
          }
          flushSync(() => railRoot.render(<WorkspaceSidebar {...railProps} collapsed />))
          // Compare traversal with real shortcuts, including reordered and hidden pages.
          const reordered = [...TABS].reverse().filter(tab => !['heatmap', 'gold'].includes(tab.id))
          const ordered = pagesInVisualOrder(reordered)
          const renderedOrder = []
          for (const workspace of WORKSPACES) {
            const first = ordered.find(tab => workspace.pages.includes(tab.id))
            if (!first) continue
            if (workspace === FOCUS_WORKSPACE) {
              check(first.id === FOCUS_DASHBOARD_TAB_ID, 'Focus Dashboard must lead its workspace even with a saved custom order')
              renderedOrder.push(first.id)
              renderFocus(reordered)
              for (const button of railHost.querySelectorAll('nav[aria-label="Focus pages"] button')) {
                button.click()
                renderedOrder.push(selected)
              }
              continue
            }
            flushSync(() => railRoot.render(<WorkspaceHeader tabs={reordered} activeTab={first.id}
              onSelectTab={id => selected = id} favorite={false} onToggleFavorite={() => {}} saving={false} isMac={false} />))
            for (const button of railHost.querySelectorAll('nav[aria-label="Workspace pages"] button:not(:disabled)')) {
              button.click()
              renderedOrder.push(selected)
            }
          }
          if (ordered.some(tab => tab.id === 'settings')) renderedOrder.push('settings')
          check(JSON.stringify(renderedOrder) === JSON.stringify(ordered.map(tab => tab.id)), 'Page stepping differs from visual navigation order')
          for (let i = 0; i < renderedOrder.length; i++) {
            check(adjacentPage(ordered, renderedOrder[i], 1) === renderedOrder[(i + 1) % renderedOrder.length], 'Right skipped a visible page')
            check(adjacentPage(ordered, renderedOrder[i], -1) === renderedOrder[(i + renderedOrder.length - 1) % renderedOrder.length], 'Left skipped a visible page')
          }
          const focusButton = () => railHost.querySelector('nav[aria-label="Workspaces"] button[aria-label="Focus"]')
          const focusCards = () => [...railHost.querySelectorAll('nav[aria-label="Focus pages"] button')]
          const focusLabels = () => focusCards().map(button => button.getAttribute('aria-label'))
          flushSync(() => railRoot.render(<WorkspaceSidebar {...railProps} activeTab="nvda" collapsed />))
          focusButton().click()
          check(selected === FOCUS_DASHBOARD_TAB_ID, 'Focus must open its landing page when revisited')
          const withoutDashboard = TABS.filter(tab => tab.id !== FOCUS_DASHBOARD_TAB_ID)
          flushSync(() => railRoot.render(<WorkspaceSidebar {...railProps} tabs={withoutDashboard} activeTab="nvda" collapsed />))
          focusButton().click()
          check(selected === 'nvda', 'Hiding the dashboard must preserve access to Focus pages')
          const renderHeader = tabs => <WorkspaceHeader tabs={tabs} activeTab="nvda"
            onSelectTab={id => selected = id} favorite={false} onToggleFavorite={() => {}} saving={false} isMac={false} />
          flushSync(() => railRoot.render(renderHeader(TABS)))
          const back = [...railHost.querySelectorAll('header button')].find(button => button.textContent.includes('Focus Dashboard'))
          check(back && !railHost.querySelector('nav[aria-label="Workspace pages"]'), 'Detail header must offer a dashboard shortcut')
          back.click()
          check(selected === FOCUS_DASHBOARD_TAB_ID, 'Dashboard shortcut navigated to the wrong page')
          flushSync(() => railRoot.render(renderHeader(withoutDashboard)))
          check(railHost.querySelector('nav[aria-label="Workspace pages"] button'), 'Focus shortcuts must be available with the dashboard hidden')
          renderFocus(TABS)
          check(focusCards().length === FOCUS_WORKSPACE.pages.length - 1, 'Focus Dashboard must include every topic')
          check(focusLabels().join(',') === focusLabels().sort((a, b) => a.localeCompare(b, 'en')).join(','),
            'Focus Dashboard must sort topic cards by their displayed labels')
          check(railHost.querySelectorAll('[data-focus-metric]').length === focusCards().length, 'Every Focus card needs a headline metric')
          const asOf = '2026-10-01', period = 'Q3 2026', timestamp = Date.parse(asOf)
          const report = fields => ({ earnings: { reports: [{ period, ...fields }] } })
          const pltrQuarterly = { revenue: [{ endDate: asOf, value: 1.1e9, label: 'Q3' }],
            netIncome: [], operatingCashFlow: [], freeCashFlow: [], sharesOutstanding: [], researchDevelopment: [] }
          const fixtures = [
            ['AMZN', queryKeys.amzn, report({ segments: [{ name: 'AWS', revenue: 31e9 }] }), '$31.0B'],
            ['Anthropic', queryKeys.anthropic, { quarters: [{ period, revenue: 17 }] }, '$17.0B'],
            ['AVGO', queryKeys.avgo, { earnings: { period, metrics: [{ id: 'aiRevenue', value: 5e9, text: 'over' }] } }, '> $5.0B'],
            ['Bitcoin', queryKeys.bitcoin, { stats: { market_price_usd: 45_000, timestamp } }, '$45,000'],
            ['BMNR', queryKeys.bmnr, { live: { ethHeld: { value: 3e6, asOf } } }, '3.00M'],
            ['Ethereum', queryKeys.eth, { mainnet: { tps: 15.5, asOf: timestamp } }, '15.5 TPS'],
            ['Gold', queryKeys.gold, { market: { futuresPrice: { value: 2500, asOf } } }, '$2,500'],
            ['GOOGL', queryKeys.googl, report({ businesses: [{ name: 'Google Cloud', revenue: 14e9 }] }), '$14.0B'],
            ['HIMS', queryKeys.hims, report({ metrics: { subscribers: { value: 2e6 } } }), '2.00M'],
            ['Homebuilders', queryKeys.homebuilders, { rows: [{ company: { symbol: 'ITB' }, market: { price: 106.3, quoteTime: timestamp } }] }, '$106.30'],
            ['HOOD', queryKeys.hood, { monthly: { period, metrics: [{ id: 'deposits', value: 2e9 }] } }, '$2.0B'],
            ['Macro', queryKeys.economic, { rows: [{ seriesId: 'CPIAUCSL', available: true, latest: 2.64, latestDate: asOf }] }, '2.64%'],
            ['MU', queryKeys.mu, { earnings: { period, metrics: [{ id: 'revenue', value: 9e9 }] } }, '$9.0B'],
            ['NVDA', queryKeys.nvda, { earnings: { quarters: [{ period, dataCenter: 42e9 }] } }, '$42.0B'],
            ['Oil', queryKeys.oil, { market: { wtiPrice: { value: 69.5, asOf } } }, '$69.50'],
            ['PLTR', queryKeys.fundamentalsPage('PLTR'), { displayCurrency: 'USD', currencyVersion: 2, quarterly: pltrQuarterly }, '$1.1B'],
            ['Semiconductors', queryKeys.semiconductors, { rows: [
              ...[1, 3, -2, null].map(dailyChange => ({ market: { dailyChange } })),
              { market: { dailyChange: 25, changeBasis: '24h' } },
            ] }, '2 up / 1 down'],
            ['SOFI', queryKeys.sofi, { reports: { quarters: [{ endDate: asOf, values: { members: 12e6 } }] } }, '12.00M'],
            ['VST', queryKeys.vst, { operations: { period, totalGenerationGwh: 25_600 } }, '25.6 TWh'],
          ]
          const cardMetric = label => focusCards().find(button => button.getAttribute('aria-label') === label).querySelector('[data-focus-metric]')
          const metricValue = label => cardMetric(label).querySelector('b').textContent
          const snapshot = (data, freshness = 'fresh') => ({ data, errors: [], meta: { freshness, source: 'Fixture', fetchedAt: timestamp } })
          check(metricValue('Bitcoin') === '—', 'An absent reading must leave an empty metric')
          flushSync(() => {
            for (const [, key, data] of fixtures) focusCache.setQueryData(key, snapshot(data))
          })
          for (const [label, , , expected] of fixtures) check(metricValue(label) === expected, 'Wrong headline metric for ' + label)
          check(cardMetric('Bitcoin').textContent.includes('Oct 1, 2026'), 'Spot reference must show the observation date')
          renderFocus(TABS, ['bitcoin'])
          check(!cardMetric('Bitcoin').textContent.includes('45,000') && !cardMetric('Bitcoin').title.includes('45,000'),
            'A protected page must not reveal its cached reading in the Focus Dashboard')
          renderFocus(TABS)
          check(metricValue('Bitcoin') === '$45,000', 'Removing Obscure protection must restore the reading')
          flushSync(() => focusCache.setQueryData(queryKeys.bitcoin, snapshot({ stats: { market_price_usd: 17, timestamp } }, 'failed')))
          check(metricValue('Bitcoin') === '—', 'A failed snapshot must not display data from a failure envelope')
          check(focusCache.getQueryCache().getAll().every(query => query.getObserversCount() === 0),
            'Focus readings should not attach query observers')
          const filter = label => flushSync(() => [...railHost.querySelectorAll('[aria-label="Filter Focus pages"] button')]
            .find(button => button.textContent === label).click())
          filter('Digital assets')
          check(focusLabels().join(',') === 'Bitcoin,BMNR,Ethereum', 'Digital assets must keep the matching topics in alphabetical order')
          const search = railHost.querySelector('input[aria-label="Search Focus pages"]')
          const changeSearch = text => flushSync(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, text)
            search.dispatchEvent(new Event('input', { bubbles: true }))
          })
          changeSearch('staking')
          check(focusCards().length === 1 && focusCards()[0].getAttribute('aria-label') === 'Ethereum', 'Search did not refine the active filter')
          focusCards()[0].click()
          check(selected === 'eth', 'Filtered card navigated to the wrong page')
          changeSearch('unmatched phrase')
          check(focusCards().length === 0 && railHost.textContent.includes('No matching Focus pages.'), 'Missing search empty state')
          flushSync(() => [...railHost.querySelectorAll('button')].find(button => button.textContent === 'Clear filters').click())
          check(focusCards().length === FOCUS_WORKSPACE.pages.length - 1 && !search.value, 'Clear filters did not restore the directory')
          changeSearch('chip')
          check(focusLabels().join(',') === 'AVGO,Semiconductors', 'Search results must stay alphabetical')
          if (${JSON.stringify(process.argv.includes('--page-order-only'))}) {
            railRoot.unmount()
            focusCache.clear()
            railHost.remove()
            return 'PASS: visual page traversal, Focus landing and routes, filters, search, 19 cached readings, cache updates and Obscure protection'
          }
          flushSync(() => railRoot.render(<WorkspaceSidebar {...railProps} collapsed />))
          const favoriteButtons = [...railHost.querySelectorAll('nav[aria-label="Favorite pages"] button')]
          check(favoriteButtons.length === TABS.length, 'Missing favorite pages')
          for (const tab of TABS) {
            check(pageIconPaths[tab.id], 'Missing page icon: ' + tab.id)
            const button = favoriteButtons.find(button => button.getAttribute('aria-label') === tab.label)
            check(button.title === tab.label && button.textContent === '', 'Collapsed page label or tooltip incorrect: ' + tab.id)
            check(button.querySelector('svg[aria-hidden="true"] path'), 'Missing SVG: ' + tab.id)
            button.click()
            check(selected === tab.id, 'Favorite icon selected wrong page: ' + tab.id)
          }
          check(new Set(TABS.map(tab => pageIconPaths[tab.id])).size === TABS.length, 'Pages must have distinct icons')
          for (const workspace of WORKSPACES) {
            const button = railHost.querySelector('nav[aria-label="Workspaces"] button[aria-label="' + workspace.label + '"]')
            check(button.querySelector('svg') && button.title === workspace.label, 'Missing workspace icon or tooltip')
            button.click()
            check(workspace.pages.includes(selected), 'Workspace icon selected wrong workspace')
          }
          check(railHost.querySelector('button[aria-label="Articles"][aria-current="page"]'), 'Selected icon lost active state')
          railHost.querySelector('button[aria-label="Expand sidebar"]').click()
          check(toggled, 'Expand icon did not toggle sidebar')
          flushSync(() => railRoot.render(<WorkspaceSidebar {...railProps} collapsed={false} isMac />))
          check(!railHost.querySelector('[data-navigation-icon]'), 'Expanded sidebar should show labels')
          check(railHost.textContent.includes('Macro & events') && railHost.textContent.includes('Personal Finance'), 'Expanded labels missing')
          railRoot.unmount()
          focusCache.clear()
          railHost.remove()
          createRoot(document.getElementById('root')).render(<Shell />)
          await settle()
          const original = document.querySelector('[data-page-id="a"]')
          original.querySelector('button').click()
          await settle()
          const before = renders.a
          flushSync(() => updateShell(1))
          await settle()
          check(renders.a === before, 'Shell updates rerendered the page')
          await go('b')
          check(effects.a === 0 && effects.b === 1, 'Hidden effects were not suspended')
          const retainedB = document.querySelector('[data-page-id="b"]')
          retainedB.querySelector('button').click()
          retainedB.querySelector('[data-scroll]').scrollTop = 230
          retainedB.querySelector('[data-scroll]').dispatchEvent(new Event('scroll'))
          await settle()
          const stopped = ticks.a
          await settle()
          check(ticks.a === stopped, 'Hidden page kept polling')
          check(getComputedStyle(original).display === 'none', 'Hidden page is visible')
          await go('a')
          check(document.querySelector('[data-page-id="a"]') === original, 'Return rebuilt the DOM')
          check(original.querySelector('button').textContent === '1', 'Return lost page state')
          check(effects.a === 1 && effects.b === 0, 'Effects did not resume correctly')
          await go('c'); await go('d'); await go('e')
          check(document.querySelectorAll('[data-page-id]').length === 3, 'Page cache exceeded its resident limit')
          check(!document.querySelector('[data-page-id="a"]'), 'Oldest page was not evicted')
          check(!document.querySelector('[data-page-id="b"]'), 'Earlier page was not evicted')
          check(document.querySelector('[data-page-id="c"]'), 'Recent page was evicted')
          flushSync(() => hide('c'))
          await settle()
          check(!document.querySelector('[data-page-id="c"]'), 'Settings-hidden page was retained')
          await go('b')
          check(document.querySelector('[data-page-id="b"]') !== retainedB, 'Evicted page reused stale DOM')
          check(document.querySelector('[data-page-id="b"] button').textContent === '0', 'Evicted page kept local state')
          check(document.querySelector('[data-page-id="b"] [data-scroll]').scrollTop === 230, 'Evicted page lost its saved scroll position')
          await go('dictionary')
          document.querySelector('[data-page-id="dictionary"] button').click()
          await settle()
          const dictionary = document.querySelector('[data-page-id="dictionary"]')
          await go('a'); await go('d'); await go('e'); await go('settings'); await go('articles'); await go('notifications')
          await go('dictionary')
          check(document.querySelector('[data-page-id="dictionary"]') === dictionary, 'Lightweight reader was evicted by expensive pages')
          check(dictionary.querySelector('button').textContent === '1', 'Retained reader lost selection/control state')
          check([...document.querySelectorAll('[data-page-id]')].filter(node => ['a','b','c','d','e'].includes(node.dataset.pageId)).length <= 3, 'Light reader retention exceeded the chart budget')
          check(Object.values(effects).reduce((a, b) => a + b, 0) === 1, 'More than one page has active effects')
          return 'PASS: visual page traversal in both directions, reordered/hidden pages, wrapping, all page and workspace icons, tooltips, selection, sidebar expansion, recent-page retention, resident limit, eviction, shell render isolation, suspended polling, effect resume, hidden-page removal'
        }
      `,
    },
    bundle: true,
    jsx: 'automatic',
    write: false,
    outfile: join(directory, 'renderer.js'),
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  for (const file of bundle.outputFiles) await writeFile(file.path, file.contents)
  await writeFile(join(directory, 'index.html'), '<link rel="stylesheet" href="renderer.css"><div id="root"></div><script>window.api = {}</script><script src="renderer.js"></script>')
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        console.log(await window.webContents.executeJavaScript('window.runProbe()'))
        app.exit(0)
      } catch (error) { console.error(error); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const output = await new Promise<{ code: number | null, text: string }>((resolveRun, reject) => {
    const headless = process.platform === 'linux' && !process.env.DISPLAY
      ? ['--ozone-platform=headless', '--disable-gpu'] : []
    const child = spawn(require('electron') as string, [...headless, join(directory, 'main.cjs')], {
      env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let text = ''
    child.stdout.on('data', chunk => { text += chunk })
    child.stderr.on('data', chunk => { text += chunk })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Navigation probe timed out')) }, 30_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, text }) })
  })
  assert.equal(output.code, 0, output.text)
  assert.match(output.text, /PASS:/)
  console.log(output.text.trim())
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
