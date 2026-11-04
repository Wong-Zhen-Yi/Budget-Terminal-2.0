const { buildSync } = require('esbuild')
const { resolve } = require('node:path')
const root = resolve(__dirname, '../apps/desktop')

// Standalone bundles only. Do not empty output directories or rebuild the running app.
buildSync({ entryPoints: [resolve(root, 'electron/logViewer.ts')], outfile: resolve(root, 'out/main/logViewer.js'),
  bundle: true, platform: 'node', format: 'esm', external: ['electron'], logLevel: 'warning' })
buildSync({ entryPoints: [resolve(root, 'electron/logViewerPreload.ts')], outfile: resolve(root, 'out/preload/logViewer.cjs'),
  bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'warning' })
