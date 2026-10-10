import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ArticlesMutation } from '@shared/articles'
import { api, queryKeys } from './client'

export function useArticles() {
  return useQuery({ queryKey: queryKeys.articles, queryFn: () => api.articles(), staleTime: Infinity })
}

export function useArticlesMutation() {
  const client = useQueryClient()
  return async (mutation: ArticlesMutation) => {
    const result = await api.mutateArticles(mutation)
    if (result.meta.freshness === 'failed') throw new Error(result.meta.failureReason ?? 'Could not save article.')
    client.setQueryData(queryKeys.articles, result)
    return result.data
  }
}
