import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-calendar-ui-'))
const screenshot = join(root, 'out', 'calendar-smoke.png')
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert.ok(css, 'Run npm run build before this UI probe')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({
    stdin: {
      resolveDir: root, loader: 'tsx', contents: `
        import { createRoot } from 'react-dom/client'
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
        import { CalendarPage } from './src/pages/CalendarPage'
        import { useCalendarPage } from './src/stores/calendar'
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const check = (ok, message) => { if (!ok) throw Error(message) }
        const settle = () => new Promise(resolve => setTimeout(resolve, 220))
        const text = () => document.body.innerText
        const button = label => [...document.querySelectorAll('button')].find(b => b.textContent === label)
        const day = date => document.querySelector('button[aria-label^="' + date + '"]')
        window.checkLayout = async () => {
          await settle()
          check(document.documentElement.scrollWidth <= innerWidth, 'Document overflows at ' + innerWidth)
          const page = document.querySelector('.calendar-month-page')
          check(page.scrollWidth <= page.clientWidth + 1, 'Calendar overflows at ' + innerWidth)
          const fontSize = selector => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize)
          check(fontSize('.calendar-grid-event') >= 13, 'Calendar event text is too small')
          check(fontSize('.calendar-day-number') >= 17, 'Calendar dates are too small')
          for (const more of document.querySelectorAll('.calendar-more')) {
            check(more.getBoundingClientRect().bottom <= more.closest('.calendar-day').getBoundingClientRect().bottom, 'Larger text clips event overflow count')
          }
          day('2026-08-31').click()
          await settle()
          const preview = document.querySelector('.calendar-day-preview')
          const rect = preview.getBoundingClientRect()
          check(rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight, 'Day preview outside viewport at ' + innerWidth)
          check(preview.scrollWidth <= preview.clientWidth, 'Day preview content overflows')
          check(fontSize('.calendar-day-preview header strong') >= 18, 'Hover date heading is too small')
          check(fontSize('.calendar-day-preview .calendar-readings') >= 15, 'Hover economic figures are too small')
          check(fontSize('.calendar-day-preview .calendar-source') >= 14, 'Hover explanatory text is too small')
          for (const table of preview.querySelectorAll('table')) check(table.scrollWidth <= table.parentElement.clientWidth, 'Economic table overflows preview')
          check(preview.innerText.includes('PPI final demand'), 'Overflow events missing from day preview')
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          await settle()
          check(!document.querySelector('.calendar-day-preview'), 'Escape must dismiss details')
        }
        window.runProbe = async () => {
          useCalendarPage.setState({ initialized: true, year: 2026, month: 8, detailsCollapsed: false })
          createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><CalendarPage onStatusChange={() => {}} /></QueryClientProvider>)
          await settle()
          check(text().includes('Loading calendar'), 'Missing loading status')
          window.ready = true
          await settle()
          check(document.querySelectorAll('button.calendar-day').length === 31, 'Wrong number of month days')
          check(text().includes('CPI 0.3% MoM'), 'Missing CPI reading in grid')
          day('2026-08-12').dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
          await settle()
          let preview = document.querySelector('.calendar-day-preview')
          check(preview?.innerText.includes('Core CPI'), 'Hover did not expose core CPI')
          check(preview.innerText.includes('2026-07') && preview.innerText.includes('Previous*'), 'Reference month / comparison missing')
          check(preview.innerText.includes('Strike $200.00') && preview.innerText.includes('2 contract(s)'), 'Option details missing')
          check(preview.innerText.includes('AAPL') && preview.innerText.includes('Closed all day'), 'Company / holiday details missing')
          day('2026-08-12').click()
          await settle()
          check(document.querySelector('.calendar-day-preview')?.innerText.includes('Pinned day'), 'Click must pin hover details')
          day('2026-08-12').dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }))
          await settle()
          check(document.querySelector('.calendar-day-preview'), 'Pinned preview should persist')
          document.querySelector('[aria-label="Close day details"]').click()
          await settle()
          day('2026-08-02').focus()
          // Hidden Electron windows update activeElement without emitting native focus events.
          day('2026-08-02').dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
          await settle()
          check(document.querySelector('.calendar-day-preview')?.innerText.includes('No events'), 'Keyboard focus / empty day failed')
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          await settle()
          button('Hide information').click()
          await settle()
          check(document.querySelector('#calendar-details').hidden, 'Details collapse failed')
          check(document.querySelectorAll('.calendar-filter-bar input').length === 4, 'Filters hidden by collapse')
          button('Show information').click()
          document.querySelector('.calendar-filter-bar input').click()
          await settle()
          check(!text().includes('CPI 0.3% MoM'), 'Economic category filter failed')
          document.querySelector('.calendar-filter-bar input').click()
          await settle()
          button('Export').click()
          await settle()
          check(window.exported.includes('0.3%'), 'Export should contain readings')
          window.mode = 'partial'
          button('Refresh').click()
          await settle()
          check(window.forced, 'Refresh did not force request')
          check(text().includes('Some FRED readings unavailable'), 'Partial failure not visible')
          check(text().includes('CPI 0.3% MoM'), 'Partial failure removed healthy readings')
          window.mode = 'success'
          button('Refresh').click()
          await settle()
          await window.checkLayout()
          return 'PASS: loading, readings, pointer hover, pin, keyboard, empty day, filters, collapse, export, refresh and partial failure'
        }
      `,
    },
    bundle: true, jsx: 'automatic', write: false, format: 'iife', outfile: join(directory, 'renderer.js'),
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  for (const file of bundle.outputFiles) await writeFile(file.path, file.contents)
  await writeFile(join(directory, 'index.html'), `
    <html><head><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="height:100vh;display:flex;min-width:0"></div>
    <script>
      window.mode = 'success'; window.ready = false;
      const readings = label => [
        { label: label + ' MoM (SA)', seriesId: 'CPIAUCSL', source: 'FRED · current revised data', period: '2026-07', actual: '0.3%', previous: '0.2%' },
        { label: label + ' YoY (SA)', seriesId: 'CPIAUCSL', source: 'FRED · current revised data', period: '2026-07', actual: '2.7%', previous: '2.6%' }
      ];
      const economics = date => [
        { date, name: 'CPI Release', importance: 'high', readings: [...readings('CPI'), ...readings('Core CPI')] },
        { date, name: 'PPI Release', importance: 'medium', readings: readings('PPI final demand') },
        { date, name: 'PCE Inflation', importance: 'medium', readings: readings('PCE') },
        { date, name: 'Jobs Report', importance: 'high' }
      ];
      const option = { ticker: 'AAPL', expiry: '2026-08-12', strategy: 'Covered Call', strike: 200, contracts: 2, status: 'Open' };
      const envelope = data => ({ data, meta: { source: 'UI fixture', fetchedAt: Date.now(), freshness: 'fresh' }, errors: [] });
      window.api = {
        onPortfolioChanged: () => () => {},
        portfolio: async () => envelope({ portfolios: [{ id: 'main', name: 'Main', tickers: ['AAPL'], options: [option] }], mainId: 'main' }),
        writeClipboard: async content => { window.exported = content },
        calendarMonth: async request => {
          while (!window.ready) await new Promise(resolve => setTimeout(resolve, 20));
          window.forced = request.force;
          const result = envelope({ economicEvents: [...economics('2026-08-12'), ...economics('2026-08-31')],
            companyEvents: [{ date: '2026-08-12', ticker: 'AAPL', event: 'Earnings' }],
            marketHolidays: [{ date: '2026-08-12', event: 'Fixture holiday', cellLabel: 'Holiday', detail: 'Closed all day', market: 'US Equities', color: '#26c6da' }], generatedAt: Date.now() });
          if (window.mode === 'partial') result.meta.failureReason = 'Some FRED readings unavailable';
          return result;
        }
      };
    </script><script src="renderer.js"></script></body></html>
  `)
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron');
    const fs = require('fs');
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { backgroundThrottling: false } });
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
        console.log(await window.webContents.executeJavaScript('window.runProbe().catch(error => { throw Error(error.stack) })'));
        fs.writeFileSync(${JSON.stringify(screenshot)}, (await window.webContents.capturePage()).toPNG());
        for (const width of [900, 600, 390]) {
          window.setSize(width, 800);
          await new Promise(resolve => setTimeout(resolve, 250));
          await window.webContents.executeJavaScript('window.checkLayout().catch(error => { throw Error(error.stack) })');
        }
        console.log('PASS: responsive grid and bounded day previews at desktop, tablet and phone widths'); app.exit(0);
      } catch (error) { console.error(error); app.exit(1); }
    });
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Calendar UI probe timed out')) }, 40_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log(`Screenshot: ${screenshot}`)
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
