import { createContext } from 'react'
import type { QueryKey } from '@tanstack/react-query'

export const PageQueryScope = createContext<string | undefined>(undefined)
const owners = new Map<string, Map<string, { key: QueryKey; count: number }>>()
export function registerPageQuery(page: string, hash: string, key: QueryKey) {
  const queries = owners.get(page) ?? new Map()
  owners.set(page, queries)
  const entry = queries.get(hash) ?? { key, count: 0 }
  entry.count += 1
  queries.set(hash, entry)
  return () => {
    entry.count -= 1
    if (!entry.count) queries.delete(hash)
    if (!queries.size) owners.delete(page)
  }
}
export const pageQueryKeys = (page: string): QueryKey[] => [...(owners.get(page)?.values() ?? [])].map(entry => entry.key)
