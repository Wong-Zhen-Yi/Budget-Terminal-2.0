const { readFileSync, statSync } = require('node:fs')
const { resolve } = require('node:path')

/** Never open Electron onto a partial or missing production build. */
function verifyDesktopBuild(directory = resolve(__dirname, '../apps/desktop')) {
  const required = ['out/main/main.js', 'out/main/quantWorker.js', 'out/main/cacheWorker.js', 'out/preload/preload.cjs']
  try {
    for (const entry of ['index.html', 'mobile.html']) {
      const htmlPath = `out/renderer/${entry}`
      const html = readFileSync(resolve(directory, htmlPath), 'utf8')
      const assets = [...html.matchAll(/(?:src|href)=["'](\.\/assets\/[^"']+)["']/g)].map(match =>
        `out/renderer/${decodeURIComponent(match[1])}`)
      if (!assets.some(file => file.endsWith('.js'))) {
        throw new Error(`${entry} does not reference a built JavaScript entry.`)
      }
      required.push(htmlPath, ...assets)
    }
    for (const file of required) {
      const info = statSync(resolve(directory, file))
      if (!info.isFile() || info.size === 0) throw new Error(`Missing or empty build file: ${file}`)
    }
  } catch (error) {
    throw new Error(`The desktop build is incomplete: ${error.message}\nClose Budget Terminal and any running dev/build commands, then run Launch Budget Terminal.cmd again (or npm run build from the repository root).`)
  }
}

module.exports = { verifyDesktopBuild }
