import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(join(tmpdir(), 'budget-heatmap-ui-'))
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert(css, 'Run npm run build first')
  await writeFile(join(scratch, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import { createRoot } from 'react-dom/client'
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
    import { HeatmapPage } from './src/pages/HeatmapPage'
    import { buildIntervalSummaries, HEATMAP_REPLAY_RETRY_MS } from './electron/shared/heatmap'
    import { queryKeys } from './src/api/client'
    import { warmStartupQuery } from './src/api/warmQueue'
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false } } })
    const check = (value, message) => { if (!value) throw Error(message) }
    const settle = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms))
    const button = label => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === label)
    const history = { dates: ['2026-01-02','2026-01-05','2026-01-06','2026-01-07'], closes: [100,110,55,60] }
    const holdings = [{ symbol: 'AAA', name: 'Alpha', sector: 'Technology', weight: 1, price: 60, changes: { live: 9.09, '1d': 9.09 }, history }]
    const data = { etf: 'SPY', ticker: 'SPY', fundName: 'Test', issuer: 'Fixture', asOfDate: '2026-01-08', sourceUrl: '',
      holdings, holdingsLoaded: 1, quoteCoverage: 1, weightedDayMove: 9.09, strongest: null, weakest: null,
      intervalSummaries: buildIntervalSummaries(holdings), fetchedAt: Date.now(), priceAsOfDate: '2026-01-07' }
    let calls = 0
    let finishFirstLoad
    const firstLoad = new Promise(resolve => { finishFirstLoad = resolve })
    let finishRetry
    const retryLoad = new Promise(resolve => { finishRetry = resolve })
    const envelope = (data, freshness = 'fresh') => ({ data, errors: [], meta: { source: 'fixture', fetchedAt: Date.now(), freshness } })
    const legacy = envelope({ ...data, holdings: holdings.map(({ history, ...holding }) => holding) })
    const key = queryKeys.heatmap('SPY')
    client.setQueryData(key, legacy)
    window.api.heatmapProgress = async () => data
    window.api.heatmap = async request => {
      check(request.background && !request.force, 'Automatic history loads must use the background lane and reuse caches')
      calls++
      if (calls === 1) {
        await firstLoad
        return envelope(legacy.data, 'failed')
      }
      if (calls === 2) {
        await retryLoad
        return envelope(data, 'partial')
      }
      return envelope({ ...data, etf: request.etf })
    }
    const nativeSetInterval = window.setInterval
    window.setInterval = (callback, ms, ...args) =>
      nativeSetInterval(callback, ms === HEATMAP_REPLAY_RETRY_MS ? 650 : ms, ...args)
    const host = createRoot(document.getElementById('root'))
    const render = () => host.render(<QueryClientProvider client={client}><HeatmapPage onStatusChange={() => {}} /></QueryClientProvider>)
    render()
    window.runProbe = async () => {
      await settle(250)
      check(calls === 1 && button('Play history').disabled, 'Saved history must start building without a reload')
      check(document.body.innerText.includes('Replay building') && document.body.innerText.includes('Price: $60.00'),
        'Replay progress must leave the current map visible')
      finishFirstLoad()
      await settle()
      check(document.body.innerText.includes('Retrying automatically') && calls === 1,
        'Replay failure must keep the current map and wait for the retry interval')
      await settle(650)
      check(calls === 2 && document.body.innerText.includes('Replay building'), 'History must retry automatically')
      finishRetry()
      await settle(750)
      window.setInterval = nativeSetInterval
      check(calls === 2 && !button('Play history').disabled, 'Usable replay from a partial response must stop retrying and be playable')

      const startup = new QueryClient()
      startup.setQueryData(key, legacy)
      let startupCalls = 0
      await warmStartupQuery(startup, { queryKey: key, staleTime: 1_800_000,
        queryFn: async () => { startupCalls++; return envelope(data) } })
      check(startupCalls === 1, 'Startup must rebuild even a fresh saved heatmap that lacks replay history')
      button('Play history').click(); await settle()
      const slider = () => document.querySelector('input[aria-label="Replay date"]')
      check(slider().value === '0' && document.body.innerText.includes('2026-01-05'), 'Replay must start at earliest return')
      check(document.body.innerText.includes('Price: $110.00') && document.body.innerText.includes('1D Change: +10.00%'), 'Replay prices/returns missing')
      await settle(480)
      check(slider().value === '1' && document.body.innerText.includes('1D Change: -50.00%'), 'Replay did not advance one trading day in 500 ms')
      button('Pause').click(); await settle(600)
      check(slider().value === '1', 'Pause did not stop playback')
      button('Restart').click(); await settle()
      check(slider().value === '0' && button('Play'), 'Restart must rewind and pause')
      const input = slider()
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '1')
      input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }))
      await settle()
      check(slider().value === '1' && button('Play'), 'Scrubbing must select a date and pause')
      button('Play').click(); await settle(600)
      check(slider().value === '2' && button('Play'), 'Playback must stop at final date')
      button('Play').click(); await settle()
      check(slider().value === '0', 'Play at end must start over')
      button('Back to latest').click(); await settle(600)
      check(!slider() && document.body.innerText.includes('Price: $60.00'), 'Latest prices did not restore')

      // Watch the timer registrations so the speed switch can be verified without a tight wall-clock assertion.
      const setInterval = window.setInterval
      const clearInterval = window.clearInterval
      const timers = new Map()
      window.setInterval = (callback, delay, ...args) => {
        const timer = setInterval(callback, delay, ...args)
        timers.set(timer, delay)
        return timer
      }
      window.clearInterval = timer => { timers.delete(timer); clearInterval(timer) }
      button('1W').click(); await settle()
      button('Play history').click(); await settle()
      check(button('1W').getAttribute('aria-pressed') === 'true', 'Starting replay must keep the selected timeframe')
      check(timers.size === 1 && [...timers.values()][0] === 400, '1W must schedule a 400 ms frame')
      check(document.body.innerText.includes('0.4s per trading day'), '1W replay speed label missing')
      button('1Y').click(); await settle()
      check(slider().value === '0', 'Changing timeframe must keep the current replay date')
      check(timers.size === 1 && [...timers.values()][0] === 200, '1Y must replace the running timer with a 200 ms frame')
      check(document.body.innerText.includes('0.2s per trading day'), '1Y replay speed label missing')
      button('Back to latest').click(); await settle()
      check(timers.size === 0, 'Leaving replay must clear its timer')
      window.setInterval = setInterval
      window.clearInterval = clearInterval
      check(calls === 2, 'Replay and timeframe changes must not fetch history again')
      button('Play history').click(); await settle(); button('Dow 30').click(); await settle(600)
      check(!slider(), 'Index change must stop replay')
      button('Play history').click(); await settle(); button('Pause').click(); await settle()
      window.verifyLayout = fit => {
        check(document.documentElement.scrollWidth <= innerWidth, 'Horizontal overflow')
        if (fit) check(document.documentElement.scrollHeight <= innerHeight, 'Vertical overflow')
      }
      return 'PASS: automatic startup and replay recovery, historical prices/returns, playback speed, pause, restart, scrub, end, latest, index reset and no playback network calls'
    }
  ` }, bundle: true, jsx: 'automatic', write: false, format: 'iife', loader: { '.css': 'empty' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') }, define: { 'process.env.NODE_ENV': '"production"' } })
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
        for (const [name, width, height, fit] of [['normal',1500,950,true],['compact',1280,800,true],['narrow',720,850,false]]) {
          window.setSize(width,height); await new Promise(resolve => setTimeout(resolve,250));
          await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
          await new Promise(resolve => setTimeout(resolve,100));
          fs.writeFileSync(${JSON.stringify(join(root, 'out/heatmap-'))} + name + '.png', (await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
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
    const timer = setTimeout(() => { child.kill(); reject(Error('Heatmap UI probe timed out')) }, 45_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
} finally {
  assert(relative(tmpdir(), scratch) && !relative(tmpdir(), scratch).startsWith('..'))
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
