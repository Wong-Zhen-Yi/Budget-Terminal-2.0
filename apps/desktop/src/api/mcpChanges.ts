import type { QueryClient } from '@tanstack/react-query'
import type { SavedDataChanged } from '@shared/contract'

/** Refresh prepared pages as well as visible observers after an external saved-data edit. */
export async function refreshSavedData(client: QueryClient, { domains }: SavedDataChanged): Promise<void> {
  const keys = new Set<string>(domains)
  if (domains.includes('portfolio')) {
    for (const key of ['cardsPerformance', 'analytics', 'momentum', 'returns', 'optionQuotes']) keys.add(key)
  }
  if (domains.includes('cards')) keys.add('cardsPerformance')
  await client.invalidateQueries({
    predicate: (query) => typeof query.queryKey[0] === 'string' && keys.has(query.queryKey[0]),
    refetchType: 'all',
  })
}
