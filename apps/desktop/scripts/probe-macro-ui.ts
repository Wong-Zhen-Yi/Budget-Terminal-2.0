import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(join(tmpdir(), 'budget-macro-ui-'))
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert(css, 'Run npm run build first')
  await writeFile(join(scratch, 'theme.css'), (await readFile(join(assets, css), 'utf8')) + '\n' + (await readFile(join(root, 'src/pages/MacroPage.css'), 'utf8')))
  const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import { createRoot } from 'react-dom/client'
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
    import { MacroPage } from './src/pages/MacroPage'
    import { ECONOMIC_SERIES, buildRow, buildYieldCurve } from './electron/shared/economic'
    import { addDays, calendarToday } from './electron/shared/calendar'
    import { buildTasks } from './src/api/prefetch'
    import { macroCalendarRequest } from './src/api/calendarQueries'
    import { useRefreshEconomic } from './src/api/economicQueries'
    import { useEconomicPage } from './src/stores/economic'
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false, gcTime: Infinity } } })
    const check = (value, message) => { if (!value) throw Error(message) }
    const settle = () => new Promise(resolve => setTimeout(resolve, 180))
    let calls = 0, scheduleCalls = 0, navigation, lastRequest, lastScheduleRequest, statuses, failed = false
    const rows = ECONOMIC_SERIES.map(series => buildRow(series, Array.from({length: 36}, (_, i) => [new Date(Date.UTC(2024, i, 1)).toISOString().slice(0,10), 100 + i + i*i/100])))
    const payload = { rows, source: 'fixture', generatedAt: new Date().toISOString(), groups: ['Growth', 'Inflation', 'Labor', 'Rates'], missing: [], unreachable: [], yieldCurve: buildYieldCurve(rows) }
    window.api.economic = async request => { calls++; lastRequest = request; return { data: failed ? { ...payload, rows: [] } : payload, errors: failed ? [{ source: 'fixture', reason: 'HTTP 503' }] : [], meta: { source: 'fixture', freshness: failed ? 'failed' : 'fresh', failureReason: failed ? 'HTTP 503' : undefined, fetchedAt: Date.now() } } }
    const today = calendarToday('est')
    const event = (name, days, importance = 'high') => ({ name, date: addDays(today, days), importance })
    const schedule = { data: { companyEvents: [], marketHolidays: [], generatedAt: Date.now(), economicEvents: [
      event('CPI Release', 35), event('GDP Report', 60), event('PCE Inflation', 4, 'medium'), event('FOMC Decision', 1),
      event('Jobs Report', 3), event('CPI Release', 0), event('Jobs Report', -1), event('PPI Release', 2), event('GDP Report', 61),
    ] }, meta: { source: 'fixture', freshness: 'fresh', fetchedAt: Date.now() } }
    window.api.calendarMonth = async request => { scheduleCalls++; lastScheduleRequest = request; return schedule }
    const host = createRoot(document.getElementById('root'))
    function Page() { window.refreshMacro = useRefreshEconomic().refresh; return <MacroPage onStatusChange={panels => { statuses = panels }} onNavigate={page => { navigation = page }} /> }
    const render = () => host.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>)
    window.runProbe = async () => {
      const tasks = buildTasks(undefined, { hiddenTabs: ['macro'], favoriteTabs: [] }, { stocks: 'AAPL', fundamentals: 'AAPL' }, { year: 2026, month: 11, earningsYear: 2026, ipoYear: 2026 })
      const task = tasks.find(task => task.tab === 'macro' && task.label === 'Macro'); check(task, 'Hidden Macro missing from startup')
      await task.run(client, 7); check(lastRequest.background && lastRequest.backgroundOrder === 7, 'Startup priority lost')
      const releaseTask = tasks.find(task => task.tab === 'macro' && task.label === 'US release schedule')
      check(releaseTask, 'Hidden Macro release schedule missing from startup')
      await releaseTask.run(client, 7)
      const { year, month } = macroCalendarRequest(today)
      const releaseKey = ['calendarMonth', year, month, '']
      check(lastScheduleRequest.background && lastScheduleRequest.backgroundOrder === 7, 'Release schedule startup priority lost')
      check(lastScheduleRequest.year === year && lastScheduleRequest.month === month && !lastScheduleRequest.tickers.length, 'Release schedule should use the current US month and skip company lookups')
      await tasks.find(task => task.tab === 'economic').run(client, 8); check(calls === 1, 'Shared cache repeated download')
      render(); await settle(); check(calls === 1 && scheduleCalls === 1, 'First visit fetched warmed content')
      check(document.body.innerText.includes('Cycle compass') && document.body.innerText.includes('Upcoming US releases'), 'Macro content missing')
      const releases = [...document.querySelectorAll('.macro-release-list li')]
      check(releases.map(row => row.querySelector('strong').textContent).join(', ') === 'CPI Release, FOMC Decision, Jobs Report, PCE Inflation, GDP Report', 'Watch must show only the next key release of each type in date order')
      check(releases[0].querySelector('time').dateTime === today && releases[0].textContent.includes('Today') && releases[1].textContent.includes('Tomorrow'), 'US release dates and relative days must agree')
      check(releases[4].querySelector('time').dateTime === addDays(today, 60), 'Watch must include the 60-day boundary')
      const compassGrid = document.querySelector('.macro-compass-grid')
      check(compassGrid.querySelectorAll('tbody td').length === 9, 'Compass must show all nine states')
      const original = client.getQueryData(['economic'])
      const steadyRows = rows.map(row => row.seriesId === 'GDPC1' ? { ...row, change: 0 }
        : row.seriesId === 'CPIAUCSL' ? { ...row, change: -0.08 }
        : row)
      client.setQueryData(['economic'], { ...original, data: { ...payload, rows: steadyRows } }); await settle()
      check(compassGrid.tBodies[0].rows[1].cells[2].dataset.active === 'true', 'Small and flat moves should highlight the center')
      check(document.querySelector('.macro-compass-reading').textContent === 'Steady growth · Steady inflation', 'Compass reading should name both states')
      check(document.querySelector('.macro-compass dl').textContent.includes('0.00 pp') && document.querySelector('.macro-compass dl').textContent.includes('−0.08 pp'), 'Exact release changes must distinguish steady readings')
      client.setQueryData(['economic'], original); await settle()
      check(statuses[0].label === 'Macro' && statuses[1].label === 'US release schedule', 'Settings diagnostic labels missing')
      const payroll = [...document.querySelectorAll('.macro-driver')].find(node => node.textContent.includes('Nonfarm'))
      payroll.click(); check(navigation === 'economic' && useEconomicPage.getState().activeTab === 'labor' && useEconomicPage.getState().selectedSeries.Labor === 'PAYEMS', 'Driver history should open the matching chart in Economic')
      document.querySelectorAll('nav button')[1].click(); check(navigation === 'calendar', 'Calendar navigation failed')
      client.setQueryData(releaseKey, { ...schedule, data: { ...schedule.data, economicEvents: [event('GDP Report', 61)] } }); await settle()
      check(document.querySelector('.macro-release-empty').textContent.includes('No key releases'), 'Out-of-window schedule must show the empty state')
      client.setQueryData(releaseKey, { ...schedule, data: { ...schedule.data, economicEvents: [] }, meta: { ...schedule.meta, freshness: 'failed' } }); await settle()
      check(document.querySelector('.macro-release-empty').textContent === 'Release schedule unavailable.' && statuses[1].envelope.meta.freshness === 'failed', 'Schedule outage should be visible in Settings with no dates fabricated')
      client.setQueryData(releaseKey, schedule); await settle()
      client.setQueryData(['economic'], { data: { ...payload, rows: [] }, meta: { source: 'fixture', freshness: 'failed', fetchedAt: Date.now() } }); await settle()
      check(document.body.innerText.includes('No directional signal'), 'Missing data fabricated a signal')
      check(!compassGrid.querySelector('[data-active="true"]'), 'Missing releases must leave the matrix unmarked')
      await window.refreshMacro(true); await settle(); check(lastRequest.force, 'Force refresh not propagated')
      failed = true; await window.refreshMacro(true).catch(() => {}); await settle(); check(!document.querySelector('.macro-driver').disabled, 'Indicator outage erased historical data'); check(document.querySelectorAll('.macro-release-list li').length === 5, 'Indicator outage erased release schedule'); check(String(client.getQueryState(['economic']).error).includes('HTTP 503'), 'Settings lost refresh failure')
      failed = false; await window.refreshMacro(true); await settle(); check(!client.getQueryState(['economic']).error, 'Recovery retained error')
      host.render(null); await settle(); const before = calls; render(); await settle(); check(calls === before && scheduleCalls === 1, 'Revisit repeated download')
      window.verifyLayout = fit => {
        const page = document.querySelector('[data-macro-page]')
        const compass = page.querySelector('.macro-compass').getBoundingClientRect()
        const drivers = page.querySelector('.macro-drivers').getBoundingClientRect()
        const releases = page.querySelector('.macro-release-watch').getBoundingClientRect()
        const rates = page.querySelector('.macro-rates').getBoundingClientRect()
        check(document.documentElement.scrollWidth <= innerWidth, 'Document horizontal overflow')
        check(page.scrollWidth <= page.clientWidth + 1, 'Page horizontal overflow')
        if (fit) {
          check(compass.right < drivers.left && drivers.right < rates.left, 'Macro drivers must occupy the center column')
          check(releases.right <= drivers.left && releases.top > compass.bottom, 'Releases must sit below the cycle compass')
          check(page.scrollHeight <= page.clientHeight + 1, 'Page vertical overflow')
          for (const section of page.querySelectorAll('section')) check(section.scrollHeight <= section.clientHeight + 1, 'Section clipped: ' + section.className)
        } else {
          check(compass.bottom < drivers.top && drivers.bottom < releases.top, 'Narrow layout must put drivers between the compass and releases')
        }
      }
      return 'PASS: Macro hidden startup, shared cache, release watch, driver drilldowns, missing coverage, refresh and revisit'
    }
` }, bundle: true, jsx: 'automatic', write: false, format: 'iife', loader: { '.css': 'empty' }, alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') }, define: { 'process.env.NODE_ENV': '"production"' } })
  await writeFile(join(scratch, 'renderer.js'), bundle.outputFiles.find(file => file.path.endsWith('.js'))?.text ?? bundle.outputFiles[0].text)
  await writeFile(join(scratch, 'index.html'), '<html><head><meta charset="utf-8"><link rel="stylesheet" href="theme.css"></head><body><div id="root" style="height:100vh;display:flex"></div><script>window.api = { platform: "win32" };</script><script src="renderer.js"></script></body></html>')
  await writeFile(join(scratch, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron'); const fs = require('fs');
    app.setPath('userData', ${JSON.stringify(join(scratch, 'userData'))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1500, height: 950, webPreferences: { backgroundThrottling: false } });
      try {
        await window.loadFile(${JSON.stringify(join(scratch, 'index.html'))});
        console.log(await window.webContents.executeJavaScript('window.runProbe()'));
        for (const [name, width, height, fit] of [['normal',1500,950,true],['compact',1280,800,true],['app-content',1040,680,true],['narrow',720,850,false]]) {
          window.setSize(width,height); await new Promise(resolve => setTimeout(resolve,250));
          await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
          await new Promise(resolve => setTimeout(resolve,100));
          fs.writeFileSync(${JSON.stringify(join(root, 'out/macro-'))} + name + '.png', (await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
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
    const timer = setTimeout(() => { child.kill(); reject(Error('Macro UI probe timed out')) }, 45_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
} finally {
  assert(relative(tmpdir(), scratch) && !relative(tmpdir(), scratch).startsWith('..'))
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
