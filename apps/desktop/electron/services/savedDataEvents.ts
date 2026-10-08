import type { SavedDataChanged, SavedDataDomain } from '../shared/contract.js'

const listeners = new Set<(event: SavedDataChanged) => void>()

export function publishSavedDataChanged(domains: SavedDataDomain[]): void {
  const event = { domains: [...new Set(domains)] }
  for (const listener of listeners) {
    try { listener(event) } catch { console.warn('A saved-data subscriber could not refresh.') }
  }
}

export function subscribeSavedDataChanged(listener: (event: SavedDataChanged) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
