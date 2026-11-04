import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createGenerator, createProgram, createParser, createFormatter, DEFAULT_CONFIG, SchemaGenerator, UnknownType } from 'ts-json-schema-generator'
import { createRequire } from 'node:module'
import { operations } from './operations.js'
import { featureOperations } from './features.js'
import { TABS } from '../electron/shared/contract.js'

// Use the generator's compiler: the workspace compiler may expose only CLI APIs.
const schemaRequire = createRequire(createRequire(import.meta.url).resolve('ts-json-schema-generator'))
const regexKind: number = schemaRequire('typescript').SyntaxKind.RegularExpressionLiteral

const root = resolve(import.meta.dirname, '..')
const directory = resolve(root, 'out/mcp-schemas')
await mkdir(directory, { recursive: true })
const input = resolve(directory, 'inputs.ts')
const contract = await readFile(resolve(root, 'electron/shared/contract.ts'), 'utf8')
const desktopApi = contract.slice(contract.indexOf('export interface DesktopApi'))
const external = ['BitcoinRequest', 'ForexRequest', 'ForexPairRequest', 'ForexHistoryRequest', 'Sp500Request', 'Sp500BreadthRequest']
const aliases = Object.keys(operations).map((key) => {
  if (featureOperations.has(key)) return `export type Input_${key} = Features.${key[0].toUpperCase() + key.slice(1)}Request`
  if (key === 'screenshot') return 'export type Input_screenshot = ScreenshotRequest'
  const method = desktopApi.match(new RegExp(`\\b${key}\\(\\s*(?:\\w+\\??:\\s*([\\s\\S]*?))?\\s*\\):\\s*Promise`))
  if (!method) throw new Error(`Cannot resolve DesktopApi request for ${key}`)
  const type = method[1]?.replace(/\b[A-Z]\w*/g, (name) => name === 'Record' || external.includes(name) ? name : `Contract.${name}`) ?? 'Record<string, never>'
  return `export type Input_${key} = ${type}`
})
await writeFile(input, `import type * as Features from '../../mcp/features.js'
import type * as Contract from '../../electron/shared/contract.js'
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
const outputInput = resolve(directory, 'outputs.ts')
const outputAliases = Object.keys(operations).filter(key => !featureOperations.has(key)).map(key => {
  if (key === 'screenshot') return 'export type Output_screenshot = Envelope<ScreenshotPayload>'
  const method = desktopApi.match(new RegExp(`\\b${key}\\([\\s\\S]*?\\):\\s*Promise<([^\\n]+)>`))
  if (!method) throw new Error(`Cannot resolve output for ${key}`)
  return `export type Output_${key} = ${method[1]}`
})
// Imported payloads also reference the original contract. Namespace the copied
// declarations so the generator can distinguish both definition graphs.
const localNames = [...contract.matchAll(/export (?:interface|type|const) (\w+)/g)].map(match => match[1])
const localize = (text: string) => text.replace(new RegExp(`\\b(${localNames.join('|')})\\b`, 'g'), name => `McpOutput${name}`)
const modules: string[] = []
const expanded = contract.replace(/import\('([^']+)'\)\.(\w+)/g, (_match, module: string, name: string) => {
  let index = modules.indexOf(module)
  if (index < 0) { index = modules.length; modules.push(module) }
  return `OutputModule${index}.${name}`
})
const moduleImports = modules.map((module, index) => `import type * as OutputModule${index} from '${module}'`).join('\n')
await writeFile(outputInput, (moduleImports + '\n' + localize(expanded)).replaceAll("'./", "'../../electron/shared/") + `\nimport type { ScreenshotPayload } from '../../electron/shared/screenshot.js'\n` + localize(outputAliases.join('\n')))
const outputConfig = { ...DEFAULT_CONFIG, path: outputInput, tsconfig: resolve(root, 'tsconfig.json'), skipTypeCheck: true, expose: 'all' as const }
const outputProgram = createProgram(outputConfig)
// Regex values in metric catalogs are implementation details, never JSON output.
// Parsing their enclosing const catalog is necessary to resolve metric ID unions.
const outputParser = createParser(outputProgram, outputConfig, parser => parser.addNodeParser({
  supportsNode: node => node.kind === regexKind,
  createType: () => new UnknownType(),
}))
const outputGenerator = new SchemaGenerator(outputProgram, outputParser, createFormatter(outputConfig), outputConfig)
const outputs = Object.fromEntries(Object.keys(operations).filter(key => !featureOperations.has(key)).map(key => {
  try { return [key, outputGenerator.createSchema('Output_' + key)] }
  catch (error) { throw new Error('Output ' + key + ': ' + (error as Error).message) }
}))
const outputPath = resolve(root, 'mcp/output-schemas.json')
const outputContents = `${JSON.stringify(outputs, null, 2)}\n`
if (process.argv.includes('--check')) {
  if (await readFile(outputPath, 'utf8') !== outputContents) throw new Error('MCP output schemas are out of date.')
} else await writeFile(outputPath, outputContents)
