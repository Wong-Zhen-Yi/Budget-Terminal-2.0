import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Render the actual page in isolated Electron, following probe-navigation's harness.
const require = createRequire(import.meta.url)
const directory = await mkdtemp(join(tmpdir(), 'budget-money-ui-'))
try {
  const bundle = await build({
    stdin: {
      resolveDir: resolve(import.meta.dirname, '..'),
      loader: 'tsx',
      contents: `
        import { createRoot } from 'react-dom/client'
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
        import { MoneyPage } from './src/pages/MoneyPage'
        import { MONEY_SERIES } from './electron/shared/money'
        import { useReloadAll } from './src/api/queries'
        const check = (value, message) => { if (!value) throw Error(message) }
        const settle = () => new Promise(resolve => setTimeout(resolve, 120))
        let mode = 'fresh'
        const calls = []
        let reload
        const history = Array.from({length: 133}, (_, i) => [new Date(Date.UTC(2015, i, 1)).toISOString().slice(0, 10), 1000 + i * 10])
        const payload = () => ({ data: { generatedAt: new Date().toISOString(), rows: MONEY_SERIES.map(d => ({...d, history: mode === 'unavailable' ? [] : history, fetchedAt: Date.now(), status: mode, error: mode === 'fresh' ? null : 'Fixture outage'})) }, meta: {source: 'FRED', fetchedAt: Date.now(), freshness: mode === 'unavailable' ? 'failed' : mode === 'stale' ? 'partial' : 'fresh'}, errors: [] })
        window.api.money = async request => { calls.push(request); return payload() }
        function Shell() { reload = useReloadAll(); return <MoneyPage onStatusChange={() => {}} /> }
        const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
        const choose = async (label, value) => {
          const select = document.querySelector('select[aria-label="' + label + '"]')
          select.value = value
          select.dispatchEvent(new Event('change', {bubbles: true}))
          await settle()
        }
        const click = async text => {
          const button = [...document.querySelectorAll('button')].find(b => b.textContent === text)
          check(button, 'Missing button ' + text)
          button.click(); await settle()
        }
        window.runProbe = async () => {
          createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><Shell /></QueryClientProvider>)
          await settle()
          check(document.querySelector('h1').textContent === 'Money', 'Page title')
          check(document.querySelectorAll('tbody tr').length === 7, 'All indicators')
          check(document.querySelectorAll('svg').length === 7, 'All seven history charts')
          check(document.querySelector('select[aria-label="History range"]').value === '5', 'Default 5Y')
          check(document.querySelector('[aria-pressed="true"]').textContent === 'M1 money supply', 'Default M1 explorer')
          check(document.body.textContent.includes('May 2020'), 'M1 definition change')
          for (const years of ['1', '3', '5', '10']) {
            await choose('History range', years)
            window.checkLayout()
          }
          await choose('M2 growth measure', '1')
          check(document.body.textContent.includes('MoM growth'), 'MoM selection')
          await click('Treasury General Account')
          check(document.querySelector('[aria-pressed="true"]').textContent === 'Treasury General Account', 'Explorer selection')
          await click('Refresh'); check(calls.at(-1).force === false, 'Normal refresh')
          await click('Force refresh'); check(calls.at(-1).force === true, 'Force refresh')
          await reload(); check(calls.at(-1).force === true, 'F5 reload hook forces Money')
          mode = 'stale'; await click('Force refresh')
          check(document.body.textContent.includes('stale') && document.querySelectorAll('svg').length === 7, 'Stale charts retained')
          mode = 'unavailable'; await click('Force refresh')
          check(document.body.textContent.includes('Observations unavailable'), 'Unavailable state')
          mode = 'fresh'; await click('Force refresh')
          check(document.querySelectorAll('svg').length === 7, 'Refresh recovery')
          return 'PASS: Money rendering, defaults, selectors, refresh, F5 hook, stale and unavailable recovery'
        }
        window.checkLayout = () => {
          check(document.documentElement.scrollWidth <= window.innerWidth, 'Page overflows horizontally')
          for (const section of document.querySelectorAll('section')) check(section.getBoundingClientRect().height >= 70, 'Collapsed panel')
          for (const svg of document.querySelectorAll('svg')) {
            const labels = [...svg.querySelectorAll('text[data-axis="x"]')]
            check(labels.length >= 2, 'Chart needs endpoint dates')
            check(labels.at(-1).textContent === history.at(-1)[0], 'Axis must include latest observation')
            const bounds = svg.getBoundingClientRect()
            let previousRight = bounds.left
            for (const label of labels) {
              const rect = label.getBoundingClientRect()
              check(rect.left >= previousRight, 'Overlapping X-axis labels')
              check(rect.right <= bounds.right && rect.bottom <= bounds.bottom, 'Clipped X-axis label')
              previousRight = rect.right + 8
            }
            const path = svg.querySelector('path')
            const start = path.getPointAtLength(0)
            const end = path.getPointAtLength(path.getTotalLength())
            check(Math.abs(Number(labels[0].getAttribute('x')) - start.x) < 1, 'First date alignment')
            check(Math.abs(Number(labels.at(-1).getAttribute('x')) - end.x) < 1, 'Last date alignment')
          }
          return 'PASS: responsive layout at ' + window.innerWidth
        }
      `,
    },
    bundle: true,
    jsx: 'automatic',
    write: false,
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@': resolve(import.meta.dirname, '../src'), '@shared': resolve(import.meta.dirname, '../electron/shared') },
  })
  const assets = resolve(import.meta.dirname, '../out/renderer/assets')
  const css = (await readdir(assets)).find((file) => file.endsWith('.css'))!
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), '<link rel="stylesheet" href="theme.css"><style>html,body,#root{height:100%;margin:0}#root{display:flex}</style><div id="root"></div><script>window.api={}</script><script src="renderer.js"></script>')
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    const { writeFileSync } = require('node:fs')
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { backgroundThrottling: false } })
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        console.log(await window.webContents.executeJavaScript('window.runProbe()'))
        console.log(await window.webContents.executeJavaScript('window.checkLayout()'))
        writeFileSync(${JSON.stringify(join(directory, 'money-wide.png'))}, (await window.webContents.capturePage()).toPNG())
        window.setSize(640, 900)
        await new Promise(resolve => setTimeout(resolve, 250))
        console.log(await window.webContents.executeJavaScript('window.checkLayout()'))
        await window.webContents.executeJavaScript("document.querySelector('svg').closest('section').scrollIntoView()")
        writeFileSync(${JSON.stringify(join(directory, 'money-narrow.png'))}, (await window.webContents.capturePage()).toPNG())
        window.setSize(360, 800)
        await new Promise(resolve => setTimeout(resolve, 250))
        console.log(await window.webContents.executeJavaScript('window.checkLayout()'))
        await window.webContents.executeJavaScript("document.querySelector('svg').closest('section').scrollIntoView()")
        writeFileSync(${JSON.stringify(join(directory, 'money-small.png'))}, (await window.webContents.capturePage()).toPNG())
        app.exit(0)
      } catch (error) { console.error(error); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const output = await new Promise<{ code: number | null; text: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let text = ''
    child.stdout.on('data', (chunk) => { text += chunk })
    child.stderr.on('data', (chunk) => { text += chunk })
    const timer = setTimeout(() => { child.kill(); reject(Error('Money UI probe timed out')) }, 30_000)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('exit', (code) => { clearTimeout(timer); resolveRun({ code, text }) })
  })
  assert.equal(output.code, 0, output.text)
  console.log(output.text.trim())
  if (process.argv.includes('--keep')) console.log(`Screenshots: ${directory}`)
} finally {
  if (!process.argv.includes('--keep')) {
    assert(directory.startsWith(join(tmpdir(), 'budget-money-ui-')))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
