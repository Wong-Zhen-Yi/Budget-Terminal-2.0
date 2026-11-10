import type { QueryClient } from '@tanstack/react-query'
import type { SavedDataChanged } from '@shared/contract'

const pending = new WeakMap<QueryClient, { domains: Set<SavedDataChanged['domains'][number]>; metadataOnly: boolean; task: Promise<void> }>()

/** Refresh prepared pages as well as visible observers after an external saved-data edit. */
export function refreshSavedData(client: QueryClient, event: SavedDataChanged): Promise<void> {
  const existing = pending.get(client)
  if (existing) {
    event.domains.forEach(domain => existing.domains.add(domain))
    if (event.domains.includes('portfolio')) existing.metadataOnly &&= !!event.portfolioMetadataOnly
    return existing.task
  }
  const batch = { domains: new Set(event.domains), metadataOnly: !event.domains.includes('portfolio') || !!event.portfolioMetadataOnly, task: Promise.resolve() }
  pending.set(client, batch)
  batch.task = (async () => {
    while (batch.domains.size) {
      await new Promise(resolve => setTimeout(resolve, 25))
      const domains = [...batch.domains]
      const portfolioMetadataOnly = batch.metadataOnly
      batch.domains.clear()
      batch.metadataOnly = true
      await refreshNow(client, { domains, portfolioMetadataOnly })
    }
  })().finally(() => pending.delete(client))
  return batch.task
}

async function refreshNow(client: QueryClient, { domains, portfolioMetadataOnly }: SavedDataChanged): Promise<void> {
  const keys = new Set<string>(domains)
  if (domains.includes('portfolio') && !portfolioMetadataOnly) {
    for (const key of ['cardsPerformance', 'analytics', 'momentum', 'returns', 'optionQuotes']) keys.add(key)
  }
  if (domains.includes('cards')) keys.add('cardsPerformance')
  await client.invalidateQueries({
    predicate: (query) => typeof query.queryKey[0] === 'string' && keys.has(query.queryKey[0]),
    refetchType: 'all',
  })
}
