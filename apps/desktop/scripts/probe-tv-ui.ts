import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(join(tmpdir(), 'budget-tv-ui-'))
try {
  await mkdir(join(root, 'out'), { recursive: true })
  await writeFile(join(scratch, 'theme.css'), await readFile(join(root, 'src/styles/tv.css'), 'utf8'))
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
      import { TvPage } from './src/pages/TvPage'
      import { buildTasks } from './src/api/prefetch'
      import { queryKeys } from './src/api/client'
      import { TV_CHANNELS } from './electron/shared/tv'
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: Infinity } } })
      const check = (value, message) => { if (!value) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 140))
      const cards = () => [...document.querySelectorAll('.tv-card')]
      const button = label => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === label)
      const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#142c49"/><path d="M60 280L160 210 250 235 360 140 430 170 570 65" fill="none" stroke="#a6c5ff" stroke-width="6"/><text x="40" y="55" fill="#d9e7ff" font-size="22" font-family="sans-serif">MARKET COVERAGE - UI FIXTURE</text></svg>')
      const videos = Array.from({ length: 9 }, (_, i) => ({
        videoId: 'fixture' + i, channelId: TV_CHANNELS[i % 3].id, channel: TV_CHANNELS[i % 3].name,
        title: ['Stock market today: the week ahead', 'Nasdaq earnings: what investors are watching', 'Wall Street and the interest rate outlook'][i % 3] + ' ' + i,
        publishedAt: Date.now() - (i + 1) * 60000, descriptionSnippet: 'Fictional market coverage used to verify the TV interface.',
        url: 'https://www.youtube.com/watch?v=fixture' + i, thumbnailUrl: ''
      }))
      const envelope = (data, freshness = 'fresh') => ({ data, errors: [], meta: { source: 'TV fixture', fetchedAt: Date.now(), freshness } })
      let calls = 0, thumbnails = 0, mode = 'fresh', opened = '', lastRequest, release, failImage = false
      window.api.tv = async request => {
        calls++; lastRequest = request
        if (mode === 'waiting') await new Promise(resolve => { release = resolve })
        if (mode === 'throws') throw Error('Network unavailable')
        const result = envelope({ items: mode === 'empty' ? [] : videos, warnings: mode === 'partial' ? ['CNBC Television: unavailable'] : [], fetchedAt: Date.now(), channelsLoaded: mode === 'partial' ? 2 : 3, channelsTotal: 3 }, ['partial', 'stale', 'failed'].includes(mode) ? mode : 'fresh')
        if (mode === 'failed') result.meta.failureReason = 'Channel feeds unavailable'
        return result
      }
      window.api.youtubeThumbnail = async request => {
        thumbnails++
        return failImage && request.videoId === 'fixture1'
          ? { ...envelope({ dataUri: '', resolvedUrl: '' }, 'failed'), errors: [{ reason: 'Image unavailable' }] }
          : envelope({ dataUri: image, resolvedUrl: '' })
      }
      window.api.openExternal = async url => { opened = url }
      const host = createRoot(document.getElementById('root'))
      const render = () => host.render(<QueryClientProvider client={client}><TvPage onStatusChange={() => {}} /></QueryClientProvider>)
      const task = () => buildTasks(undefined, undefined, { stocks: 'AAPL', fundamentals: 'AAPL' }, { year: 2026, month: 10, earningsYear: 2026, ipoYear: 2026 }).find(task => task.tab === 'tv')
      const refresh = async next => { mode = next; button('Refresh').click(); await settle() }
      window.runProbe = async () => {
        check(task(), 'TV must preload with no portfolio')
        await task().run(client, 7)
        check(lastRequest.background && lastRequest.backgroundOrder === 7, 'Startup priority missing')
        check(calls === 1 && thumbnails === 9, 'Startup must warm all video images')
        render(); await settle()
        check(calls === 1 && thumbnails === 9, 'First visit triggered a data/image load')
        check(cards().length === 9 && document.querySelector('.tv-feature h2').textContent === videos[0].title, 'Newest video not featured')
        cards()[2].click(); await settle()
        check(document.querySelector('.tv-feature h2').textContent === videos[2].title, 'Card selection failed')
        button('Watch on YouTube ↗').click(); check(opened === videos[2].url, 'Watch URL wrong')
        document.querySelector('.tv-feature-image').click(); check(opened === videos[2].url, 'Preview watch URL wrong')
        button('Yahoo Finance').click(); await settle()
        check(cards().length === 3 && cards().every(card => card.textContent.includes('Yahoo Finance')), 'Channel filtering failed')
        const input = document.querySelector('input')
        const setInput = value => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }
        setInput('no-match-xyz'); await settle()
        check(cards().length === 0 && document.body.innerText.includes('No matching videos') && !document.querySelector('.tv-watch'), 'Empty filter retained a watch action')
        button('Clear filters').click(); await settle()
        check(cards().length === 9, 'Clear filters failed')
        await refresh('partial')
        check(document.body.innerText.includes('Some channels could not refresh') && document.querySelector('details') && cards().length === 9, 'Partial result/warnings missing')
        await refresh('stale'); check(document.body.innerText.includes('Showing saved uploads') && cards().length === 9, 'Stale status missing')
        await refresh('failed'); check(document.body.innerText.includes('Channel feeds unavailable'), 'Failure details missing')
        await refresh('throws'); check(document.body.innerText.includes('Network unavailable') && cards().length === 9, 'Rejected refresh lost content')
        await refresh('waiting'); check(document.querySelector('.tv-refresh').disabled && cards().length === 9, 'Loading state lost feed')
        mode = 'fresh'; release(); await settle()
        await refresh('empty'); check(cards().length === 0 && document.body.innerText.includes('No recent market videos'), 'Empty state missing')
        await refresh('fresh'); check(lastRequest.force, 'Manual refresh did not force the provider')
        host.render(null); await settle(); const previousCalls = calls, previousImages = thumbnails
        render(); await settle()
        check(calls === previousCalls && thumbnails === previousImages, 'Revisit reloaded warmed content')
        failImage = true
        const failedClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        let failure = ''
        try { await task().run(failedClient) } catch (error) { failure = error.message; check(error.state === 'degraded', 'Image failure must degrade readiness') }
        check(failure.includes('thumbnail') && failedClient.getQueryData(queryKeys.youtubeThumbnail('fixture8', '')), 'Image failure passed silently or blocked others')
        return 'PASS: TV startup with no holdings, all images, first visit/revisit, channel/search filters, selection, watch links, manual refresh, partial/stale/failed/loading/empty states and image failures'
      }
      window.checkLayout = () => {
        check(document.documentElement.scrollWidth <= innerWidth, 'Horizontal overflow')
        check(document.querySelector('.tv-content').getBoundingClientRect().bottom <= innerHeight + 1, 'Page exceeds viewport')
        check(document.querySelector('.tv-feature').clientWidth > 200, 'Feature collapsed')
        check(document.querySelector('.tv-card').clientWidth > 150, 'Video cards collapsed')
        return 'PASS: TV layout at ' + innerWidth + 'px'
      }
    ` },
    bundle: true, jsx: 'automatic', write: false, format: 'iife', loader: { '.css': 'empty' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  await writeFile(join(scratch, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(scratch, 'index.html'), '<html><head><meta charset="UTF-8"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}#root{height:100vh;display:flex}</style><link rel="stylesheet" href="theme.css"></head><body><div id="root"></div><script>window.api={platform:"win32"}</script><script src="renderer.js"></script></body></html>')
  await writeFile(join(scratch, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron'); const fs = require('fs');
    app.setPath('userData', ${JSON.stringify(join(scratch, 'userData'))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true, webPreferences: { backgroundThrottling: false } });
      try {
        await window.loadFile(${JSON.stringify(join(scratch, 'index.html'))});
        console.log(await window.webContents.executeJavaScript('window.runProbe()'));
        for (const [width, height] of [[1920, 1080], [1366, 768], [720, 850], [480, 800]]) {
          window.setContentSize(width, height); await new Promise(resolve => setTimeout(resolve, 250));
          console.log(await window.webContents.executeJavaScript('window.checkLayout()'));
          await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
          fs.writeFileSync(${JSON.stringify(join(root, 'out/tv-smoke-'))} + width + '.png', (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        }
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
    const timer = setTimeout(() => { child.kill(); reject(new Error('TV UI probe timed out')) }, 45_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log('Screenshots: out/tv-smoke-{1920,1366,720,480}.png')
} finally {
  assert(!relative(tmpdir(), scratch).startsWith('..'))
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
