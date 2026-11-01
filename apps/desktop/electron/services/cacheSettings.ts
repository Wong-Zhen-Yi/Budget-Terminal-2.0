import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DEFAULT_CACHE_SETTINGS, validCacheSettings, type CacheSettings } from '../shared/cachePolicy.js'

export function cacheSettingsPath(): string {
  return join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'),
    'BudgetTerminalElectron', 'cache-settings.json')
}

export function readCacheSettings(): CacheSettings {
  try {
    const value: unknown = JSON.parse(readFileSync(cacheSettingsPath(), 'utf8'))
    if (validCacheSettings(value)) return value
  } catch { /* Missing or damaged preferences use safe defaults. */ }
  return { ...DEFAULT_CACHE_SETTINGS }
}

let writeQueue = Promise.resolve()

export function saveCacheSettings(value: unknown): Promise<CacheSettings> {
  if (!validCacheSettings(value)) return Promise.reject(new Error('Cache limits are outside the supported range.'))
  const settings: CacheSettings = { rendererMiB: value.rendererMiB, marketMiB: value.marketMiB,
    assetsMiB: value.assetsMiB, retentionDays: value.retentionDays }
  const operation = writeQueue.then(async () => {
    const target = cacheSettingsPath()
    await mkdir(dirname(target), { recursive: true })
    const temporary = `${target}.tmp`
    await writeFile(temporary, JSON.stringify(settings), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, target)
    return settings
  })
  writeQueue = operation.then(() => undefined, () => undefined)
  return operation
}
