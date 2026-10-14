import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { startupPages, workspaceFor } from '../electron/shared/navigation.js'
import { TABS } from '../electron/shared/contract.js'

assert.equal(workspaceFor('hims')?.id, 'focus')
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
        import { PageCache } from './src/components/chrome/PageCache'
        import { WorkspaceSidebar } from './src/components/chrome/WorkspaceNavigation'
        import { pageIconPaths } from './src/components/chrome/NavigationIcon'
        import { TABS } from './electron/shared/contract'
        import { WORKSPACES } from './electron/shared/navigation'
        const renders = {}, effects = {}, ticks = {}
        const ids = ['a', 'b', 'c', 'd', 'e']
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
            {Array.from({length: 1000}, (_, i) => <div key={i}>Row {i}</div>)}
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
          const railProps = {
            tabs: TABS, activeTab: 'articles', favorites: TABS.map(tab => tab.id), recent: [],
            onSelectTab: id => selected = id, onToggleCollapsed: () => toggled = true,
            saving: false, isMac: false,
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
          check(Object.values(effects).reduce((a, b) => a + b, 0) === 1, 'More than one page has active effects')
          return 'PASS: all page and workspace icons, tooltips, selection, sidebar expansion, recent-page retention, resident limit, eviction, shell render isolation, suspended polling, effect resume, hidden-page removal'
        }
      `,
    },
    bundle: true,
    jsx: 'automatic',
    write: false,
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), '<div id="root"></div><script src="renderer.js"></script>')
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
    const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], {
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
