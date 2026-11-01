import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-dictionary-ui-'))
const screenshots = join(root, 'out/maintenance')
try {
  await mkdir(screenshots, { recursive: true })
  const assets = join(root, 'out/renderer/assets')
  const styles = (await readdir(assets)).filter(name => name.endsWith('.css'))
  assert(styles.length, 'Run npm run build before the Dictionary UI probe')
  const stylesheet = (await Promise.all(styles.map(name => readFile(join(assets, name), 'utf8')))).join('\n')
  assert(stylesheet.includes('.dictionary-page'), 'Rebuild the app to include Dictionary Reading Room styles')
  await writeFile(join(directory, 'theme.css'), stylesheet)
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { flushSync } from 'react-dom'
      import { DictionaryPage } from './src/pages/DictionaryPage'
      import { useDictionary } from './src/stores/dictionary'
      import { DICTIONARY_CATEGORIES, DICTIONARY_ENTRIES, getDictionaryEntry } from './electron/shared/dictionary'
      const check = (value, message) => { if (!value) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 75))
      let statuses = 0, clipboard = '', copyFails = false
      window.api = { writeClipboard: async text => {
        if (copyFails) throw Error('Synthetic clipboard failure')
        clipboard = text
        return true
      } }
      const host = createRoot(document.getElementById('root'))
      let renderKey = 0
      const render = async () => {
        flushSync(() => host.render(<DictionaryPage key={renderKey++} onStatusChange={() => { statuses++ }} />))
        await settle()
      }
      const findButton = (text, scope = document) => {
        const button = [...scope.querySelectorAll('button')].find(button => button.textContent.trim() === text)
        check(button, 'Missing button: ' + text + ' in ' + (scope.className || 'document'))
        return button
      }
      const click = async button => { check(button, 'Missing button'); button.click(); await settle() }
      const search = async value => {
        const input = document.querySelector('[aria-label="Search Dictionary"]')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true })); await settle()
      }
      const terms = () => document.querySelector('[aria-label="Dictionary terms"]')
      const title = () => document.querySelector('.dictionary-entry-title h2')?.textContent
      const category = value => click(findButton(value, document.querySelector('[aria-label="Dictionary categories"]')))
      window.runProbe = async () => {
        await render()
        check(statuses > 0 && title() === 'Relative Strength Index', 'Offline Dictionary did not render immediately')
        check(document.querySelectorAll('.dictionary-categories button').length === DICTIONARY_CATEGORIES.length + 1, 'Canonical categories missing')
        await window.captureFixture('dictionary-desktop')
        await click(document.querySelector('.dictionary-saved-toggle'))
        check(document.body.textContent.includes('Build your reference shelf'), 'Missing empty saved state')
        await click(findButton('Browse all terms'))
        check(terms().querySelectorAll('button').length === DICTIONARY_ENTRIES.length, 'Browse all omits terms')
        for (const name of DICTIONARY_CATEGORIES) {
          await category(name)
          check(terms().querySelectorAll('button').length === DICTIONARY_ENTRIES.filter(entry => entry.category === name).length, 'Category lost terms: ' + name)
        }
        await search('P/E')
        check(title() === 'Price-to-Earnings Ratio', 'Global alias search is trapped by previous category')
        const formula = getDictionaryEntry('price-to-earnings-ratio').sections.find(section => section.title === 'Formula').body
        await click(document.querySelector('[aria-label="Copy formula"]'))
        check(clipboard === formula && document.body.textContent.includes('Formula copied'), 'Formula copy altered the catalog text')
        copyFails = true
        await click(document.querySelector('[aria-label="Copy formula"]'))
        check(document.body.textContent.includes('Could not copy'), 'Clipboard failure hidden')
        copyFails = false
        await click(document.querySelector('[aria-label="Save Price-to-Earnings Ratio"]'))
        await search('RSI')
        check(title() === 'Relative Strength Index', 'RSI alias lookup')
        await click(document.querySelector('[aria-label="Save Relative Strength Index"]'))
        const savedState = localStorage.getItem('budget-terminal:dictionary')
        check(savedState && JSON.parse(savedState).state.savedEntryIds.length === 2, 'Bookmarks were not persisted')
        await click(document.querySelector('.dictionary-saved-toggle'))
        check(terms().querySelectorAll('button').length === 2, 'Saved filter omitted bookmarks')
        await search('zz-no-matching-term')
        check(document.body.textContent.includes('No matching terms'), 'Search empty state missing')
        await click(document.querySelector('[aria-label="Clear dictionary search"]'))
        check(terms().querySelectorAll('button').length === 2, 'Clearing search lost saved-only filter')
        await click(document.querySelector('[aria-label="Unsave Relative Strength Index"]'))
        check(terms().querySelectorAll('button').length === 1 && title() === 'Price-to-Earnings Ratio', 'Removing active saved term did not choose a remaining term')
        await click(document.querySelector('[aria-label="Unsave Price-to-Earnings Ratio"]'))
        check(document.body.textContent.includes('Build your reference shelf'), 'Removing last saved term left stale article')
        localStorage.setItem('budget-terminal:dictionary', savedState)
        await useDictionary.persist.rehydrate()
        await render()
        check(useDictionary.getState().savedEntryIds.length === 2 && title() === 'Relative Strength Index', 'Saved terms or selected article lost on remount')
        check(document.querySelector('.dictionary-context').textContent.includes('Price-to-Earnings Ratio'), 'Reading history missing')
        const target = getDictionaryEntry('relative-strength-index').relatedEntryIds[0]
        await click(findButton(getDictionaryEntry(target).term, document.querySelector('.dictionary-related')))
        check(title() === getDictionaryEntry(target).term && useDictionary.getState().category === getDictionaryEntry(target).category, 'Related term navigation opened another article')
        check(document.querySelector('.dictionary-reader').scrollTop === 0, 'Related article retained old scroll offset')
        await search('RSI')
        const reader = document.querySelector('.dictionary-reader')
        await click(findButton('Formula', document.querySelector('.dictionary-desktop-outline')))
        check(reader.scrollTop > 0 && document.activeElement.dataset.dictionarySection === 'section-0', 'Article outline did not scroll and focus its section')
        reader.scrollTop = 0; reader.dispatchEvent(new Event('scroll')); await settle()
        check(findButton('Overview', document.querySelector('.dictionary-desktop-outline')).getAttribute('aria-current') === 'location', 'Outline did not follow reader scroll')
        const input = document.querySelector('[aria-label="Search Dictionary"]')
        input.blur()
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }))
        check(document.activeElement === input, 'Slash shortcut did not focus search')
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle()
        check(input.value === '', 'Escape did not clear dictionary query')
        input.blur()
        document.querySelector('.dictionary-page').style.display = 'none'
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }))
        check(document.activeElement !== input, 'Hidden dictionary stole the search shortcut')
        document.querySelector('.dictionary-page').style.display = ''
        const pattern = DICTIONARY_ENTRIES.find(entry => entry.chartPatternId)
        await search(pattern.term)
        await click(findButton(pattern.term, terms()))
        check(document.querySelector('.dictionary-pattern svg[role="img"]'), 'Candlestick chart disappeared')
        const examples = [...document.querySelectorAll('.dictionary-pattern-toolbar button')]
        check(examples.length > 1, 'Chart example controls disappeared')
        await click(examples[1])
        check(examples[1].getAttribute('aria-pressed') === 'true', 'Chart example selection failed')
        await window.captureFixture('dictionary-pattern')
        await search('CPI Release')
        await click(findButton('CPI Release', terms()))
        for (const section of getDictionaryEntry('cpi-release').sections) {
          check([...document.querySelectorAll('.dictionary-section h3')].some(node => node.textContent === section.title), 'Economic-event section missing: ' + section.title)
        }
        const valid = DICTIONARY_ENTRIES.slice(0, 12).map(entry => entry.entryId)
        localStorage.setItem('budget-terminal:dictionary', JSON.stringify({ state: {
          selectedEntryId: ' RSI-invalid ', category: 'Removed category',
          savedEntryIds: [null, 7, 'unknown', ' relative-strength-index ', 'relative-strength-index'],
          recentEntryIds: ['unknown', ...valid, ...valid],
        }, version: 0 }))
        await useDictionary.persist.rehydrate()
        check(useDictionary.getState().savedEntryIds.join() === 'relative-strength-index', 'Bookmark restoration did not validate and canonicalize IDs')
        check(useDictionary.getState().recentEntryIds.length === 8 && new Set(useDictionary.getState().recentEntryIds).size === 8, 'History is unbounded or duplicated')
        useDictionary.setState({ selectedEntryId: 'relative-strength-index', category: 'Technical Indicators', recentEntryIds: ['price-to-earnings-ratio'], savedEntryIds: ['relative-strength-index'] })
        await render()
        return 'PASS: 405 offline terms, all 14 topics, global alias search, saved filter and persistence, history, related navigation, outline scrolling, clipboard success/failure, shortcuts, diagrams and economic sections'
      }
      window.checkLayout = async () => {
        const page = document.querySelector('.dictionary-page'), reader = document.querySelector('.dictionary-reader')
        check(page.scrollWidth <= page.clientWidth + 1, 'Page overflows horizontally at ' + innerWidth)
        check(page.getBoundingClientRect().bottom <= innerHeight + 1, 'Page overflows vertically at ' + innerWidth)
        check(reader.clientHeight > 180 && reader.scrollHeight > reader.clientHeight, 'Reader is not a bounded scrollport at ' + innerWidth)
        check(reader.scrollWidth <= reader.clientWidth + 1, 'Reader overflows horizontally at ' + innerWidth)
        check(document.querySelector('.dictionary-browser').getBoundingClientRect().bottom <= page.getBoundingClientRect().bottom, 'Topic browser overflows page')
        for (const list of document.querySelectorAll('.dictionary-categories, .dictionary-terms')) {
          const active = list.querySelector('[aria-current]').getBoundingClientRect()
          const bounds = list.getBoundingClientRect()
          check(active.top >= bounds.top - 1 && active.bottom <= bounds.bottom + 1, 'Selected row is outside its list at ' + innerWidth)
        }
        if (innerWidth <= 1100) {
          check(getComputedStyle(document.querySelector('.dictionary-mobile-outline')).display !== 'none', 'Compact article outline missing')
          document.querySelector('.dictionary-mobile-outline').open = true; await settle()
          await click(findButton('Formula', document.querySelector('.dictionary-mobile-outline')))
          check(reader.scrollTop > 0, 'Compact article outline does not navigate')
          document.querySelector('.dictionary-mobile-outline').open = false
        }
        reader.scrollTop = 0
        await settle()
        return 'PASS: responsive reading layout at ' + innerWidth + 'px'
      }
    ` },
    bundle: true, jsx: 'automatic', write: false, format: 'iife', loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
  })
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), `<meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'"><link rel="stylesheet" href="theme.css"><style>#root{display:flex}</style><div id="root"></div><script src="renderer.js"></script>`)
  await writeFile(join(directory, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('captureFixture',name=>ipcRenderer.invoke('capture-fixture',name));`)
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow, ipcMain } = require('electron')
    const fs = require('fs'), path = require('path')
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1600, height: 1000, useContentSize: true, webPreferences: { backgroundThrottling: false, preload: ${JSON.stringify(join(directory, 'preload.cjs'))} } })
      window.webContents.on('console-message', event => console.log(event.message))
      ipcMain.handle('capture-fixture', async (_event, name) => {
        if (!/^[a-z-]+$/.test(name)) throw Error('Invalid screenshot name')
        fs.writeFileSync(path.join(${JSON.stringify(screenshots)}, name + '.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
      })
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        console.log(await window.webContents.executeJavaScript('window.runProbe()'))
        for (const [width, height] of [[1600, 1000], [1366, 768], [900, 850], [600, 850], [360, 800]]) {
          window.setContentSize(width, height)
          await new Promise(resolve => setTimeout(resolve, 160))
          console.log(await window.webContents.executeJavaScript('window.checkLayout()'))
          fs.writeFileSync(path.join(${JSON.stringify(screenshots)}, 'dictionary-' + width + '.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
        }
        app.exit(0)
      } catch (error) { console.error(error); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Dictionary UI probe timed out')) }, 60_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log('Dictionary UI screenshots: ' + screenshots)
} finally {
  const resolved = resolve(directory)
  if (dirname(resolved) === resolve(tmpdir()) && basename(resolved).startsWith('budget-dictionary-ui-')) {
    await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
