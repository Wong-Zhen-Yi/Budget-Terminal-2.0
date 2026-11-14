import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(join(tmpdir(), 'budget-news-ui-'))
try {
  const css = (await readdir(join(root, 'out/renderer/assets'))).find(name => name.endsWith('.css'))
  assert(css, 'Build the renderer before running the UI probe')
  await writeFile(join(scratch, 'theme.css'), await readFile(join(root, 'out/renderer/assets', css)))
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { NewsPage } from './src/pages/NewsPage'
      const check = (value, message) => { if (!value) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 150))
      const button = label => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label)
      let copied = '', failed = false
      window.api.writeClipboard = async text => { if (failed) throw Error('clipboard unavailable'); copied = text }
      window.api.saveText = () => { throw Error('File export must not run') }
      createRoot(document.getElementById('root')).render(<NewsPage onStatusChange={() => {}} />)
      window.runProbe = async () => {
        await settle()
        check(!document.querySelector('aside'), 'Reader must start collapsed')
        document.querySelector('[data-article-id="portfolio"]').click(); await settle()
        check(document.querySelector('aside') && document.body.innerText.includes('Full extracted preview'), 'Reader or preview label missing')
        const rail = document.querySelector('aside').getBoundingClientRect()
        check(rail.width >= 300 && rail.right <= innerWidth, 'Reader exceeds wide viewport')
        window.previewMode = 'fallback'
        document.querySelector('[data-article-id="macro"]').click(); await settle()
        check(document.body.innerText.includes('Summary only'), 'Fallback preview must be labeled summary only')
        window.previewMode = 'failed'
        document.querySelector('[data-article-id="portfolio"]').click(); await settle()
        check(document.body.innerText.includes('Preview unavailable'), 'Failed preview must be labeled unavailable')
        window.previewMode = 'truncated'
        document.querySelector('[data-article-id="macro"]').click(); await settle()
        check(document.body.innerText.includes('Article preview — shortened'), 'Truncated preview must be labeled shortened')
        window.previewMode = 'article'
        document.querySelector('[data-article-id="portfolio"]').click(); await settle()
        document.querySelector('[aria-label="Close the reader"]').click(); await settle()
        check(!document.querySelector('aside'), 'Close must hide the reader')
        button('Reader').click(); await settle()
        check(document.querySelector('aside'), 'Reader toggle must reopen selection')
        button('Copy News for AI').click(); await settle()
        check(copied.includes('Portfolio fixture') && copied.includes('Macro fixture'), 'Default export missing loaded headlines')
        const portfolio = [...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Portfolio ('))
        portfolio.click(); await settle()
        button('Copy News for AI').click(); await settle()
        check(copied.includes('Portfolio fixture') && !copied.includes('Macro fixture'), 'Filtered export ignored category filter')
        const scope = document.querySelector('[aria-label="News export scope"]')
        scope.value = 'all'; scope.dispatchEvent(new Event('change', { bubbles: true })); await settle()
        button('Copy News for AI').click(); await settle()
        check(copied.includes('Macro fixture'), 'All export incorrectly applied category filter')
        failed = true; button('Copy News for AI').click(); await settle()
        check(document.body.innerText.includes('Could not copy news'), 'Clipboard error must be visible')
        failed = false
        return 'PASS: collapsed reader, selection, close/reopen, full preview, scoped clipboard exports and failure feedback'
      }
      window.checkNarrow = async () => {
        await settle()
        const aside = document.querySelector('aside')
        const rect = aside.getBoundingClientRect()
        check(rect.left >= 0 && rect.right <= innerWidth && rect.width > innerWidth - 50, 'Narrow reader must fill available content')
        check(document.documentElement.scrollWidth <= innerWidth, 'Narrow layout overflows')
        document.querySelector('[aria-label="Close the reader"]').click(); await settle()
        check(!document.querySelector('aside'), 'Narrow reader cannot close')
        return 'PASS: narrow reader bounds and close'
      }
    ` },
    bundle: true, jsx: 'automatic', write: false, format: 'iife',
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'news-fixtures', setup(builder) {
      builder.onResolve({ filter: /api\/(newsQueries|queries|agentComposer)$/ }, args => ({ path: args.path.split('/').at(-1)!, namespace: 'fixtures' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixtures' }, args => ({ loader: 'js', contents: args.path === 'queries' ? `
        export const usePortfolio = () => ({ data: { data: { portfolios: [{ tickers: ['AAPL'] }] } } })
        export const useQuotes = () => ({})
      ` : args.path === 'agentComposer' ? `export const useAgentComposer = () => ({ chatAvailable: false })` : `
        const article = (id, category, title) => ({ id, category, title, ticker: 'AAPL', source: 'Fixture', url: 'https://example.com/' + id, summary: 'Fixture summary', publishedAt: Date.now(), time: 'Today', score: null, signals: [] })
        export const useNewsPage = () => ({ data: { data: { articles: [article('portfolio', 'portfolio', 'Portfolio fixture'), article('macro', 'macro', 'Macro fixture')] }, meta: { freshness: 'fresh' } } })
        export const useNewsTickerSearch = () => ({})
        export const useNewsThumbnail = () => ({})
        export const useNewsPreview = () => ({ isError: window.previewMode === 'failed', data: { data: { text: window.previewMode === 'failed' ? '' : 'Extracted fixture body', origin: window.previewMode === 'fallback' ? 'fallback' : 'article', truncated: window.previewMode === 'truncated' }, meta: { freshness: 'fresh' } } })
      ` }))
    } }],
  })
  await writeFile(join(scratch, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(scratch, 'index.html'), '<html><head><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="height:100vh;display:flex"></div><script>window.api = {};</script><script src="renderer.js"></script></body></html>')
  await writeFile(join(scratch, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron');
    app.setPath('userData', ${JSON.stringify(join(scratch, 'userData'))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { offscreen: true, backgroundThrottling: false } });
      try {
        await window.loadFile(${JSON.stringify(join(scratch, 'index.html'))});
        console.log(await window.webContents.executeJavaScript('window.runProbe()'));
        window.setSize(700, 850);
        await new Promise(resolve => setTimeout(resolve, 300));
        console.log(await window.webContents.executeJavaScript('window.checkNarrow()'));
        app.exit(0);
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
    const timeout = setTimeout(() => { child.kill(); reject(Error('News UI probe timed out')) }, 30_000)
    child.on('error', error => { clearTimeout(timeout); reject(error) })
    child.on('exit', code => { clearTimeout(timeout); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
} finally {
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
