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
          await click('New article')
          await fill('Title', 'A saved article')
          await fill('Topic', 'AI')
          await fill('Article', 'Demand grows. <script>window.injected = true</script>')
          await click('Save article')
          check(data.articles.length === 1 && data.articles[0].title === 'A saved article', 'Article not saved')
          await click('Read article')
          check(document.querySelector('article').textContent.includes('Demand grows.'), 'Reader missing content')
          check(!window.injected, 'Content executed HTML')
          await click('Edit article')
          await fill('Title', 'Unsaved edit')
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
          return 'PASS: Articles empty state, create, edit, read, safe text, unsaved draft guard, AI refresh and delete'
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
