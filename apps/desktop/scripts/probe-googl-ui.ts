import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(join(tmpdir(), 'budget-googl-ui-'))
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert(css, 'Run npm run build first')
  await writeFile(join(scratch, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import { createRoot } from 'react-dom/client'
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
    import { GooglPage } from './src/pages/GooglPage'
    import { googlFixture } from './scripts/fixtures/googl'
    import { emptyGooglPayload } from './electron/shared/googl'
    import { buildTasks } from './src/api/prefetch'
    import { useRefreshGoogl } from './src/api/googlQueries'
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false, gcTime: Infinity } } })
    const check = (value, message) => { if (!value) throw Error(message) }
    const settle = () => new Promise(resolve => setTimeout(resolve, 180))
    const text = () => document.body.innerText
    const button = label => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === label)
    let calls = 0, mode = 'success', lastRequest, opened = '', navigation
    window.api.googl = async request => {
      calls++; lastRequest = request
      const data = mode === 'failed' ? emptyGooglPayload() : googlFixture()
      if (mode === 'partial') { data.earnings = null; data.progress.earnings = 'unavailable' }
      return { data, errors: mode === 'success' ? [] : [{ symbol: 'earnings', source: 'fixture', operation: 'googl-earnings', reason: 'HTTP 503' }],
        meta: { source: 'GOOGL fixture', fetchedAt: Date.now(), freshness: mode === 'success' ? 'fresh' : mode, failureReason: mode === 'success' ? undefined : 'HTTP 503' } }
    }
    window.api.openExternal = async url => { opened = url }
    function Page() {
      window.reloadGoogl = useRefreshGoogl()
      return <GooglPage onStatusChange={panels => { window.statuses = panels }} onNavigate={(tab, symbol) => { navigation = [tab, symbol] }} />
    }
    const host = createRoot(document.getElementById('root'))
    const render = () => host.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>)
    window.runProbe = async () => {
      const task = buildTasks(undefined, { hiddenTabs: ['googl'], favoriteTabs: [] }, { stocks: 'AAPL', fundamentals: 'AAPL' }, { year: 2026, month: 11, earningsYear: 2026, ipoYear: 2026 }).find(task => task.tab === 'googl')
      check(task, 'Hidden GOOGL is absent from startup tasks')
      await task.run(client, 7)
      check(lastRequest.background && lastRequest.backgroundOrder === 7, 'Startup priority was lost')
      render(); await settle()
      check(calls === 1, 'First visit fetched warmed content again')
      check(text().includes('Alphabet') && text().includes('Traffic acquisition costs') && text().includes('$127.58B'), 'Company metrics missing')
      check(document.querySelectorAll('canvas').length > 0, 'Market chart did not render')
      check(document.querySelector('svg[aria-label*="Search & other"]'), 'Revenue trend missing')
      const cloud = [...document.querySelectorAll('.googl-business')].find(row => row.textContent.startsWith('Google Cloud'))
      cloud.click(); await settle()
      check(cloud.getAttribute('aria-pressed') === 'true' && document.querySelector('svg[aria-label*="Google Cloud"]'), 'Business selection failed')
      const select = document.querySelector('select'); select.value = '2025 Q4'; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
      check(text().includes('$113.83B'), 'Quarter selector did not update the financial view')
      button('Earnings release ↗').click(); check(opened.includes('googexhibit991q42025'), 'Quarter source link lost selected period')
      select.value = '2026 Q3'; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
      for (const tab of ['Charts', 'Fundamentals', 'Valuation', 'Options']) { button(tab + ' ↗').click(); check(navigation.join(':') === tab.toLowerCase() + ':GOOGL', 'Ticker navigation failed') }
      button('Investor relations ↗').click(); check(opened === 'https://abc.xyz/investor/', 'Investor relations link failed')
      button('3M').click(); await settle(); check(button('3M').getAttribute('aria-pressed') === 'true' && calls === 1, 'Chart range changed data requests')
      for (const next of ['partial', 'stale', 'failed']) {
        mode = next; await window.reloadGoogl().catch(() => {}); await settle()
        check(lastRequest.force && text().includes('$127.58B'), 'Refresh outage erased usable financials')
        check(String(client.getQueryState(['googl']).error).includes('HTTP 503'), 'Settings diagnostics lost source error')
      }
      mode = 'success'; await window.reloadGoogl(); await settle()
      check(!client.getQueryState(['googl']).error, 'Recovery did not clear the refresh error')
      host.render(null); await settle(); const before = calls; render(); await settle()
      check(calls === before, 'Revisit repeated initial loading')
      check(!text().includes('Pages ') && !text().includes('Page needs attention'), 'Global diagnostics banner restored')
      window.verifyLayout = fit => {
        const page = document.querySelector('[data-googl-page]')
        check(document.documentElement.scrollWidth <= innerWidth, 'Document has horizontal overflow')
        check(page.scrollWidth <= page.clientWidth + 1, 'Page has horizontal overflow')
        if (fit) check(page.scrollHeight <= page.clientHeight + 1, 'Normal viewport requires vertical scrolling')
        for (const node of document.querySelectorAll('.googl-trend svg, .googl-business, .googl-businesses > .googl-note, .googl-cash-flow, .googl-profit-rows')) {
          const rect = node.getBoundingClientRect(), panel = node.closest('section').getBoundingClientRect()
          check(rect.right <= panel.right + 1 && rect.bottom <= panel.bottom + 1, 'Financial content is clipped')
        }
      }
      return 'PASS: startup warming, hidden pages, quarter/business/range selection, filing links, ticker navigation, retained snapshots, recovery and revisit'
    }
  ` }, bundle: true, jsx: 'automatic', write: false, format: 'iife', loader: { '.css': 'empty' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') }, define: { 'process.env.NODE_ENV': '"production"' } })
  await writeFile(join(scratch, 'renderer.js'), bundle.outputFiles.find(file => file.path.endsWith('.js'))?.text ?? bundle.outputFiles[0].text)
  await writeFile(join(scratch, 'index.html'), '<html><head><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="height:100vh;display:flex"></div><script>window.api = { platform: "win32" };</script><script src="renderer.js"></script></body></html>')
  await writeFile(join(scratch, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron'); const fs = require('fs');
    app.setPath('userData', ${JSON.stringify(join(scratch, 'userData'))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1500, height: 950, webPreferences: { backgroundThrottling: false } });
      try {
        await window.loadFile(${JSON.stringify(join(scratch, 'index.html'))});
        console.log(await window.webContents.executeJavaScript('window.runProbe()'));
        for (const [name, width, height, fit] of [['normal',1500,950,true],['compact',1280,800,true],['narrow',720,850,false]]) {
          window.setSize(width,height); await new Promise(resolve => setTimeout(resolve,250));
          await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
          await new Promise(resolve => setTimeout(resolve,100));
          fs.writeFileSync(${JSON.stringify(join(root, 'out/googl-'))} + name + '.png', (await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
          const layout = await window.webContents.executeJavaScript('try { window.verifyLayout(' + fit + '); "PASS" } catch(e) { e.message }');
          if (layout !== 'PASS') throw Error(name + ': ' + layout);
        }
        console.log('PASS: normal, compact and narrow layouts'); app.exit(0);
      } catch (error) { console.error(error); app.exit(1); }
    });
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: scratch, LOCALAPPDATA: scratch }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(scratch, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(Error('GOOGL UI probe timed out')) }, 45_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
} finally {
  assert(relative(tmpdir(), scratch) && !relative(tmpdir(), scratch).startsWith('..'))
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
