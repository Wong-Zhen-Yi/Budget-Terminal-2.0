import { retainedQueryOptions } from './snapshotResult'
import { useCallback } from 'react'
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useQuery } from '@/api/progressiveQuery'

import type {
  Envelope,
  NewsArticle,
  NewsPagePayload,
  NewsPreviewPayload,
  NewsThumbnailPayload,
  NewsTickerSearchPayload,
} from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'
import { queryFreshness } from './queryPersistence'
import { FRESHNESS } from '@shared/freshness'

/** Refresh the mounted News page on the same five-minute cadence as its source caches. */
export function useNewsPage(tickers: string[]): UseQueryResult<Envelope<NewsPagePayload>> {
  return useQuery({
    queryKey: queryKeys.newsPage(tickers),
    queryFn: () => api.newsPage({ tickers, force: forcing() }),
    enabled: tickers.length > 0,
    refetchInterval: FRESHNESS.newsPage,
    refetchIntervalInBackground: false,
    staleTime: queryFreshness(queryKeys.newsPage(tickers)),
  })
}

/**
 * The page's own Refresh, which passes `force` outright rather than relying on the Reload
 * window — without it the main process would answer from its own five-minute TTL cache and
 * the button would look dead.
 */
export function useRefreshNewsPage(tickers: string[]): () => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    await queryClient.fetchQuery(retainedQueryOptions(queryClient, {
      queryKey: queryKeys.newsPage(tickers),
      queryFn: () => api.newsPage({ tickers, force: true }),
      staleTime: 0,
    }))
  }, [queryClient, tickers])
}

/**
 * Outside-portfolio ticker news. Its own query, so running a search does not invalidate
 * the page payload and send all three lanes back to the network.
 */
export function useNewsTickerSearch(
  tickers: string[],
): UseQueryResult<Envelope<NewsTickerSearchPayload>> {
  return useQuery({
    queryKey: queryKeys.newsTickerSearch(tickers),
    queryFn: () => api.newsTickerSearch({ tickers }),
    enabled: tickers.length > 0,
    refetchInterval: false,
    staleTime: queryFreshness(queryKeys.newsTickerSearch(tickers)),
  })
}

/**
 * The reader pane's body.
 *
 * The reference guards this with `_p34_preview_request_id` so a slow fetch cannot land on
 * a selection that has since changed. Nothing like that is needed here: the query key is
 * the article's url, so a late response lands in a cache entry nobody is reading.
 */
export function useNewsPreview(
  article: NewsArticle | null,
): UseQueryResult<Envelope<NewsPreviewPayload>> {
  const url = article?.url ?? ''
  return useQuery({
    queryKey: queryKeys.newsPreview(url),
    queryFn: () =>
      api.newsArticle({ url, title: article?.title ?? '', summary: article?.summary ?? '' }),
    enabled: Boolean(url),
    refetchInterval: false,
    staleTime: Infinity,
    retry: false,
  })
}

/**
 * One card's thumbnail, as a `data:` URI from the main process — the renderer's CSP is
 * `img-src 'self' data:`, so a remote `<img src>` would be blocked silently.
 *
 * `enabled` is the card's own visibility gate. React Query dedupes by key, so twenty cards
 * sharing a publisher image cost one round trip between them.
 */
export function useNewsThumbnail(
  url: string,
  enabled: boolean,
): UseQueryResult<Envelope<NewsThumbnailPayload>> {
  return useQuery({
    queryKey: queryKeys.newsThumbnail(url),
    queryFn: () => api.newsThumbnail({ url }),
    enabled: enabled && Boolean(url),
    refetchInterval: false,
    staleTime: Infinity,
    retry: false,
  })
}
