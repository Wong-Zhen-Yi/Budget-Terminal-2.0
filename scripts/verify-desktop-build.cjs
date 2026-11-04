const { readFileSync, statSync } = require('node:fs')
const { resolve } = require('node:path')

/** Never open Electron onto a partial or missing production build. */
function verifyDesktopBuild(directory = resolve(__dirname, '../apps/desktop')) {
  const required = ['out/main/main.js', 'out/main/quantWorker.js', 'out/main/cacheWorker.js', 'out/preload/preload.cjs', 'out/renderer/index.html']
  const htmlPath = resolve(directory, 'out/renderer/index.html')
  try {
    const html = readFileSync(htmlPath, 'utf8')
    for (const match of html.matchAll(/(?:src|href)=["'](\.\/assets\/[^"']+)["']/g)) {
      required.push(`out/renderer/${decodeURIComponent(match[1])}`)
    }
    if (!required.some(file => file.endsWith('.js') && file.startsWith('out/renderer/'))) {
      throw new Error('The renderer HTML does not reference a built JavaScript entry.')
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
