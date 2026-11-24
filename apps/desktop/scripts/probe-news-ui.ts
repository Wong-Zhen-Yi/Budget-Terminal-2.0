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
  await writeFile(join(scratch, 'theme.css'), [
    await readFile(join(root, 'out/renderer/assets', css), 'utf8'),
    await readFile(join(root, 'src/mobile/mobile.css'), 'utf8'),
    await readFile(join(root, 'src/mobile/portrait.css'), 'utf8'),
  ].join('\n'))
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { NewsPage } from './src/pages/NewsPage'
      import { NewsLitePage } from './src/pages/NewsLitePage'
      const check = (value, message) => { if (!value) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 150))
      const button = label => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label)
      let copied = '', failed = false
      window.api.writeClipboard = async text => { if (failed) throw Error('clipboard unavailable'); copied = text }
      window.api.saveText = () => { throw Error('File export must not run') }
      const Page = window.newsLite ? NewsLitePage : NewsPage
      createRoot(document.getElementById('root')).render(<Page onStatusChange={() => {}} />)
      window.runProbe = async () => {
        await settle()
        check(!button('Filters & tools'), 'Desktop must keep the full toolbar visible')
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
      window.runMobileProbe = async () => {
        await settle()
        const disclosure = button('Filters & tools')
        const feedFilter = document.querySelector('[aria-label="Filter the news feed"]')
        const tickerSearch = document.querySelector('[aria-label="Search news for tickers outside the portfolio"]')
        const portfolio = [...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Portfolio ('))
        const article = () => document.querySelector('[data-article-id="portfolio"]')
        const visible = element => element?.getClientRects().length > 0
        const setInput = (input, value) => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
          input.dispatchEvent(new Event('input', { bubbles: true }))
        }
        const sharedToolbar = document.createElement('div')
        sharedToolbar.className = 'flex flex-wrap items-center gap-1'
        sharedToolbar.innerHTML = '<h1>Research</h1><div class="mobile-tab-strip contents gap-1"><button>Charts</button><button>Fundamentals</button><button>Investor relations</button></div><button>Tools</button>'
        document.getElementById('root').append(sharedToolbar)
        sharedToolbar.style.cssText = 'position:fixed;left:8px;right:8px;top:0'
        const [title, strip, tools] = sharedToolbar.children
        check(Math.abs(title.getBoundingClientRect().top + title.getBoundingClientRect().height / 2 - tools.getBoundingClientRect().top - tools.getBoundingClientRect().height / 2) < 2,
          'Shared mobile tab groups must stay beside the title and tools')
        check(strip.getBoundingClientRect().right <= tools.getBoundingClientRect().left,
          'Shared mobile tab groups must leave room for tools')
        sharedToolbar.remove()
        check(disclosure?.getAttribute('aria-expanded') === 'false' && !visible(feedFilter) && !visible(tickerSearch),
          'Mobile News must start with both control groups collapsed')
        const primary = document.querySelector('.news-toolbar-primary')
        const tabs = document.querySelector('.news-toolbar-filters')
        const heading = primary.querySelector('h1')
        const bounds = element => element.getBoundingClientRect()
        check(Math.abs(bounds(heading).top + bounds(heading).height / 2 - bounds(disclosure).top - bounds(disclosure).height / 2) < 2,
          'Mobile title and tools must share one line')
        check(bounds(tabs).left >= bounds(heading).right && bounds(tabs).right <= bounds(disclosure).left,
          'Category tabs must sit between the title and tools on the same row')
        check(bounds(primary).height <= 44 && bounds(primary).right <= innerWidth,
          'Mobile primary toolbar must fit in one row: ' + JSON.stringify({ width: innerWidth, primary: bounds(primary).toJSON(), tabs: bounds(tabs).toJSON() }))
        portfolio.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        portfolio.click(); await settle()
        check(visible(portfolio) && visible(article()), 'Category filters and articles must be usable while collapsed')
        const articleTop = article().getBoundingClientRect().top
        disclosure.click(); await settle()
        check(disclosure.getAttribute('aria-expanded') === 'true' && visible(feedFilter) && visible(tickerSearch),
          'Expanding must expose both control groups')
        check(article().getBoundingClientRect().top > articleTop, 'Collapsing must reclaim vertical space for the articles')
        setInput(feedFilter, 'Portfolio fixture')
        setInput(tickerSearch, 'NVDA')
        disclosure.click(); await settle()
        check(!visible(feedFilter) && !visible(tickerSearch) && visible(article()), 'Collapsing must preserve the filtered feed')
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' })); await settle()
        check(document.activeElement === feedFilter && feedFilter.value === 'Portfolio fixture' && tickerSearch.value === 'NVDA',
          'The filter shortcut must reopen and focus the controls without losing drafts')
        disclosure.click(); await settle()
        article().click(); await settle()
        check(document.querySelector('aside')?.innerText.includes('Extracted fixture body'), 'Reader must open with the controls collapsed')
        check(document.documentElement.scrollWidth <= innerWidth, 'Mobile News must fit horizontally')
        return 'PASS: mobile News disclosure reclaims article space, retains drafts, and supports keyboard and reader access'
      }
      window.runLiteProbe = async () => {
        await settle()
        const find = selector => document.querySelector(selector)
        const rows = () => [...document.querySelectorAll('.news-lite-story')]
        const save = () => find('.news-lite-reader [aria-label="Save story"]')
        const view = label => [...document.querySelectorAll('.news-lite-toolbar nav button')].find(b => b.textContent.startsWith(label))
        const search = async value => {
          const input = find('.news-lite-search input')
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
          input.dispatchEvent(new Event('input', { bubbles: true }))
          await settle()
        }
        check(rows().length === 2 && find('.news-lite-reader').innerText.includes('2 reports'), 'Matching headlines must be grouped')
        check(!window.previewReads, 'News Lite must defer article previews until requested')
        document.querySelectorAll('.news-lite-source-toggle')[1].click(); await settle()
        check(find('.news-lite-source-preview').innerText.includes('Extracted fixture body') && window.previewReads.endsWith('/second'),
          'Opening a source must load its own preview')
        save().click(); await settle()
        view('Saved').click(); await settle()
        check(rows().length === 1 && save().getAttribute('aria-pressed') === 'true', 'Saved view must show the saved story')
        button('Mark read').click(); await settle()
        button('Unread only').click(); await settle()
        check(rows().length === 0, 'Read stories must be omitted by the unread filter')
        button('Show all news').click(); await settle()
        check(rows().length === 2, 'Clearing filters must restore the feed')
        find('.news-lite-tickers button').click(); await settle()
        await search('Second publisher')
        check(rows().length === 1 && rows()[0].textContent.includes('Portfolio fixture'), 'Search must match publisher and ticker')
        button('Copy digest').click(); await settle()
        check(copied.includes('Portfolio fixture') && copied.includes('Second publisher') && !copied.includes('Macro fixture'),
          'Digest must include matching reports and respect filters')
        await search('NVDA')
        find('.news-lite-search').requestSubmit(); await settle()
        check(rows().length === 1 && rows()[0].textContent.includes('Outside holding fixture'), 'Ticker lookup must search outside holdings')
        check(find('.news-lite').scrollWidth <= find('.news-lite').clientWidth, 'Desktop News Lite must fit horizontally')
        return 'PASS: News Lite grouping, source previews, saved and unread, text and ticker search, and digest'
      }
      window.checkLiteNarrow = async () => {
        await settle()
        const reader = document.querySelector('.news-lite-reader')
        const feed = document.querySelector('.news-lite-feed')
        const visible = element => element.getClientRects().length > 0
        check(visible(feed) && !visible(reader), 'Narrow News Lite must start in the feed')
        const savedView = [...document.querySelectorAll('.news-lite-toolbar nav button')].find(b => b.textContent.startsWith('Saved'))
        savedView.click(); await settle()
        const story = document.querySelector('.news-lite-story')
        check(story?.textContent.includes('Portfolio fixture'), 'Saved stories must survive reload and provider rollover')
        story.click(); await settle()
        const back = document.querySelector('.news-lite-back')
        check(!visible(feed) && visible(reader) && document.activeElement === back && button('Mark unread'), 'Narrow reader must open with saved read state and focus')
        back.click(); await settle()
        check(visible(feed) && !visible(reader) && document.activeElement === story, 'Returning must restore the headline focus')
        check(document.documentElement.scrollWidth <= innerWidth, 'Narrow News Lite must fit horizontally')
        return 'PASS: saved News Lite stories survive feed rollover and narrow reader restores focus'
      }
    ` },
    bundle: true, jsx: 'automatic', write: false, format: 'iife', loader: { '.css': 'empty' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'news-fixtures', setup(builder) {
      builder.onResolve({ filter: /api\/(newsQueries|queries|agentComposer)$/ }, args => ({ path: args.path.split('/').at(-1)!, namespace: 'fixtures' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixtures' }, args => ({ loader: 'js', contents: args.path === 'queries' ? `
        export const usePortfolio = () => ({ data: { data: { portfolios: [{ tickers: ['AAPL'] }] } } })
        export const useQuotes = () => ({})
      ` : args.path === 'agentComposer' ? `export const useAgentComposer = () => ({ chatAvailable: false })` : `
        const article = (id, category, title, ticker = 'AAPL', source = 'Fixture') => ({ id, category, title, ticker, source, url: 'https://example.com/' + id, summary: 'Fixture summary', publishedAt: Date.UTC(2026, 0, 1, 12), time: 'Today', score: null, signals: [] })
        const portfolio = article('portfolio', 'portfolio', 'Portfolio fixture')
        const macro = article('macro', 'macro', 'Macro fixture', 'SPY')
        const second = article('second', 'other', 'Portfolio fixture', 'AAPL', 'Second publisher')
        export const useNewsPage = () => ({ data: { data: { articles: window.newsLite
          ? (location.search ? [macro] : [portfolio, second, macro]) : [portfolio, macro] }, meta: { freshness: 'fresh' } } })
        export const useNewsTickerSearch = tickers => window.newsLite && tickers.includes('NVDA')
          ? { data: { data: { articles: [article('ticker', 'search', 'Outside holding fixture', 'NVDA')] } } }
          : ({})
        export const useNewsThumbnail = () => ({})
        export const useNewsPreview = article => {
          if (article?.url) window.previewReads = article.url
          return { isError: window.previewMode === 'failed', data: { data: { text: window.previewMode === 'failed' ? '' : 'Extracted fixture body', origin: window.previewMode === 'fallback' ? 'fallback' : 'article', truncated: window.previewMode === 'truncated' }, meta: { freshness: 'fresh' } } }
        }
      ` }))
    } }],
  })
  await writeFile(join(scratch, 'renderer.js'), bundle.outputFiles[0].text)
  const html = '<html><head><link rel="stylesheet" href="theme.css"></head><body><div id="root" data-page-id="news" style="height:100vh;display:flex"></div><script>window.api = {}; LITE</script><script src="renderer.js"></script></body></html>'
  await writeFile(join(scratch, 'index.html'), html.replace('LITE', ''))
  await writeFile(join(scratch, 'lite.html'), html.replace('LITE', 'window.newsLite = true;'))
  await writeFile(join(scratch, 'mobile.html'), html.replace('<html>', '<html data-terminal-mobile>').replace('LITE', ''))
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
        window.setSize(404, 850);
        await window.loadFile(${JSON.stringify(join(scratch, 'mobile.html'))});
        console.log(await window.webContents.executeJavaScript('window.runMobileProbe()'));
        for (const width of [320, 390, 440, 844]) {
          window.setSize(width, width === 844 ? 390 : 850);
          await window.loadFile(${JSON.stringify(join(scratch, 'mobile.html'))});
          console.log('Width ' + width + ': ' + await window.webContents.executeJavaScript('window.runMobileProbe()'));
        }
        window.setSize(1400, 900);
        await window.loadFile(${JSON.stringify(join(scratch, 'lite.html'))});
        console.log(await window.webContents.executeJavaScript('window.runLiteProbe()'));
        window.setSize(620, 850);
        await window.loadFile(${JSON.stringify(join(scratch, 'lite.html'))}, { query: { rolled: '1' } });
        await new Promise(resolve => setTimeout(resolve, 300));
        console.log(await window.webContents.executeJavaScript('window.checkLiteNarrow()'));
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
