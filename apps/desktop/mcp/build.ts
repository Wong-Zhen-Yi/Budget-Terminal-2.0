import { build } from 'esbuild'
import { resolve } from 'node:path'
import { publishBundle } from './publishBundle.js'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'out/mcp/server.mjs')
const result = await build({
  entryPoints: [resolve(root, 'mcp/server.ts')], outfile: output, write: false,
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  banner: { js: "import { createRequire as __mcpCreateRequire } from 'node:module'; const require = __mcpCreateRequire(import.meta.url);" },
})
const contents = result.outputFiles[0].contents
await publishBundle(output, contents)
await publishBundle(resolve(root, '../../plugins/budget-terminal/server/server.mjs'), contents)
