import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { MarketApiKeyStore } from './marketApiKeys.js'

export const marketApiKeys = new MarketApiKeyStore({
  path: () => join(app.getPath('userData'), 'market-api-keys.bin'),
  available: () => safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
  encrypt: value => safeStorage.encryptString(value),
  decrypt: bytes => safeStorage.decryptString(bytes),
})
