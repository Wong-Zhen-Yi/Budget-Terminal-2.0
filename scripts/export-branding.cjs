// Package the approved Fold icon for desktop platforms using Electron's image encoder.
const { join } = require('node:path')
const { writeFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')

if (!process.versions.electron) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[key]
  }
  const result = spawnSync(require('electron'), [__filename], { env, windowsHide: true, stdio: 'inherit' })
  if (result.error) console.error(result.error.message)
  process.exit(result.status ?? 1)
}

const { app, nativeImage } = require('electron')
app.disableHardwareAcceleration()
app.whenReady().then(() => {
  const root = join(__dirname, '../apps/desktop')
  const source = nativeImage.createFromPath(join(root, 'src/assets/branding/budget-terminal-fold-icon-source.png'))
  if (source.isEmpty()) throw new Error('Fold icon source is missing or invalid.')
  writeFileSync(join(root, 'resources/budget-terminal-icon.png'), source.resize({ width: 512, height: 512, quality: 'best' }).toPNG())
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const images = sizes.map(size => source.resize({ width: size, height: size, quality: 'best' }).toPNG())
  const header = Buffer.alloc(6 + sizes.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16
    header[entry] = header[entry + 1] = size === 256 ? 0 : size
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(images[index].length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += images[index].length
  })
  writeFileSync(join(root, 'resources/budget-terminal-icon.ico'), Buffer.concat([header, ...images]))
  console.log('Exported Fold PNG (512px) and Windows ICO (16–256px).')
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
