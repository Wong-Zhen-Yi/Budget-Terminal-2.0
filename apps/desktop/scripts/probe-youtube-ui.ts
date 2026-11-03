import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(join(tmpdir(), 'budget-youtube-ui-'))
try {
  const assets = join(root, 'out/renderer/assets')
  const styles = (await readdir(assets)).filter(name => name.endsWith('.css'))
  assert(styles.length, 'Run npm run build before this probe')
  await writeFile(join(scratch, 'theme.css'), (await Promise.all(styles.map(name => readFile(join(assets, name), 'utf8')))).join('\n'))
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
      import { YouTubePage } from './src/pages/YouTubePage'
      import { buildTasks } from './src/api/prefetch'
      import { queryKeys } from './src/api/client'
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: Infinity } } })
      const check = (value, message) => { if (!value) throw Error(message) }
      const settle = () => new Promise(resolve => setTimeout(resolve, 120))
      const rows = () => [...document.querySelectorAll('.youtube-video-row')]
      const text = () => document.body.innerText
      const button = label => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === label)
      const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g"><stop stop-color="#173b4b"/><stop offset="1" stop-color="#07121d"/></linearGradient></defs><path fill="url(#g)" d="M0 0h640v360H0z"/><rect x="245" y="105" width="150" height="150" rx="12" fill="#287b77" stroke="#65e6d4"/><text x="320" y="193" text-anchor="middle" fill="#e3fff8" font-size="32" font-family="sans-serif">VIDEO</text></svg>')
      const settings = { youtubePage: { sortColumn: 3, sortDescending: true } }
      const portfolio = { portfolios: [{ id: 'fixture', tickers: ['NVDA', 'AAPL', 'MSFT'], holdings: {} }], activeId: 'fixture', mainId: 'fixture' }
      const titles = ['NVIDIA earnings: what matters next', 'Apple’s next growth cycle', 'Microsoft cloud: the quarterly picture', 'Alphabet and the cloud opportunity', 'A closer look at technology', 'The week ahead for your portfolio', 'Research notes: the latest quarter', 'Technology earnings in context']
      const videos = titles.map((title, i) => ({
        videoId: 'fixture000' + i, ticker: ['NVDA', 'AAPL', 'MSFT'][i % 3], title,
        channel: ['Market Lens', 'Equity Brief', 'The Research Desk'][i % 3],
        viewCount: 100000 - i * 1000, viewCountText: (100 - i) + 'K', publishedText: '2026-10-30',
        publishedDays: i + 1, publishedDaysText: String(i + 1), durationText: '18:42',
        url: 'https://www.youtube.com/watch?v=fixture' + i, thumbnailUrl: '', descriptionSnippet: 'A review of the latest earnings, business trends and developments to watch. Fictional sample content for interface verification.'
      }))
      videos.push({ ...videos[0], ticker: 'AAPL' })
      const envelope = (data, freshness = 'fresh') => ({ data, errors: [], meta: { source: 'YouTube UI fixture', fetchedAt: Date.now(), freshness } })
      let calls = 0, thumbnails = 0, mode = 'fresh', opened = '', lastRequest, lastMutation, release, failImage = false
      window.api.portfolio = async () => envelope(portfolio)
      window.api.onPortfolioChanged = () => () => {}
      window.api.settings = async () => envelope(settings)
      window.api.mutateSettings = async mutation => { lastMutation = mutation; settings.youtubePage = mutation.value; return envelope(settings) }
      window.api.openExternal = async url => { opened = url }
      window.api.youtube = async request => {
        calls++; lastRequest = request
        if (mode === 'waiting') await new Promise(resolve => { release = resolve })
        if (mode === 'throws') throw Error('Network unavailable')
        const data = { items: mode === 'empty' ? [] : videos, warnings: mode === 'partial' || mode === 'warnings' ? ['MSFT search unavailable'] : [], fetchedAt: Date.now(), fromCacheCount: 0, fetchedCount: 3, tickersTotal: 3 }
        const result = envelope(data, ['partial', 'stale', 'failed'].includes(mode) ? mode : 'fresh')
        if (mode === 'failed') result.meta.failureReason = 'Provider unavailable'
        return result
      }
      window.api.youtubeThumbnail = async request => {
        thumbnails++
        return failImage && request.videoId === 'fixture0001'
          ? { ...envelope({ dataUri: '', resolvedUrl: '' }, 'failed'), errors: [{ reason: 'Image unavailable' }] }
          : envelope({ dataUri: image, resolvedUrl: '' })
      }
      const host = createRoot(document.getElementById('root'))
      const render = () => host.render(<QueryClientProvider client={client}><YouTubePage onStatusChange={() => {}} /></QueryClientProvider>)
      const task = () => buildTasks(portfolio, settings, { stocks: 'NVDA', fundamentals: 'NVDA' }, { year: 2026, month: 10, earningsYear: 2026, ipoYear: 2026 }).find(task => task.tab === 'youtube')
      const refresh = async next => { mode = next; void client.refetchQueries({ queryKey: queryKeys.youtube(['NVDA', 'AAPL', 'MSFT']), exact: true }); await settle() }
      window.runProbe = async () => {
        await task().run(client, 7)
        check(lastRequest.background && lastRequest.backgroundOrder === 7, 'Startup lost background priority')
        check(thumbnails === 8, 'Startup must warm every unique image including below the fold')
        render(); await settle()
        check(calls === 1 && thumbnails === 8, 'First visit triggered a new data or image load')
        check(rows().length === 9 && document.querySelector('.youtube-focus h2')?.textContent === videos[0].title, 'Warmed feed or saved sort missing: ' + rows().length + ' rows; ' + text())
        check(document.querySelectorAll('.youtube-video-row[aria-selected=true]').length === 1, 'Shared video selection count: ' + document.querySelectorAll('.youtube-video-row[aria-selected=true]').length + '; ' + rows().map(row => row.outerHTML.slice(0, 150)).join(' | '))
        rows()[1].click(); await settle()
        check(document.querySelector('.youtube-focus .youtube-ticker').textContent === 'AAPL', 'Shared video selected the wrong ticker')
        check(!document.querySelector('.youtube-player-dialog'), 'Player must wait for an explicit play action')
        button('Play video').click(); await settle()
        check(document.querySelector('.youtube-player-dialog').open, 'Play did not open an in-app dialog')
        check(document.querySelector('.youtube-player-dialog iframe').src.includes('/embed/' + videos[0].videoId), 'Player video ID wrong')
        check(!opened, 'Play opened the external browser')
        document.querySelector('[aria-label="Close video player"]').click(); await settle()
        check(!document.querySelector('iframe'), 'Close must stop and remove playback')
        document.querySelector('.youtube-preview').click(); await settle()
        check(document.querySelector('.youtube-player-dialog iframe'), 'Preview must play in app')
        document.querySelector('.youtube-player-dialog').dispatchEvent(new Event('cancel')); await settle()
        check(!document.querySelector('iframe'), 'Escape must stop playback')
        rows()[2].dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await settle()
        check(document.querySelector('iframe').src.includes('/embed/' + videos[1].videoId), 'Double click played the wrong video')
        document.querySelector('[aria-label="Close video player"]').click(); await settle()
        const tickerFilter = document.querySelector('[aria-label="Filter by portfolio ticker"]')
        tickerFilter.value = 'MSFT'; tickerFilter.dispatchEvent(new Event('change', { bubbles: true })); await settle()
        check(rows().length === 2 && rows().every(row => row.querySelector('.youtube-ticker').textContent === 'MSFT'), 'Ticker filter must match exactly')
        tickerFilter.value = ''; tickerFilter.dispatchEvent(new Event('change', { bubbles: true })); await settle()
        const input = document.querySelector('input')
        const setInput = value => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }
        setInput('Equity Brief'); await settle()
        check(rows().length === 3 && rows().every(row => row.textContent.includes('Equity Brief')), 'Channel search failed')
        setInput('zz-no-results'); await settle()
        check(rows().length === 0 && text().includes('No matching videos') && !document.querySelector('.youtube-watch'), 'Empty filter retained a watch action')
        button('Clear filters').click(); await settle()
        const sort = document.querySelector('[aria-label="Sort videos"]')
        sort.value = '3:false'; sort.dispatchEvent(new Event('change', { bubbles: true })); await settle()
        check(lastMutation.type === 'setYouTubePage' && !lastMutation.value.sortDescending && rows()[0].textContent.includes(videos[7].title), 'Sort was not applied and saved')
        await refresh('partial')
        check(text().includes('Refresh returned partial data') && rows().length === 9, 'Partial result hid videos or its availability state')
        await refresh('warnings')
        check(rows().length === 9 && !text().toLowerCase().includes('warning') && !document.querySelector('.youtube-warnings, .youtube-warning-panel'), 'Warning status or controls remain visible')
        check(!document.querySelector('.youtube-status'), 'Warning-only results must not claim everything is up to date')
        await refresh('stale'); check(text().includes('Refresh returned stale data') && rows().length === 9, 'Stale data hidden or treated as fresh')
        await refresh('failed'); check(text().includes('Provider unavailable') && rows().length === 9, 'Failure details or retained feed missing')
        await refresh('throws'); check(text().includes('Network unavailable') && rows().length === 9, 'Rejected refresh unhandled')
        await refresh('waiting'); check(document.querySelector('.youtube-feed').getAttribute('aria-busy') === 'true' && rows().length === 9, 'Loading should retain the feed')
        mode = 'fresh'; release(); await settle()
        await refresh('empty'); check(rows().length === 0 && text().includes('No videos available'), 'Empty response not shown')
        await refresh('fresh')
        host.render(null); await settle(); const previousCalls = calls, previousImages = thumbnails
        render(); await settle()
        check(calls === previousCalls && thumbnails === previousImages, 'Revisit fetched warmed content')
        failImage = true
        const failedClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        let failure = ''
        try { await task().run(failedClient) } catch (error) { failure = error.message; check(error.state === 'degraded', 'Image failure must degrade readiness') }
        check(failure.includes('thumbnail') && failedClient.getQueryData(queryKeys.youtubeThumbnail('fixture0007', '')), 'Image failure passed silently or blocked other images')
        failImage = false
        client.setQueryData(queryKeys.portfolio, envelope({ ...portfolio, portfolios: [] })); await settle()
        check(text().includes('Add portfolio tickers') && !document.querySelector('.youtube-refresh'), 'No-holdings state missing')
        client.setQueryData(queryKeys.portfolio, envelope(portfolio)); await settle()
        const many = Array.from({length: 43}, (_, i) => ({...videos[i % 8], videoId: 'many' + i, title: videos[i % 8].title + ' #' + i, descriptionSnippet: videos[i % 8].descriptionSnippet.repeat(20)}))
        for (const video of many) client.setQueryData(queryKeys.youtubeThumbnail(video.videoId, ''), envelope({dataUri: image, resolvedUrl: ''}))
        client.setQueryData(queryKeys.youtube(portfolio.portfolios[0].tickers), envelope({items: many, warnings: [], fetchedAt: Date.now(), tickersTotal: 3})); await settle()
        button('Details').click(); await settle()
        return 'PASS: startup warming/deduplication, first visit/revisit, shared-video selection, filters, saved sort, in-app playback/close/Escape/double click, loading, stale/partial/failed/empty results, refresh rejection, image failure and no holdings'
      }
      window.checkLayout = async () => {
        check(document.documentElement.scrollWidth <= innerWidth, 'Horizontal overflow')
        const feed = document.querySelector('.youtube-feed'), focus = document.querySelector('.youtube-focus'), body = document.querySelector('.youtube-body')
        check(feed.clientWidth >= 200 && focus.clientWidth >= 200, 'Workspace collapsed')
        check(body.getBoundingClientRect().bottom <= innerHeight + 1, 'Vertical viewport overflow')
        if (innerWidth > 900) check(focus.getBoundingClientRect().left > feed.getBoundingClientRect().left, 'Desktop inspector not on the right')
        else check(focus.getBoundingClientRect().top > feed.getBoundingClientRect().top, 'Narrow inspector not below table')
        const previous = () => document.querySelector('[aria-label="Previous video page"]')
        const next = () => document.querySelector('[aria-label="Next video page"]')
        let steps = 0
        while (!previous().disabled && steps++ < 43) { previous().click(); await settle() }
        const seen = new Set(), before = calls, beforeImages = thumbnails
        do {
          const area = document.querySelector('.youtube-table-wrap').getBoundingClientRect()
          check(rows().length > 0 && rows().every(row => row.getBoundingClientRect().bottom <= area.bottom + 1), 'Rows clipped instead of paginated')
          for (const row of rows()) seen.add(row.getAttribute('aria-label'))
          check(document.querySelector('.youtube-video-row[aria-selected=true]'), 'Selection fell outside current page')
          if (next().disabled) break
          next().click(); await settle()
        } while (steps++ < 90)
        check(seen.size === 43, 'Pagination lost videos: ' + seen.size)
        check(calls === before && thumbnails === beforeImages, 'Changing pages fetched prepared content')
        button('Description').click(); await settle()
        const description = document.querySelector('.youtube-fitted-text p')
        check(description.scrollHeight <= description.clientHeight + 1 && description.scrollWidth <= description.clientWidth + 1, 'Description overflows')
        const advance = document.querySelector('[aria-label="Next description page"]')
        check(advance && !advance.disabled, 'Long descriptions must remain accessible without scrolling')
        const oldText = description.textContent; advance.click(); await settle()
        check(description.textContent !== oldText, 'Description page did not advance')
        button('Details').click(); await settle()
        const bounds = focus.getBoundingClientRect()
        for (const selector of ['.youtube-preview', '.youtube-title-row', '.youtube-watch', '.youtube-inspector-tabs', '.youtube-information']) {
          const rect = document.querySelector(selector).getBoundingClientRect()
          check(rect.top >= bounds.top && rect.bottom <= bounds.bottom + 1, selector + ' clipped by inspector')
        }
        for (const element of document.querySelectorAll('[data-youtube-page], [data-youtube-page] *')) {
          const style = getComputedStyle(element)
          if (['auto', 'scroll'].includes(style.overflowY)) check(element.scrollHeight <= element.clientHeight + 1, 'Vertical scrollbar: ' + element.className)
          if (['auto', 'scroll'].includes(style.overflowX)) check(element.scrollWidth <= element.clientWidth + 1, 'Horizontal scrollbar: ' + element.className)
        }
        return 'PASS: no scrollbars, 43-video pagination, selected video and long-description paging at ' + innerWidth + 'x' + innerHeight
      }
    ` },
    bundle: true, jsx: 'automatic', write: false, format: 'iife',
    loader: { '.css': 'empty' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  await writeFile(join(scratch, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(scratch, 'index.html'), '<html><head><meta charset="UTF-8"><link rel="stylesheet" href="theme.css"></head><body><div style="height:143px;background:#0d1420;padding:24px;color:#7d8ea6">Budget Terminal · YouTube layout verification</div><div id="root" style="height:calc(100vh - 143px);display:flex"></div><script>window.api = { platform: "win32" };</script><script src="renderer.js"></script></body></html>')
  await build({ entryPoints: [join(root, 'electron/services/youtubePlayer.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: join(scratch, 'player.cjs') })
  const shellHtml = await readFile(join(root, 'src/index.html'), 'utf8')
  const policy = shellHtml.match(/content="(default-src[^"\n]+)"/)?.[1]
  assert(policy)
  await writeFile(join(scratch, 'player.html'), `<meta http-equiv="Content-Security-Policy" content="${policy}"><iframe title="YouTube playback verification" style="width:800px;height:450px" allow="autoplay; encrypted-media; fullscreen" src="https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?autoplay=1&playsinline=1&rel=0"></iframe>`)
  await writeFile(join(scratch, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron'); const fs = require('fs');
    app.setPath('userData', ${JSON.stringify(join(scratch, 'userData'))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true, webPreferences: { backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
      window.webContents.session.webRequest.onBeforeRequest({ urls: ['https://www.youtube-nocookie.com/*'] }, (_, callback) => callback({ cancel: true }));
      window.webContents.on('console-message', event => console.log(event.message));
      try {
        await window.loadFile(${JSON.stringify(join(scratch, 'index.html'))});
        console.log(await window.webContents.executeJavaScript('window.runProbe()'));
        for (const [width, height] of [[1920, 1080], [1600, 1000], [1366, 768], [1024, 650], [720, 850], [480, 800], [480, 600]]) {
          window.setContentSize(width, height); await new Promise(resolve => setTimeout(resolve, 250));
          console.log(await window.webContents.executeJavaScript('window.checkLayout()'));
          await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
          await new Promise(resolve => setTimeout(resolve, 100));
          fs.writeFileSync(${JSON.stringify(join(root, 'out/youtube-smoke-'))} + width + '.png', (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        }
        if (${process.argv.includes('--live')}) {
          window.webContents.session.webRequest.onBeforeRequest(null);
          require('./player.cjs').configureYouTubePlayer(window);
          let identified = false;
          window.webContents.session.webRequest.onSendHeaders({ urls: ['https://www.youtube-nocookie.com/embed/*'] }, details => {
            identified = Object.entries(details.requestHeaders).some(([key, value]) => key.toLowerCase() === 'referer' && value === 'https://budget-terminal.app/');
          });
          await window.loadFile(${JSON.stringify(join(scratch, 'player.html'))});
          let state;
          for (let attempt = 0; attempt < 25; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const frame = window.webContents.mainFrame.frames.find(frame => frame.url.startsWith('https://www.youtube-nocookie.com/embed/'));
            if (frame) state = await frame.executeJavaScript('JSON.stringify({ ready: document.querySelector("video")?.readyState, time: document.querySelector("video")?.currentTime, text: document.body.innerText.slice(0, 500) })').then(JSON.parse).catch(() => null);
            if (state?.time > 0) break;
          }
          if (!identified || !(state?.time > 0)) throw Error('Live player did not start: ' + JSON.stringify({ identified, state }));
          console.log('PASS: live YouTube playback, production CSP and public app Referer; playback time ' + state.time);
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
    const timeout = setTimeout(() => { child.kill(); reject(new Error('YouTube UI probe timed out')) }, 90_000)
    child.on('error', error => { clearTimeout(timeout); reject(error) })
    child.on('exit', code => { clearTimeout(timeout); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log('Screenshots: out/youtube-smoke-{1920,1366,720,480}.png')
} finally {
  assert(!relative(tmpdir(), scratch).startsWith('..'))
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
