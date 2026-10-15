import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'



// Exercise the actual page host in Chromium with synthetic data and isolated storage.
const require = createRequire(import.meta.url)
const directory = await mkdtemp(join(tmpdir(), 'budget-articles-ui-'))
try {
  const bundle = await build({
    stdin: {
      resolveDir: resolve(import.meta.dirname, '..'),
      loader: 'tsx',
      contents: `
        import React from 'react'
        import { createRoot } from 'react-dom/client'
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
        let data = { articles: [], sourcePath: 'fixture/articles.json' }
        const envelope = () => ({ data: structuredClone(data), meta: { source: 'fixture', freshness: 'fresh', fetchedAt: Date.now() }, errors: [] })
        window.api = {
          articles: async () => envelope(),
          mutateArticles: async request => {
            if (request.type === 'add') data.articles.unshift({ ...request, id: 'test', revision: 1, createdAt: Date.now(), updatedAt: Date.now() })
            if (request.type === 'remove') data.articles = []
            if (request.type === 'update') data.articles[0] = { ...data.articles[0], ...request, revision: request.revision + 1 }
            return envelope()
          },
          writeClipboard: async () => true,
          exportArticlesPdf: async request => {
            window.exportedRequest = request
            window.exportedArticle = request.articles[0]
            if (window.exportOutcome === 'error') throw Error('Export write failed')
            const cancelled = window.exportOutcome === 'cancel'
            return { data: { cancelled, paths: cancelled ? [] : ['exports/article.pdf'], failures: window.exportOutcome === 'partial' ? [{ title: 'Library article 39', message: 'Disk full' }] : [] } }
          },
          openExternal: async url => { window.openedUrl = url; return true },
        }
        const check = (condition, message) => { if (!condition) throw Error(message) }
        const settle = () => new Promise(resolve => setTimeout(resolve, 100))
        const click = async text => {
          const button = [...document.querySelectorAll('button')].find(b => b.textContent === text)
          check(button && !button.disabled, 'Missing or disabled button: ' + text)
          button.click(); await settle()
        }
        const fill = async (label, value) => {
          const field = [...document.querySelectorAll('label')].find(l => l.childNodes[0].textContent === label).querySelector('input, textarea')
          Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(field, value)
          field.dispatchEvent(new Event('input', { bubbles: true })); await settle()
        }
        window.runProbe = async () => {
          const { ArticlesPage } = await import('./src/pages/ArticlesPage')
          const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
          createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><ArticlesPage onStatusChange={() => {}} /></QueryClientProvider>)
          await settle()
          check(document.body.textContent.includes('A home for your ideas'), 'Missing empty state')
          check([...document.querySelectorAll('button')].find(button => button.textContent === 'Export all Articles').disabled, 'Empty library can be exported')
          await click('New article')
          await fill('Title', 'A saved article')
          await fill('Topic', 'AI')
          await fill('Article', 'Demand grows. <script>window.injected = true</script>')
          await click('Save article')
          check(data.articles.length === 1 && data.articles[0].title === 'A saved article', 'Article not saved')
          await click('Read article')
          check(document.querySelector('article').textContent.includes('Demand grows.'), 'Reader missing content')
          check(!window.injected, 'Content executed HTML')
          await click('Export article')
          check(!window.exportedRequest.all && window.exportedArticle.title === 'A saved article' && window.exportedArticle.html.includes('AI') && window.exportedArticle.html.includes('&lt;script&gt;'), 'PDF export omitted metadata or safe source text')
          check(document.body.textContent.includes('Article exported to exports/article.pdf'), 'Export success not visible')
          window.exportOutcome = 'cancel'
          await click('Export article')
          check(document.body.textContent.includes('Export cancelled.'), 'Cancelled export reported success')
          window.exportOutcome = 'error'
          await click('Export article')
          check(document.body.textContent.includes('Export write failed'), 'Export failure not visible')
          window.exportOutcome = undefined
          await click('Edit article')
          await fill('Title', 'Unsaved edit')
          await click('Export article')
          check(window.exportedArticle.title === 'Unsaved edit' && data.articles[0].title === 'A saved article', 'Export did not capture draft independently of saving')
          await click('Export all Articles')
          check(window.exportedRequest.all && window.exportedArticle.title === 'A saved article', 'Bulk export changed a saved article to the unsaved draft')
          await click('New article')
          check(document.body.textContent.includes('You have unsaved changes'), 'Unsaved draft not protected')
          await click('Keep editing')
          await click('Save article')
          check(data.articles[0].title === 'Unsaved edit', 'Updated draft lost')
          // Simulate an AI write and the same cache refresh used by the app event bridge.
          data.articles[0] = { ...data.articles[0], title: 'AI revision', revision: 3 }
          await client.invalidateQueries({ queryKey: ['articles'] }); await settle()
          check(document.querySelector('input[placeholder="Article title"]').value === 'AI revision', 'AI edit did not refresh clean editor')
          await click('Delete')
          await click('Confirm delete')
          check(data.articles.length === 0, 'Delete did not persist')
          const { appZetaVisuals } = await import('./scripts/fixtures/app-zeta-visuals')
          const fence = String.fromCharCode(96).repeat(3)
          const visualText = appZetaVisuals.map(visual => fence + 'article-visual\\n' + JSON.stringify(visual, null, 2) + '\\n' + fence).join('\\n\\n')
          const longContent = '# Long article\\n\\nQ2 2026 financial comparison: APP vs ZETA.\\n\\n' + visualText + '\\n\\n' + Array.from({ length: 60 }, (_, i) => (i + 1) + '. Section ' + i + '\\n\\n' + 'Long article body with useful detail. '.repeat(16)).join('\\n\\n') + '\\n\\n[Official source](https://example.com/research)\\n\\n<script>window.injected = true</script>\\n\\nEND OF SAVED CONTENT'
          data.articles = Array.from({ length: 40 }, (_, i) => ({ id: 'long-' + i, title: i ? 'Library article ' + i : 'Long article', topic: 'Research', content: longContent, status: i === 39 ? 'draft' : 'finished', revision: 1, createdAt: Date.now(), updatedAt: Date.now() - i }))
          const original = JSON.stringify(data.articles)
          await client.invalidateQueries({ queryKey: ['articles'] }); await settle()
          check(document.querySelector('article h2').textContent === 'Long article', 'Saved library did not open in reading mode')
          check(document.querySelectorAll('.article-visual').length === 5, 'Saved visual blocks did not render')
          await click('Export article')
          const html = new DOMParser().parseFromString(window.exportedArticle.html, 'text/html')
          check(html.querySelectorAll('.article-visual').length === 5 && html.body.textContent.includes('END OF SAVED CONTENT') && html.querySelector('a[href="https://example.com/research"]'), 'PDF export lost charts, sources or the article ending')
          check(!html.querySelector('script') && !html.body.textContent.includes('article-visual\\n'), 'PDF export contains executable HTML or raw chart definitions')
          window.pdfFixture = window.exportedArticle
          const search = document.querySelector('[aria-label="Search articles"]')
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'Library article 39')
          search.dispatchEvent(new Event('input', { bubbles: true })); await settle()
          check(document.querySelectorAll('.articles-card').length === 1, 'Bulk export filter fixture did not filter')
          await click('Export all Articles')
          check(window.exportedRequest.all && window.exportedRequest.articles.length === 40 && window.exportedRequest.articles[39].html.includes('Status: draft'), 'Bulk export omitted filtered articles or saved drafts')
          window.exportOutcome = 'partial'
          await click('Export all Articles')
          check(document.body.textContent.includes('Exported 1 of 2 PDFs.') && document.body.textContent.includes('Disk full'), 'Partial bulk export was reported as complete')
          window.exportOutcome = undefined
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, '')
          search.dispatchEvent(new Event('input', { bubbles: true })); await settle()
          check(!document.querySelector('.article-visual-error'), 'Valid financial visual failed validation')
          const appBar = document.querySelector('rect[data-value="1923.7"]')
          const zetaBar = document.querySelector('rect[data-value="442.8"]')
          check(Math.abs(Number(appBar.getAttribute('width')) / Number(zetaBar.getAttribute('width')) - 1923.7 / 442.8) < 0.001, 'Financial bar lengths do not match reviewed data')
          check(document.querySelector('.article-matrix').textContent.includes('-10%'), 'Sensitivity formula did not show the article example')
          const { articleBlocks, articlePages } = await import('./src/components/articles/ArticleContent')
          const parsedBlocks = articleBlocks(longContent, 'Long article')
          check(articlePages(parsedBlocks).flat().map(block => block.text).join('') === parsedBlocks.map(block => block.text).join(''), 'Pagination lost or reordered content')
          const sheets = document.querySelectorAll('.articles-sheet')
          check(sheets.length > 2, 'Dual page layout did not paginate long content')
          const firstSheet = sheets[0].getBoundingClientRect()
          const secondSheet = sheets[1].getBoundingClientRect()
          check(Math.abs(firstSheet.top - secondSheet.top) < 2 && secondSheet.left > firstSheet.right, 'Dual page sheets are not side by side')
          await click('Single page')
          check(document.querySelectorAll('.articles-sheet').length === 1, 'Single page toggle did not restore continuous reading')
          await click('Dual page')
          check(document.querySelectorAll('.article-visual').length === 5, 'Layout switching lost visuals')
          const reader = document.querySelector('[aria-label="Article reader"]')
          const library = document.querySelector('[aria-label="Saved articles"]')
          check(reader.clientHeight > 150 && reader.scrollHeight > reader.clientHeight * 3, 'Long article has no bounded scrollport')
          check(library.scrollHeight > library.clientHeight && library.clientHeight > 0, 'Library cannot scroll independently')
          check(document.body.scrollHeight <= window.innerHeight, 'Article expanded the application outside the viewport')
          reader.scrollTop = reader.scrollHeight; await settle()
          const end = document.querySelector('.articles-end').getBoundingClientRect()
          const bounds = reader.getBoundingClientRect()
          check(reader.scrollTop > 0 && end.top >= bounds.top && end.bottom <= bounds.bottom, 'Cannot reach end of long article')
          await click('Back to top ↑')
          check(reader.scrollTop === 0, 'Back to top failed')
          const sectionSelect = document.querySelector('[aria-label="Article sections"] select')
          sectionSelect.value = sectionSelect.options[30].value
          sectionSelect.dispatchEvent(new Event('change', { bubbles: true })); await settle()
          check(reader.scrollTop > 0, 'Section navigation did not scroll the reader')
          const source = document.querySelector('article a[href="https://example.com/research"]')
          source.click(); await settle()
          check(window.openedUrl === 'https://example.com/research', 'Source link did not use the application API')
          check(!window.injected, 'Reader executed article HTML')
          await click('Larger text')
          check(document.querySelector('article').classList.contains('articles-large-text'), 'Reader text size did not change')
          // Collapse using the main toolbar, not the library's separate Hide button.
          await click('Hide library')
          check(getComputedStyle(document.querySelector('.articles-library')).display === 'none', 'Focus reading did not hide library')
          await click('Show library')
          await click('Edit article')
          const editor = document.querySelector('[aria-label="Article editor"]')
          const textarea = document.querySelector('textarea')
          check(textarea.value === longContent, 'Reading reformatted the persisted source text')
          textarea.scrollTop = textarea.scrollHeight
          check(textarea.scrollTop > 0, 'Long editor text cannot scroll')
          editor.scrollTop = editor.scrollHeight; await settle()
          const brief = [...document.querySelectorAll('button')].find(b => b.textContent === 'Copy AI writing brief').getBoundingClientRect()
          check(brief.bottom <= editor.getBoundingClientRect().bottom, 'Cannot reach editor actions')
          await click('Read article')
          check(JSON.stringify(data.articles) === original, 'Reading or UI controls mutated saved articles')
          window.verifyNarrow = async () => {
            await settle()
            await click('Hide library')
            const viewport = document.querySelector('[aria-label="Article reader"]')
            check(viewport.clientHeight > 100, 'Narrow layout has no reader height')
            check(document.body.scrollWidth <= window.innerWidth, 'Narrow layout overflows horizontally')
            const pages = document.querySelectorAll('.articles-sheet')
            check(pages[1].getBoundingClientRect().top >= pages[0].getBoundingClientRect().bottom, 'Narrow dual pages did not stack in reading order')
            check([...document.querySelectorAll('.article-visual')].every(visual => visual.scrollWidth <= visual.clientWidth + 1), 'Visuals overflow narrow pages')
            viewport.scrollTop = viewport.scrollHeight; await settle()
            const end = document.querySelector('.articles-end').getBoundingClientRect()
            check(end.bottom <= viewport.getBoundingClientRect().bottom, 'Narrow layout cannot reach article end')
            check(JSON.stringify(data.articles) === original, 'Resizing changed saved articles')
            await click('Back to top ↑')
            return 'PASS: narrow reader and saved content preservation'
          }
          window.prepareChartScreenshot = async () => {
            const reader = document.querySelector('.articles-viewport')
            const chart = document.querySelector('figure[aria-label="Financial scale: APP vs ZETA"]')
            reader.scrollTop = chart.getBoundingClientRect().top - reader.getBoundingClientRect().top + reader.scrollTop - 20
            await settle()
          }
          return 'PASS: Articles CRUD, safe formatting, unsaved guard, AI refresh, scrolling, source-backed charts, sensitivity, dual/single pages and content preservation'
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
  for (const file of bundle.outputFiles) await writeFile(file.path, file.text)
  await build({ entryPoints: [resolve(import.meta.dirname, '../electron/services/articlePdf.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: join(directory, 'pdf-service.cjs') })
  await writeFile(join(directory, 'index.html'), '<style>html,body{height:100%;margin:0;overflow:hidden;font-family:Segoe UI,sans-serif}#root{height:100%;display:flex;flex-direction:column}*{box-sizing:border-box}</style><link rel="stylesheet" href="renderer.css"><div id="root"></div><script src="renderer.js"></script>')
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { backgroundThrottling: false, offscreen: true } })
      window.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message) })
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        console.log(await window.webContents.executeJavaScript('window.runProbe()'))
        const { writeArticlePdfs, articlePdfRequestSchema } = require('./pdf-service.cjs')
        const fs = require('node:fs/promises')
        const folder = ${JSON.stringify(directory)}
        const fixture = await window.webContents.executeJavaScript('window.pdfFixture')
        if (articlePdfRequestSchema.safeParse({ all: true, articles: [] }).success) throw Error('Empty PDF request accepted')
        await fs.writeFile(require('node:path').join(folder, 'Long article.pdf'), 'Existing PDF')
        const request = { all: true, articles: [fixture, fixture, { title: 'CON', html: '<!doctype html><html><head><title>Safe filename</title></head><body>Another article</body></html>' }] }
        const result = await writeArticlePdfs(request, folder)
        if (result.paths.length !== 3 || result.failures.length || !result.paths[0].endsWith('Long article (2).pdf') || !result.paths[1].endsWith('Long article (3).pdf') || !result.paths[2].endsWith('article-CON.pdf')) throw Error('Individual PDF files or duplicate filename handling failed: ' + JSON.stringify(result))
        if (await fs.readFile(require('node:path').join(folder, 'Long article.pdf'), 'utf8') !== 'Existing PDF') throw Error('Bulk export overwrote an existing PDF')
        for (const path of result.paths) if ((await fs.readFile(path)).subarray(0, 5).toString() !== '%PDF-') throw Error('Export is not a PDF')
        const singlePath = require('node:path').join(folder, 'single.pdf')
        const single = await writeArticlePdfs({ all: false, articles: [fixture] }, singlePath)
        if (single.paths[0] !== singlePath || single.failures.length) throw Error('Single PDF export failed')
        const failed = await writeArticlePdfs({ all: true, articles: [fixture] }, require('node:path').join(folder, 'missing-directory'))
        if (failed.paths.length || failed.failures.length !== 1) throw Error('PDF write failure was not reported')
        if (process.argv.includes('--screenshots')) await fs.copyFile(singlePath, ${JSON.stringify(join(tmpdir(), 'budget-articles-export.pdf'))})
        console.log('PASS: real PDF generation, individual bulk files, duplicate and reserved filenames, existing file preservation and write failures')
        await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        const point = await window.webContents.executeJavaScript('(() => { const reader = document.querySelector(".articles-viewport"); reader.scrollTop = 0; reader.focus(); const bounds = reader.getBoundingClientRect(); return { x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + bounds.height / 2) } })()')
        window.webContents.debugger.attach('1.3')
        await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaY: 420, deltaX: 0 })
        await new Promise(resolve => setTimeout(resolve, 200))
        const wheelTop = await window.webContents.executeJavaScript('document.querySelector(".articles-viewport").scrollTop')
        if (wheelTop <= 0) throw new Error('Mouse wheel did not scroll the article')
        await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 })
        await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 })
        await new Promise(resolve => setTimeout(resolve, 250))
        const keyboardTop = await window.webContents.executeJavaScript('document.querySelector(".articles-viewport").scrollTop')
        if (keyboardTop <= wheelTop) throw new Error('PageDown did not scroll the focused article')
        window.webContents.debugger.detach()
        console.log('PASS: native mouse wheel and PageDown scrolling')
        if (process.argv.includes('--screenshots')) {
          await window.webContents.executeJavaScript('document.querySelector(".articles-viewport").scrollTop = 0')
          await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
          require('node:fs').writeFileSync(${JSON.stringify(join(tmpdir(), 'budget-articles-desktop.png'))}, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
          await window.webContents.executeJavaScript('window.prepareChartScreenshot()')
          await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
          require('node:fs').writeFileSync(${JSON.stringify(join(tmpdir(), 'budget-articles-charts.png'))}, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
        }
        window.setSize(520, 700)
        console.log(await window.webContents.executeJavaScript('window.verifyNarrow()'))
        if (process.argv.includes('--screenshots')) {
          await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
          require('node:fs').writeFileSync(${JSON.stringify(join(tmpdir(), 'budget-articles-narrow.png'))}, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
        }
        app.exit(0)
      } catch (error) { console.error(error); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const output = await new Promise<{ code: number | null, text: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(directory, 'main.cjs'), ...process.argv.slice(2)], {
      env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let text = ''
    child.stdout.on('data', chunk => { text += chunk })
    child.stderr.on('data', chunk => { text += chunk })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Articles UI probe timed out')) }, 30_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, text }) })
  })
  assert.equal(output.code, 0, output.text)
  assert.match(output.text, /PASS:/)
  console.log(output.text.trim())
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
