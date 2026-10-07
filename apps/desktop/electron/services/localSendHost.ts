import { dirname, join } from 'node:path'
import type { LocalSendAction, LocalSendStatus } from '../shared/localSend.js'
import { failed } from '../shared/envelope.js'
import { onUserDataSaved } from './automaticBackup.js'
import { settingsPath } from './settingsStore.js'
import { applySyncSnapshot, readSyncSnapshot } from './syncSnapshot.js'
import { LocalSendSync } from './localSendSync.js'

let sync: LocalSendSync | undefined
let failure = 'LocalSend sync is starting.'

export async function startLocalSendSync(onApplied: () => void): Promise<() => Promise<void>> {
  const directory = join(dirname(settingsPath()), 'sync')
  sync = new LocalSendSync(directory, {
    read: readSyncSnapshot,
    apply: (snapshot, expected) => applySyncSnapshot(snapshot, expected, join(directory, 'recovery')),
    onApplied,
  })
  try { await sync.initialize() }
  catch (error) { failure = String(error); sync = undefined; console.warn('LocalSend sync failed:', error) }
  const unsubscribe = onUserDataSaved(() => sync?.scheduleSync())
  return async () => { unsubscribe(); await sync?.stop() }
}

const unavailable = () => failed<LocalSendStatus>({ enabled: false, running: false, alias: 'Budget Terminal', port: 53317, addresses: [], devices: [], error: failure }, failure, 'LocalSend sync')

export const localSendStatus = () => sync?.status() ?? unavailable()
export const localSendAction = (action: LocalSendAction) => sync?.action(action) ?? Promise.resolve(unavailable())
