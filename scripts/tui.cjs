const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { build } = require('esbuild')

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log('BT TUI - Portfolio and Agents\n\nUsage: npm run tui [-- --build-only | --help]\n\nF1 opens Portfolio; F2 opens Agents research chat. In Agents, Enter sends, /help lists commands and Ctrl+C exits. Saved portfolios, live holdings, candlestick charts and options. C toggles charts; Up/Down selects tickers; 1/2/3 selects hour/day/week; +/- zooms. Left/Right switches books; R refreshes; H hides values; Tab shows options; Q exits.')
    return
  }
  if (args.some(arg => arg !== '--build-only')) throw new Error('Unknown option. Use --help for usage.')
  const buildOnly = args.includes('--build-only')
  if (!buildOnly && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('Run BT in an interactive terminal window.')
  const desktop = path.resolve(__dirname, '../apps/desktop')
  const output = path.join(desktop, 'out/tui/main.mjs')
  await build({
    entryPoints: [path.join(desktop, 'tui/main.ts')], outfile: output,
    bundle: true, platform: 'node', format: 'esm', target: 'node22',
    banner: { js: "import { createRequire as __tuiCreateRequire } from 'node:module'; const require = __tuiCreateRequire(import.meta.url);" },
    // In Node the Electron package exports an executable path, not named APIs.
    // Preserve CJS property access as in our tsx service probes. Desktop-only
    // actions are excluded by the Agents research tool allowlist.
    plugins: [{ name: 'node-electron-imports', setup(builder) {
      builder.onResolve({ filter: /^electron$/ }, args => args.namespace === 'node-electron'
        ? { path: 'electron', external: true } : { path: 'electron', namespace: 'node-electron' })
      builder.onLoad({ filter: /.*/, namespace: 'node-electron' }, () => ({ contents: "module.exports = require('electron')", loader: 'js' }))
    } }],
  })
  await build({ entryPoints: [path.join(desktop, 'electron/workers/cacheWorker.ts')], outfile: path.join(desktop, 'out/tui/cacheWorker.js'), bundle: true, platform: 'node', format: 'esm', target: 'node22' })
  await build({ entryPoints: [path.join(desktop, 'electron/workers/quantWorker.ts')], outfile: path.join(desktop, 'out/tui/quantWorker.js'), bundle: true, platform: 'node', format: 'esm', target: 'node22' })
  if (buildOnly) {
    console.log('BT TUI Portfolio and Agents built successfully. No services are started.')
    return
  }
  await import(pathToFileURL(output).href)
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
