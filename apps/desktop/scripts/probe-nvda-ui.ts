import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(join(tmpdir(), 'budget-nvda-ui-'))
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert(css, 'Run npm run build first')
  await writeFile(join(scratch, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import { createRoot } from 'react-dom/client'
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
    import { NvdaPage } from './src/pages/NvdaPage'
    import { nvdaFixture } from './scripts/fixtures/nvda'
    import { buildTasks } from './src/api/prefetch'
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    const check = (value, message) => { if (!value) throw Error(message) }
    const settle = () => new Promise(resolve => setTimeout(resolve, 200))
    const node = selector => document.querySelector(selector)
    const button = label => [...document.querySelectorAll('button')].find(button => button.textContent === label)
    let calls = 0, lastRequest, navigation, opened, statuses, fails = false
    window.api.nvda = async request => {
      calls++
      lastRequest = request
      const data = nvdaFixture()
      if (fails) data.earnings = null
      return { data, errors: fails ? [{ source: 'fixture', reason: 'HTTP 503', operation: 'nvda-earnings' }] : [],
        meta: { source: 'fixture', fetchedAt: Date.now(), freshness: fails ? 'partial' : 'fresh', failureReason: fails ? 'HTTP 503' : undefined } }
    }
    window.api.openExternal = async url => { opened = url }
    const host = createRoot(node('#root'))
    const render = () => host.render(<QueryClientProvider client={client}><NvdaPage
      onStatusChange={panels => { statuses = panels }} onNavigate={(...args) => { navigation = args }} /></QueryClientProvider>)
    window.runProbe = async () => {
      const tasks = buildTasks(undefined, { hiddenTabs: ['nvda'], favoriteTabs: [] }, { stocks: 'AAPL', fundamentals: 'AAPL' },
        { year: 2026, month: 11, earningsYear: 2026, ipoYear: 2026 })
      const task = tasks.find(task => task.tab === 'nvda')
      check(task, 'Hidden NVDA is absent from startup tasks')
      check(task.refreshIntervalMs === 60 * 60_000, 'NVDA snapshot cadence differs from startup freshness')
      await task.run(client, 7)
      check(lastRequest.background && lastRequest.backgroundOrder === 7, 'Startup priority lost')
      render(); await settle()
      check(calls === 1, 'First visit fetched warmed content again')
      check(node('.nvda-headline').textContent.includes('$115.8B') && node('.nvda-outlook').textContent.includes('$130.0B'), 'Results or guidance missing')
      check(document.querySelectorAll('canvas').length > 0, 'Market chart did not render')
      check([...document.querySelectorAll('.nvda-stack i')].every(item => item.getBoundingClientRect().height > 0), 'One or more revenue platforms are invisible')
      node('.nvda-quarter[aria-label^="Q3 FY2026,"]').click(); await settle()
      check(node('.nvda-economics').textContent.includes('73.4%') && node('.nvda-mix').textContent.includes('$35.1B'), 'Quarter selection did not change mix and economics')
      button('1Y').click(); await settle()
      check(button('1Y').getAttribute('aria-pressed') === 'true' && calls === 1, 'Chart range triggered another data load')
      button('CFO commentary ↗').click()
      check(opened === nvdaFixture().earnings.sourceUrl, 'Source navigation lost the official document')
      for (const [label, tab] of [['Open charts ↗', 'charts'], ['Fundamentals ↗', 'fundamentals'], ['Options ↗', 'options']]) {
        button(label).click(); check(navigation.join(':') === tab + ':NVDA', 'Ticker navigation failed')
      }
      fails = true
      await client.refetchQueries({ queryKey: ['nvda'] }); await settle()
      check(String(statuses[0].error).includes('HTTP 503'), 'Settings lost the provider failure')
      check(node('.nvda-mix').textContent.includes('$35.1B'), 'Refresh erased usable disclosure')
      check(!document.body.innerText.includes('HTTP 503'), 'Provider diagnostics surfaced in the content')
      fails = false
      await client.refetchQueries({ queryKey: ['nvda'] }); await settle()
      host.render(null); await settle()
      const before = calls
      render(); await settle()
      check(calls === before, 'Revisit repeated initial loading')
      return 'PASS: NVDA startup, quarter selection, stock chart, sources, failure retention and revisit'
    }
    window.verifyLayout = fit => {
      const page = node('[data-nvda-page]')
      check(page.scrollWidth <= page.clientWidth + 1, 'Page has horizontal overflow')
      if (fit) check(page.scrollHeight <= page.clientHeight + 1, 'Desktop layout requires scrolling')
      for (const section of page.querySelectorAll('section')) {
        check(section.scrollHeight <= section.clientHeight + 1 && section.scrollWidth <= section.clientWidth + 1, 'Clipped section: ' + section.className)
      }
    }
  ` }, bundle: true, jsx: 'automatic', write: false, format: 'iife', loader: { '.css': 'empty' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') }, define: { 'process.env.NODE_ENV': '"production"' } })
  await writeFile(join(scratch, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(scratch, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="height:100vh;display:flex"></div><script>window.api = { platform: "win32" };</script><script src="renderer.js"></script></body></html>')
  await writeFile(join(scratch, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    const fs = require('node:fs')
    app.setPath('userData', ${JSON.stringify(join(scratch, 'userData'))})
    app.whenReady().then(async () => {
      const win = new BrowserWindow({ show: false, useContentSize: true, width: 1400, height: 840, webPreferences: { backgroundThrottling: false } })
      try {
        await win.loadFile(${JSON.stringify(join(scratch, 'index.html'))})
        console.log(await win.webContents.executeJavaScript('window.runProbe()'))
        for (const [width, height, fit] of [[1400,840,true],[1240,730,true],[720,790,false],[400,760,false]]) {
          win.setContentSize(width, height)
          await new Promise(resolve => setTimeout(resolve, 140))
          const result = await win.webContents.executeJavaScript('try { window.verifyLayout(' + fit + '); "PASS" } catch (error) { error.message }')
          if (width === 1240) {
            await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
            await new Promise(resolve => setTimeout(resolve, 120))
            fs.writeFileSync(${JSON.stringify(join(root, 'out/nvda-smoke.png'))}, (await win.webContents.capturePage()).toPNG())
          }
          if (result !== 'PASS') throw Error(width + 'x' + height + ': ' + result)
        }
        console.log('PASS: NVDA desktop, compact and narrow layouts')
        app.exit(0)
      } catch (error) { console.error(error); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: scratch, LOCALAPPDATA: scratch, BUDGET_TERMINAL_DATA_DIR: scratch }
  delete env.ELECTRON_RUN_AS_NODE
  const { code, output } = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(scratch, 'main.cjs')], { env, windowsHide: true })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(Error('NVDA UI probe timed out')) }, 45_000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(code, 0, output)
  console.log(output.trim())
} finally {
  const location = relative(tmpdir(), scratch)
  assert(location && !location.startsWith('..') && resolve(tmpdir(), location) === scratch)
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
