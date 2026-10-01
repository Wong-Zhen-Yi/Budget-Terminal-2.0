import { build } from 'esbuild'
import { mkdir, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'out/mcp/server.mjs')
await build({
  entryPoints: [resolve(root, 'mcp/server.ts')], outfile: output,
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  banner: { js: "import { createRequire as __mcpCreateRequire } from 'node:module'; const require = __mcpCreateRequire(import.meta.url);" },
})
const plugin = resolve(root, '../../plugins/budget-terminal/server')
await mkdir(plugin, { recursive: true })
await copyFile(output, resolve(plugin, 'server.mjs'))
