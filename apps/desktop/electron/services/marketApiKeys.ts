import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { MARKET_API_PROVIDERS } from '../shared/marketApiKeys.js'
import type { MarketApiKeyStatus, MarketApiProvider } from '../shared/marketApiKeys.js'
import { failed, ok } from '../shared/envelope.js'

type Keys = Partial<Record<MarketApiProvider, string>>

/** No network access or key getter: these credentials are reserved for future integrations. */
export class MarketApiKeyStore {
  private pending: Promise<unknown> = Promise.resolve()

  constructor(private readonly storage: {
    path: () => string
    available: () => boolean
    encrypt: (value: string) => Buffer
    decrypt: (value: Buffer) => string
  }) {}

  private async load(): Promise<Keys> {
    let bytes: Buffer
    try { bytes = await readFile(this.storage.path()) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error }
    if (!this.storage.available()) throw new Error('Encryption unavailable')
    const data: unknown = JSON.parse(this.storage.decrypt(bytes))
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid store')
    const keys: Keys = {}
    for (const { id } of MARKET_API_PROVIDERS) {
      const value = (data as Record<string, unknown>)[id]
      if (value !== undefined && (typeof value !== 'string' || !value.trim())) throw new Error('Invalid store')
      if (typeof value === 'string') keys[id] = value
    }
    return keys
  }

  private status(keys: Keys): MarketApiKeyStatus {
    return { configured: { alltick: Boolean(keys.alltick), finnhub: Boolean(keys.finnhub), fmp: Boolean(keys.fmp) }, encryptionAvailable: this.storage.available() }
  }

  read() {
    return this.enqueue(async () => {
      try { return ok(this.status(await this.load()), 'local-credentials') }
      catch { return failed(this.status({}), 'Unable to read encrypted API keys. Check the system keyring and try again.', 'local-credentials') }
    })
  }

  mutate(request: unknown) {
    return this.enqueue(async () => {
      let keys: Keys = {}
      try {
        if (!request || typeof request !== 'object') throw new Error('Invalid request')
        const { type, provider, key } = request as Record<string, unknown>
        if (!MARKET_API_PROVIDERS.some(entry => entry.id === provider) || (type !== 'save' && type !== 'remove')) throw new Error('Invalid request')
        if (type === 'save' && (typeof key !== 'string' || !key.trim() || key.length > 4096 || /\s/.test(key.trim()))) throw new Error('Invalid key')
        keys = await this.load()
        if (!this.storage.available()) throw new Error('Encryption unavailable')
        const next = { ...keys }
        if (type === 'save') next[provider as MarketApiProvider] = (key as string).trim()
        else delete next[provider as MarketApiProvider]
        const path = this.storage.path()
        if (Object.keys(next).length) {
          const bytes = this.storage.encrypt(JSON.stringify(next))
          await mkdir(dirname(path), { recursive: true })
          try {
            await writeFile(path + '.tmp', bytes, { mode: 0o600 })
            await rename(path + '.tmp', path)
          } finally { await rm(path + '.tmp', { force: true }) }
        } else { await rm(path, { force: true }) }
        return ok(this.status(next), 'local-credentials')
      } catch {
        return failed(this.status(keys), 'Unable to update API key. Enter a valid key and ensure OS credential encryption is available.', 'local-credentials')
      }
    })
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.pending.then(run, run)
    this.pending = next.catch(() => undefined)
    return next
  }
}

