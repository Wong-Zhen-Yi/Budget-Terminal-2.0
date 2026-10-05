import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createGenerator } from 'ts-json-schema-generator'
import { operations } from './operations.js'
import { TABS } from '../electron/shared/contract.js'

const root = resolve(import.meta.dirname, '..')
const directory = resolve(root, 'out/mcp-schemas')
await mkdir(directory, { recursive: true })
const input = resolve(directory, 'inputs.ts')
const contract = await readFile(resolve(root, 'electron/shared/contract.ts'), 'utf8')
const desktopApi = contract.slice(contract.indexOf('export interface DesktopApi'))
const external = ['BitcoinRequest', 'ForexRequest', 'ForexPairRequest', 'ForexHistoryRequest', 'Sp500Request', 'Sp500BreadthRequest']
const aliases = Object.keys(operations).map((key) => {
  if (key === 'screenshot') return 'export type Input_screenshot = ScreenshotRequest'
  const method = desktopApi.match(new RegExp(`\\b${key}\\(\\s*(?:\\w+\\??:\\s*([\\s\\S]*?))?\\s*\\):\\s*Promise`))
  if (!method) throw new Error(`Cannot resolve DesktopApi request for ${key}`)
  const type = method[1]?.replace(/\b[A-Z]\w*/g, (name) => name === 'Record' || external.includes(name) ? name : `Contract.${name}`) ?? 'Record<string, never>'
  return `export type Input_${key} = ${type}`
})
await writeFile(input, `import type * as Contract from '../../electron/shared/contract.js'
import type { BitcoinRequest } from '../../electron/shared/bitcoin.js'
import type { ForexRequest, ForexPairRequest, ForexHistoryRequest } from '../../electron/shared/forex.js'
import type { Sp500Request, Sp500BreadthRequest } from '../../electron/shared/sp500.js'
import type { ScreenshotRequest } from '../../electron/shared/screenshot.js'
${aliases.join('\n')}\n`)

const generator = createGenerator({ path: input, tsconfig: resolve(root, 'tsconfig.json'), skipTypeCheck: true, expose: 'all' })
const schemas: Record<string, unknown> = {}
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean)
  if (!value || typeof value !== 'object') return value
  const object = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(object)) {
    if (key === '$schema') continue
    if (key === 'properties' && entry && typeof entry === 'object') {
      result[key] = Object.fromEntries(Object.entries(entry).filter(([name]) => !['background', 'backgroundOrder'].includes(name)).map(([name, field]) => [name, clean(field)]))
    } else result[key] = clean(entry)
  }
  return result
}
for (const key of Object.keys(operations)) {
  const schema = generator.createSchema(`Input_${key}`)
  if (key === 'screenshot') {
    // Derive the page allowlist from navigation so newly implemented pages are
    // exposed automatically, while typo/path inputs still fail validation.
    const request = schema.definitions?.ScreenshotRequest as { properties: { page: { enum?: string[] } } }
    request.properties.page.enum = ['current', 'all', ...TABS.filter((tab) => tab.implemented).map((tab) => tab.id)]
  }
  schemas[key] = clean(schema)
}
const output = resolve(root, 'mcp/schemas.json')
const contents = `${JSON.stringify(schemas, null, 2)}\n`
if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8') !== contents) throw new Error('MCP schemas are out of date. Run npm run generate:mcp --workspace budget-terminal-desktop.')
} else await writeFile(output, contents)
