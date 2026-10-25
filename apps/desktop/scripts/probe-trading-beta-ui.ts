import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-trading-beta-ui-'))
try {
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
        import { createRoot } from 'react-dom/client'
        import { BetaDotPlot } from './src/components/tradingvolumes/BetaDotPlot'
        const check = (value, message) => { if (!value) throw Error(message) }
        const settle = () => new Promise(resolve => setTimeout(resolve, 120))
        const row = (ticker, volume, history = true) => ({
          ticker, thirtyDayAvgDollarVolume: volume, fiveDayAvgDollarVolume: volume * 2,
          betaHistory: history ? [{ date: '2026-10-14', value: 0.9 }, { date: '2026-10-15', value: 1.1 }] : [],
        })
        const rows = [row('A', 1e7), row('B', 2e7), row('C', 3e7), row('D', 4e7), row('OUTLIER', 1e11),
          row('NO_HISTORY', 1e18, false), row('NO_VOLUME', null), row('INVALID', Infinity)]
        const root = createRoot(document.getElementById('root'))
        const render = async (rows, interval = '30d') => {
          root.render(<BetaDotPlot rows={rows} interval={interval} />)
          await settle(); await settle()
        }
        const dots = () => [...document.querySelectorAll('svg circle')]
        const positions = () => dots().map(dot => Number(dot.getAttribute('cx')))
        const centered = () => {
          const xs = positions().sort((a, b) => a - b)
          const median = (xs[Math.floor(xs.length / 2)] + xs[Math.floor((xs.length - 1) / 2)]) / 2
          const svg = document.querySelector('svg')
          const width = svg.viewBox.baseVal.width
          const middle = (65 + width - 20) / 2
          check(Math.abs(median - middle) < 0.01, 'Median ticker must be in plot center: ' + median + ' vs ' + middle)
          check(xs.every(x => Number.isFinite(x) && x > 65 && x < width - 20), 'All dots, including outliers, stay inside plot')
        }
        window.runProbe = async () => {
          await render(rows)
          check(dots().length === 5, 'Only finite positive volumes with Beta history plotted')
          centered()
          const xs = positions()
          check(Math.abs((xs[1] - xs[0]) / (xs[2] - xs[0]) - Math.log10(2) / Math.log10(3)) < 1e-10, 'Preserve logarithmic volume spacing')
          const ticks = () => [...document.querySelectorAll('svg text')].filter(text => text.textContent.startsWith('$')).map(text => text.textContent).join('|')
          const before = ticks()
          ;[...document.querySelectorAll('button')].find(button => button.textContent === 'Replay').click()
          await settle()
          check(JSON.stringify(positions()) === JSON.stringify(xs) && ticks() === before, 'Replay keeps horizontal positions and scale fixed')
          await render(rows.slice(0, 4))
          centered()
          await render([rows[0]])
          centered()
          await render([row('SAME1', 1e7), row('SAME2', 1e7)])
          centered()
          await render(rows.filter(row => row.ticker !== 'OUTLIER'), '5d')
          centered()
          await render(rows)
          document.getElementById('root').style.width = '700px'
          await settle(); await settle()
          centered()
          await render([row('MISSING', 1e7, false)])
          check(!document.querySelector('svg') && document.body.textContent.includes('Refresh to load Beta history'), 'Missing history remains visible as empty state')
          await render([])
          check(!document.querySelector('svg'), 'Empty filter is safe')
          return 'PASS: Beta cluster centered, outliers visible, log spacing, replay stability, even/odd/single/equal volumes, filtering, intervals, resize and missing data'
        }
      `,
    },
    bundle: true, jsx: 'automatic', write: false, format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
  })
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(file => file.endsWith('.css'))
  assert.ok(css, 'Run npm run build before this UI probe')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), '<link rel="stylesheet" href="theme.css"><style>html,body,#root{height:100%;margin:0}#root{display:flex;width:100%}</style><div id="root"></div><script src="renderer.js"></script>')
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: true, width: 1500, height: 850, webPreferences: { backgroundThrottling: false } })
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        console.log(await window.webContents.executeJavaScript('window.runProbe()'))
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
    const timer = setTimeout(() => { child.kill(); reject(new Error('Beta UI probe timed out')) }, 30_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
