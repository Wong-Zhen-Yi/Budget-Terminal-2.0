export interface LocalSendDevice {
  fingerprint: string
  alias: string
  address: string
  port: number
  protocol: 'https' | 'http'
  budgetTerminal: boolean
  paired?: boolean
  lastSyncedAt?: number
  error?: string
}

export interface LocalSendStatus {
  enabled: boolean
  running: boolean
  alias: string
  port: number
  addresses: string[]
  pairingCode?: string
  pairingExpiresAt?: number
  devices: LocalSendDevice[]
  pending?: { id: string; alias: string; exportedAt: string; receivedAt: number }
  recoveryPath?: string
  message?: string
  error?: string
}

export type LocalSendAction =
  | { type: 'enable'; enabled: boolean; port?: number }
  | { type: 'discover' }
  | { type: 'connect'; address: string; port: number }
  | { type: 'openPairing' }
  | { type: 'pair'; fingerprint: string; code: string }
  | { type: 'forget'; fingerprint: string }
  | { type: 'sync' }
  | { type: 'resolve'; id: string; accept: boolean }
