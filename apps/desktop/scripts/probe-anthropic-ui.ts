import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(join(tmpdir(), 'budget-anthropic-ui-'))
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert(css, 'Build the app first')
  await writeFile(join(scratch, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import { createRoot } from 'react-dom/client'
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
    import { AnthropicPage } from './src/pages/AnthropicPage'
    import { anthropicResearch } from './electron/shared/anthropic'
    import { buildTasks } from './src/api/prefetch'
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false } } })
    const settle = () => new Promise(resolve => setTimeout(resolve, 180))
    const check = (value, message) => { if (!value) throw Error(message) }
    let calls = 0, request, opened, fail = false
    window.api.anthropic = async input => {
      calls++; request = input
      const data = anthropicResearch()
      data.announcements = [{ title: 'New research disclosure', date: '2026-11-16', url: 'https://www.anthropic.com/news/research' }]
      data.filings = [{ form: 'S-1/A', filedDate: '2026-11-16', description: 'Registration update', accessionNumber: 'test', documentUrl: data.sources[0].url }]
      data.checks = ['announcements', 'models', 'roadshow', 'safety', 'SEC filings'].map(id => ({ id, checkedAt: Date.now(), changed: false }))
      data.reviewReasons = ['New announcements were published after the research review.']
      return { data, errors: fail ? [{ reason: 'Source unavailable', source: 'fixture', operation: 'check' }] : [], meta: { source: 'fixture', freshness: fail ? 'partial' : 'fresh', fetchedAt: Date.now() } }
    }
    window.api.openExternal = async url => { opened = url }
    const host = createRoot(document.getElementById('root'))
    const render = () => host.render(<QueryClientProvider client={client}><AnthropicPage onStatusChange={() => {}} /></QueryClientProvider>)
    const section = label => [...document.querySelectorAll('.ant-index button')].find(el => el.textContent.includes(label))
    window.checkLayout = async () => {
      check(document.documentElement.scrollWidth <= innerWidth, 'Horizontal document overflow')
      for (const label of ['Business', 'Capital', 'Economics', 'Products', 'Risks', 'Updates']) {
        section(label).click(); await settle()
        if (innerWidth > 900) {
          const page = document.querySelector('[data-anthropic-page]')
          check(page.scrollHeight <= page.clientHeight + 1, 'Page requires vertical scroll: ' + label)
          for (const el of document.querySelectorAll('.ant-research, .ant-evidence, .ant-demand, .ant-adoption, .ant-topic-facts, .ant-feeds')) check(el.getBoundingClientRect().bottom <= innerHeight + 1, 'Panel below viewport: ' + label)
        }
        check(!document.body.innerText.includes('NaN'), 'Invalid number rendered')
      }
      section('Business').click(); await settle()
    }
    window.runProbe = async () => {
      const task = buildTasks(undefined, undefined, { stocks: 'AAPL', fundamentals: 'AAPL' }, { year: 2026, month: 11, earningsYear: 2026, ipoYear: 2026 }).find(task => task.tab === 'anthropic')
      check(task, 'Startup task missing'); await task.run(client, 7)
      check(request.background && request.backgroundOrder === 7, 'Startup priority missing')
      render(); await settle(); check(calls === 1, 'First visit refetched warmed dossier')
      check(document.querySelectorAll('.ant-quarter').length === 7, 'Quarterly chart incomplete')
      document.querySelector('[aria-label="Inspect source for Enterprise adoption"]').click(); await settle()
      check(document.querySelector('.ant-selected-fact').innerText.includes('September 30, 2026'), 'Full evidence detail missing')
      section('Capital').click(); await settle()
      check(document.querySelectorAll('.ant-funding-history button').length === 4, 'Funding history incomplete')
      document.querySelector('[aria-label="Inspect Series G funding source"]').click(); await settle()
      check(document.querySelector('.ant-source-detail').innerText.includes('Series G'), 'Evidence selection failed')
      document.querySelector('.ant-source-detail button').click(); await settle()
      check(opened.includes('380-billion'), 'Source link incorrect')
      section('Updates').click(); await settle()
      check(document.querySelectorAll('.ant-feed-scroll button').length === 2, 'Live evidence feeds missing')
      const refresh = () => [...document.querySelectorAll('button')].find(el => el.textContent === 'Check for updates')
      refresh().click(); await settle(); check(request.force && calls === 2, 'Manual update check did not force refresh')
      fail = true; refresh().click(); await settle()
      check(document.body.innerText.includes('Saved research remains available'), 'Failed check feedback missing')
      check(client.getQueryData(['anthropic', 1]).meta.freshness === 'fresh', 'Incomplete refresh replaced reviewed snapshot')
      fail = false; refresh().click(); await settle()
      check(document.body.innerText.includes('Public sources checked'), 'Refresh recovery failed')
      check(!document.body.innerText.includes('Page needs attention'), 'Global diagnostics banner restored')
      await window.checkLayout()
      const before = calls
      host.render(<QueryClientProvider client={client}><div>Another page</div></QueryClientProvider>); await settle(); render(); await settle()
      check(calls === before, 'Warm revisit refetched')
      return 'PASS: startup warming, research views, chart, funding, source selection, links, update checks, failure recovery and warm revisit'
    }
  ` }, bundle: true, jsx: 'automatic', write: false, format: 'iife', loader: { '.css': 'empty' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') }, define: { 'process.env.NODE_ENV': '"production"' } })
  await writeFile(join(scratch, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(scratch, 'index.html'), '<html><head><meta charset="utf-8"><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="height:100vh;display:flex"></div><script>window.api={platform:"win32"}</script><script src="renderer.js"></script></body></html>')
  await writeFile(join(scratch, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron'), fs = require('fs'), path = require('path')
    app.setPath('userData', ${JSON.stringify(join(scratch, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1920, height: 1080, webPreferences: { backgroundThrottling: false, offscreen: true } })
      try {
        await window.loadFile(${JSON.stringify(join(scratch, 'index.html'))})
        console.log(await window.webContents.executeJavaScript('window.runProbe()'))
        for (const [width,height] of [[1920,1080],[1366,650],[1024,650],[720,850]]) {
          window.setSize(width,height); await new Promise(resolve=>setTimeout(resolve,200))
          await window.webContents.executeJavaScript('window.checkLayout()')
          fs.writeFileSync(path.join(${JSON.stringify(join(root, 'out'))}, 'anthropic-'+width+'.png'), (await window.webContents.capturePage()).toPNG())
        }
        console.log('PASS: 1920, 1366, 1024 and narrow viewport layouts'); app.exit(0)
      } catch(error) { console.error(error); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: scratch, LOCALAPPDATA: scratch }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(scratch, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(Error('Anthropic UI probe timed out')) }, 60_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
} finally {
  const location = relative(tmpdir(), scratch)
  assert(location && !location.startsWith('..'))
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
